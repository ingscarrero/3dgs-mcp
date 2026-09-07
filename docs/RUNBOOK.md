# Runbook

Operational procedures for `3dgs-mcp`. Commands assume macOS with Podman;
substitute `docker` where noted (`CONTAINER_RUNTIME=docker`).

## Start

The server is started **by Claude Desktop**, not by hand. Restart Claude
Desktop (or toggle the server in *Settings → Developer*) after any config
change.

Manual start for testing:

```bash
# Container (what Claude Desktop does)
STUDIO_SERVICE_KEY=… STUDIO_URL=http://localhost:3000/3dgs-studio bash run-container.sh

# Host mode (development)
npm run build && STUDIO_SERVICE_KEY=… node dist/index.js
```

Then paste a JSON-RPC `initialize` line on stdin (see README "Testing by
hand"). A healthy server prints one `[3dgs-mcp] … started on stdio` line to
stderr and answers on stdout.

## Stop

- Quit Claude Desktop, or disable the server in *Settings → Developer*. The
  container is started with `--rm`, so it disappears on exit.
- Stray containers (e.g. after a crash of the parent):

  ```bash
  podman ps --filter name=3dgs-mcp-
  podman rm -f $(podman ps -q --filter name=3dgs-mcp-)
  ```

## Rebuild the image

```bash
podman build -t 3dgs-mcp:latest .
# or force the wrapper to rebuild on next start
podman rmi 3dgs-mcp:latest
```

## Rotate the service key

1. Generate a new secret (32+ random bytes, e.g. `openssl rand -hex 32`).
2. Set it in the **studio** (`STUDIO_SERVICE_KEY` in its environment or
   `.env.local`) and restart the studio.
3. Set the same value for the MCP server — either in the `env` block of
   `claude_desktop_config.json`, in the dotenv file the wrapper reads
   (`STUDIO_ENV_FILE`), or in your shell environment.
4. Restart Claude Desktop. Verify with any mutating tool (e.g.
   `create_project`) — a stale key shows as
   `(401): Unauthorized. Check STUDIO_SERVICE_KEY.`

Never paste the key into chat, issues, or logs.

## Logs

- **Claude Desktop** captures the server's stderr:
  `~/Library/Logs/Claude/mcp-server-3dgs-studio.log` (macOS) and
  `~/Library/Logs/Claude/mcp.log` for the launcher itself.
- Every line from this server is prefixed `[3dgs-mcp]`.
- The startup line shows the resolved `studio=`, `projects=`,
  `serviceKey=set|unset`, `container=true|false` — check it first.
- Container-level logs for a running instance:
  `podman logs 3dgs-mcp-<pid>` (name printed by the wrapper).

## Health check (one-liner)

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | bash run-container.sh 2>/dev/null | grep -c '"name":"open_studio"'   # expect 1
```

## Common errors

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Claude shows the server as "failed" immediately | Wrapper not executable, or no container runtime on `PATH` for GUI apps | `chmod +x run-container.sh`; set `CONTAINER_RUNTIME` and a full path in `command`, or add `env.PATH` in the Claude config |
| `neither podman nor docker found on PATH` | Same as above | `podman machine start`; or `CONTAINER_RUNTIME=docker` |
| `Studio unreachable at http://host.containers.internal:3000/…` | Studio not running, wrong port, or Docker without host-gateway mapping | Start the studio; with Docker the wrapper adds `--add-host` automatically, otherwise set `STUDIO_URL` to a reachable host |
| `(401): Unauthorized. Check STUDIO_SERVICE_KEY.` | Key unset or different from the studio's | Rotate/sync the key (above) |
| `non-JSON response (HTTP 200)` | `STUDIO_URL` points at a page (missing basePath) or a login redirect | Include the basePath, e.g. `/3dgs-studio` |
| `(409): training already running` | A run is still active for that project | `stop_training` with the running `runId` or wait |
| `(503): Trainer daemon unreachable` | Studio up, GPU daemon down | Restart the trainer daemon on the studio host |
| `list_projects` returns `count: 0` unexpectedly | Wrong `PROJECTS_ROOT` or empty bind mount | Check the startup log line; ensure the host path exists and matches the studio's |
| `Invalid arguments for open_studio: path must be a relative route…` | Claude passed an absolute URL | Ask for a route like `/?tab=chat`; absolute URLs are rejected by design |
| `could not launch browser via open` (host mode) | No GUI opener available | Use the URL from the message, or run in container mode |

## Upgrade

```bash
git pull
npm ci && npm run typecheck && npm test
podman build -t 3dgs-mcp:latest .
# restart Claude Desktop
```

See `CHANGELOG.md` for behaviour changes between versions.
