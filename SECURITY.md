# Security policy

## Supported versions

Only the latest release on `main` is supported.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private vulnerability
reporting on this repository ("Security" → "Report a vulnerability"). You
will get an acknowledgement within a few days and a fix or mitigation plan
as soon as practical.

## Threat model

`3dgs-mcp` runs on a single user's workstation, is spawned by Claude
Desktop, and holds an **owner-level** credential for the studio API.

| Asset | Threat | Control |
|-------|--------|---------|
| Host shell / processes | Command injection through model-supplied tool arguments | No shell is ever used. The only spawned process is the OS URL opener, started with an argv array. The `path` argument is whitelisted (relative route, no scheme, no `//`, no `.`/`..` segments, no `%` so encoded dot segments such as `%2e%2e` cannot slip past, no quotes/whitespace/metacharacters) and the URL is rebuilt with `new URL()`, pinned to the studio origin, and verified to still sit under the studio base path. In containers the browser is never launched. |
| User files outside `PROJECTS_ROOT` | Path traversal via `projectId` / `runId` | Ids must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` and contain no `..`; the container additionally sees only the bind-mounted root. |
| Studio service key | Leakage via logs, URLs, or chat | Sent only as the `x-service-key` header; the server logs whether it is *set*, never its value; it is never echoed in tool results. |
| Studio service key | Interception in transit | Plain HTTP is used **only** on loopback / the container host gateway. If `STUDIO_URL` points at another machine, use `https://`. |
| Studio | Abuse of the owner-level key | The key grants everything the studio owner can do. Keep it on the machine, rotate it if exposed (see `docs/RUNBOOK.md`), and never share the dotenv file that holds it. |
| Container | Privilege escalation | Runs as a non-root user; no published ports; single **read-only** bind mount; base image pinned by digest. |

## Known limitations

- The key is passed to the container as an environment variable using the
  pass-through form (`--env STUDIO_SERVICE_KEY`, value read from the
  wrapper's environment), so it never appears on the container runtime's
  argv and is not visible to other local users through `ps`. It remains
  visible to the same OS user through `podman inspect` / `docker inspect`.
  This is accepted for a single-user workstation.
- The server does not rate-limit; the studio does (for guests) and the stdio
  transport gives a single client.

## Secrets hygiene

- Never commit `.env*` files or keys. The tree and git history were scanned
  before publication.
- Example values in docs are placeholders (`…`).
