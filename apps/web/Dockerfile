# ── Base ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ── Prune: only the packages @ybot/web depends on ─────────────────────────────
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.11.2 prune @ybot/web --docker

# ── Build stage ───────────────────────────────────────────────────────────────
FROM base AS builder

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

COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./
RUN pnpm exec turbo run build --filter=@ybot/web --ui=stream

# ── Serve stage ───────────────────────────────────────────────────────────────
FROM nginx:stable-alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# SPA routing: serve index.html for all unknown paths
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
