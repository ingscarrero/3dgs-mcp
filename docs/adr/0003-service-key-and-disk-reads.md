# ADR-0003: Authenticate to the studio with a shared service key; read state from disk

- **Status:** Accepted
- **Date:** 2026-05-20

## Context

The reference studio protects `/api/*` with an interactive session (OAuth
via NextAuth) and a guest-link system. A machine client cannot complete a
browser login. The studio also persists every project (`meta.json`) and run
(`run.json`) to a directory that can be shared with other processes.

## Decision

1. The studio accepts an `x-service-key` header whose value equals a secret
   in its environment; a match bypasses session auth at owner level. The MCP
   server sends this header on every request and nothing else (no cookies).
2. Read-only tools (`list_projects`, `get_project`, `get_training_status`,
   `list_splats`) read the shared directory directly instead of calling the
   API. Mutating tools (`create_project`, `start_training`, `stop_training`)
   always go through the API.

## Consequences

- **Positive:** no token exchange, no session state, trivial rotation
  (change two env vars, restart). Polling progress costs a file read, works
  while the studio restarts, and lets the server trim multi-thousand-line
  logs locally. The API surface the studio must implement is just three
  routes (see `docs/STUDIO_API.md`).
- **Negative:** the key is owner-level, so its holder can do anything the
  studio owner can; it must never leave the machine and must be rotated if
  exposed. Plain HTTP is only acceptable on loopback / host gateway; a
  remote studio needs `https://`. Disk reads couple the server to the file
  layout, which is therefore documented as part of the contract.
- The server's HTTP client treats any non-2xx or non-JSON response as an
  error with the status and the studio's message, so a missing or rotated
  key shows up as a clear `401 … Check STUDIO_SERVICE_KEY` rather than a
  confusing HTML sign-in page.
