# Studio API contract

This MCP server is a thin client. Everything stateful lives in a **studio
service** — an HTTP API plus a shared projects directory on disk. The
reference implementation is `3dgs-studio` (a Next.js app with a trainer
daemon), which is a **separate, currently private** project. Nothing in this
repository depends on its source: **any server that implements the contract
below works**, and this document is the authoritative description of it.

The contract was derived from the reference studio's route handlers, auth
proxy, trainer daemon, and TypeScript types, and is what the test suite in
`tests/` asserts against (with `fetch` and `fs` mocked).

---

## 1. Transport, base URL and authentication

| Item | Value |
|------|-------|
| Base URL | `STUDIO_URL`, **including** any basePath (e.g. `http://localhost:3000/3dgs-studio`). The server never adds or strips a basePath. |
| Content type | `application/json` both ways. The server sends `Content-Type: application/json` and `Accept: application/json`. |
| Auth header | `x-service-key: <STUDIO_SERVICE_KEY>` on every request (omitted when the key is empty). |
| Timeout | `STUDIO_TIMEOUT_MS` (default 30 000 ms) per request via `AbortSignal.timeout`. |

### Service-key semantics (what the studio must enforce)

- A request whose `x-service-key` equals the studio's configured secret is
  treated as **owner-level** and bypasses interactive session auth.
- A missing or wrong key must yield **`401 {"error":"Unauthorized"}`** for
  `/api/*` routes (the reference proxy does exactly this).
- The key is a bearer-style shared secret: it is compared for equality and
  never appears in URLs or logs on either side.
- Transport is **plain HTTP on a trusted local network** (host loopback or a
  container's host gateway) by design; see `SECURITY.md` for the threat model
  and when TLS becomes mandatory.

### Response envelope

- Success: a JSON object (shape per endpoint).
- Failure: a JSON object `{ "error": string, ...extra }` with a 4xx/5xx status.
- The MCP server tolerates an **empty body** on 2xx (treated as `null`) but
  treats any **non-JSON** body — including HTML sign-in pages — as an error.

---

## 2. HTTP endpoints the MCP server calls

### 2.1 `POST /api/projects` — create a project (`create_project` tool)

Request body (all validated by the MCP server before sending):

```jsonc
{
  "name": "Living room",              // required, 1–200 chars, no control chars
  "description": "Wide-angle shots",  // optional, ≤ 2000 chars; tabs/newlines ok, no other control chars
  "tags": ["interior", "test"],        // optional, ≤ 50 entries, each ≤ 64 chars
  "trainingConfig": {                  // optional; merged over studio defaults
    "method": "splatfacto",            // see §4 for accepted methods
    "maxSteps": 30000                  // integer ≥ 1
  }
}
```

Responses:

| Status | Body | Meaning |
|--------|------|---------|
| `201` | `{ "project": Project }` | Created. The studio assigns `id` (UUID v4), timestamps, `status: "idle"`, `imageCount: 0`, and creates `<root>/<id>/images` and `<root>/<id>/output`. |
| `400` | `{ "error": "name is required" }` | Missing name. |
| `401` | `{ "error": "Unauthorized" }` | Bad/missing service key. |

Reference defaults applied by the studio when `trainingConfig` fields are
absent: `method: "splatfacto"`, `maxSteps: 30000`, `learningRate: 0.001`,
`downscaleFactor: 1`.

### 2.2 `POST /api/training/start` — start a run (`start_training` tool)

Request body:

```jsonc
{
  "projectId": "3f2a9c1e-…",   // required, single safe path segment
  "method": "splatfacto",       // optional, default "splatfacto"
  "maxSteps": 30000,            // optional, integer ≥ 1
  "skipProcessing": false       // optional; skip image processing if transforms.json exists
}
```

The reference studio accepts many more optional tuning fields (processor,
downscale stages, SH degree, resume checkpoints…). The MCP server only sends
the four above; a studio must treat unknown fields as optional and apply its
own defaults.

Responses:

| Status | Body | Meaning |
|--------|------|---------|
| `202` | `{ "runId": string, "run": TrainingRun }` | Accepted; training runs asynchronously. `run.status` is `"running"` (or `"queued"`). |
| `400` | `{ "error": "projectId required" }` | Missing project id. |
| `404` | `{ "error": "…" }` | Unknown project (implementation-defined; the reference returns a failed run instead). |
| `409` | `{ "error": "training already running", "run": TrainingRun }` | A run for this project is still `running`. |
| `503` | `{ "error": "Trainer daemon unreachable: …" }` | Studio is up but cannot reach its trainer backend. |

Side effects the MCP server relies on: the studio writes
`<root>/<projectId>/run.json` (see §3) and updates `meta.json.status` to
`"training"`, then to `"completed"` or `"failed"`.

### 2.3 `DELETE /api/training/start` — stop a run (`stop_training` tool)

Request body: `{ "runId": string }` (yes, `DELETE` with a JSON body — the
reference API is shaped this way; the MCP server sends
`Content-Type: application/json`).

| Status | Body | Meaning |
|--------|------|---------|
| `200` | `{ "ok": true }` | Run cancelled. `run.json` is rewritten with `status: "cancelled"`, `completedAt`, `error: "Stopped by user"`. |
| `404` | `{ "error": "not found" }` / `{ "error": "run not found" }` | No such active run. |
| `503` | `{ "error": "Trainer daemon unreachable: …" }` | Backend unreachable. |

### 2.4 Endpoints **not** called (for completeness)

The reference studio also exposes `GET /api/projects`, `PATCH /api/projects`,
`GET /api/training/status/:runId`, uploads, frame extraction, MoGe/mesh
routes, guest management, and `POST /api/chat`. The MCP server reads project
state from disk instead of `GET`ting it (see ADR-0003), so none of these are
required.

---

## 3. On-disk metadata the MCP server reads

`PROJECTS_ROOT` is a directory the studio and the MCP server **share** (bind-
mounted read-only into the container as `/app/data/projects`). One
sub-directory per project, named by the project id:

```
<PROJECTS_ROOT>/
└── <projectId>/
    ├── meta.json        # Project record         → readMeta()
    ├── run.json         # latest TrainingRun     → readRun()
    ├── runs/<runId>.json# run history (not read by the MCP server)
    ├── images/          # source images
    └── output/**        # training outputs; *.splat listed by list_splats
```

- **`listProjectIds()`** — sorted names of sub-directories of `PROJECTS_ROOT`
  (files are ignored; the root is created if missing).
- **`readMeta(id)`** — parses `meta.json`; returns `null` when the file is
  missing, unreadable, malformed, or not a JSON object. Projects without a
  readable `meta.json` are skipped by `list_projects` / `list_splats`.
- **`readRun(id)`** — same rules for `run.json`. Absence means "no run yet".
- **`listSplatFiles(id)`** — recursive listing of `output/` filtered to
  `*.splat`. `.ply` outputs are deliberately not listed (the studio converts
  them on demand).

The reference studio writes these files atomically (write-then-rename) so a
poll never observes a half-written JSON document; if yours does not, the MCP
server still degrades gracefully (malformed JSON → `null`).

### 3.1 `Project` (meta.json)

```ts
interface Project {
  id: string;                       // UUID v4, equals the directory name
  name: string;
  status: 'idle' | 'processing' | 'training' | 'completed' | 'failed';
  createdAt: string;                // ISO-8601
  updatedAt: string;                // ISO-8601
  imageCount: number;
  description?: string;
  tags?: string[];
  trainingConfig?: {
    method: 'msplat' | 'opensplat' | 'splatfacto' | 'nerfacto' | 'instant-ngp' | 'gaussian-splatting';
    maxSteps: number;
    learningRate?: number;
    downscaleFactor: number;
    numImages?: number;
    processor?: 'colmap' | 'mast3r';
  };
  outputSplat?: string;             // path relative to PROJECTS_ROOT, e.g. "output/msplat/scene.ply"
  gaussianCount?: number;
  sourceType?: 'photos' | 'video_2d' | 'video_360';
  // …plus viewer/UI fields the MCP server ignores (thumbnailUrl, sceneRotation, cameraPosition, pruneSettings, …)
}
```

`list_projects` returns only the fields it understands (`id`, `name`,
`description`, `status`, `imageCount`, `sourceType`, `tags`,
`trainingConfig`, `outputSplat`, `gaussianCount`, `createdAt`, `updatedAt`);
`get_project` returns the whole object verbatim.

### 3.2 `TrainingRun` (run.json)

```ts
interface TrainingRun {
  id: string;                       // runId
  projectId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;                // ISO-8601
  completedAt?: string;
  logs: LogEntry[];                 // capped by the studio (reference: 2000 lines)
  metrics: TrainingMetrics[];
  outputDir?: string;
  error?: string;
  targetSteps?: number;
  resumedFromStep?: number;
  pid?: number;
}

interface LogEntry     { timestamp: string; level: 'info' | 'warn' | 'error' | 'debug'; message: string }
interface TrainingMetrics { step: number; psnr?: number; loss?: number; ssim?: number; splatCount?: number; timestamp: string }
```

`get_training_status` returns the last **20** log messages and the last
**10** metric rows; `logs`/`metrics` may be absent or contain non-object
entries and the server copes.

---

## 4. Enumerations

| Field | Accepted by the MCP server | Notes |
|-------|----------------------------|-------|
| `method` | `splatfacto`, `nerfacto`, `instant-ngp`, `opensplat`, `msplat`, `gaussian-splatting` | Union of the reference studio's `TrainingConfig.method`. A studio may support a subset and should answer `400` for the rest. |
| `status` (project) | `idle`, `processing`, `training`, `completed`, `failed` | Read only. |
| `status` (run) | `queued`, `running`, `completed`, `failed`, `cancelled` | Read only. |

---

## 5. Minimal conforming studio

A conforming implementation needs only:

1. Three routes (§2.1–2.3) behind an `x-service-key` equality check.
2. To write `meta.json` on create and `run.json` (plus `meta.json.status`)
   during training, into a directory it shares with the MCP server.

Everything else (uploads, viewers, chat, guests) is out of scope for this
server. See `docs/ARCHITECTURE.md` for how the pieces are wired and
`docs/REQUIREMENTS.md` for the behaviours the server guarantees on top of
this contract.
