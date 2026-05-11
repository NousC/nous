FROM node:20-alpine AS base
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests for dependency install
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/core/package.json ./packages/core/

# Install prod deps only
RUN pnpm install --frozen-lockfile --prod

# Copy source
COPY apps/api ./apps/api
COPY packages/core ./packages/core

EXPOSE 3000
CMD ["node", "apps/api/src/index.mjs"]
