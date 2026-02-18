# Agents

Agents are specialized entities within OpenBot that handle specific types of tasks.

## Built-in Agents

### OS Agent (`os`)
The OS agent is responsible for low-level system interactions. It uses the `shell` and `file-system` plugins to execute commands and manage files.

### Topic Agent (`topic`)
A background agent that observes completions from the Manager and automatically generates concise titles for chat threads.

### Codex Agent (`codex`)
A world-class software engineer and coding assistant powered by OpenAI. It helps with high-level architectural decisions, code refactoring, complex logic implementation, and debugging. It has access to the shell and file system to explore and modify your codebase.

## YAML Agents

You can define custom agents using YAML files in `~/.openbot/agents/`.

### Installing Agents

You can easily install official agents using the CLI:

```bash
openbot add codex
```

This will automatically download the agent from the official `meetopenbot` GitHub organization and install it into your local agents directory.

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
      promptInputType: "agent:my-ts-agent:input",
      actionResultInputType: "agent:my-ts-agent:result",
      completionEventType: "agent:my-ts-agent:output",
    }));
  },
  capabilities: {
    "do_something": "Performs a custom TS-driven action"
  }
};
```

TS agents are automatically compiled and loaded on startup.
