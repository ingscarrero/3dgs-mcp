# ── Dockerfile — 3DGS MCP Server ──────────────────────────────────────────────
# The MCP server uses stdio transport — Claude Desktop starts it as a subprocess
# and communicates via stdin/stdout.  To run it containerised, Claude Desktop's
# config points to a wrapper script (see trainer-daemon/install.sh) that does:
#
#   podman run --rm -i \
#     -v ~/Documents/.../projects:/app/data/projects \
#     -e PROJECTS_ROOT=/app/data/projects \
#     -e STUDIO_URL=http://host.containers.internal:3000/3dgs-studio \
#     -e STUDIO_SERVICE_KEY=<key> \
#     -e CONTAINER_MODE=1 \
#     3dgs-mcp
#
# The -i flag pipes stdin/stdout through to the container, satisfying the MCP
# stdio protocol.

FROM node:22-alpine
WORKDIR /app

RUN addgroup -g 1001 -S nodejs \
 && adduser  -u 1001 -S mcpuser -G nodejs

COPY package*.json ./
RUN npm ci

COPY --chown=mcpuser:nodejs . .

USER mcpuser

# PROJECTS_ROOT and STUDIO_URL injected at runtime by the wrapper script.
# Build TypeScript at container startup then launch the server — equivalent
# to running `npm run build && node dist/index.js` on the host.
CMD ["sh", "-c", "npm run build && node dist/index.js"]
