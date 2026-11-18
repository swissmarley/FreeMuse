# Per-user sandbox browser ("secure VM" stand-in). Runs as non-root with Chromium; network egress only via Sentinel.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/security/package.json packages/security/
COPY services/sandbox/package.json services/sandbox/
RUN pnpm install --frozen-lockfile --filter @muse/sandbox... --ignore-scripts
COPY packages/core packages/core
COPY packages/security packages/security
COPY services/sandbox services/sandbox
USER pwuser
EXPOSE 7000
CMD ["node", "--import", "tsx", "services/sandbox/src/main.ts"]
