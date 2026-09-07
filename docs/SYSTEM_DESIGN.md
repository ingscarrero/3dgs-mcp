# System design

A short record of the decisions that shape `3dgs-mcp`, with the alternatives
that were considered. Longer-form rationale for the three biggest ones lives
in `docs/adr/`.

## Goals

1. Let Claude Desktop drive a 3D Gaussian Splatting pipeline in natural
   language: create projects, start/stop GPU training, inspect progress and
   outputs, jump to the web UI.
2. Keep the MCP server **stateless and thin** so that the studio remains the
   single source of truth and can evolve independently.
3. Be safe to run on a personal workstation that also holds the user's data
   and an owner-level API key.

## Decision summary

| Decision | Chosen | Why | Rejected alternatives |
|----------|--------|-----|-----------------------|
| Transport | **stdio** (ADR-0001) | Claude Desktop spawns local servers over stdio natively; no ports, no auth layer of our own, process lifetime tied to the client. | *Streamable HTTP / SSE*: would need a listener, TLS, and token auth on the workstation for a single local user — pure overhead. |
| Packaging | **Container via wrapper script** (ADR-0002) | Reproducible Node runtime, non-root user, explicit bind mount and env; Claude Desktop only sees one executable path. Works identically with Podman or Docker. | *Bare `node dist/index.js`*: still supported for development, but relies on whatever Node the GUI app inherits from launchd and exposes the host FS. *npx package*: same drawbacks plus supply-chain surface. |
| Studio auth | **Shared service key** (`x-service-key`) (ADR-0003) | The studio's interactive auth is cookie/OAuth-based; a machine client needs a bearer-style secret. Equality check, trivially rotatable, no session state. | *Reusing a browser session cookie*: brittle and leaks user identity. *mTLS*: heavy for loopback. *OAuth client-credentials*: the studio has no token issuer. |
| Reading state | **Direct filesystem reads** of `meta.json` / `run.json` | Zero-latency, works even when the studio is down, no API surface needed for polling; the data is already on the shared volume. | *`GET /api/projects` / status endpoints*: extra hops, and `run.json` can be tens of thousands of lines — trimming locally is cheaper. |
| Mutations | **Always through the studio API** | Training involves process supervision, GPU scheduling, and consistent metadata patches — that logic belongs in one place. | *Spawning trainers from the MCP server*: would duplicate the studio's daemon and give the container GPU access. |
| Error surface | **`isError` results, never thrown protocol errors** | Claude can read the message and retry or ask the user; the server keeps running. | *JSON-RPC errors*: lose the remediation hint and, in some clients, abort the turn. |
| Browser launch | **`spawn` with argv, no shell; disabled in container** | Removes the injection class entirely; containers have no display anyway. | *`execSync("open \"url\"")`* (the original): shell injection via the `path` argument. |
| Validation | **Whitelist validators per argument** | Model output is untrusted; the cheapest place to stop traversal/injection is before any I/O. | *Trusting JSON Schema alone*: clients do not enforce it. |

## Data flow

```
Claude ──stdio──▶ 3dgs-mcp ──fs read──▶ PROJECTS_ROOT (shared volume)
                     │
                     └──HTTP + x-service-key──▶ Studio API ──▶ trainer / GPU
                                                     │
                                                     └── writes meta.json, run.json, output/
```

The server never writes to the volume (it only `mkdir -p`s the root so an
empty install lists zero projects instead of failing).

## Failure modes and how they surface

| Failure | Detection | User-visible result |
|---------|-----------|---------------------|
| Studio not running | `fetch` rejects / times out (30 s) | "Studio unreachable at … Is 3DGS Studio running?" |
| Wrong service key | 401 JSON | "(401): Unauthorized. Check STUDIO_SERVICE_KEY." |
| Concurrent run | 409 JSON | "(409): training already running. A conflicting run already exists." |
| Trainer daemon down | 503 JSON | "(503): Trainer daemon unreachable…" |
| Studio behind a login page | HTML body | "non-JSON response (HTTP 200)" |
| Volume not mounted / empty | `readdir` of an empty root | `{ projects: [], count: 0 }` |
| Half-written or corrupt `run.json` | `JSON.parse` fails | "No training run found" (next poll succeeds) |
| Hostile `projectId` / `path` | validators | "Invalid arguments for <tool>: …" and nothing is touched |
| Browser opener missing (host mode) | `spawn` `error` event | Logged to stderr; the URL is still returned |

## Scaling and limits

This is a single-user, single-machine tool by design. The container has no
published ports and one stdio client; running several Claude Desktop
instances simply spawns several isolated containers against the same
volume, which is safe because the server is read-only on disk.

## Security posture in one paragraph

Untrusted input (tool arguments) is whitelisted before any I/O. The only
process the server starts is the OS URL opener, via argv. The only secret it
holds is the studio service key, received through the environment, sent
only as a header over a trusted local hop, and never logged. The container
runs as a non-root user with a single bind mount. See `SECURITY.md`.
