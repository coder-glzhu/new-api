#!/bin/bash
# dev-local.sh — 本地开发一键启动脚本
# 前端：Rsbuild dev server（HMR，改 tsx 秒生效）
# 后端：air 监听 .go 文件，自动重建+重启
# Ctrl+C 同时结束两者。
#
# 兼容 macOS 自带 bash 3.2：不用 wait -n，且所有紧挨中文的变量一律用 ${var}。

set -eu
set -o pipefail
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="${ROOT_DIR}/web/default"
LOG_DIR="${ROOT_DIR}/.dev-logs"
mkdir -p "${LOG_DIR}"

BACKEND_PORT="${PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"

# ---- 后端环境变量 ----
export SQL_DSN="${SQL_DSN:-postgresql://$(whoami)@localhost:5432/new-api?sslmode=disable}"
export SESSION_SECRET="${SESSION_SECRET:-249aec5efa2c89c35237782551c3c422b6e51af2797c4873d99621abfea68de7}"
export PORT="${BACKEND_PORT}"
export VITE_REACT_APP_SERVER_URL="http://localhost:${BACKEND_PORT}"
export GOCACHE="${GOCACHE:-${ROOT_DIR}/.gocache}"
export GOTMPDIR="${GOTMPDIR:-${ROOT_DIR}/.gocache-temp}"
mkdir -p "${GOCACHE}" "${GOTMPDIR}"

# ---- 颜色 ----
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
MAGENTA=$'\033[35m'
CYAN=$'\033[36m'
RESET=$'\033[0m'

log()  { printf "%s[dev]%s %s\n" "${CYAN}"   "${RESET}" "$*"; }
warn() { printf "%s[dev]%s %s\n" "${YELLOW}" "${RESET}" "$*"; }
die()  { printf "%s[dev]%s %s\n" "${RED}"    "${RESET}" "$*" >&2; exit 1; }

# ---- 依赖检查 ----
command -v go  >/dev/null 2>&1 || die "未找到 go，先安装 Go 1.22+"
command -v bun >/dev/null 2>&1 || die "未找到 bun，先安装 bun"

GOPATH_DIR="$(go env GOPATH)"
AIR_BIN="${GOPATH_DIR}/bin/air"
if [ ! -x "${AIR_BIN}" ]; then
  log "未检测到 air，正在安装 github.com/air-verse/air@latest ..."
  GO111MODULE=on go install github.com/air-verse/air@latest
fi
[ -x "${AIR_BIN}" ] || die "air 安装失败，请手动检查"
[ -f "${ROOT_DIR}/.air.toml" ] || die "缺少 ${ROOT_DIR}/.air.toml，无法启动后端热重载"

if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
  log "前端 node_modules 缺失，执行 bun install ..."
  ( cd "${FRONTEND_DIR}" && bun install )
fi

# ---- 端口占用警告 ----
check_port() {
  port="$1"
  name="$2"
  if lsof -i ":${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    warn "端口 ${port} 已被占用 (${name})，如启动失败请先关闭占用进程"
  fi
}
check_port "${BACKEND_PORT}"  backend
check_port "${FRONTEND_PORT}" frontend

# ---- 进程管理 ----
BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
  log "收到退出信号，正在停止子进程..."
  [ -n "${BACKEND_PID}"  ] && kill  "${BACKEND_PID}"  >/dev/null 2>&1 || true
  [ -n "${FRONTEND_PID}" ] && kill  "${FRONTEND_PID}" >/dev/null 2>&1 || true
  sleep 0.3
  [ -n "${BACKEND_PID}"  ] && pkill -P "${BACKEND_PID}"  >/dev/null 2>&1 || true
  [ -n "${FRONTEND_PID}" ] && pkill -P "${FRONTEND_PID}" >/dev/null 2>&1 || true
  log "已停止。日志保留在 ${LOG_DIR}/"
}
trap cleanup EXIT INT TERM

# ---- 带前缀输出 ----
prefix_stream() {
  prefix="$1"
  color="$2"
  while IFS= read -r line; do
    printf "%s%s%s %s\n" "${color}" "${prefix}" "${RESET}" "${line}"
  done
}

log "后端端口: ${BACKEND_PORT}   前端端口: ${FRONTEND_PORT}"
log "SQL_DSN: ${SQL_DSN}"
log "前端代理 /api,/mj,/pg -> ${VITE_REACT_APP_SERVER_URL}"
log "日志目录: ${LOG_DIR}"

# ---- 启动后端（air）----
(
  cd "${ROOT_DIR}"
  "${AIR_BIN}" -c .air.toml 2>&1
) | tee "${LOG_DIR}/backend.log" | prefix_stream "[backend]" "${MAGENTA}" &
BACKEND_PID=$!

# ---- 启动前端（rsbuild dev）----
(
  cd "${FRONTEND_DIR}"
  bun run dev --port "${FRONTEND_PORT}" 2>&1
) | tee "${LOG_DIR}/frontend.log" | prefix_stream "[frontend]" "${GREEN}" &
FRONTEND_PID=$!

log "前端访问: http://localhost:${FRONTEND_PORT}"
log "后端 API:  http://localhost:${BACKEND_PORT}"
log "Ctrl+C 停止"

# bash 3.2 没有 wait -n，改为轮询任一进程是否还活着
while kill -0 "${BACKEND_PID}" >/dev/null 2>&1 && kill -0 "${FRONTEND_PID}" >/dev/null 2>&1; do
  sleep 1
done
warn "检测到子进程退出，准备收尾"
