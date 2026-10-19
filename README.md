# YAI

A minimal **Node + TypeScript** web app starter, preconfigured to run in a
Cursor Cloud Agent environment.

## Requirements

- Node.js >= 20 (the Cloud Agent image ships Node 22)
- npm

## Getting started

```bash
npm ci          # install dependencies (uses package-lock.json)
npm run dev     # start the dev server with live reload (http://localhost:3000)
```

Other scripts:

```bash
npm run build       # compile TypeScript to dist/
npm start           # run the compiled server (dist/server.js)
npm test            # run the unit test suite
npm run typecheck   # type-check without emitting
```

## What it does

- Serves a small styled home page at `/`.
- Exposes a JSON API:
  - `GET /api/health` — service health and uptime.
  - `GET /api/greet?name=<name>` — returns a greeting payload.

The server listens on `PORT` (default `3000`) and `HOST` (default `0.0.0.0`).

## Project layout

```
src/app.ts        # pure, testable helpers (greeting, html escaping)
src/server.ts     # HTTP server and routes
test/app.test.ts  # unit tests (node:test)
```

## Cloud Agent environment

`.cursor/environment.json` configures the Cloud Agent environment:

- `install`: `npm ci`
- `terminals`: runs `npm run dev` so the server is available with live logs
- `ports`: exposes port `3000`
