FROM node:20-alpine AS base
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/core/package.json ./packages/core/

RUN pnpm install --frozen-lockfile --prod

COPY apps/worker ./apps/worker
COPY packages/core ./packages/core

CMD ["node", "apps/worker/src/index.mjs"]
