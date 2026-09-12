# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security
- `open_studio` rejects any `%` in `path`, and `buildStudioUrl` re-checks the
  resolved URL for dot segments and for staying under the studio base path, so
  `%2e%2e` can no longer escape e.g. `/3dgs-studio` (origin was already pinned).
- `list_splats` returns paths relative to `PROJECTS_ROOT` instead of absolute
  host paths (no longer discloses the operator's home directory).
- `get_project` applies the same `meta.json` field allowlist as `list_projects`.
- `run-container.sh` mounts the projects directory read-only (`:ro` /
  `:z,ro`), matching the documented contract, and passes
  `STUDIO_SERVICE_KEY` through from the environment (`--env NAME`) instead of
  putting its value on the container runtime's argv.
- `Dockerfile` pins `node:22-alpine` to its multi-arch index digest; CI pins
  every third-party action to a full commit SHA.
- Production dependency audit: 0 vulnerabilities (was 6, all transitive via
  `@modelcontextprotocol/sdk`: `hono`, `ip-address`, `fast-uri`, `qs`,
  `body-parser`) after `npm audit fix`.

## [0.2.0] — 2026-09-07

Public-readiness release. The server now stands alone against a documented
studio HTTP contract.

### Security
- **Fixed a shell-injection vulnerability in `open_studio`.** The
  model-supplied `path` argument was interpolated into
  `execSync(\`open "${url}"\`)`. The tool now whitelists `path` as a relative
  route, builds the URL with the WHATWG `URL` class pinned to the studio
  origin, and launches the browser with `spawn(cmd, [url])` — no shell.
- Every tool argument is validated before it touches the filesystem, the
  network, or a process (ids, names, tags, enums, integer ranges, routes).

### Added
- `docs/STUDIO_API.md` — the HTTP + on-disk contract this server depends on.
- `docs/ARCHITECTURE.md`, `docs/REQUIREMENTS.md`, `docs/SYSTEM_DESIGN.md`,
  `docs/RUNBOOK.md`, three ADRs under `docs/adr/`.
- Vitest suite (149 tests) with `fetch`, `fs` and `child_process` mocked;
  coverage floors 96 % lines/branches/statements, 97 % functions.
- GitHub Actions CI: typecheck, tests + coverage artifact, stdio smoke test,
  container build (not pushed) + container smoke test.
- MIT `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, this changelog.
- `STUDIO_TIMEOUT_MS` and `CONTAINER_RUNTIME` / `MCP_IMAGE` /
  `STUDIO_ENV_FILE` overrides.

### Changed
- Studio HTTP calls now check `res.ok`, parse defensively, and time out;
  failures surface as `isError` results with the HTTP status, the studio's
  message, and a hint.
- `create_project` sends `trainingConfig.{method,maxSteps}` (previously
  `method`/`maxSteps` were sent at top level and ignored by the studio).
- `list_projects` returns a bounded summary per project; `get_project`
  labels the run as `latestRun`.
- `run-container.sh` no longer requires a sibling `3dgs-studio` checkout:
  env vars override everything, the dotenv file is optional, `localhost` is
  rewritten to the container host gateway, and Docker is supported.
- Dockerfile is multi-stage; TypeScript is compiled at image build time and
  the runtime layer contains production dependencies only.
- Source split into `config`, `validate`, `studio`, `projects`, `tools`,
  `server` modules; `index.ts` is the stdio bootstrap.

## [0.1.0] — 2026-02-01

- Initial version: eight tools over stdio, Podman wrapper script.

[Unreleased]: https://github.com/ingscarrero/3dgs-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ingscarrero/3dgs-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ingscarrero/3dgs-mcp/releases/tag/v0.1.0
