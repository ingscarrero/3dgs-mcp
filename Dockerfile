# ── Dockerfile — 3DGS MCP Server ──────────────────────────────────────────────
# Multi-stage build: compile TypeScript once at image build time, then ship a
# production-only runtime layer that runs as an unprivileged user.
#
# The server speaks MCP over stdio, so the container must be started with -i
# (stdin kept open). `run-container.sh` does this for Claude Desktop:
#
#   export STUDIO_SERVICE_KEY   # value taken from the environment, not argv
#   podman run --rm -i \
#     -v "$PROJECTS_ROOT:/app/data/projects:z,ro" \
#     -e PROJECTS_ROOT=/app/data/projects \
#     -e STUDIO_URL=http://host.containers.internal:3000/3dgs-studio \
#     --env STUDIO_SERVICE_KEY \
#     -e CONTAINER_MODE=1 \
#     3dgs-mcp:latest
#
# The base image is pinned to the multi-arch index digest of node:22-alpine
# (Node 22.23.2 at the time of pinning). Refresh it deliberately with
# `docker buildx imagetools inspect node:22-alpine` and update both stages.

# ── Stage 1: build ────────────────────────────────────────────────────────────
# node:22-alpine (22.23.2)
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts

COPY src ./src
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# node:22-alpine (22.23.2)
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
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
