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

OpenBot is a local-first harness for running AI agents. It is built around a small event API, local file storage, and a Melony-powered runtime that routes events to agents and plugins.

## What It Does

- Runs a local agent server.
- Stores channels, threads, agents, plugins, config, and variables under `~/.openbot`.
- Ships with a built-in `system` agent named OpenBot (orchestrator, includes the LLM runtime).
- Ships with a built-in `state` agent for deterministic, non-LLM handling (e.g. `/api/state` defaults).
- Loads custom agents from `~/.openbot/agents/<agent-id>/AGENT.md`.
- Loads shared plugins from `~/.openbot/plugins`.
- Streams events to clients with Server-Sent Events.

## Quick Start

Requires Node.js `>=20.12.0`.

```bash
npm i -g openbot
openbot start
```

The server listens on `http://localhost:4132` by default. Set a different port with:

```bash
openbot start --port 3000
```

For local development:

```bash
npm install
npm run dev
```

## API

OpenBot intentionally keeps the public API small:

- `GET /api/events` opens an SSE stream for a channel or thread.
- `POST /api/publish` publishes an event into the harness (defaults to the built-in `system` agent with the OpenBot / LLM runtime).
- `GET /api/state` runs an event and returns the resulting events without opening a stream (defaults to the built-in `state` agent: storage-oriented plugins, no LLM).

You can override the agent with `agentId` (header, query, or body where applicable).

Example:

```bash
curl -X POST http://localhost:4132/api/publish \
  -H "content-type: application/json" \
  -d '{"type":"agent:invoke","data":{"role":"user","content":"hello"}}'
```

Useful context can be passed as headers, query params, or body fields:

- `channelId`
- `threadId`
- `agentId`
- `runId`

## Configuration

OpenBot reads config from `~/.openbot/config.json`.

```json
{
  "port": 4132,
  "baseDir": "~/.openbot",
  "model": "openai/gpt-4o-mini"
}
```

Variables are read from `~/.openbot/variables.json` and applied to the server process environment on startup.

## Agents

The built-in `system` agent is always available. Add a custom agent by creating `~/.openbot/agents/<agent-id>/AGENT.md`:

```markdown
---
name: Researcher
description: Helps collect and summarize information.
plugins:
  - id: openbot
    config:
      model: openai/gpt-4o-mini
  - id: storage
---

You are a careful research assistant.
Summarize findings clearly and cite sources when available.
```

Agents are discovered from disk when the server starts.

## Plugins

Built-in plugins include:

- `storage-tools`
- `delegation`
- `openbot`

Shared plugins can be placed in `~/.openbot/plugins` and referenced by agents.

## Project Layout

- `src/app`: CLI, server, event types, and app config.
- `src/harness`: orchestration and process helpers.
- `src/plugins`: built-in plugin implementations.
- `src/services`: local storage service.
- `src/registry`: plugin registry.
- `docs`: architecture, agents, and plugin notes.

## Learn More

- [Architecture](./docs/architecture.md)
- [Agents](./docs/agents.md)
- [Plugins](./docs/plugins.md)

Need help or want to share feedback? Join the community on Discord: https://discord.gg/XYYXvN2ebB
