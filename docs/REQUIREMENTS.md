# Requirements

Status: **implemented** unless marked otherwise. Each requirement names the
code that satisfies it and the test file that proves it.

## 1. Functional requirements — tools

All tools are exposed via MCP `tools/list` and dispatched by `tools/call`
(`src/tools.ts`, `tests/tools.test.ts`, `tests/server.test.ts`).

| ID | Tool | Requirement | Inputs | Output | Side effects |
|----|------|-------------|--------|--------|--------------|
| FR-1 | `list_projects` | Return a summary of every project under `PROJECTS_ROOT` that has a readable `meta.json`, sorted by id. | — | `{ projects: ProjectSummary[], count }` | None (read-only). |
| FR-2 | `get_project` | Return `meta.json` filtered to the `ProjectSummary` fields (same allowlist as FR-1) and the latest `run.json` (or `null`) for one project. Unknown id → `isError`. | `projectId` | `{ project, latestRun }` | None. |
| FR-3 | `create_project` | Create a project through the studio, sending `trainingConfig.{method,maxSteps}` (not top-level fields) so the studio honours them. | `name`, `description?`, `method?`, `maxSteps?`, `tags?` | Studio reply `{ project }` | `POST /api/projects`; studio creates `<id>/` on disk. |
| FR-4 | `start_training` | Ask the studio to start a run and return its `runId`. | `projectId`, `method?`, `maxSteps?`, `skipProcessing?` | Studio reply `{ runId, run }` | `POST /api/training/start`; GPU work begins. |
| FR-5 | `stop_training` | Cancel a run by id. | `runId` | `{ ok: true }` | `DELETE /api/training/start`; process killed, `run.json` marked `cancelled`. |
| FR-6 | `get_training_status` | Report status, timestamps, last 20 log lines and last 10 metric rows from `run.json`; tolerate missing/odd fields. | `projectId` | `{ runId, status, startedAt, completedAt, targetSteps, recentLogs, recentMetrics, error }` | None. |
| FR-7 | `list_splats` | List every `*.splat` under `<id>/output/**` (as paths relative to `PROJECTS_ROOT`) for projects that have at least one. | — | `{ splats: [{ projectId, name, splats[] }], count }` | None. |
| FR-8 | `open_studio` | Open a **relative** studio route in the default browser, or return the URL when running in a container. | `path?` (default `/`) | Text confirmation with the URL | Spawns the OS opener (host mode only). |

Cross-cutting:

- **FR-9** Every tool returns a single `text` content block; failures use
  `isError: true` with an actionable message rather than a protocol error.
- **FR-10** Tool schemas declare enums, integer minimums and defaults so
  Claude can self-correct before calling.

## 2. Non-functional requirements

### 2.1 Security

| ID | Requirement | Implementation |
|----|-------------|----------------|
| NFR-S1 | **No shell execution.** External processes are started with `spawn(cmd, argv)` and never with a shell string. | `defaultBrowserOpener` in `src/tools.ts`; asserted in `tests/tools.test.ts`. |
| NFR-S2 | **Input validation on every argument** that reaches the filesystem, HTTP layer, or a process: ids are single safe path segments; names/tags are bounded single-line text; descriptions are bounded multi-line text (tab/LF/CR only) — no other control characters; enums are whitelisted; numbers are bounded integers; `path` is a relative route with no scheme, `//`, `..`, quotes, whitespace, or shell metacharacters. | `src/validate.ts`; ~60 rejection cases in `tests/validate.test.ts`. |
| NFR-S3 | **Origin pinning.** `open_studio` builds the URL with `new URL()` and refuses any result whose origin differs from `STUDIO_URL`. | `buildStudioUrl`. |
| NFR-S4 | **Service-key scope.** The key is owner-level for the studio API; it is sent only as `x-service-key`, never in URLs or logs, and the server logs only whether it is set. | `src/studio.ts`, `src/index.ts`. |
| NFR-S5 | **Rotation.** Rotating the key requires no code change: update the studio's secret and the value passed to the server, restart both. | `docs/RUNBOOK.md`. |
| NFR-S6 | **Transport assumption.** Plain HTTP is acceptable only on loopback or a container host gateway. Any remote studio must be reached over TLS (`https://` `STUDIO_URL`). | `SECURITY.md`. |
| NFR-S7 | Container runs as a non-root user with a read-only-intent bind mount and no ports published. | `Dockerfile`, `run-container.sh`. |
| NFR-S8 | No secrets in the repository or its history (verified before publication). | — |

### 2.2 Reliability and failure modes

| ID | Scenario | Required behaviour | Where |
|----|----------|--------------------|-------|
| NFR-R1 | Studio down / DNS failure / timeout | `isError` "Studio unreachable at <url> (<reason>). Is 3DGS Studio running?" | `studioRequest`, `tests/studio.test.ts` |
| NFR-R2 | Studio returns 4xx/5xx | `isError` naming the status, the studio's `error` string and a hint (401 → check key, 409 → conflicting run, 503 → trainer daemon). | same |
| NFR-R3 | Studio returns non-JSON (e.g. HTML sign-in page) | `isError` "non-JSON response (HTTP n)". | same |
| NFR-R4 | Missing project directory or `meta.json` | `get_project` → `isError` not found; listings skip it. | `tests/projects.test.ts` |
| NFR-R5 | Malformed / non-object JSON on disk | Treated as absent (`null`), never crashes. | same |
| NFR-R6 | Directory vanishes between `readdir` and `stat` | Entry skipped. | same |
| NFR-R7 | `run.json` without `logs`/`metrics` arrays | Empty arrays returned. | `tests/tools.test.ts` |
| NFR-R8 | Browser launcher missing | Error logged to stderr; tool still returns success text for the URL. | `defaultBrowserOpener` |
| NFR-R9 | Unexpected exception in a handler | Caught, logged, returned as `isError`; server keeps serving. | `handleToolCall` |
| NFR-R10 | Malformed tool arguments (non-object) | `isError` "Tool arguments must be an object." | `assertArgsObject` |

### 2.3 Performance

| ID | Requirement |
|----|-------------|
| NFR-P1 | **stdio latency.** Read-only tools complete in a single synchronous pass over the filesystem; no network. Typical cost is a few milliseconds per project. |
| NFR-P2 | **HTTP bound.** Mutating tools are bounded by `STUDIO_TIMEOUT_MS` (default 30 s) via `AbortSignal.timeout`; the server never hangs indefinitely on the studio. |
| NFR-P3 | **Polling.** Training progress is obtained by Claude re-calling `get_training_status`, which reads `run.json` directly instead of hitting the API. Response size is bounded (20 log lines, 10 metric rows) regardless of run length. |
| NFR-P4 | **Startup.** The container image is pre-built; a cold start is `podman run` plus Node boot (well under a second on Apple silicon). No build step at runtime. |

### 2.4 Logging and observability

| ID | Requirement |
|----|-------------|
| NFR-L1 | **stdout is protocol-only.** All diagnostics go to stderr with a `[3dgs-mcp]` prefix; Claude Desktop captures stderr in its MCP logs. |
| NFR-L2 | Startup line reports the studio URL, projects root, whether a service key is set (never its value) and the runtime mode. |
| NFR-L3 | Unexpected handler failures and browser-launch failures are logged with the tool name and the error message. |

### 2.5 Portability and operations

| ID | Requirement |
|----|-------------|
| NFR-O1 | Runs on Node ≥ 22 on macOS, Linux and Windows in host mode; containerised via Podman or Docker (`CONTAINER_RUNTIME`). |
| NFR-O2 | All configuration is via environment variables with documented defaults; the wrapper script can additionally read a dotenv file (`STUDIO_ENV_FILE`). The default `PROJECTS_ROOT` (`~/Documents/Claude/Projects/3DGS/projects`) is a convention, not a requirement. |
| NFR-O3 | Works against **any** studio that implements `docs/STUDIO_API.md`; no dependency on the private reference implementation. |

### 2.6 Quality gates

| ID | Requirement |
|----|-------------|
| NFR-Q1 | `npm run typecheck` (strict TS for `src/` and `tests/`) and `vitest run --coverage` pass in CI on every PR. |
| NFR-Q2 | Coverage floors: 96 % lines/statements/branches, 97 % functions (3 points below the measured baseline at the time they were set). |
| NFR-Q3 | The container image builds in CI and answers `initialize` + `tools/list` over stdio. |

## 3. Out of scope

- Uploading images/videos, frame extraction, viewers, meshes, chat — these
  remain studio features reachable through `open_studio`.
- Multi-user or remote deployments of the MCP server itself (stdio is
  single-user by construction; see ADR-0001).
