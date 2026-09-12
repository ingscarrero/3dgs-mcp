#!/usr/bin/env bash
# run-container.sh — wrapper Claude Desktop runs as the MCP subprocess.
#
# Starts the 3DGS MCP server inside a Podman (or Docker) container with
# stdin/stdout piped through, which satisfies the MCP stdio transport.
# Point claude_desktop_config.json at this script:
#
#   "command": "/absolute/path/to/3dgs-mcp/run-container.sh"
#
# Configuration (highest precedence first):
#   1. Environment variables set on this process (e.g. via the "env" block in
#      claude_desktop_config.json): PROJECTS_ROOT, STUDIO_URL,
#      STUDIO_SERVICE_KEY, CONTAINER_RUNTIME, MCP_IMAGE, STUDIO_ENV_FILE.
#   2. An optional dotenv file (STUDIO_ENV_FILE, default
#      ../3dgs-studio/.env.local for people who run the reference studio next
#      to this checkout). NEXTAUTH_URL is accepted as an alias for STUDIO_URL.
#   3. Documented defaults (see README.md, "Environment variables").
#
# Usage:
#   bash run-container.sh          # interactive test (type JSON-RPC on stdin)
#   (Claude Desktop invokes it automatically)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE="${MCP_IMAGE:-3dgs-mcp:latest}"
ENV_FILE="${STUDIO_ENV_FILE:-$SCRIPT_DIR/../3dgs-studio/.env.local}"

log() { echo "[3dgs-mcp] $*" >&2; }

# read_env KEY DEFAULT — value from the dotenv file, or DEFAULT.
read_env() {
  local key="$1" default="$2" val=""
  if [[ -f "$ENV_FILE" ]]; then
    val=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)
    val="${val%\"}"; val="${val#\"}"   # strip optional surrounding quotes
  fi
  echo "${val:-$default}"
}

# ── Resolve configuration ────────────────────────────────────────────────────
PROJECTS_ROOT="${PROJECTS_ROOT:-$(read_env PROJECTS_ROOT "$HOME/Documents/Claude/Projects/3DGS/projects")}"
STUDIO_URL="${STUDIO_URL:-$(read_env STUDIO_URL "$(read_env NEXTAUTH_URL "http://localhost:3000/3dgs-studio")")}"
STUDIO_SERVICE_KEY="${STUDIO_SERVICE_KEY:-$(read_env STUDIO_SERVICE_KEY "")}"

# ── Pick a container runtime ─────────────────────────────────────────────────
if [[ -z "${CONTAINER_RUNTIME:-}" ]]; then
  if command -v podman >/dev/null 2>&1; then CONTAINER_RUNTIME=podman
  elif command -v docker >/dev/null 2>&1; then CONTAINER_RUNTIME=docker
  else
    log "neither podman nor docker found on PATH (set CONTAINER_RUNTIME to override)"
    exit 1
  fi
fi

# Inside the container "localhost" is the container itself; rewrite it to the
# runtime's host gateway so the server can reach a studio running on the host.
# The projects directory is mounted read-only: the server only ever reads
# meta.json / run.json / output/**. ":z" asks Podman for an SELinux relabel
# (harmless on macOS / non-SELinux hosts); Docker needs plain ":ro".
case "$CONTAINER_RUNTIME" in
  podman) HOST_GATEWAY="host.containers.internal"; EXTRA_ARGS=(); MOUNT_OPTS="z,ro" ;;
  docker) HOST_GATEWAY="host.docker.internal"; MOUNT_OPTS="ro"
          EXTRA_ARGS=(--add-host "host.docker.internal:host-gateway") ;;
  *)      HOST_GATEWAY="host.containers.internal"; EXTRA_ARGS=(); MOUNT_OPTS="ro" ;;
esac
CONTAINER_STUDIO_URL=$(printf '%s' "$STUDIO_URL" | sed -E "s#//(localhost|127\.0\.0\.1)([:/]|\$)#//${HOST_GATEWAY}\2#")

if [[ -z "$STUDIO_SERVICE_KEY" ]]; then
  log "warning: STUDIO_SERVICE_KEY is empty — studio calls will be rejected with 401"
fi

mkdir -p "$PROJECTS_ROOT"

# ── Build the image on first run ─────────────────────────────────────────────
if ! "$CONTAINER_RUNTIME" image inspect "$IMAGE" >/dev/null 2>&1; then
  log "building container image $IMAGE with $CONTAINER_RUNTIME..."
  "$CONTAINER_RUNTIME" build -t "$IMAGE" "$SCRIPT_DIR" >&2
fi

log "starting $IMAGE via $CONTAINER_RUNTIME (studio=$CONTAINER_STUDIO_URL, projects=$PROJECTS_ROOT)"

# --rm : remove container on exit
# -i   : keep stdin open (required for MCP stdio transport)
# The service key is passed through from this process's environment with the
# bare "--env NAME" form, so its value never appears on the container
# runtime's argv (visible to every local user via `ps`).
export STUDIO_SERVICE_KEY
exec "$CONTAINER_RUNTIME" run --rm -i \
  --name "3dgs-mcp-$$" \
  "${EXTRA_ARGS[@]}" \
  -v "${PROJECTS_ROOT}:/app/data/projects:${MOUNT_OPTS}" \
  -e "PROJECTS_ROOT=/app/data/projects" \
  -e "STUDIO_URL=${CONTAINER_STUDIO_URL}" \
  --env STUDIO_SERVICE_KEY \
  -e "CONTAINER_MODE=1" \
  "$IMAGE"
