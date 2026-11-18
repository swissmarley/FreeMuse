# Shared image for the Node services (api, agent, sentinel) and the web app.
FROM node:22.23.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/tokens/package.json packages/tokens/
COPY packages/llm/package.json packages/llm/
COPY packages/db/package.json packages/db/
COPY packages/security/package.json packages/security/
COPY packages/runtime/package.json packages/runtime/
COPY services/api/package.json services/api/
COPY services/agent/package.json services/agent/
COPY services/sentinel/package.json services/sentinel/
COPY services/sandbox/package.json services/sandbox/
COPY apps/web/package.json apps/web/
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile --filter '!@muse/mobile'
COPY packages packages
COPY services services
COPY apps/web apps/web
COPY scripts scripts
COPY infra/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

FROM base AS web
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @muse/web build
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
CMD ["pnpm", "--filter", "@muse/web", "start"]

FROM base AS service
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
