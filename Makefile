# ─────────────────────────────────────────────────────────────────────────────
# Makefile — convenience wrappers for BotStudio on AVIORI
# Usage: make <target>
# ─────────────────────────────────────────────────────────────────────────────

COMPOSE  := docker compose -f docker-compose.yml -f docker-compose.synology.yml
ENV_FILE := --env-file .env.production
TAG      ?= latest

.PHONY: up down restart logs ps pull migrate seed shell-api shell-db

up: pull migrate
	$(COMPOSE) $(ENV_FILE) up -d --remove-orphans
	@echo "BotStudio is running. Check: make ps"

down:
	$(COMPOSE) $(ENV_FILE) down

restart:
	$(COMPOSE) $(ENV_FILE) restart

logs:
	$(COMPOSE) $(ENV_FILE) logs -f

ps:
	$(COMPOSE) $(ENV_FILE) ps

pull:
	IMAGE_TAG=$(TAG) $(COMPOSE) $(ENV_FILE) pull

migrate:
	$(COMPOSE) $(ENV_FILE) run --rm api sh -c ' \
		cd /app && SCHEMA="packages/db/prisma/schema.prisma"; \
		node_modules/.bin/prisma migrate deploy --schema "$$SCHEMA" 2>/dev/null \
		  || node_modules/.bin/prisma db push --schema "$$SCHEMA"'

seed:
	$(COMPOSE) $(ENV_FILE) run --rm api sh -c ' \
		cd /app && node_modules/.bin/tsx packages/db/src/seed.ts'

shell-api:
	$(COMPOSE) $(ENV_FILE) exec api sh

shell-db:
	$(COMPOSE) $(ENV_FILE) exec postgres psql -U ybot ybot
