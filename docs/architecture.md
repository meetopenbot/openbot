# Architecture

OpenBot is an orchestration platform built on a modular, event-driven architecture. It leverages the `melony` framework to coordinate interactions between multiple specialized agents through a central **orchestrator** (HTTP handlers call it directly).

## Core Components

### 1. Orchestrator & routing
The orchestrator is the execution entry point for agent work: it normalizes incoming events, runs the queue processor (todo-driven assignees), builds per-agent Melony runtimes, and streams emitted events back to callers (for example storage and SSE). Routing across the agent network uses:

1. **Command Prefix** — Explicit delegation to a specific agent (e.g., `/os list files`).
2. **DM context** — Direct communication with a specific agent.
3. **Orchestrator Intelligence** — The default agent analyzes the request and suggests or invokes the most suitable specialized agent.

### 2. Agent Registry
A dynamic registry that manages all available agents. Agents can be:
- **Built-in**: Core agent packages shipped with the repo (e.g. `src/agents/openbot/`).
- **YAML-based**: Rapidly defined agents in `~/.openbot/agents/*/AGENT.md`.
- **TS Packages**: Advanced agents with custom logic in `~/.openbot/agents/*/index.ts`.

### 3. Plugin registry
The "capability layer" that provides tools and logic shared across the platform. Plugins (like `shell`, `file-system`, or `mcp`) define the actions agents can perform.

### 4. Orchestration layer (Melony)
The underlying event bus that handles all communication. It ensures that agents can collaborate asynchronously, share context, and emit real-time updates to the UI.

## Multi-Agent Workflow

1. **Input**: User sends a message to the platform.
2. **Orchestration**: The router or orchestrator agent identifies the required capabilities (via command prefix or intent analysis).
3. **Execution**: The target agent(s) process the task, potentially collaborating with other agents via the event bus.
4. **Output**: Agents stream events (`agent:output`, `ui`, etc.) back to the central dashboard.
