# ADR-0002: Run the server in a container started by a wrapper script

- **Status:** Accepted
- **Date:** 2026-04-02

## Context

Claude Desktop launches MCP servers from a GUI context whose `PATH` and Node
version are unpredictable. The server reads a directory of user data and
carries an owner-level API key. Users may have Podman (preferred on macOS
for its rootless machine) or Docker.

## Decision

Ship a multi-stage `Dockerfile` (build TypeScript once, run
production-only dependencies as a non-root user) and a `run-container.sh`
wrapper that Claude Desktop invokes. The wrapper resolves configuration
(env vars → optional dotenv file → defaults), rewrites `localhost` in
`STUDIO_URL` to the runtime's host gateway, builds the image on first use,
and `exec`s `podman|docker run --rm -i` with a single bind mount and four
environment variables. `CONTAINER_MODE=1` tells the server it has no display.

## Consequences

- **Positive:** reproducible Node 22 runtime; the host filesystem is limited
  to `PROJECTS_ROOT`; no ports; identical behaviour on macOS and Linux;
  swapping runtimes is `CONTAINER_RUNTIME=docker`.
- **Negative:** the browser cannot be launched from inside the container, so
  `open_studio` returns the URL instead. The service key is visible in the
  container's environment (`podman inspect`) to the same user — acceptable
  for a single-user workstation, documented in `SECURITY.md`.
- Host mode (`node dist/index.js`) remains supported for development and is
  what the unit tests and CI smoke test exercise.
