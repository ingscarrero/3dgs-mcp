# Architecture

`3dgs-mcp` is a **stdio MCP server** that turns a 3D Gaussian Splatting
studio into eight tools Claude Desktop can call. It has no database and no
background work of its own: it validates input, reads project state from a
shared directory, and forwards mutating actions to the studio's HTTP API.

## Component view

```mermaid
flowchart LR
    subgraph host["User's machine"]
        CD["Claude Desktop"]
        WS["run-container.sh<br/>(wrapper)"]
        subgraph ctr["Container (Podman / Docker)"]
            MCP["3dgs-mcp<br/>Node 22 · stdio MCP server"]
        end
        FS[("PROJECTS_ROOT<br/>meta.json · run.json · output/*.splat")]
        ST["Studio HTTP API<br/>(reference: 3dgs-studio, private)"]
        TD["Trainer daemon / GPU"]
        BR["Default browser"]
    end

    CD -- "spawn, stdin/stdout JSON-RPC" --> WS
    WS -- "podman run -i<br/>env + bind mount" --> MCP
    MCP -- "fs read (bind mount)" --> FS
    MCP -- "HTTP + x-service-key<br/>POST/DELETE /api/…" --> ST
    ST -- writes --> FS
    ST --> TD
    MCP -. "open_studio (host mode only)<br/>spawn(open, [url])" .-> BR
```

Key boundaries:

| Boundary | Mechanism | Trust |
|----------|-----------|-------|
| Claude Desktop ↔ server | JSON-RPC over stdin/stdout (MCP stdio transport). stderr is logs only. | Tool arguments are **untrusted** model output → validated in `src/validate.ts`. |
| Server ↔ filesystem | Read-only bind mount of `PROJECTS_ROOT` at `/app/data/projects`. | Ids are single path segments, so reads cannot leave the root. |
| Server ↔ studio | Plain HTTP on loopback / container host gateway with a shared `x-service-key`. | Studio is trusted; responses are still checked for status and JSON shape. |
| Server ↔ browser | `spawn()` with an argv array (no shell), only when `CONTAINER_MODE` is unset. | URL is rebuilt with `new URL()` and pinned to the studio origin. |

## Source layout

```
src/
├── index.ts     # stdio bootstrap (loadConfig → createServer → connect)
├── server.ts    # MCP Server wiring: tools/list, tools/call
├── tools.ts     # TOOLS schema + handleToolCall dispatcher + browser opener
├── validate.ts  # argument validators (ids, names, enums, routes, URL join)
├── studio.ts    # HTTP client: headers, timeouts, status + JSON checks
├── projects.ts  # readMeta / readRun / listProjectIds / listSplatFiles
└── config.ts    # env → Config with documented defaults
```

Dependency direction is strictly downward: `index → server → tools →
{validate, studio, projects} → config`. Everything under `tools.ts` is pure
with respect to process state, which is what makes the 149 unit tests cheap.

## Sequence: `start_training`

```mermaid
sequenceDiagram
    autonumber
    participant C as Claude Desktop
    participant S as 3dgs-mcp (tools.ts)
    participant V as validate.ts
    participant H as studio.ts
    participant API as Studio API
    participant FS as PROJECTS_ROOT

    C->>S: tools/call start_training {projectId, method?, maxSteps?, skipProcessing?}
    S->>V: validateId / validateMethod / validateMaxSteps / validateBoolean
    alt invalid argument
        V-->>S: ValidationError
        S-->>C: { isError: true, "Invalid arguments for start_training: …" }
    else valid
        S->>H: studioPost('/api/training/start', body)
        H->>API: POST /api/training/start<br/>x-service-key, JSON body, 30 s timeout
        alt network error / timeout
            H-->>S: StudioError "Studio unreachable at …"
            S-->>C: { isError: true, message }
        else 4xx / 5xx or non-JSON
            API-->>H: e.g. 409 {"error":"training already running"}
            H-->>S: StudioError "(409): training already running. A conflicting run already exists."
            S-->>C: { isError: true, message }
        else 202
            API-->>H: 202 {"runId","run"}
            API->>FS: write run.json, patch meta.json.status="training"
            H-->>S: parsed body
            S-->>C: { content: [ JSON {runId, run} ] }
        end
    end
    Note over C,FS: Claude later polls get_training_status, which reads run.json directly.
```

## Sequence: `open_studio`

```mermaid
sequenceDiagram
    autonumber
    participant C as Claude Desktop
    participant S as 3dgs-mcp (tools.ts)
    participant V as validate.ts
    participant OS as child_process.spawn
    participant B as Browser

    C->>S: tools/call open_studio {path?: "/?tab=chat"}
    S->>V: validateStudioPath(path)
    alt rejected (scheme, "//", "..", quotes, $(), whitespace, non-ASCII…)
        V-->>S: ValidationError
        S-->>C: { isError: true, "Invalid arguments for open_studio: …" }
    else accepted relative route
        S->>V: buildStudioUrl(STUDIO_URL, route)
        V-->>S: "http://localhost:3000/3dgs-studio/?tab=chat" (origin verified)
        alt CONTAINER_MODE=1
            S-->>C: "Studio is available at: <url>"
        else host mode
            S->>OS: spawn("open" | "xdg-open" | "rundll32", [url], {detached, stdio:"ignore"})
            Note right of OS: argv array — no shell, no interpolation
            OS->>B: launch URL
            S-->>C: "Opened <url> in browser."
        end
    end
```

## Runtime modes

| Mode | How it starts | `open_studio` | Studio URL |
|------|---------------|---------------|------------|
| **Container** (default, recommended) | Claude Desktop → `run-container.sh` → `podman run -i` | Returns the URL | `localhost` rewritten to `host.containers.internal` / `host.docker.internal` |
| **Host** (development) | `node dist/index.js` | Launches the browser | Used as given |

## Failure handling at a glance

- Every handler returns an MCP result; the process never crashes on a tool
  call. Unexpected exceptions are logged to stderr and reported as
  `isError: true`.
- Filesystem problems degrade to "not found" / empty lists.
- Studio problems map 1:1 to `StudioError` messages that name the HTTP status
  and include the studio's own `error` string plus a remediation hint.

See `docs/SYSTEM_DESIGN.md` for the reasoning behind these choices and
`docs/REQUIREMENTS.md` for the guarantees stated as requirements.
