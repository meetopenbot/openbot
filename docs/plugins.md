# Plugins (public edition)

Plugins extend agents with tools and event handlers. Built-in plugins ship in `src/plugins/`.

## Built-in plugins

| Id        | Type | Description                          |
|-----------|------|--------------------------------------|
| `openbot` | Runtime | LLM loop + bundled storage tools  |
| `storage` | Tool + infra | Channels, threads |
| `ui`      | Tool | Render widgets to the client      |

Reference plugins in `AGENT.md`:

```yaml
plugins:
  - id: openbot
    config:
      model: openai/gpt-4o-mini
  - id: storage
```

## Community plugins

Place npm-built packages under `~/.openbot/plugins/<package-name>/dist/index.js` and reference the package name as the plugin id.

## Writing a plugin

Export a `Plugin` object (or `default`) with:

- `name`, `description`
- optional `toolDefinitions` (Zod schemas)
- `factory(context)` returning a Melony plugin function

See `src/plugins/ui/index.ts` for a small example.
