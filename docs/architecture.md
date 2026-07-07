# Architecture (public edition)

OpenBot is an event-driven local agent server built on [Melony](https://www.npmjs.com/package/melony).

## Core pieces

1. **HTTP server** (`src/app/server.ts`) — `GET /api/events`, `POST /api/publish`, `GET /api/state`.
2. **Harness** (`src/harness`) — runs one agent turn: load state, compose plugins, stream events.
3. **Storage** (`src/plugins/storage`) — local-file persistence for channels, threads, agents, and events.
4. **Plugins** — built-in capabilities registered in `src/services/plugins/registry.ts`.

## Event flow

1. Client publishes `agent:invoke` (or another event) via `POST /api/publish`.
2. Harness loads agent config and plugin stack from disk.
3. Melony runtime processes the event; plugins emit `action:*` and result events.
4. Events are persisted and fan-out to SSE subscribers.

## Data layout

All state lives under `~/.openbot` by default:

- `config.json` — port, base paths
- `variables.json` — env vars applied at startup
- `channels/` — per-channel events, threads, workspace files
- `agents/` — custom `AGENT.md` definitions
- `plugins/` — optional community plugin packages
