# openbot-plugin-gemini-cli

An OpenBot agent package that wraps Google's
[`gemini`](https://www.npmjs.com/package/@google/gemini-cli) CLI in headless
mode (`--output-format stream-json`). The CLI runs its own tool loop (file ops,
shell, web search, …); this package adapts its event stream to the OpenBot bus
protocol.

## Status

Currently shipped **in-tree** under `src/agents/gemini-cli/` and registered as
a built-in for convenience. The folder is intentionally self-contained so it
can be extracted to its own npm package (`openbot-plugin-gemini-cli`) later.

## Requirements

Node.js 20+ (already required by OpenBot). The `gemini` binary itself is
**not** required: if it is not on `PATH`, the runtime falls back to
`npx -y @google/gemini-cli@latest`, which auto-installs the CLI on first run
and caches it for subsequent invocations.

If you prefer an explicit global install for faster cold starts:

```bash
npm install -g @google/gemini-cli
```

## Bus contract

- Listens on `agent:invoke` and reads `data.content` as the user prompt.
- Spawns `gemini -p - --output-format stream-json` per turn, piping the prompt
  on stdin.
- Translates `message` (assistant) events into `agent:output` and surfaces
  `error` / `result` failures.
- On auth failure, yields a `client:ui:widget` form to capture and persist
  `GEMINI_API_KEY` as a workspace variable.

Note: Gemini CLI's headless mode does not currently expose a `resume` flag, so
each invocation starts a fresh session. Conversation continuity across runs
should be handled at the bus/orchestrator layer if needed.

## Config

| key      | type    | default  | notes                                                       |
| -------- | ------- | -------- | ----------------------------------------------------------- |
| `model`  | string  | (CLI default) | Gemini model id (e.g. `gemini-2.5-pro`, `gemini-2.5-flash`). |
| `yolo`   | boolean | `false`  | Auto-approve all tool calls (`--yolo`). Use cautiously.     |
| `binary` | string  | (auto)   | Optional gemini executable path. If unset, uses `gemini` on PATH or falls back to `npx -y @google/gemini-cli@<npmTag>`. |
| `npmTag` | string  | `latest` | npm tag/version of `@google/gemini-cli` for the npx fallback. |

The agent's `instructions` (from `AGENT.md` / `AgentDetails`) are prepended to
the user prompt sent to the CLI.

## Auth

Set one of:

- `GEMINI_API_KEY` (Gemini API)
- `GOOGLE_API_KEY` + `GOOGLE_GENAI_USE_VERTEXAI=true` (Vertex AI)
- A signed-in Google account via `gemini` interactive OAuth

The CLI manages credentials itself; this package only persists the API key
when the user fills in the auth widget.

## Extracting to npm later

To publish this folder as an external package:

1. Move `src/agents/gemini-cli/` into its own repo / workspace package.
2. Replace the relative imports (`../../bus/agent-package.js`,
   `../../app/types.js`, `../../bus/types.js`) with peer-dep imports from
   `openbot` (e.g. `import type { AgentPackage } from 'openbot/bus'`).
3. Build to `dist/` and publish.
4. From the registry, drop the built-in entry; users can install via
   `agent-packages` (npm) and OpenBot will load it through the existing
   community-package loader (`resolveAgentPackage`).
