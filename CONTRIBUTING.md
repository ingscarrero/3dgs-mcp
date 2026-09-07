# Contributing

Thanks for your interest. This is a small, focused project; the bar is
"keep it small, keep it safe, keep it tested".

## Development setup

```bash
git clone https://github.com/ingscarrero/3dgs-mcp.git
cd 3dgs-mcp
npm ci              # also builds dist/ via the prepare script
npm run typecheck   # strict TS for src/ and tests/
npm test            # vitest
npm run test:coverage
```

Node 22+ is required. No studio is needed to run the tests — `fetch`, `fs`
and `child_process` are mocked.

## Workflow

1. Branch from `main` (`main` is protected; changes land via pull request).
2. Keep commits focused; use conventional prefixes (`feat:`, `fix:`,
   `docs:`, `test:`, `chore:`).
3. Run the full gate before pushing:

   ```bash
   npm ci && npm run typecheck && npx vitest run --coverage
   ```

4. Open a PR describing *what* and *why*, and how you tested it. CI must be
   green (typecheck, tests with coverage floors, container build + stdio
   smoke test).

## Ground rules

- **No shell strings.** Start processes with `spawn(cmd, argv)` only.
- **Validate at the edge.** Every new tool argument gets a validator in
  `src/validate.ts` and rejection tests, including at least one injection
  or traversal attempt.
- **Handlers never throw.** Return `isError: true` with a message that tells
  the model what to do next.
- **stdout is the protocol.** Log with `console.error` only.
- **Contract first.** If you need a new studio endpoint, document it in
  `docs/STUDIO_API.md` in the same PR and keep the server usable against
  any implementation of that contract.
- **Coverage floors** in `vitest.config.ts` only move up.
- Record significant design changes as a new file in `docs/adr/`.

## Reporting security issues

Please do not open a public issue; see `SECURITY.md`.
