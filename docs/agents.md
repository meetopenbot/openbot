# Agents

Agents are specialized entities within the OpenBot platform, each designed to handle specific domains or tasks. The platform orchestrates these agents to solve complex problems through collaboration.

## Built-in Agents

### Orchestrator Agent (Default)
The central intelligence of the platform. It manages the conversation flow, handles long-term memory, and coordinates other agents.

### OS Agent (`os`)
Specialized in low-level system interactions. It uses the `shell` and `file-system` plugins to execute commands and manage files. (Implementation: `src/agents/system.ts`)

### Topic Agent (`topic`)
A utility agent that observes completions and automatically generates concise titles for conversations to keep the workspace organized.

### Codex Agent (`codex`)
A world-class software engineer agent. It assists with architectural decisions, refactoring, and debugging, with full access to the development environment.

## YAML Agents

You can define custom agents using YAML files in `~/.openbot/agents/`.

### Installing Agents

You can easily install official agents using the CLI:

```bash
openbot add codex
```

This will automatically download the agent and install it into your local agents directory.

Example `codex.yaml`:
```yaml
name: codex
description: "A specialized agent for writing and refactoring code"
plugins:
  - name: file-system
  - name: shell
prompt: |
  You are an expert software engineer. 
  You use the provided tools to write high-quality code.
```

YAML agents are automatically discovered and registered by OpenBot on startup.

## TS Agents (Packages)

For more advanced use cases, you can create a full TypeScript package as an agent. This is useful if you need custom logic, additional event handlers, or private plugins that you don't want to expose globally.

Place these in `~/.openbot/agents/my-ts-agent/`.

### Structure

- `package.json`: Standard npm package configuration.
- `index.ts`: The entry point that exports a `TSAgentDefinition`.

### Example `index.ts`

```typescript
import { TSAgentDefinition } from "openbot";

export const agent: TSAgentDefinition = {
  name: "my-ts-agent",
  description: "An agent with custom TypeScript logic.",
  factory: ({ model }) => (builder) => {
    // 1. You can use standard plugins
    // 2. Or implement custom event handling logic here
    // 3. Finally, wire up an LLM loop for it
    builder.use(llmPlugin({
      model,
      system: "You are a specialized TS Agent...",
      toolDefinitions: { /* custom tools */ },
      // I/O defaults to standardized: user:input / agent:output
    }));
  },
  capabilities: {
    "do_something": "Performs a custom TS-driven action"
  }
};
```

TS agents are automatically compiled and loaded on startup.
