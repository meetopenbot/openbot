# Agents

Agents are specialized entities within OpenBot that handle specific types of tasks.

## Built-in Agents

### OS Agent (`os`)
The OS agent is responsible for low-level system interactions. It uses the `shell` and `file-system` plugins to execute commands and manage files.

### Topic Agent (`topic`)
A background agent that observes completions from the Manager and automatically generates concise titles for chat threads.

## YAML Agents

You can define custom agents using YAML files in `~/.openbot/agents/`.

Example `coder.yaml`:
```yaml
name: coder
description: "A specialized agent for writing and refactoring code"
plugins:
  - name: file-system
  - name: shell
prompt: |
  You are an expert software engineer. 
  You use the provided tools to write high-quality code.
```

YAML agents are automatically discovered and registered by OpenBot on startup.
