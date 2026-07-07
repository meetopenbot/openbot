# Agents (public edition)

## Built-in agents

| Id       | Name    | Purpose                                      |
|----------|---------|----------------------------------------------|
| `system` | OpenBot | Default LLM agent (`openbot` + storage tools) |
| `state`  | State   | Deterministic storage reads (no model)       |

The `system` agent id is fixed. Custom agents use their folder name as id.

## Defining a custom agent

Create `~/.openbot/agents/<agent-id>/AGENT.md`:

```markdown
---
name: My Agent
description: What this agent does.
plugins:
  - id: openbot
    config:
      model: openai/gpt-4o-mini
  - id: storage
---

System instructions go here (markdown body).
```

Restart the server or publish a storage refresh event after changes.

## Models

Use `provider/model-id` strings supported by the runtime:

- `openai/gpt-4o-mini`
- `openai/gpt-4o`
- `anthropic/claude-3-5-sonnet-latest`
- `google/gemini-2.0-flash`

Set API keys via environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) before starting the server.
