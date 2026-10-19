#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — First-time install & update script for YBot on AVIORI (Synology)
#
# Prerequisites (run once):
#   1. Install Docker from Synology Package Center
#   2. Enable SSH in DSM → Control Panel → Terminal & SNMP
#   3. SSH into the NAS and run this script as an admin user
#
# Usage:
#   ./deploy.sh              # pull :latest and (re)start all services
#   ./deploy.sh v1.2.3       # pull a specific release tag
#   ./deploy.sh --first-run  # first install: create dirs, copy env template, migrate
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.production"
COMPOSE_FILES="-f ${SCRIPT_DIR}/docker-compose.yml -f ${SCRIPT_DIR}/docker-compose.synology.yml"
IMAGE_TAG="${1:-latest}"
FIRST_RUN=false
[[ "${1:-}" == "--first-run" ]] && { FIRST_RUN=true; IMAGE_TAG="latest"; }

# ── Colour helpers ─────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[ybot]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

# ── Checks ─────────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || error "Docker is not installed. Install it from Synology Package Center."
docker compose version >/dev/null 2>&1 || error "Docker Compose v2 is required. Update Docker in Package Center."

# ── First-run: create directories & .env.production ────────────────────────
if $FIRST_RUN; then
  info "Creating volume directories on /volume1/docker/ybot ..."
  mkdir -p \
    /volume1/docker/ybot/pgdata \
    /volume1/docker/ybot/valkey \
    /volume1/docker/ybot/minio \
    /volume1/docker/ybot/caddy/data \
    /volume1/docker/ybot/caddy/config

  if [[ ! -f "${ENV_FILE}" ]]; then
    info "Copying .env.aviori → .env.production (please edit it before continuing)"
    cp "${SCRIPT_DIR}/.env.aviori" "${ENV_FILE}"
    warn "Edit ${ENV_FILE} and set JWT_SECRET, passwords, FRONTEND_URL, and LLM keys."
    warn "Then re-run: ./deploy.sh --first-run"
    exit 0
  fi
fi

[[ -f "${ENV_FILE}" ]] || error ".env.production not found. Run './deploy.sh --first-run' first."

export IMAGE_TAG

# ── Pull images ─────────────────────────────────────────────────────────────
info "Pulling images (tag: ${IMAGE_TAG}) ..."
docker compose ${COMPOSE_FILES} --env-file "${ENV_FILE}" pull

# ── Start infrastructure (postgres, valkey, minio) ──────────────────────────
info "Starting infrastructure services ..."
docker compose ${COMPOSE_FILES} --env-file "${ENV_FILE}" \
  up -d postgres valkey minio

info "Waiting for PostgreSQL to be healthy ..."
until docker compose ${COMPOSE_FILES} --env-file "${ENV_FILE}" \
    exec -T postgres pg_isready -U ybot >/dev/null 2>&1; do
  sleep 2
done

# ── Run database migrations / schema push ───────────────────────────────────
info "Applying database schema ..."
docker compose ${COMPOSE_FILES} --env-file "${ENV_FILE}" \
  run --rm api \
  sh -c 'cd /app && sh ./migrate.sh'

# ── (Optional) seed demo data on first run ──────────────────────────────────
if $FIRST_RUN; then
  info "Seeding demo data ..."
  docker compose ${COMPOSE_FILES} --env-file "${ENV_FILE}" \
    run --rm api \
    sh -c 'cd /app && node_modules/.bin/tsx packages/db/src/seed.ts' \
    || warn "Seed failed (non-fatal — run manually if needed)"
fi

# ── Start / update all services ─────────────────────────────────────────────
info "Starting all services ..."
docker compose ${COMPOSE_FILES} --env-file "${ENV_FILE}" \
  up -d --remove-orphans

info "Done! YBot is running."
info "Access it at: $(grep FRONTEND_URL "${ENV_FILE}" | cut -d= -f2)"
info ""
info "Useful commands:"
info "  View logs:  docker compose ${COMPOSE_FILES} --env-file .env.production logs -f"
info "  Stop:       docker compose ${COMPOSE_FILES} --env-file .env.production down"
info "  Update:     ./deploy.sh <new-tag>"
