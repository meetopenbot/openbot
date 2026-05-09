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
  - id: ai-sdk
    config:
      model: anthropic/claude-3-5-sonnet-20240620
  - id: mcp
  - id: shell
  - id: delegation
---

You are a web research specialist. Use the available tools to gather and
synthesize information. Be concise and cite sources where relevant.
```

The body below the frontmatter is the system prompt passed to the runtime
plugin as `agentDetails.instructions`.

### Required: at least one runtime plugin

A runtime plugin is one that handles `agent:invoke` (the LLM loop). Without
one, the agent will not respond to user input. Built-in runtime plugins:

- `ai-sdk` — generic LLM runtime (Vercel AI SDK). Consumes tools from other
  plugins listed alongside it.
- `claude-code` — runs Claude inside the Claude Agent SDK with its own tools.
- `gemini-cli` — spawns Google's `gemini` CLI in headless mode.

`claude-code` and `gemini-cli` own their own tool loops, so attaching tool
plugins like `shell` or `mcp` to them has no effect. Pair tool plugins with
`ai-sdk`.

## Built-in agent

OpenBot ships a built-in `system` agent (the orchestrator) with the
`ai-sdk` runtime plus the standard tool plugins (storage, shell, mcp,
delegation, ui, approval). It cannot be deleted.

## Installing community agents

Marketplace entries reference plugin ids (built-in or npm package names).
Installing an agent ensures every referenced plugin is available locally,
fetching unknown ids from npm into `~/.openbot/plugins/<id>/` on first use.
