#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
LOG_DIR="$ROOT_DIR/logs"

export PATH="$HOME/.bun/bin:$PATH"

BACKEND_PORT="${PORT:-3000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5174}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-$(whoami)}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-new-api}"
DB_CONTAINER="${DB_CONTAINER:-new-api-dev-postgres}"

export PORT="$BACKEND_PORT"
export VITE_DEV_API_TARGET="${VITE_DEV_API_TARGET:-http://localhost:${BACKEND_PORT}}"
if [ -z "${SQL_DSN:-}" ]; then
  if [ -n "$DB_PASSWORD" ]; then
    export SQL_DSN="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=disable"
  else
    export SQL_DSN="postgresql://${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=disable"
  fi
fi
export REDIS_CONN_STRING="${REDIS_CONN_STRING:-}"
export TZ="${TZ:-Asia/Shanghai}"
export GOCACHE="${GOCACHE:-/tmp/go-build-cache}"

mkdir -p "$LOG_DIR" "$GOCACHE"

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

  for _ in $(seq 1 "$attempts"); do
    if port_open "$host" "$port"; then
      return 0
    fi
    sleep 1
  done

  echo "等待 ${name} 启动超时: ${host}:${port}" >&2
  return 1
}

start_database() {
  if port_open "$DB_HOST" "$DB_PORT"; then
    echo "数据库已在 ${DB_HOST}:${DB_PORT} 可用，跳过启动。"
    return 0
  fi

  if ! has_cmd docker; then
    echo "未检测到 PostgreSQL 端口 ${DB_HOST}:${DB_PORT}，并且未安装 docker，无法自动启动数据库。" >&2
    exit 1
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    echo "启动已有数据库容器: ${DB_CONTAINER}"
    docker start "$DB_CONTAINER" >/dev/null
  else
    echo "创建并启动数据库容器: ${DB_CONTAINER}"
    docker run -d \
      --name "$DB_CONTAINER" \
      -e POSTGRES_USER="$DB_USER" \
      -e POSTGRES_PASSWORD="$DB_PASSWORD" \
      -e POSTGRES_DB="$DB_NAME" \
      -p "${DB_HOST}:${DB_PORT}:5432" \
      postgres:15 >/dev/null
  fi

  wait_for_port "$DB_HOST" "$DB_PORT" "PostgreSQL"
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

  echo "启动 Go 后端: http://localhost:${BACKEND_PORT}"
  (
    cd "$ROOT_DIR"
    go run main.go
  ) >"$LOG_DIR/dev-backend.log" 2>&1 &
  BACKEND_PID=$!
  echo "$BACKEND_PID" >"$LOG_DIR/dev-backend.pid"
  wait_for_port "127.0.0.1" "$BACKEND_PORT" "Go 后端"
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
  wait_for_port "$FRONTEND_HOST" "$FRONTEND_PORT" "前端"
}

start_database
start_backend
start_frontend

echo
echo "开发服务已启动："
echo "  后端: http://localhost:${BACKEND_PORT}"
echo "  前端: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "  前端代理: ${VITE_DEV_API_TARGET}"
echo "  数据库: ${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo
echo "日志："
echo "  后端: ${LOG_DIR}/dev-backend.log"
echo "  前端: ${LOG_DIR}/dev-frontend.log"
echo
echo "停止服务："
echo "  kill \$(cat ${LOG_DIR}/dev-backend.pid) \$(cat ${LOG_DIR}/dev-frontend.pid)"
