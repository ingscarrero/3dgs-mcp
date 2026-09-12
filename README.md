# 3DGS MCP Server

[![CI](https://github.com/ingscarrero/3dgs-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ingscarrero/3dgs-mcp/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-99%25-brightgreen)](#testing)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)
[![MCP](https://img.shields.io/badge/MCP-stdio-8A2BE2)](https://modelcontextprotocol.io)

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets
Claude Desktop run a **3D Gaussian Splatting** pipeline in plain language:
create projects, launch and cancel GPU training runs, watch PSNR/loss as
they train, find finished `.splat` files, and jump into the web studio.
It is a deliberately thin, stateless client — every mutation goes through a
small, documented **studio HTTP contract** and every read comes from a
shared projects directory — so it is safe to run on a personal workstation,
easy to test without a GPU, and works with *any* studio that implements the
contract in [`docs/STUDIO_API.md`](docs/STUDIO_API.md).

> The reference studio (`3dgs-studio`, a Next.js app with a trainer daemon)
> is a separate, currently private project. This repository does not depend
> on its source.

```
Claude Desktop ──stdio──▶ run-container.sh ──▶ [container] 3dgs-mcp ──HTTP + x-service-key──▶ Studio API ──▶ GPU
                                                              └────fs read────▶ PROJECTS_ROOT (meta.json, run.json, output/*.splat)
```

---

## Tools

| Tool | Parameters | Returns | Side effects |
|------|------------|---------|--------------|
| `list_projects` | — | `{ projects: [{ id, name, status, imageCount, trainingConfig, outputSplat, … }], count }` | None |
| `get_project` | `projectId` | `{ project, latestRun \| null }` — `meta.json` filtered to the same fields as `list_projects`, plus the full `run.json` | None |
| `create_project` | `name`, `description?`, `method?` (enum), `maxSteps?` (int ≥ 1), `tags?` (string[]) | Studio reply `{ project }` | `POST /api/projects`; studio creates the project directory |
| `start_training` | `projectId`, `method?`, `maxSteps?`, `skipProcessing?` | `{ runId, run }` | `POST /api/training/start`; GPU training begins |
| `stop_training` | `runId` | `{ ok: true }` | `DELETE /api/training/start`; run cancelled |
| `get_training_status` | `projectId` | `{ runId, status, startedAt, completedAt, targetSteps, recentLogs[≤20], recentMetrics[≤10], error }` | None |
| `list_splats` | — | `{ splats: [{ projectId, name, splats: [paths relative to `PROJECTS_ROOT`, e.g. `<id>/output/scene.splat`] }], count }` | None |
| `open_studio` | `path?` (relative route, default `/`; no `%`, `.` or `..` segments) | Confirmation text with the URL | Opens the browser in host mode; returns the URL in container mode |

`method` accepts `splatfacto`, `nerfacto`, `instant-ngp`, `opensplat`,
`msplat`, `gaussian-splatting`. All failures come back as MCP `isError`
results with the HTTP status, the studio's message, and a hint — never as a
crashed server.

---

## Quick start (Claude Desktop + Podman or Docker)

**Prerequisites:** Node 22+ (host mode only), Podman (`brew install podman
&& podman machine start`) *or* Docker, and a running studio that implements
[`docs/STUDIO_API.md`](docs/STUDIO_API.md) with a service key configured.

1. Clone and make the wrapper executable:

   ```bash
   git clone https://github.com/ingscarrero/3dgs-mcp.git
   chmod +x 3dgs-mcp/run-container.sh
   ```

2. Add the server to `claude_desktop_config.json`
   (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "3dgs-studio": {
         "command": "/absolute/path/to/3dgs-mcp/run-container.sh",
         "env": {
           "STUDIO_URL": "http://localhost:3000/3dgs-studio",
           "STUDIO_SERVICE_KEY": "<the studio's service key>",
           "PROJECTS_ROOT": "/Users/you/Documents/Claude/Projects/3DGS/projects"
         }
       }
     }
   }
   ```

   The wrapper builds the image on first run, rewrites `localhost` to the
   container's host gateway, bind-mounts `PROJECTS_ROOT`, and `exec`s
   `podman run --rm -i`. If you run the reference studio as a sibling
   checkout, you can omit `env` entirely — the wrapper reads
   `../3dgs-studio/.env.local` (override with `STUDIO_ENV_FILE`).

3. Restart Claude Desktop and ask: *"List my 3DGS projects."*

### Host mode (no container)

```bash
npm ci && npm run build
STUDIO_URL=http://localhost:3000/3dgs-studio STUDIO_SERVICE_KEY=… node dist/index.js
```

Point `command` at `node` with `args: ["/abs/path/3dgs-mcp/dist/index.js"]`.
In host mode `open_studio` launches your browser.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STUDIO_URL` | `http://localhost:3000` (wrapper: `http://localhost:3000/3dgs-studio`) | Base URL of the studio **including its basePath**. The wrapper rewrites `localhost`/`127.0.0.1` to `host.containers.internal` (Podman) or `host.docker.internal` (Docker) inside the container. `NEXTAUTH_URL` in the dotenv file is accepted as an alias. |
| `STUDIO_SERVICE_KEY` | *(empty)* | Shared secret sent as `x-service-key`. Owner-level on the studio: keep it local, rotate if exposed. Empty → studio answers 401. |
| `PROJECTS_ROOT` | `~/Documents/Claude/Projects/3DGS/projects` | Host directory shared with the studio. Overridable; the default is a convention from the reference setup, not a requirement. Mounted at `/app/data/projects` in the container. |
| `CONTAINER_MODE` | unset (wrapper sets `1`) | When `1`, `open_studio` returns the URL instead of spawning a browser. |
| `STUDIO_TIMEOUT_MS` | `30000` | Per-request timeout for studio HTTP calls. |
| `CONTAINER_RUNTIME` | auto (`podman`, then `docker`) | Wrapper only: which CLI to use. |
| `MCP_IMAGE` | `3dgs-mcp:latest` | Wrapper only: image tag to build/run. |
| `STUDIO_ENV_FILE` | `../3dgs-studio/.env.local` | Wrapper only: optional dotenv file consulted after process env, before defaults. |

Precedence in the wrapper: **process env → dotenv file → defaults**.

---

## Security

- **No shell.** The only process this server ever starts is the OS URL
  opener, via `spawn(cmd, [url])`. The `path` argument of `open_studio` is
  whitelisted (relative route only — no scheme, `//`, `.`/`..` segments,
  `%` (so encoded dot segments such as `%2e%2e` cannot slip past), quotes,
  whitespace, or metacharacters); the URL is rebuilt with `new URL()`,
  pinned to the studio origin, and rejected if the resolved path leaves the
  studio base path. Version 0.1.0 interpolated `path` into a shell string;
  that is fixed in 0.2.0.
- **Validated inputs.** Project/run ids are single safe path segments, so
  filesystem reads cannot escape `PROJECTS_ROOT`; names, tags, enums and
  numbers are bounded.
- **Service key.** Sent only as a header, over loopback or the container
  host gateway; never logged or echoed. Use `https://` for any non-local
  studio. Rotation steps are in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).
- **Container.** Non-root user, no published ports, single read-only bind mount, base image pinned by digest, service key passed through from the environment (never on argv).

Full threat model: [`SECURITY.md`](SECURITY.md).

---

## Testing

```bash
npm run typecheck        # strict TS for src/ and tests/
npm test                 # vitest
npm run test:coverage    # + v8 coverage (floors: 96 % lines/branches/stmts, 97 % funcs)
```

149 tests cover every tool handler, every validator (including injection and
traversal attempts), the filesystem readers, the studio client's error
paths, and a full in-memory MCP round trip. `fetch`, `fs` and
`child_process` are mocked, so no studio or GPU is needed. Measured coverage
at the time of writing: 99.6 % statements / 99.0 % branches / 100 %
functions; the floors sit three points below.

### Testing by hand

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | bash run-container.sh          # or: node dist/index.js
```

---

## Documentation

| Document | What it covers |
|----------|----------------|
| [`docs/STUDIO_API.md`](docs/STUDIO_API.md) | The HTTP + on-disk contract: endpoints, headers, request/response shapes, error codes, `meta.json`/`run.json` schemas. Implement this and the server works. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Component diagram, trust boundaries, sequence diagrams for `start_training` and `open_studio`. |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | Functional requirements per tool; non-functional: security, failure modes, performance, logging. |
| [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) | Why stdio, why a container, why a service key; alternatives rejected; failure modes. |
| [`docs/adr/`](docs/adr/) | Dated architecture decision records. |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Start/stop, rebuild, rotate the key, logs, common errors. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`SECURITY.md`](SECURITY.md) · [`CHANGELOG.md`](CHANGELOG.md) | Process, threat model, history. |

## Project structure

```
3dgs-mcp/
├── src/
│   ├── index.ts        # stdio bootstrap
│   ├── server.ts       # MCP wiring (tools/list, tools/call)
│   ├── tools.ts        # tool schemas + dispatcher + browser opener
│   ├── validate.ts     # argument validators
│   ├── studio.ts       # HTTP client with status/JSON/timeout handling
│   ├── projects.ts     # meta.json / run.json / output readers
│   └── config.ts       # env → Config
├── tests/              # vitest (fetch, fs, child_process mocked)
├── docs/               # contract, architecture, requirements, ADRs, runbook
├── Dockerfile          # multi-stage, non-root runtime
├── run-container.sh    # Claude Desktop entry point
└── .github/workflows/ci.yml
```

## License

[MIT](LICENSE) © 2026 Sergio Carrero
