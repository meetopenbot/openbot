# openbot-plugin-claude-code

An OpenBot agent package that wraps Anthropic's
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).
The SDK runs its own tool loop (Read, Edit, Bash, …); this package adapts it to
the OpenBot bus protocol.

## Status

Currently shipped **in-tree** under `src/agents/claude-code/` and registered as
a built-in for convenience. The folder is intentionally self-contained so it
can be extracted to its own npm package (`openbot-plugin-claude-code`) later.

## Bus contract

- Listens on `agent:invoke` and reads `data.content` as the user prompt.
- Emits `agent:output` events for each assistant text turn.
- Persists the SDK `session_id` into the active thread/channel state under
  `claudeSessionId`, then passes it as `resume` on the next invocation so
  conversation context survives across runs.

## Config

| key              | type     | default     | notes                                                              |
| ---------------- | -------- | ----------- | ------------------------------------------------------------------ |
| `model`          | string   | `sonnet`    | Claude model alias or full id (e.g. `claude-opus-4-5`).            |
| `permissionMode` | string   | `default`   | One of `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, `auto`. |

The agent's `instructions` (from `AGENT.md` / `AgentDetails`) are appended to
the SDK's `claude_code` preset system prompt.

## Auth

Set `ANTHROPIC_API_KEY` (or use Bedrock / Vertex env vars supported by the
SDK). The SDK manages credentials itself; this package does not handle keys.

## Extracting to npm later

To publish this folder as an external package:

1. Move `src/agents/claude-code/` into its own repo / workspace package.
2. Replace the relative imports (`../../bus/agent-package.js`,
   `../../app/types.js`, `../../bus/types.js`) with peer-dep imports from
   `openbot` (e.g. `import type { AgentPackage } from 'openbot/bus'`).
3. Build to `dist/` and publish.
4. From the registry, drop the built-in entry; users can install via
   `agent-packages` (npm) and OpenBot will load it through the existing
   community-package loader (`resolveAgentPackage`).
