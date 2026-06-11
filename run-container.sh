#!/usr/bin/env bash
# run-container.sh — wrapper script for Claude Desktop to start the MCP server
# inside a Podman container.  Point your claude_desktop_config.json here:
#
#   "command": "/path/to/3dgs-mcp/run-container.sh"
#
# Claude Desktop will run this script with stdin/stdout piped, which satisfies
# the MCP stdio transport protocol.
#
# Usage:
#   bash run-container.sh          # interactive test
#   (Claude Desktop invokes it automatically)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load env vars from 3dgs-studio/.env.local for tokens
ENV_FILE="$SCRIPT_DIR/../3dgs-studio/.env.local"

read_env() {
  local key="$1" default="$2"
  local val
  val=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
  echo "${val:-$default}"
}

PROJECTS_ROOT=$(read_env "PROJECTS_ROOT" "$HOME/Documents/Claude/Projects/3DGS/projects")
STUDIO_URL=$(read_env "NEXTAUTH_URL" "http://localhost:3000/3dgs-studio")
STUDIO_SERVICE_KEY=$(read_env "STUDIO_SERVICE_KEY" "")
BASE_PATH=$(read_env "BASE_PATH" "/3dgs-studio")

# Build the image if it doesn't exist
if ! podman image exists 3dgs-mcp:latest 2>/dev/null; then
  echo "[3dgs-mcp] Building container image..." >&2
  podman build -t 3dgs-mcp:latest "$SCRIPT_DIR" >&2
fi

# Run the MCP server in a container with stdin/stdout piped through (-i flag).
# --rm: remove container on exit (clean up)
# -i:   keep stdin open (required for MCP stdio transport)
exec podman run --rm -i \
  --name "3dgs-mcp-$$" \
  -v "${PROJECTS_ROOT}:/app/data/projects:z" \
  -e "PROJECTS_ROOT=/app/data/projects" \
  -e "STUDIO_URL=${STUDIO_URL}" \
  -e "STUDIO_SERVICE_KEY=${STUDIO_SERVICE_KEY}" \
  -e "CONTAINER_MODE=1" \
  3dgs-mcp:latest
