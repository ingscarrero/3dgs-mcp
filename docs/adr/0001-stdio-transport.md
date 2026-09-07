# ADR-0001: Use the MCP stdio transport

- **Status:** Accepted
- **Date:** 2026-03-14

## Context

Claude Desktop supports two ways to reach an MCP server: spawning a local
process and talking JSON-RPC over its stdin/stdout, or connecting to a
remote server over Streamable HTTP. `3dgs-mcp` runs on the same workstation
as the studio and the training GPU, for a single user.

## Decision

Implement the server on `StdioServerTransport`. stdout carries protocol
frames only; all logging goes to stderr.

## Consequences

- **Positive:** no listening socket, no TLS, no auth layer for the MCP hop —
  the OS process boundary is the security boundary. Lifetime is tied to
  Claude Desktop; nothing is left running. The container wrapper is a
  one-line `podman run -i`.
- **Negative:** one client per process; a remote Claude cannot use it. If
  that is ever needed, wrap the same `createServer()` in a Streamable HTTP
  transport behind a reverse proxy with bearer auth — `src/server.ts` is
  transport-agnostic for this reason.
- Any accidental `console.log` would corrupt the protocol stream; the code
  base uses `console.error` exclusively and CI's smoke test would catch a
  regression.
