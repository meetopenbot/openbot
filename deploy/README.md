# Fly.io deployment

One OpenBot instance per Fly app, with a persistent volume at `/data`.

## Layout

```
/data/
  .openbot/      ← OPENBOT_BASE_DIR (config, channels, agents, plugins)
  workspace/     ← OPENBOT_CHANNELS_WORKSPACE_DIR (per-channel cwd)
```

On boot, `deploy/entrypoint.sh` runs as root to `chown -R node:node /data`, then starts OpenBot as the `node` user. The image also includes `git`, `bash`, and `cloudflared` for the bash and preview plugins.

## First deploy (manual)

```bash
# From repo root
fly apps create openbot-my-tenant
fly volumes create openbot_data --region ord --size 1 -a openbot-my-tenant

fly secrets set \
  OPENBOT_PUBLIC_URL=https://openbot-my-tenant.fly.dev \
  -a openbot-my-tenant

# Optional: LLM API keys via Fly secrets or set later in the UI
# fly secrets set OPENAI_API_KEY=sk-... -a openbot-my-tenant

fly deploy --config deploy/fly.toml -a openbot-my-tenant
```

Copy `deploy/fly.toml`, set `app` to your tenant id, and ensure the volume name matches `openbot_data`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENBOT_BASE_DIR` | Yes (cloud) | Data root on the volume, e.g. `/data/.openbot` |
| `OPENBOT_CHANNELS_WORKSPACE_DIR` | Yes (cloud) | Channel workspace parent, e.g. `/data/workspace` |
| `OPENBOT_PUBLIC_URL` | Yes (cloud) | Public HTTPS URL for file links |
| `OPENBOT_GATEWAY_TOKEN` | Yes (cloud) | Per-workspace HMAC token; gateway sends `x-openbot-gateway-token` on proxied requests |
| `PORT` | Auto | Set by Fly (`8080`) |

## Health check

`GET /api/health` returns `{ status, version, apiVersion }`.

## Control plane integration

Your control plane should:

1. `fly apps create openbot-{tenantId}`
2. `fly volumes create openbot_data --region {region} --size {gb}`
3. `fly secrets set OPENBOT_PUBLIC_URL=...` (+ API keys)
4. `fly deploy` with a pinned image tag
5. Poll `/api/health` until `status === 'ok'`

Set `OPENBOT_GATEWAY_TOKEN` via Fly secrets (derived per workspace). The gateway appends `x-openbot-gateway-token` on proxied requests; when the env var is unset (local dev), the check is skipped. `GET /api/health` is exempt for Fly health checks.
