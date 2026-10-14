# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

ARG VITE_API_URL=/api/v1
ARG VITE_APP_VERSION=1.1.0
ARG VITE_BUILD_NUMBER=local
ARG VITE_GIT_SHA=dev
ARG VITE_BUILD_DATE

ENV VITE_API_URL=${VITE_API_URL} \
    VITE_APP_VERSION=${VITE_APP_VERSION} \
    VITE_BUILD_NUMBER=${VITE_BUILD_NUMBER} \
    VITE_GIT_SHA=${VITE_GIT_SHA} \
    VITE_BUILD_DATE=${VITE_BUILD_DATE}

RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json     packages/db/
COPY packages/ui/package.json     packages/ui/
COPY packages/llm/package.json    packages/llm/
COPY apps/runtime/package.json    apps/runtime/
COPY apps/web/package.json        apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/runtime/ apps/runtime/
COPY apps/web/ apps/web/
COPY tsconfig.base.json ./

ENV DATABASE_URL=postgresql://dummy:dummy@localhost/dummy
RUN pnpm --filter @ybot/db generate
RUN pnpm --filter @ybot/db build
RUN pnpm --filter @ybot/shared build
RUN pnpm --filter @ybot/llm build
RUN pnpm --filter @ybot/runtime build
RUN pnpm --filter @ybot/web build

# ── Serve stage ───────────────────────────────────────────────────────────────
FROM nginx:stable-alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# SPA routing: serve index.html for all unknown paths
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
