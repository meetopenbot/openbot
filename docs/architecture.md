# Architecture

OpenBot follows a modular architecture based on the `melony` framework.

## Core Components

### 1. Agent Routing
The router is the central dispatcher. It receives user input and determines which agent should handle the message using the following priority:

1. **@mention** — the first `@agentId` in the message text
2. **Thread assignee** — if the thread is already assigned to an agent
3. **DM context** — direct messages route to the DM target agent
4. **Channel default** — falls back to the `default` agent

Once an agent is resolved for a thread, subsequent messages in that thread auto-route to the same agent.

### 2. Agent Registry
Holds all available agents. Agents can be:
- **Built-in**: Compiled directly into the OpenBot core (e.g., `osAgent`).
- **YAML-based**: Defined in `~/.openbot/agents/*/AGENT.md` files for quick customization.

### 3. Plugin Registry
Manages functionality that can be shared across agents. Plugins provide tool definitions and implementations (e.g., `shell`, `file-system`).

### 4. Melony App
The underlying event-driven orchestration layer that handles communication between agents via events like `agent:input` and `agent:output`.

## Message Flow

1. User sends a message (optionally @mentioning an agent).
2. Router parses the @mention and resolves the target agent.
3. The target agent's runtime processes the message.
4. The agent streams events (`agent:output`, `ui`, etc.) back to the client.
5. The thread is assigned to the agent for future messages.
