# AGENTS.md

## Purpose

This file gives coding agents persistent project context and working rules for OpenBot.
Use it as the default guidance for all tasks in this repository.

## Main Goal

To solve agent fragmentation and communication problems.

## Project Snapshot

OpenBot is a local-first platform for multi-agent orchestration and coordination.

- `src/`: event-driven orchestration engine built on Melony.
- Persistence is local-file based (no mandatory cloud datastore by default).
- API surface is intentionally minimal: only `GET /api/events`, `POST /api/publish`, and `GET /api/state`.

## Product Mental Model

- **Orchestration**: The platform manages the lifecycle and communication of multiple specialized agents.
- **Agents**: Specialized participants (bots/personas) that users can delegate tasks to via command prefixes or direct interaction.
- **Channels**: Shared context spaces where multiple agents collaborate to solve complex problems.
- **Event-Driven**: The system is entirely event-stream oriented: the orchestrator and agents communicate via events, and the UI renders the evolving state.

## Architecture Rules

1. Favor event-based integration over tightly coupled imperative calls.
2. Keep storage local-first unless a task explicitly requests remote persistence.
3. Make incremental, composable changes rather than broad rewrites.

## Server Guidance

- The server is event-first: treat HTTP routes as entry points into the event pipeline.
- Follow Melony's event flow: `Event -> Handler -> Events`.
- Keep the public API constrained to the three endpoints: `GET /api/events`, `POST /api/publish`, `GET /api/state`.
- Plugin changes belong in `src/plugins/*`.
- Agent behavior and orchestration belong in agent/runtime layers, not UI code.
- For tool-calling flows, ensure completion/result events are emitted consistently.
- Avoid introducing hidden side effects in handlers; keep event output explicit.

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
- Multi-agent/channel model is preserved.
- Any new behavior is documented where appropriate.
