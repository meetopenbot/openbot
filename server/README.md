# OpenBot Server

OpenBot Server is the event-driven backend for OpenBot, a local-first, Slack-like workspace where AI agents collaborate alongside people. The server runs on the Melony event bus, persists workspace data on disk, and exposes HTTP + Server-Sent Event (SSE) APIs that power the web dashboard and other clients.

## Highlights
- Event-driven pipeline (`Event → Handler → Events`) built on Melony for predictable orchestration.
- Local-first persistence under `~/.openbot/` for agents, plugins, channels, and transcripts.
- Extensible runtime plugin system (AI model routing, storage, threads, delegation) that can be loaded from disk.
- Lightweight CLI (`openbot`) for launching the server globally or directly from source.

## Requirements
- Node.js **>= 20.12.0** (the CLI will warn on older runtimes).
- pnpm (recommended) or npm for dependency management.
- macOS, Linux, or Windows via WSL2. The runtime expects POSIX-style filesystem semantics.

## Quick Start (Global CLI)
```bash
npm install -g openbot           # pnpm add -g openbot also works
openbot server --port 4132
```
The first launch creates `~/.openbot/` with default folders for agents and plugins. Add API keys such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` to your environment (or a local `.env`) before starting the server so AI-backed plugins can call external models.

## Run from Source (Monorepo Developers)
```bash
git clone https://github.com/meetopenbot/openbot.git
cd openbot/server

pnpm install         # install server dependencies
pnpm dev             # live-reload TypeScript entrypoint
# or build & run the compiled CLI
pnpm build
pnpm start -- --port 4132
```
Build artifacts land in `dist/v2/app/`, and `package.json` currently reports version `0.2.12`.

## Configuration & Data
- Configuration lives in `~/.openbot/config.json`. Edit it to change the default port or move the workspace via `baseDir`.
- Provider credentials and other secrets live in `~/.openbot/variables.json`. Values are loaded into `process.env` at startup.
- Agents, plugins, and channel state are stored beneath the same base directory. Drop compiled plugins into `~/.openbot/plugins/<name>/dist/index.js` to have them auto-loaded.
- The server reads `.env` files from the working directory in addition to standard environment variables.

## Usage Examples

### Start the server with custom options
```bash
openbot server --port 5000
```
CLI flags override values from `config.json`, and you can also set `PORT=5000` in the environment if you prefer.

### Publish a user message to a channel
```bash
curl -X POST http://localhost:4132/api/publish \
  -H 'Content-Type: application/json' \
  -H 'x-openbot-channel-id: dm_default' \
  -d '{
    "type": "user:input",
    "data": { "content": "Hello @codex" }
  }'
```
Incoming `user:input` events are transformed into `agent:invoke` events, routed to the appropriate agent (based on @mentions, DM context, or channel defaults), persisted, and fanned out to active SSE subscribers.

### Subscribe to the live event stream
```bash
curl -N 'http://localhost:4132/api/events?channelId=dm_default'
```
Add `x-openbot-thread-id` (or `threadId` in the query string) to scope the stream to a specific thread. The server emits keepalive frames so long-running EventSource connections stay healthy.

### Explore stored events
Workspace history is durable under `~/.openbot/channels`. Inspect transcripts directly or build automation on top of the JSON event log.

## Development Workflow
- `pnpm dev` — run the CLI through `tsx watch` for instant reloads.
- `pnpm build` — compile TypeScript into `dist/`.
- `pnpm start` — execute the compiled CLI (`node dist/v2/app/cli.js server`).
- `node src/v2/app/cli.ts server` — ad-hoc smoke test if `tsx` is installed globally.

## Contribution Guidelines
We welcome contributions across agents, plugins, runtime features, and documentation.

1. Fork the repository, create a feature branch from `main`, and ensure you are on Node.js ≥ 20.12.0.
2. Install dependencies with `pnpm install` inside `server/`.
3. Make incremental, well-documented changes. Add or update tests whenever behavior changes.
4. Run `pnpm build` (and any relevant checks you touched) before opening a pull request.
5. Open a PR describing the problem solved, the scenarios validated, and any follow-up work.

Full contribution details (issue triage, coding standards, review flow) live in `../CONTRIBUTING.md`.

## Support & Feedback
- Discord: https://discord.gg/XYYXvN2ebB
- Issues & feature requests: https://github.com/meetopenbot/openbot/issues

Thanks for helping keep OpenBot local-first and event-driven!
