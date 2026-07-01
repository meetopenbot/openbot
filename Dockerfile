# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV OPENBOT_BASE_DIR=/data/.openbot
ENV OPENBOT_CHANNELS_WORKSPACE_DIR=/data/workspace

RUN apk add --no-cache bash git su-exec curl \
  && ARCH="$(uname -m)" \
  && case "$ARCH" in x86_64) CF_ARCH=amd64 ;; aarch64) CF_ARCH=arm64 ;; *) CF_ARCH=amd64 ;; esac \
  && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o /usr/local/bin/cloudflared \
  && chmod +x /usr/local/bin/cloudflared \
  && corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

USER root
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/app/cli.js", "start"]
