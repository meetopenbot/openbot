# CLI Reference

The `openbot` CLI is the primary way to interact with and configure your OpenBot instance.

## Commands

### `configure`
Interactive setup for choosing your default LLM (OpenAI or Anthropic). Model names follow the `provider/model` format (e.g., `openai/gpt-4o`).

```bash
openbot configure
```

### `server`
Starts the OpenBot server.

```bash
openbot server [options]
```
**Options:**
- `-p, --port <number>`: Port to listen on.
- `--openai-api-key <key>`: OpenAI API Key (can also be set via `OPENAI_API_KEY` env var).
- `--anthropic-api-key <key>`: Anthropic API Key (can also be set via `ANTHROPIC_API_KEY` env var).

### `add <name>`
Conveniently add an official agent or plugin. It auto-resolves names from the `meetopenbot` GitHub organization or official NPM registry.

```bash
# Add an agent (e.g. meetopenbot/agent-coder)
openbot add coder

# Add a plugin (e.g. meetopenbot/plugin-search)
openbot add search
```

### `plugin install <source>`
Installs a shared plugin from a GitHub repository or local path.

```bash
openbot plugin install user/repo
# or
openbot plugin install ./path/to/plugin
```

### `plugin list`
Lists all installed shared plugins.

```bash
openbot plugin list
```
