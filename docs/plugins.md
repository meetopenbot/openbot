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
| `openbot`       | Runtime    | Standard batteries-included OpenBot agent runtime.        |
| `claude-code`   | Runtime    | Claude Agent SDK; owns its own tool loop                  |
| `gemini-cli`    | Runtime    | Google `gemini` CLI in headless mode                      |
| `bash`          | Tool       | `bash` (inbuilt in `openbot`)                             |
| `storage`       | Tool       | `create_channel`, `patch_*`, ... (inbuilt in `openbot`)   |
| `memory`        | Tool       | `remember`, `recall`, `forget` (inbuilt in `openbot`)     |
| `plugin-manager`| Infra      | Marketplace list, npm plugin install/uninstall, agent install |

## Batteries-included: `openbot` runtime

The `openbot` plugin is the standard runtime for OpenBot agents. It is designed
to be isolated and self-contained, providing a core ecosystem of inbuilt tools:

- **Bash**: Stateful system tasks and file operations.
- **Memory**: Long-term durable fact storage.
- **Storage**: Channel and thread management.
- **Delegation**: Calling upon other specialized agents.
- **Approval**: Gating protected actions behind UI confirmation.

When you use the `openbot` runtime, these tools are automatically available.
You can configure the inbuilt `approval` plugin via the `openbot` plugin config:

```yaml
plugins:
  - id: openbot
    config:
      model: openai/gpt-4o-mini
      approval:
        actions: [action:shell_exec, action:create_channel]
```

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

The `approval` plugin gates protected tool calls behind a UI confirmation widget. By default, it gates `action:shell_exec`.

```yaml
plugins:
  - id: approval
    config:
      actions: [action:shell_exec]
```
