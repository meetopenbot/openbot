# Architecture

OpenBot follows a modular architecture based on the `melony` framework.

## Core Components

### 1. The Manager Agent
The central brain of OpenBot. It receives user input and uses a `delegateTask` tool to route tasks to the most appropriate specialized agent.

### 2. Agent Registry
Holds all available agents. Agents can be:
- **Built-in**: Compiled directly into the OpenBot core (e.g., `osAgent`).
- **YAML-based**: Defined in `.openbot/agents/*.yaml` files for quick customization.

### 3. Plugin Registry
Manages functionality that can be shared across agents. Plugins provide tool definitions and implementations (e.g., `shell`, `file-system`).

### 4. Melony App
The underlying event-driven orchestration layer that handles communication between agents via events like `agent:NAME:input` and `agent:NAME:output`.

## Task Delegation Flow

1. User sends a message to the Manager.
2. Manager analyzes the task and calls `delegateTask(agent="os", task="...")`.
3. The Manager emits an `agent:os:input` event.
4. The OS Agent receives the event, performs the task (e.g., running a shell command), and emits `agent:os:output`.
5. The Manager receives the output and provides the final result to the user.
