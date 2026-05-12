# Plugins

A **Plugin** is the single extension unit on the OpenBot bus. Every agent is
just a list of plugins. The bus does not distinguish between "runtime" and
"tool" plugins — those are roles defined entirely by which events a plugin
subscribes to and emits.

- **Runtime plugins** handle `agent:invoke` and run an LLM loop. They may
  consume tools contributed by other plugins via `PluginContext.tools`.
- **Tool plugins** expose `toolDefinitions` and handle the corresponding
  `action:<tool>` events.
- **Middleware plugins** observe events and re-emit them with extra logic
  (e.g. the `approval` plugin gates protected actions).

## Plugin contract

```ts
export interface Plugin {
  id: string;
  name: string;
  description: string;
  image?: string;
  configSchema?: ConfigSchema;
  toolDefinitions?: Record<string, ToolDefinition>;
  factory: (context: PluginContext) => MelonyPlugin;
}

export interface PluginContext {
  agentId: string;
  agentDetails: AgentDetails;
  config: Record<string, unknown>;   // from AGENT.md plugins[].config
  storage: Storage;
  tools: Record<string, ToolDefinition>; // merged from all tool plugins
}
```

The agent loader collects `toolDefinitions` from every plugin attached to the
same agent into a single map and passes it to every plugin via `context.tools`.
Runtime plugins read it; tool plugins ignore it. First plugin wins on tool
name collisions.

## Built-in plugins

| Id              | Role       | Notes                                                     |
| --------------- | ---------- | --------------------------------------------------------- |
| `ai-sdk`        | Runtime    | Generic LLM loop on Vercel AI SDK; consumes external tools |
| `claude-code`   | Runtime    | Claude Agent SDK; owns its own tool loop                  |
| `gemini-cli`    | Runtime    | Google `gemini` CLI in headless mode                      |
| `shell`         | Tool       | `shell_exec`                                              |
| `mcp`           | Tool       | `mcp_list_tools`, `mcp_call`                              |
| `delegation`    | Tool       | `handoff`, `delegate`                                     |
| `storage-tools` | Tool       | `create_channel`, `patch_*`, `create_variable`, ...       |
| `ui`            | Tool       | `render_ui_widget`                                        |
| `approval`      | Middleware | Gates protected actions behind a UI confirmation widget   |

## Community plugins

A community plugin is just an npm package whose default export matches the
`Plugin` interface. Reference it by its npm package name in AGENT.md:

```yaml
plugins:
  - id: openbot-plugin-search
    config:
      provider: tavily
```

On first use OpenBot installs the package into
`~/.openbot/plugins/<npm-name>/` (scoped packages live under
`~/.openbot/plugins/@scope/<name>/`).

## Approval plugin

The `approval` plugin reads its rules from per-agent config:

```yaml
plugins:
  - id: approval
    config:
      rules:
        - action: action:shell_exec
          message: The agent wants to run a terminal command.
          detailKeys: [command, cwd, shell, timeoutMs]
          hiddenKeys: [env]
```

If `rules` is omitted, sensible defaults are applied (currently: gate
`action:shell_exec`).
