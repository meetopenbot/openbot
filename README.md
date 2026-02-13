# 🤖 OpenBot

The ultimate AI sidekick that lives in your terminal and your browser. Built with [Melony](https://github.com/ddaras/melony), OpenBot can chat, browse the web, and manage files—giving you a powerful, real-time assistant for everything you do.

## 🚀 Quick Start

```bash
# Install the CLI
npm i -g openbot

# Configure your model (OpenAI, Anthropic, etc.)
openbot configure

# Start the agent server
openbot server
```

## 🌐 Web Interface

Once your server is running, you can use the interactive web UI:

```bash
npx openbot-web
```

## 📖 Documentation

Detailed documentation can be found in the [docs/](./docs/) folder:
- [Architecture](./docs/architecture.md)
- [CLI Reference](./docs/cli.md)
- [Plugins](./docs/plugins.md)
- [Agents](./docs/agents.md)

## 🏗️ Structure

- `server/`: The core AI agent and API server.
- `web/`: The React-based dashboard for interacting with your bots.

---

Built with ❤️ by the OpenBot team.
