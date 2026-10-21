# ── Base ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ── Prune: only the packages @botstudio/web depends on ─────────────────────────────
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.11.2 prune @botstudio/web --docker

# ── Build stage ───────────────────────────────────────────────────────────────
FROM base AS builder

# No build number, SHA or date here: the console reads them from the API at
# runtime. Unchanged web code then builds the same image, and Watchtower does
# not restart the web container on an API-only deploy.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}

COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./
RUN pnpm exec turbo run build --filter=@botstudio/web --ui=stream

# ── Serve stage ───────────────────────────────────────────────────────────────
FROM nginx:stable-alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# SPA routing: serve index.html for all unknown paths
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
