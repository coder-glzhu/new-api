#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web/default"
CLASSIC_WEB_DIR="$ROOT_DIR/web/classic"
LOG_DIR="$ROOT_DIR/logs"
ENV_FILE="$ROOT_DIR/.env"

export PATH="$HOME/.bun/bin:$PATH"

BACKEND_PORT="${PORT:-3000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5174}"
BACKEND_START_TIMEOUT_SECONDS="${BACKEND_START_TIMEOUT_SECONDS:-240}"
FRONTEND_START_TIMEOUT_SECONDS="${FRONTEND_START_TIMEOUT_SECONDS:-40}"

export PORT="$BACKEND_PORT"
export REDIS_CONN_STRING="${REDIS_CONN_STRING:-}"
export TZ="${TZ:-Asia/Shanghai}"
export GOCACHE="${GOCACHE:-/tmp/go-build-cache}"

mkdir -p "$LOG_DIR" "$GOCACHE"

load_env_file() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

port_open() {
  local host="$1"
  local port="$2"
  if has_cmd nc; then
    nc -z "$host" "$port" >/dev/null 2>&1
    return $?
  fi
  if has_cmd lsof; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local name="$3"
  local attempts="${4:-40}"
  local pid="${5:-}"
  local log_file="${6:-}"

  for _ in $(seq 1 "$attempts"); do
    if port_open "$host" "$port"; then
      return 0
    fi
    if [ -n "$pid" ] && ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "${name} 进程已退出，未能监听 ${host}:${port}" >&2
      if [ -n "$log_file" ] && [ -f "$log_file" ]; then
        echo "--- ${name} 日志（最近 50 行）---" >&2
        tail -n 50 "$log_file" >&2 || true
      fi
      return 1
    fi
    sleep 1
  done

  echo "等待 ${name} 启动超时: ${host}:${port}" >&2
  if [ -n "$log_file" ] && [ -f "$log_file" ]; then
    echo "--- ${name} 日志（最近 50 行）---" >&2
    tail -n 50 "$log_file" >&2 || true
  fi
  return 1
}

ensure_embed_placeholders() {
  local placeholder='<!doctype html><html><head><title>dev</title></head><body>use frontend dev server</body></html>'

  mkdir -p "$WEB_DIR/dist" "$CLASSIC_WEB_DIR/dist"

  if [ ! -f "$WEB_DIR/dist/index.html" ]; then
    printf '%s\n' "$placeholder" >"$WEB_DIR/dist/index.html"
  fi
  if [ ! -f "$CLASSIC_WEB_DIR/dist/index.html" ]; then
    printf '%s\n' "$placeholder" >"$CLASSIC_WEB_DIR/dist/index.html"
  fi
}

is_local_sql_dsn() {
  local dsn="$1"
  case "$dsn" in
    *"127.0.0.1"*|*"localhost"*|*"@postgres:"*|*"@mysql:"*|*"@tcp(127.0.0.1:"*|*"@tcp(localhost:"*)
      return 0
      ;;
  esac
  return 1
}

ensure_remote_sql_dsn() {
  load_env_file

  if [ -z "${SQL_DSN:-}" ]; then
    echo "未配置 SQL_DSN。请在 .env 或环境变量中设置线上数据库连接字符串。" >&2
    exit 1
  fi

  if [[ "$SQL_DSN" == *"<"* || "$SQL_DSN" == *"remote-db.example.com"* ]]; then
    echo "SQL_DSN 仍是模板占位值，请先替换为真实的线上数据库连接字符串。" >&2
    exit 1
  fi

  if is_local_sql_dsn "$SQL_DSN"; then
    echo "检测到本地数据库连接，已按要求禁止使用本地数据库: $SQL_DSN" >&2
    echo "请改为线上数据库连接字符串后再执行 make dev。" >&2
    exit 1
  fi

  export SQL_DSN
  export VITE_DEV_API_TARGET="${VITE_DEV_API_TARGET:-http://localhost:${BACKEND_PORT}}"
}

ensure_frontend_deps() {
  if [ ! -d "$WEB_DIR/node_modules" ]; then
    echo "安装前端依赖..."
    (cd "$WEB_DIR" && bun install)
  fi
}

start_backend() {
  if port_open "127.0.0.1" "$BACKEND_PORT"; then
    echo "后端端口 ${BACKEND_PORT} 已被占用，跳过启动后端。"
    return 0
  fi

  ensure_embed_placeholders
  echo "启动 Go 后端: http://localhost:${BACKEND_PORT}"
  (
    cd "$ROOT_DIR"
    go run main.go
  ) >"$LOG_DIR/dev-backend.log" 2>&1 &
  BACKEND_PID=$!
  echo "$BACKEND_PID" >"$LOG_DIR/dev-backend.pid"
  wait_for_port \
    "127.0.0.1" \
    "$BACKEND_PORT" \
    "Go 后端" \
    "$BACKEND_START_TIMEOUT_SECONDS" \
    "$BACKEND_PID" \
    "$LOG_DIR/dev-backend.log"
}

start_frontend() {
  if port_open "$FRONTEND_HOST" "$FRONTEND_PORT"; then
    echo "前端端口 ${FRONTEND_PORT} 已被占用，跳过启动前端。"
    return 0
  fi

  ensure_frontend_deps
  echo "启动前端: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
  (
    cd "$WEB_DIR"
    VITE_DEV_API_TARGET="$VITE_DEV_API_TARGET" bun run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
  ) >"$LOG_DIR/dev-frontend.log" 2>&1 &
  FRONTEND_PID=$!
  echo "$FRONTEND_PID" >"$LOG_DIR/dev-frontend.pid"
  wait_for_port \
    "$FRONTEND_HOST" \
    "$FRONTEND_PORT" \
    "前端" \
    "$FRONTEND_START_TIMEOUT_SECONDS" \
    "$FRONTEND_PID" \
    "$LOG_DIR/dev-frontend.log"
}

ensure_remote_sql_dsn
start_backend
start_frontend

echo
echo "开发服务已启动："
echo "  后端: http://localhost:${BACKEND_PORT}"
echo "  前端: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "  前端代理: ${VITE_DEV_API_TARGET}"
echo "  数据库: 使用已配置的线上 SQL_DSN"
echo
echo "日志："
echo "  后端: ${LOG_DIR}/dev-backend.log"
echo "  前端: ${LOG_DIR}/dev-frontend.log"
echo
echo "停止服务："
echo "  kill \$(cat ${LOG_DIR}/dev-backend.pid) \$(cat ${LOG_DIR}/dev-frontend.pid)"
