<p align="center">
  <img src="logo-black.png" width="200" alt="OpenBot Logo" />
</p>

<h1 align="center">OpenBot: The Extensible, Multi-Agent AI Sidekick.</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/openbot"><img src="https://img.shields.io/npm/v/openbot" alt="npm version" /></a>
  <a href="https://github.com/meetopenbot/openbot/blob/main/LICENSE"><img src="https://img.shields.io/github/license/meetopenbot/openbot" alt="license" /></a>
  <a href="https://github.com/meetopenbot/openbot/stargazers"><img src="https://img.shields.io/github/stars/meetopenbot/openbot?style=social" alt="github stars" /></a>
  <a href="https://github.com/meetopenbot/openbot/network/members"><img src="https://img.shields.io/github/forks/meetopenbot/openbot?style=social" alt="github forks" /></a>
  <a href="https://www.npmjs.com/package/openbot"><img src="https://img.shields.io/npm/dt/openbot" alt="npm downloads" /></a>
</p>

OpenBot is more than just a chatbot. It's an orchestrator that lives in your terminal and browser, delegating complex tasks to specialized agents. It's designed to be local-first, event-driven, and infinitely extensible.

![OpenBot Banner](https://raw.githubusercontent.com/meetopenbot/openbot/main/docs/banner.png)

## 🧠 The "Manager-Agent" Philosophy

OpenBot follows a **Delegate by Default** pattern. 

- **The Manager Agent**: Your primary interface. It analyzes your intent, manages long-term memory (via the `brain` plugin), and orchestrates specialized workers.
- **Specialized Agents**: Workers dedicated to specific domains like `os` (shell & files), `browser` (web automation), or any custom agent you define.
- **Event Bus**: All communication happens asynchronously via events, allowing for complex multi-agent choreography and real-time UI updates.

## 🤖 Meet the Agents

### 🧠 Manager Agent (The Orchestrator)
The central "brain" of the OpenBot ecosystem. It analyzes user intent, manages long-term memory (via the `brain` plugin), and coordinates other agents using the `delegateTask` tool. It provides you with a concise summary of the results once the specialists finish their work.

### 🐚 OS Agent (`os`)
Your specialized terminal and file system companion. It has full access to your local machine (within the boundaries you set). It can execute shell commands, create/read/edit files, manage directories, and handle system-level operations like git commands or script execution.

### 🌐 Browser Agent (`browser`) <mark>Stagehand</mark>
A powerful web automation specialist based on **[Stagehand](https://github.com/browserbase/stagehand)**. It can navigate the internet exactly like a human would—browsing websites, clicking buttons, filling forms, and extracting data.
*Note: We also plan to introduce a parallel agent based on **[browser-use](https://github.com/browser-use/browser-use)** for alternative autonomous web navigation strategies.*

### 🏷️ Topic Agent (`topic`)
A background utility that works silently to keep your workspace organized. It automatically analyzes the first few messages of a new conversation and generates a concise (3-5 word) title for the thread.

## 🗺️ Roadmap: Planned Agents

We are constantly expanding the OpenBot ecosystem with specialized agents:

- **`browser-use` Agent**: A high-level web agent leveraging the `browser-use` library for more autonomous, multi-step web tasks and complex reasoning.
- **`coder` Agent**: A specialized software engineer agent with deep understanding of project structures, refactoring patterns, and test-driven development.
- **`researcher` Agent**: An information-gathering specialist that can browse multiple sources, synthesize long-form reports, and cite its findings.
- **`devops` Agent**: Focused on CI/CD pipelines, container orchestration (Docker/K8s), and cloud infrastructure management.
- **`data-scientist` Agent**: Capable of running local notebooks, performing statistical analysis, and generating visualizations.
- **`social` Agent**: Designed to manage social media interactions, schedule posts, and monitor mentions.

### 💭 Persistent Brain & Memory
Unlike most chatbots, OpenBot has a long-term memory. It can:
- **`remember`**: Store facts, snippets, or preferences for later.
- **`recall`**: Search its past experiences to provide context for new tasks.
- **`updateIdentity`**: Maintain its own persona and "soul" in a markdown file.
- **`journal`**: Keep a daily log of activities and insights.

## 🚀 Quick Start

Get up and running in seconds:

```bash
# 1. Install OpenBot globally
npm i -g openbot

# 2. Start the server
openbot server

# 3. Launch the web UI (in a new terminal)
npx openbot-web
```

Once the UI is open, head to the **Settings** tab to configure your AI providers (OpenAI, Anthropic, etc.). No configuration files required.

### 🌍 Want to browse the web?
Add the official browser agent:
```bash
openbot add browser
```

## 🛠️ Built to be Extended

OpenBot is designed for power users and builders who want to create their own custom AI workflows without the complexity of building from scratch.

### 1. YAML Agents (No Coding Required)
Create specialized agents just by writing a simple YAML file in `~/.openbot/agents/researcher/agent.yaml`:

```yaml
name: researcher
description: A specialized agent for gathering information and summarizing articles.
model: anthropic/claude-3-5-sonnet-20240620
plugins:
  - name: browser
  - name: file-system
    config:
      baseDir: ~/Documents/Research
systemPrompt: |
  You are an expert researcher. 
  Use the browser to gather information and the file-system to save detailed reports.
  Always cite your sources and provide a high-level summary.
```

### 2. TS Agent Packages (Advanced)
For more complex agents that require custom logic beyond a prompt, you can create a full TypeScript package in `~/.openbot/agents/my-agent/`:

```typescript
// ~/.openbot/agents/my-agent/index.ts
export const agent = {
  name: "custom-agent",
  description: "An agent with custom TS logic",
  factory: ({ model }) => (builder) => {
    // Compose plugins and add custom event handlers
    builder.use(llmPlugin({
      model,
      system: "You are a specialized assistant...",
      // ...
    }));
  }
};
```

### 3. Custom Plugins
For those who want even more control, you can extend the AI's toolbox with custom logic. A plugin defines new tools and reacts to system events.

```typescript
export const myPlugin = () => (builder) => {
  builder.on("action:myTool", async function* (event, { state }) {
    // Perform custom logic or interact with other systems
    yield { type: "action:taskResult", data: { result: "Done!" } };
  });
};
```

### Direct Command Routing
Skip the manager's reasoning and talk directly to an agent using prefixes:
- `/os list files in current directory`
- `/browser search for local weather`

## 🏗️ Core Architecture

- **`Manager`**: Central brain, handles `/remember` and `/recall`.
- **`Plugin Registry`**: Centralized tool discovery.
- **`Agent Registry`**: Dynamic loading of built-in and user-defined agents.
- **`SDUI (Server-Driven UI)`**: Plugins can emit UI components (cards, logs, status updates) that render directly in the web dashboard.

## 📂 Project Structure

- `/server`: Core assistant logic and API server.
- `/web`: Interactive dashboard for your bots.
- `/docs`: Detailed guides on [Architecture](./docs/architecture.md), [Plugins](./docs/plugins.md), and [Agents](./docs/agents.md).

## 🤝 Contributing

We love contributors! Whether it's adding a new plugin, a specialized agent, or improving the core orchestrator, check out our [Contribution Guide](./CONTRIBUTING.md).

---
