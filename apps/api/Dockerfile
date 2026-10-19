# ── Base ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ── Prune: only the packages @ybot/api depends on ─────────────────────────────
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.11.2 prune @ybot/api --docker

# ── Build stage ───────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./
ENV DATABASE_URL=postgresql://dummy:dummy@localhost/dummy
RUN pnpm exec turbo run build --filter=@ybot/api --ui=stream

# ── Production dependencies only ──────────────────────────────────────────────
# Install scripts stay on so @prisma/engines fetches its engines here, not at
# container start.
FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod
COPY packages/db/prisma packages/db/prisma
RUN cd packages/db && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Version info baked in at build time — readable at runtime via process.env
ARG APP_VERSION=1.1.0
ARG APP_BUILD_NUMBER=local
ARG APP_GIT_SHA=dev
ARG APP_BUILD_DATE

ENV APP_VERSION=${APP_VERSION} \
    APP_BUILD_NUMBER=${APP_BUILD_NUMBER} \
    APP_GIT_SHA=${APP_GIT_SHA} \
    APP_BUILD_DATE=${APP_BUILD_DATE}

RUN apk add --no-cache curl

WORKDIR /app

# The Prisma CLI is a dependency of @ybot/db; docker-entrypoint.sh runs it
# for migrations at start.
ENV PATH="/app/packages/db/node_modules/.bin:${PATH}"

COPY --from=deps /app/ ./
COPY --from=builder /app/packages/shared/dist  packages/shared/dist/
COPY --from=builder /app/packages/llm/dist     packages/llm/dist/
COPY --from=builder /app/packages/db/dist      packages/db/dist/
COPY --from=builder /app/apps/runtime/dist     apps/runtime/dist/
COPY --from=builder /app/apps/api/dist         apps/api/dist/
COPY apps/api/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3001
CMD ["sh", "docker-entrypoint.sh"]
