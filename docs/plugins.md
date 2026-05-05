# Plugins

Plugins are the building blocks of the OpenBot platform's capabilities. They provide the tools and logic that the orchestrator and specialized agents use to interact with the world.

## Built-in Plugins

- **ai-sdk**: Integration with AI providers (OpenAI, Anthropic, etc.).
- **storage**: Local file-based persistence for events and state.
- **mcp**: Model Context Protocol integration.
- **delegation**: Allows agents to delegate tasks to other agents.
- **approval**: Approval gate for sensitive actions.
- **shell**: Execute terminal commands.
- **ui**: Server-driven UI components.

## In-depth: UI Plugin

The `ui` plugin lets agents render small server-driven widgets through the event stream.
Agents call the `render_ui_widget` tool, which emits a `client:ui:widget` event for clients.

Preferred widget kinds:
- `message`: a simple card for notices, warnings, or summaries.
- `choice`: a decision card with one or more actions, such as approve/deny.
- `form`: structured fields for user input.
- `list`: todo lists, progress lists, or checklists.

Clients can submit clicks or form values back through `client:ui:widget:response`:

```ts
{
  type: 'client:ui:widget:response',
  data: {
    widgetId: 'widget_tool-call-id',
    actionId: 'approve',
    values: { reason: 'Looks good' }
  }
}
```

The legacy `approval` and `todo_list` presets are still accepted by `render_ui_widget`, but new agents should prefer `choice` and `list`.

## In-depth: Shell Plugin

The `shell` plugin gives agents the ability to execute terminal commands. It provides the `shell_exec` tool.

### Tool: `shell_exec`

- `command`: The shell command to execute.
- `cwd`: Optional working directory.
- `shell`: Optional shell interpreter (`bash`, `sh`, `zsh`). Defaults to `bash`.
- `timeoutMs`: Optional timeout in milliseconds. Defaults to 30000.

### Safety

The shell action is designed to run through approval first:

1. `action:shell_exec` is emitted from the tool call.
2. The approval plugin requests user confirmation.
3. On approve, `action:shell_exec` is re-emitted with approval metadata.
4. The shell plugin executes and emits `action:shell_exec:result`.

Commands are executed via `child_process.spawn`. Output is capped at 100KB to prevent memory issues.

## In-depth: Approval Plugin

The `approval` plugin is a safety layer for protected actions.
It stores pending approvals in channel/thread state, shows an approval widget, and only emits execute events after user confirmation.

### Configuration

Add it to your `AGENT.md` frontmatter:

```yaml
plugins:
  - name: approval
    config:
      rules:
        - action: "action:shell_exec"
          message: "The agent wants to execute a terminal command."
          detailKeys: ["command", "cwd", "shell", "timeoutMs"]
          hiddenKeys: ["env"]
```

- `action`: The event type prefix to intercept (for example `action:shell_exec`).
- `executeEvent`: Optional event emitted after user approval (defaults to the same action event).
- `denyEvent`: Event emitted when approval is denied (defaults to `${action}:result`).
- `denyData`: Optional payload merged into deny event data.
- `message`: Optional custom message to display in the approval UI.
- `detailKeys`: Optional ordered list of event data keys to show in the compact details block.
- `hiddenKeys`: Optional list of keys to redact from details and full payload.

The approval plugin is fully rule-driven. If no `rules` are configured, it does not gate any actions.

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
