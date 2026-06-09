# Agents

Agents are participants on the OpenBot bus. An agent is just a markdown file
(`AGENT.md`) that lists which **plugins** compose it. Plugins provide both the
LLM runtime and the tools the agent can call.

## Authoring an agent

You define an agent with a YAML-fronted markdown file at
`~/.openbot/agents/<agentId>/AGENT.md`. The folder name is the agent id.

```yaml
---
name: Researcher
description: Web research and synthesis specialist.
plugins:
  - id: openbot
    config:
      model: anthropic/claude-3-5-sonnet-20240620
---

You are a web research specialist. Use the available tools to gather and
synthesize information. Be concise and cite sources where relevant.
```

The body below the frontmatter is the system prompt passed to the runtime
plugin as `agentDetails.instructions`.

Set `hidden: true` to omit the agent from `action:storage:get-agents` (it
remains available via `action:storage:get-agent-details` and can still run on
the bus). Built-in **`state`** is hidden by default.

### Required: at least one runtime plugin

A runtime plugin is one that handles `agent:invoke` (the LLM loop). Without
one, the agent will not respond to user input. Built-in runtime plugins:

- `openbot` — the standard, opinionated OpenBot agent runtime. It is
  **batteries-included** and provides inbuilt tools (bash, memory, storage,
  delegation, and approval).
- `claude-code` — runs Claude inside the Claude Agent SDK with its own tools.
- `gemini-cli` — spawns Google's `gemini` CLI in headless mode.

`claude-code` and `gemini-cli` own their own tool loops, so attaching tool
plugins like `bash` to them has no effect.

## Built-in agents

OpenBot ships a built-in **`system`** agent (the orchestrator) with the `openbot`
runtime. A built-in **`state`** agent backs deterministic
`/api/state` handling and infra events.

You can optionally persist overrides for either id at `~/.openbot/agents/system/AGENT.md` or `~/.openbot/agents/state/AGENT.md`. When present, settings are merged on top of the code defaults (`getAgentDetails`). The **`state`** agent is not listed by **`action:storage:get-agents`** (`hidden: true`); **`system`** is listed. Use **`action:storage:create-agent`** to create an overlay once, **`action:storage:update-agent`** for partial updates (creating the file if missing for `system` / `state`), and **`action:storage:delete-agent`** to remove only that `AGENT.md` and revert to defaults (other files under the folder are left untouched).

## Memory

The `memory` plugin gives every agent three tools — `remember`, `recall`,
`forget` — backed by an append-only JSONL log at `~/.openbot/memory/log.jsonl`.
Memories are scoped:

- `global` (default) — visible to every agent everywhere.
- `agent` — visible only to the agent that wrote it.
- `channel` — visible only inside the active channel.

On every LLM turn the runtime injects matching memories into the system prompt
via the `MemoryProvider` in the context engine, so the model treats remembered
facts as ground truth without needing to call `recall` first.

## Installing community agents

Marketplace entries reference plugin ids (built-in or npm package names).
Installing an agent ensures every referenced plugin is available locally,
fetching unknown ids from npm into `~/.openbot/plugins/<id>/` on first use.
