<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo-white.svg">
    <img src="logo-black.svg" width="200" alt="OpenBot Logo" />
  </picture>
</p>

<h1 align="center">OpenBot</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/openbot"><img src="https://img.shields.io/npm/v/openbot" alt="npm version" /></a>
  <a href="https://github.com/meetopenbot/openbot/blob/main/LICENSE"><img src="https://img.shields.io/github/license/meetopenbot/openbot" alt="license" /></a>
</p>

## Archive notice

**OpenBot is no longer open source.** This repository is archived and read-only.

It preserves the **final MIT release** — a minimal, self-hosted edition you can still run locally. All active development (orchestration, cloud, plugins, and product features) continues **in private**.

| | |
|---|---|
| **Last open release** | `v0.5.3` (MIT) |
| **What’s in this repo** | Local server, event API, basic agent runtime, channel/thread storage |
| **What’s not here** | Shell tools, delegation, memory, marketplace, cloud deploy, and other platform features |
| **Contributions** | Not accepted on this repo |

If you need the full product, visit **[openbot.one](https://openbot.one)**.

---

OpenBot is a local-first harness for running AI agents. It exposes a small event API, local file storage, and a Melony-powered runtime.

## What it does

- Runs a local agent server on port `4132` by default.
- Stores channels, threads, agents, plugins, and config under `~/.openbot`.
- Ships with a built-in `system` agent (LLM runtime + storage tools).
- Ships with a built-in `state` agent for deterministic storage reads (no LLM).
- Loads custom agents from `~/.openbot/agents/<agent-id>/AGENT.md`.
- Streams events to clients with Server-Sent Events.

## Quick start

Requires Node.js `>=20.12.0`.

```bash
npm i -g openbot
openbot start
```

Local development:

```bash
npm install
npm run dev
```

Set an API key before starting (example for OpenAI):

```bash
export OPENAI_API_KEY=sk-...
openbot start
```

## API

- `GET /api/events` — SSE stream for a channel or thread.
- `POST /api/publish` — publish an event (defaults to the `system` agent).
- `GET /api/state` — run an event and return resulting events (defaults to the `state` agent).

Example:

```bash
curl -X POST http://localhost:4132/api/publish \
  -H "content-type: application/json" \
  -d '{"type":"agent:invoke","data":{"role":"user","content":"hello"}}'
```

Context headers/fields: `channelId`, `threadId`, `agentId`, `runId`.

## Built-in plugins (this edition)

| Plugin    | Role                                 |
|-----------|--------------------------------------|
| `openbot` | LLM agent runtime with storage tools |
| `storage` | Channel/thread persistence           |
| `ui`      | Interactive UI widgets               |

## Custom agents

Create `~/.openbot/agents/<agent-id>/AGENT.md`:

```markdown
---
name: Assistant
description: A helpful local assistant.
plugins:
  - id: openbot
    config:
      model: openai/gpt-4o-mini
  - id: storage
---

You are a careful assistant. Be concise and clear.
```

## License

[MIT](./LICENSE) — applies to this repository through release **v0.5.3**. Code released under MIT before this archive remains MIT; newer work is not published here.
