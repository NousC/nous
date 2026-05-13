FROM node:22-alpine AS base
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/core/package.json ./packages/core/

RUN pnpm install --frozen-lockfile

COPY apps/worker ./apps/worker
COPY packages/core ./packages/core
COPY tsconfig.base.json ./

RUN pnpm --filter @proply/core run build

RUN pnpm install --frozen-lockfile --prod

CMD ["node", "apps/worker/src/index.mjs"]
