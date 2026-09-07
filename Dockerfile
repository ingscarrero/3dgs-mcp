# ── Dockerfile — 3DGS MCP Server ──────────────────────────────────────────────
# Multi-stage build: compile TypeScript once at image build time, then ship a
# production-only runtime layer that runs as an unprivileged user.
#
# The server speaks MCP over stdio, so the container must be started with -i
# (stdin kept open). `run-container.sh` does this for Claude Desktop:
#
#   podman run --rm -i \
#     -v "$PROJECTS_ROOT:/app/data/projects:z" \
#     -e PROJECTS_ROOT=/app/data/projects \
#     -e STUDIO_URL=http://host.containers.internal:3000/3dgs-studio \
#     -e STUDIO_SERVICE_KEY=... \
#     -e CONTAINER_MODE=1 \
#     3dgs-mcp:latest

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts

COPY src ./src
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs \
 && adduser  -u 1001 -S mcpuser -G nodejs

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build --chown=mcpuser:nodejs /app/dist ./dist

USER mcpuser

# PROJECTS_ROOT, STUDIO_URL, STUDIO_SERVICE_KEY and CONTAINER_MODE are injected
# at runtime by the wrapper script (see run-container.sh and README.md).
ENTRYPOINT ["node", "dist/index.js"]
