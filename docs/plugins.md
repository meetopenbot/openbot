# Plugins

Plugins are the building blocks of the OpenBot platform's capabilities. They provide the tools and logic that the orchestrator and specialized agents use to interact with the world.

## Built-in Plugins

- **ai-sdk**: Integration with AI providers (OpenAI, Anthropic, etc.).
- **storage**: Local file-based persistence for events and state.
- **mcp**: Model Context Protocol integration.
- **delegation**: Allows agents to delegate tasks to other agents.
- **ui**: Server-driven UI components.

## In-depth: Approval Plugin

The `approval` plugin is a safety layer that can be added to any agent. It intercepts specified actions and suspends execution until a user manually approves or denies the action via the UI.

### Configuration

Add it to your `AGENT.md` frontmatter:

```yaml
plugins:
  - name: approval
    config:
      rules:
        - action: "action:executeCommand"
          message: "The agent wants to execute a terminal command."
          detailKeys: ["command", "cwd"]
          hiddenKeys: ["env"]
        - action: "action:writeFile"
          message: "The agent wants to modify a file."
          detailKeys: ["path"]
```

- `action`: The event type prefix to intercept (e.g., `action:executeCommand`).
- `message`: Optional custom message to display in the approval UI.
- `detailKeys`: Optional ordered list of event data keys to show in the compact details block.
- `hiddenKeys`: Optional list of keys to redact from details and full payload.

### Approval UI Details Payload

The approval card keeps the same visual widget but now renders structured details for clearer decisions.

Payload shape sent to the widget:

```ts
{
  summary: string;
  details?: Array<{ label: string; value: string }>;
  rawPayload?: string;
}
```

What users now see before approving:
- Action label and event type.
- A compact details list based on `detailKeys` (or auto-derived keys if omitted).
- A sanitized full action payload (sensitive keys are redacted and very large values are truncated).

## Shared Plugins

Shared plugins are community-contributed or user-defined plugins that can be installed into `~/.openbot/plugins/`. Once installed, they are automatically registered in the Plugin Registry and become available to any agent that references them.

### Installing a Plugin

For official plugins, you can use the `add` command:

```bash
openbot add search
```

## Creating a Plugin

A plugin is typically a Node.js package that exports:
- `name`: Unique identifier.
- `description`: What the plugin does.
- `toolDefinitions`: Zod-based definitions for the tools it provides.
- `factory`: A function that initializes the plugin logic.
