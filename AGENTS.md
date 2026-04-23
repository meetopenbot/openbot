# AGENTS.md

## Purpose

This file gives coding agents persistent project context and working rules for OpenBot.
Use it as the default guidance for all tasks in this repository.

## Main Goal

To solve agent fragmentation and communication problems.

## Project Snapshot

OpenBot is a local-first, Slack-like platform for AI agents.

- `server/`: event-driven `server v2` backend built on Melony.
- `web/`: React + Vite + Tailwind + shadcn/ui frontend consuming server events.
- Persistence is local-file based (no mandatory cloud datastore by default).
- API surface is intentionally minimal: only `GET /api/events`, `POST /api/publish`, and `GET /api/state`.

## Product Mental Model

- Agents are participants (bots/personas) that users can DM or include in shared spaces.
- Channels represent shared context and multi-agent collaboration space.
- The system is event-stream oriented: server emits events, UI renders evolving state.

## Architecture Rules

1. Preserve server/web separation:
   - Put orchestration, tools, runtime, persistence logic in `server/`.
   - Put rendering, interaction, and UX state composition in `web/`.
2. Favor event-based integration over tightly coupled imperative calls.
3. Keep storage local-first unless a task explicitly requests remote persistence.
4. Make incremental, composable changes rather than broad rewrites.

## Server Guidance (`server/`)

- `server v2` is event-first: treat HTTP routes as entry points into the event pipeline.
- Follow Melony's event flow: `Event -> Handler -> Events`.
- Keep the public API constrained to the three v2 endpoints: `GET /api/events`, `POST /api/publish`, `GET /api/state`.
- Plugin changes belong in `server/src/v2/plugins/*`.
- Agent behavior and orchestration belong in agent/runtime layers, not UI code.
- For tool-calling flows, ensure completion/result events are emitted consistently.
- Avoid introducing hidden side effects in handlers; keep event output explicit.

## Web Guidance (`web/`)

- Use existing shadcn/ui and project component patterns.
- Preserve Slack-like interaction patterns (chat flow, clear composer affordances, responsive panes).
- Prefer extending existing hooks/components before creating parallel abstractions.
- Consume server event streams as source of truth for timeline/state updates.
- Keep UI changes accessible and visually consistent with existing tokens/styles.

## Code Quality Expectations

- Make small, reviewable diffs with clear intent.
- Reuse existing utilities and conventions before adding new ones.
- Do not add dependencies unless necessary and justified by the task.
- Add/update tests when behavior changes in non-trivial ways.
- Run relevant checks for touched areas whenever possible.

## Safe Change Policy

- Do not remove or rewrite unrelated user changes.
- Do not run destructive git operations unless explicitly requested.
- If encountering unexpected modified files, pause and confirm next step.

## Useful Repo Context

- Detailed architecture: `docs/architecture.md`
- Plugin docs: `docs/plugins.md`
- Agent docs: `docs/agents.md`
- Cursor rules: `.cursor/rules/*.mdc`

## Task Completion Checklist

- Changes align with local-first + event-driven design.
- Server and web responsibilities remain cleanly separated.
- Multi-agent/channel UX model is preserved.
- Any new behavior is documented where appropriate.
