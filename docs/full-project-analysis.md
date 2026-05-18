# OpenBot — Full Project Analysis (Reverse Engineering)

This document is a structured reverse-engineering and analysis of the OpenBot repository as of the documentation date. Scope: **`src/`** (TypeScript sources), **`docs/`**, **`package.json`**, **`README.md`**, **`LICENSE`**. **Note:** There is no first-party web UI (React/Vue/etc.) in this repo; clients (e.g. `https://openbot.one`) use HTTP + SSE + JSON events.

---

## Phase 1 — Project overview

### What this product is

**OpenBot** is a **local-first Node.js harness**: a long-running **HTTP server** plus **CLI** (`openbot start`) that runs **multi-agent orchestration** on your machine. Agents are **Melony runtime compositions** built from **plugins**. Coordination is **event-driven**: clients publish events, the server dispatches them through a Melony `Runtime`, and results stream back as events (SSE for live subscribers; JSON array for one-shot “state” queries).

### Primary business purpose

- Provide a **standardized local runtime** for AI agents: channels, threads, tools, memory, delegation, and streaming—**without mandating a cloud database**.
- Anchor an ecosystem: **npm-distributed CLI + plugin packages**, optional **hosted UI** (`openbot.one`), and a **public registry JSON** for marketplace agents.

### Target users

- Developers and technical operators who want **local control** of models, secrets, and filesystem access.
- Teams experimenting with **multi-agent workflows** (handoffs, shared todos) with data under **`~/.openbot`**.

### Core problem solved

- **Agent fragmentation**: centralizes **bus semantics** (events), **workspace layout**, and **plugin composition** instead of one-off runners per tool.

### Product category

- **Local AI agent runtime / orchestration middleware** (not a full SaaS app in this repository alone).

### Likely monetization model (inferred)

- **Open-core CLI** (MIT) + **hosted management UI** at `openbot.one` (referenced in server logs only).
- **Distribution** via **npm** (`openbot`).

### Maturity

- **Advanced MVP / early production-grade runtime** for a narrow surface: solid event pipeline and persistence; **no automated tests** found in repo; docs reference runtimes **not** present in built-in plugin registry.

### Technical stack

| Layer        | Technology |
|-------------|------------|
| Language    | TypeScript → ES modules, Node 20.12+ |
| HTTP        | Express 4, `cors`, JSON body up to 20mb |
| Orchestration | `melony` |
| LLM         | Vercel `ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` |
| Config      | `dotenv`, `gray-matter` (`AGENT.md`), `zod` v4 |
| CLI         | `commander` |
| Build       | `tsc` → `dist/`, `tsx` for dev |

### Executive summary

OpenBot is a **local event-sourced agent platform**: a small HTTP API fans out **typed events** to a Melony runtime wired per-agent from **`AGENT.md` + plugins**. Persistence is **files under `~/.openbot`**. The **system** agent (`system` / “OpenBot”) ships built-in with **`openbot`** and tools (shell, storage, todos, approval, memory, etc.). **Server-driven UI** is emitted as `client:ui:widget` events for external clients to render.

### Product overview

- **Event** (`OpenBotEvent`): `type`, optional `data`, `meta`, `id`.
- **Spaces**: **channels** and **threads** under `~/.openbot/channels/`.
- **Participants**: channel `state.json` may list agent ids for prompt context.
- **Plugins**: extend the bus; tool definitions **merge** (first wins on name collision).
- **Run lifecycle**: `agent:run:start` / `agent:run:end`, stop via `action:agent_run_stop`, chaining via `handoff:request` and **todo assignees**.

### Technical overview

- Entry: `src/app/cli.ts` → `startServer` in `src/app/server.ts`.
- Dispatch: `src/harness/dispatcher.ts`.
- Runtime: `src/harness/runtime-factory.ts`.
- Platform bus handlers: `src/bus/services.ts`.
- Persistence: `src/services/storage.ts`, `src/services/memory.ts`.
- Plugins: `src/registry/plugins.ts`, `src/services/plugins.ts`.

### Architecture overview (text diagram)

```
CLI (commander) ──► startServer (Express)
                         │
     GET /api/events ◄───┼── SSE fan-out (per channel/thread key)
 POST /api/publish   ────┼──► dispatch()
     GET /api/state  ────┘        │
                                 ├── storageService.getOpenBotState()
                                 ├── createAgentRuntime(state) [melony + plugins]
                                 └── onEvent: persist + SSE (+ __global__ for run markers)

~/.openbot/
  config.json, variables.json
  agents/<id>/AGENT.md
  plugins/<npm-package>/dist/index.js
  channels/<channelId>/{SPEC.md,state.json,events.jsonl,threads/...}
  memory/log.jsonl
```

---

## Phase 2 — Feature inventory

### Feature map (high level)

1. CLI: `openbot start`
2. HTTP: `GET /api/health`
3. HTTP: `GET /api/events` (SSE)
4. HTTP: `POST /api/publish`
5. HTTP: `GET /api/state`
6. Context extraction (headers / query / body): channel, thread, agent, run, responseType
7. Active run tracking + snapshot to `__global__` SSE subscribers
8. Event persistence (`events.jsonl`); auto-create thread on first threaded event
9. Dispatch: user step vs pass-through vs stop
10. Melony runtime per agent
11. Bus services: channels, threads, storage wrappers, todos, marketplace, agent install, plugin install/uninstall, memory
12. OpenBot runtime: tool loop, short-term messages, API key widget flow
13. Shell: `shell_exec`
14. Delegation: `handoff` → `handoff:request` → chained steps
15. Approval middleware for protected actions
16. UI widgets: `render_ui_widget` → `client:ui:widget`
17. Memory: remember / recall / forget + context injection
18. Todos: shared thread list + `advanceAfterRun`
19. Built-in + community plugins from disk
20. Marketplace fetch + `action:agent:install`
21. Variables + sync to `process.env`
22. Channel filesystem list/read (sandboxed to channel `cwd`)
23. Last-read / unread hints (`_meta/last-read.json`)

### Feature table (repo status)

| Feature | Entry points | Key code | Data | Status |
|--------|--------------|----------|------|--------|
| CLI start | `openbot start` | `app/cli.ts`, `app/server.ts` | — | Complete |
| SSE | `GET /api/events` | `server.ts` | — | Complete |
| Publish | `POST /api/publish` | `server.ts` → `dispatcher.ts` | `events.jsonl` | Complete |
| State | `GET /api/state` | `server.ts`, `app/utils.ts` | optional persist | Complete |
| Health | `GET /api/health` | `server.ts` | — | Complete (extra vs README “3 endpoints”) |
| Agents | `~/.openbot/agents` | `services/storage.ts` | `AGENT.md` | Complete |
| System agent | default `agentId` | `storage.ts` `getSystemAgentDetails` | in-code | Complete |
| Plugin merge | runtime build | `runtime-factory.ts` | — | Complete |
| Bus CRUD | Melony `action:*` | `bus/services.ts` | JSON files | Complete |
| AI turns | `agent:invoke` | `plugins/openbot/runtime.ts` | thread/channel state | Complete |
| API key UX | widget response | `runtime.ts` | `variables.json`, `config.json` | Complete |
| Shell | `action:shell_exec` | `plugins/shell` | — | Complete |
| Handoff | `action:handoff` | `plugins/delegation`, `dispatcher.ts` | — | Complete |
| Stop | `action:agent_run_stop` | `dispatcher.ts` | in-memory | Complete |
| Approval | `approval` plugin | `plugins/approval` | `state.approvals` | Complete |
| SDUI | `render_ui_widget` | `plugins/ui` | — | Complete |
| Memory | `remember` / `recall` / `forget` | `bus/services.ts`, `memory.ts` | `memory/log.jsonl` | Complete |
| Todos | `todo_write` | `bus/services.ts`, `todo-advance.ts` | thread `state.json` | Complete |
| Marketplace | `action:marketplace:list` | `bus/services.ts` | remote JSON | Complete |
| Install agent | `action:agent:install` | `bus/services.ts` | `agents/` | Complete (heuristic) |
| Install plugin | `action:plugin:install` | `services/plugins.ts` | `plugins/` | Complete |

### Hidden / experimental / doc drift

| Item | Evidence |
|------|----------|
| Global SSE channel `__global__` | `server.ts` — run start/end/stopped fan-out |
| Docs: `claude-code`, `gemini-cli` | Not in `registry/plugins.ts` built-ins |
| Marketplace default “Coder” uses `claude-code` | `bus/services.ts` — may fail without community plugin |
| “Command prefix routing” in `docs/architecture.md` | No slash parser in `src/`; routing = HTTP `agentId` + handoff/todos |
| System agent: `ui` commented | `storage.ts` vs README claims |
| System default model `openai/gpt-5.4-nano` | `storage.ts` — verify against provider |

### Feature hierarchy

```
OpenBot Harness
├── Transport (Express): health, SSE, publish, state
├── Dispatch & orchestration (dispatcher.ts)
│   ├── Agent step (user:input / agent:invoke)
│   ├── Bus pass-through
│   └── Stop (+ TTL buffer)
├── Agent runtime (Melony): busServicesPlugin + agent plugins
├── Persistence: channels, threads, events, agents, plugins, variables, memory
└── Context engine (harness/context.ts)
```

### Feature relationships (text)

```
user:input ─► normalize ─► agent:invoke ─► Melony ─► action:* ─► handlers
                                                    │
                                                    └──► *:result ─► AI SDK continues
                                                    └──► agent:output / client:ui / handoff:request

handoff:request ─► dispatcher chains runStep
todo assignees ─► advanceAfterRun on run:end ─► chained invoke
approval ─► suspend until client:ui:widget:response
```

---

## Phase 3 — User journeys & UX

**Protocol-first:** UX is defined by events and widgets, not by a bundled SPA.

### Flows

- **First run:** install CLI → `openbot start` → optional `config.json` / env keys → connect client with `channelId`, `threadId`, `agentId`.
- **Returning:** restart server; history in `events.jsonl`.
- **Auth:** none at HTTP layer.
- **Onboarding in repo:** ensures `agents/` and `plugins/` directories exist on server start.

### Information architecture (client mental model)

1. Workspace (`~/.openbot`)
2. Channels
3. Threads (todos, short-term messages, approvals)
4. Agents
5. Plugins
6. Variables / secrets

### UX strengths / friction (protocol)

| Strength | Friction |
|----------|----------|
| SDUI for approvals and API keys | Must pass correct headers/body for routing |
| Streaming via SSE | Debugging requires log/event literacy |
| Masked variables in one read path | Secrets still plaintext in `variables.json` |

---

## Phase 4 — Frontend architecture (in-repo)

- **No React/Vue app** under `src/`.
- Clients consume: **SSE**, **JSON publish**, **widget types** from `plugins/ui/index.ts` (`message`, `choice`, `form`, `list`, legacy `approval`, `todo_list`).
- **State:** server-authoritative (`state.json`, `events.jsonl`).

---

## Phase 5 — Backend & system design

### API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | `{ status, version }` |
| GET | `/api/events` | SSE |
| POST | `/api/publish` | Dispatch event |
| GET | `/api/state` | Run dispatch, return `{ events }` |

**Context:** headers `x-openbot-channel-id`, `x-openbot-thread-id`, `x-openbot-agent-id`, `x-openbot-run-id`, `x-openbot-response-type`, or query/body equivalents.

### Middleware

- `cors()` (open), `express.json({ limit: '20mb' })`.

### Auth

- None.

### Major modules

- `server.ts`, `dispatcher.ts`, `runtime-factory.ts`, `bus/services.ts`, `services/storage.ts`, `services/plugins.ts`, `services/memory.ts`, `harness/process.ts`.

---

## Phase 6 — Data model (filesystem)

| Entity | Location |
|--------|----------|
| Channel | `channels/<id>/SPEC.md`, `state.json`, `events.jsonl`, `threads/` |
| Thread | `channels/<c>/threads/<t>/state.json`, `events.jsonl` |
| Agent | `agents/<id>/AGENT.md` |
| Plugin install | `plugins/<npm>/dist/index.js` |
| Variables | `variables.json` |
| Config | `config.json` |
| Memory | `memory/log.jsonl` |
| Last read | `channels/_meta/last-read.json` |

---

## Phase 7 — Security

- **No authentication** — local trust model; exposing the port widens blast radius.
- **Shell and npm install** are high-impact capabilities.
- **Filesystem tools** sandbox list/read to channel `cwd` (path check).
- **Secrets** in `variables.json` (plaintext file).
- **SSRF** risk: configurable marketplace URL uses `fetch`.
- **XSS** depends on client rendering of `agent:output` content.

---

## Phase 8 — DevOps & infrastructure

- User-run Node process; **no Docker/CI** files observed in typical layout.
- Build: `tsc` + copy `icon.svg` to `dist/assets/`.

---

## Phase 9 — Performance

- Channel listing may call `getEvents` per channel (costly).
- Memory `listMemories` replays full log.
- AI context reads events from disk in providers.

---

## Phase 10 — Technical debt

- Monolithic `bus/services.ts` and `storage.ts`.
- `(event as any)` in bus handlers.
- Docs vs code: missing built-in `claude-code` / `gemini-cli`.
- Dynamic `action:${toolName}` vs strict event types (casts).
- **No tests** in repository.

---

## Phase 11 — Product strategy (inferred)

- OSS runtime for adoption; hosted UI for broader audience; npm plugins for ecosystem growth.

---

## Phase 12 — Consolidated deliverables

1. **Executive summary** — Phase 1.
2. **Product breakdown** — Phases 1–2.
3. **Feature inventory** — Phase 2.
4. **User journeys** — Phase 3.
5. **Information architecture** — Phase 3 + 6.
6. **Frontend architecture** — Phase 4.
7. **Backend architecture** — Phase 5.
8. **Database documentation** — Phase 6.
9. **API documentation** — Phase 5.
10. **Security audit** — Phase 7.
11. **Performance audit** — Phase 9.
12. **Technical debt** — Phase 10.
13. **UX audit** — Phase 3.
14. **Scalability** — Phases 8–9.
15. **Hidden features** — Phase 2 table.
16. **Developer onboarding**
    - Node ≥ 20.12
    - `npm install` / `npm run dev`
    - Read `README.md`, `docs/*.md`, `AGENTS.md`
    - Trace `dispatcher.ts` → `runtime-factory.ts` → `bus/services.ts`
    - Author agents with `docs/templates/AGENT.example.md`
17. **Suggested improvements**
    - Align docs with `registry/plugins.ts`
    - Add tests (dispatcher, todos, approval)
    - Safer secrets; bind localhost by default; optional auth token
    - Reconcile README “three endpoints” with `/api/health`
18. **Risks** — exposed port, shell, npm supply chain, doc drift.
19. **Missing in repo** — SPA, auth, billing, cloud sync implementation, slash-command router, documented alternate runtimes.
20. **Overall evaluation** — Strong event/plugin architecture for local use; not enterprise/public-internet hardened without additional controls.

---

*Generated as a structured reverse-engineering reference for the OpenBot codebase.*
