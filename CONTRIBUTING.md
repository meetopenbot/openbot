# Contributing to OpenBot 🤖

Thank you for your interest in contributing to OpenBot! We're building the future of local-first, multi-agent AI assistants, and we'd love for you to join us.

---

## 🗺️ Project Overview

OpenBot is a monorepo consisting of:
- **`server/`**: The core Node.js/TypeScript backend that orchestrates agents and handles the Melony event bus.
- **`web/`**: A React-based dashboard for interacting with your OpenBot instance.
- **`docs/`**: Detailed documentation on architecture, plugins, and agents.

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/)

### Development Setup

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/ddaras/openbot.git
    cd openbot
    ```

2.  **Install dependencies**:
    We use a root-level script to install dependencies for both the server and the web dashboard:
    ```bash
    npm run install-all
    ```

3.  **Run in development mode**:
    To start both the server and the web dashboard concurrently:
    ```bash
    npm run dev
    ```
    The server typically runs on `http://localhost:4001` and the web dashboard on `http://localhost:5173`.

## 🛠️ How to Contribute

### Reporting Bugs or Requesting Features
- Check the [Issues](https://github.com/ddaras/openbot/issues) to see if it's already being discussed.
- If not, feel free to open a new issue with a clear description and steps to reproduce.

### Submitting a Pull Request
1.  **Fork the repository** and create your branch from `main`.
2.  **Make your changes**. If you're adding a new feature, please include relevant documentation in the `docs/` folder or update the READMEs.
3.  **Ensure your code builds**:
    ```bash
    cd server && npm run build
    ```
4.  **Create a Pull Request** with a clear title and description of your changes.

## 🎨 Coding Standards

- **TypeScript**: We use TypeScript for both the server and the web dashboard. Please ensure your code is type-safe.
- **Linting**: Before submitting a PR, please run the linters:
  ```bash
  npm run lint --prefix web
  ```
- **Functional & Event-Driven**: Since OpenBot is built on the [Melony](https://github.com/ddaras/melony) framework, try to stick to event-driven patterns when extending core functionality.

## 🧩 Extending OpenBot

OpenBot is designed to be extensible. You can contribute in several ways:
- **New Plugins**: Add new capabilities (tools) to the `server/src/plugins/` directory.
- **Built-in Agents**: Define new specialized agents in `server/src/agents/`.
- **UI Enhancements**: Improve the React dashboard in the `web/` directory.

---

We appreciate every contribution, big or small! If you have any questions, feel free to reach out via GitHub issues. Happy coding! 🚀
