# OpenBot Documentation

OpenBot is a powerful, extensible AI assistant framework built on top of the `melony` orchestration library. It is designed to be a secure and easy-to-use manager agent that can delegate tasks to specialized agents and interact with the operating system.

## Key Features

- **Agent Orchestration**: Dynamically delegates tasks to specialized agents (e.g., OS, Topic, or custom YAML agents).
- **Plugin System**: Easily extend functionality with built-in and community-shared plugins.
- **CLI Tool**: Simple configuration and management of the OpenBot server and plugins.
- **Security**: Designed for secure interaction with shell and file system operations.
- **Extensibility**: Add new agents using YAML definitions or full-blown Melony plugins.

## Getting Started

To get started with OpenBot, you can use the CLI to configure your preferred LLM provider, add some agents/plugins, and start the server.

```bash
# Configure the model
openbot configure

# Add the 'coder' agent and 'search' plugin
openbot add coder
openbot add search

# Start the server
openbot server --openai-api-key YOUR_KEY
```

## Documentation Contents

- [Architecture](./architecture.md) - Understand how OpenBot is built.
- [CLI Reference](./cli.md) - Detailed guide on using the `openbot` command.
- [Plugins](./plugins.md) - How to use and install shared plugins.
- [Agents](./agents.md) - Documentation on built-in and custom agents.
