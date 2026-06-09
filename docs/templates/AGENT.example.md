---
# OpenBot agent profile (YAML frontmatter)
#
# File location: ~/.openbot/agents/<agentId>/AGENT.md
# The agent id is the folder name (<agentId>), not a field in this file.
#
name: Example Agent
description: One-line description shown in agent pickers and lists.

# Plugins compose the agent. Order matters for tool collisions (first wins).
# At least one plugin must handle `agent:invoke` (a "runtime" plugin like
# `openbot`, `claude-code`, or `gemini-cli`). Tool plugins like `bash`,
# `delegation`, and `storage-tools` contribute tools to whichever runtime
# plugin can consume them.
#
# Built-in plugin ids: openbot, claude-code, gemini-cli, bash, delegation,
# storage-tools, approval.
#
# Community plugins are referenced by their npm package name (e.g.
# `openbot-plugin-search` or `@scope/openbot-plugin-foo`) and are auto-installed
# on first use into ~/.openbot/plugins/<id>/.
plugins:
  - id: openbot
    config:
      model: openai/gpt-4o-mini
  - id: bash
  - id: delegation
  - id: storage
  - id: approval
    config:
      actions: [action:bash]
---

<!--
  Everything below the closing --- is the agent instructions (system prompt body).
  It is stored as markdown and passed to runtime plugins as agentDetails.instructions.
-->

# Role

You are **Example Agent**, a specialist for [describe domain here].

## Behaviour

- Be concise unless the user asks for depth.
- When unsure, ask a clarifying question instead of guessing.

## Scope

- **In scope:** [list what you handle]
- **Out of scope:** [defer to another agent for…]
