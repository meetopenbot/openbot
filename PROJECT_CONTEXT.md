# OpenBot: Project Context

This file provides context and instructions for AI agents working on the OpenBot project.

## Project Overview

OpenBot is a local-first, Slack-like platform for AI agents. It allows users to interact with multiple specialized AI agents in a familiar, channel-based interface.

## Core Components

### Server (`/server`)
- **Melony Runtime**: A minimalist, event-based tiny runtime (event bus).
- **Functionality**: Handles server-side tasks, agent orchestration, and persistence.
- **Streaming**: Events are streamed to the client via Server-Sent Events.
- **Local Persistence**: Data is stored on the local file system (typically in `~/.openbot/`).

### Web (`/web`)
- **Technology Stack**: React, Vite, Tailwind CSS, shadcn/ui.
- **Experience**: Build a Slack-like experience where agents are bots/humans you can message.
- **Multi-Agent Behavior**: Support for multiple agents in shared contexts (channels).
- **Structure**:
    - **Channels**: Shared context and multi-agent workspace.

## AI Agent Instructions

When working on this project, keep the following in mind:

1.  **Architecture**: Always respect the `server` (logic/bus) and `web` (UI/SSE) separation.
2.  **Event-Driven**: New features should follow the Melony event-based pattern.
3.  **Local-First**: Do not introduce external cloud dependencies for data storage unless explicitly asked.
4.  **UI/UX**: Maintain the Slack-like aesthetic using shadcn/ui components.
5.  **Extensibility**: OpenBot is designed to be extensible via plugins and custom agents.

## Directory Map

- `/server`: Node.js/TypeScript backend core.
- `/web`: React/Vite dashboard.
- `/docs`: Detailed architectural and plugin documentation.
- `.cursor/rules/`: Specialized instructions for specific parts of the project (Melony, SDUI, etc.).
