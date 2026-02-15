# Plugins

Plugins are the building blocks of OpenBot's capabilities. They provide tools and logic that agents can use.

## Built-in Plugins

- **shell**: Allows agents to execute shell commands.
- **file-system**: Provides file CRUD operations (read, write, list, delete).
- **approval**: Intercepts actions and requires user confirmation before proceeding.
- **brain**: Manages the "long-term memory" and context for the manager agent.

## In-depth: Approval Plugin

The `approval` plugin is a safety layer that can be added to any agent. It intercepts specified actions and suspends execution until a user manually approves or denies the action via the UI.

### Configuration

Add it to your `agent.yaml`:

```yaml
plugins:
  - name: approval
    config:
      rules:
        - action: "action:executeCommand"
          message: "The agent wants to execute a terminal command."
        - action: "action:writeFile"
          message: "The agent wants to modify a file."
```

- `action`: The event type prefix to intercept (e.g., `action:executeCommand`).
- `message`: Optional custom message to display in the approval UI.

## Shared Plugins

Shared plugins are community-contributed or user-defined plugins that can be installed into `~/.openbot/plugins/`. Once installed, they are automatically registered in the Plugin Registry and become available to any agent that references them.

### Installing a Plugin

For official plugins, you can use the `add` command:

```bash
openbot add search
```

For community or custom plugins, you can use the `plugin install` command with a full GitHub repository path or local path:

```bash
openbot plugin install openbot-ai/plugin-web-search
```

## Creating a Plugin

A plugin is typically a Node.js package that exports:
- `name`: Unique identifier.
- `description`: What the plugin does.
- `toolDefinitions`: Zod-based definitions for the tools it provides.
- `factory`: A function that initializes the plugin logic.
