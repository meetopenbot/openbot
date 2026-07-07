# AGENTS.md

## Purpose

Minimal public edition of OpenBot — local event-driven agent server.

## Layout

- `src/app` — CLI, HTTP server, config
- `src/harness` — agent run loop
- `src/plugins` — built-in plugins (`openbot`, `storage`, `ui`)
- `src/services/plugins` — plugin registry and types

## Rules

- Event-first: HTTP routes publish into the Melony pipeline.
- Local-file persistence under `~/.openbot`.
- Keep changes small and focused.

## API

- `GET /api/events`
- `POST /api/publish`
- `GET /api/state`
