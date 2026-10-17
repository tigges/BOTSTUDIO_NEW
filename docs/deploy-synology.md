# Deploying YBot to AVIORI (Synology NAS)

YBot ships as a set of Docker images that run identically on a Synology NAS, a VPS, or any Linux box with Docker installed.

---

## Architecture on AVIORI

```
Internet / LAN
      │
      ▼
  ┌────────┐   :8080 / :8443
  │ Caddy  │◄──────────────── browser
  └────┬───┘
       │ reverse proxy
  ┌────┴───────────────────────────────────┐
  │             ybot-net (bridge)          │
  │                                        │
  │  ┌─────────┐    ┌────────┐             │
  │  │ ybot-api│    │ybot-web│             │
  │  │  :3001  │    │  :80   │             │
  │  └────┬────┘    └────────┘             │
  │       │                               │
  │  ┌────┴───┐  ┌─────────┐  ┌────────┐  │
  │  │postgres│  │  valkey │  │ minio  │  │
  │  │  :5432 │  │  :6379  │  │  :9000 │  │
  │  └────────┘  └─────────┘  └────────┘  │
  └────────────────────────────────────────┘

Optional: Ollama running natively on the NAS → http://host.docker.internal:11434
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Synology DSM 7.2+ | Any model with Docker support |
| Docker (via Package Center) | Version 24+ recommended |
| SSH access | DSM → Control Panel → Terminal & SNMP |
| 4 GB free RAM | 2 GB minimum; 4 GB comfortable |
| 20 GB free disk | On `/volume1` |

---

## First-time install (Option 1 — Git clone on NAS)

```bash
# 1. SSH into AVIORI
ssh admin@aviori

# 2. Clone the repo
git clone https://github.com/tigges/YAI.git /volume1/docker/ybot/src
cd /volume1/docker/ybot/src

# 3. First-run setup (creates directories + copies env template)
./deploy.sh --first-run
# → You'll be told to edit .env.production before continuing

# 4. Edit the env file (see "Environment variables" section below)
nano .env.production

# 5. Run first-run again to migrate + seed + start
./deploy.sh --first-run
```

---

## First-time install (Option 2 — Pre-built GHCR images)

If you prefer not to clone the full source:

```bash
# 1. On AVIORI, create the working directory
mkdir -p /volume1/docker/ybot && cd /volume1/docker/ybot

# 2. Download only the compose files
curl -sO https://raw.githubusercontent.com/tigges/YAI/main/docker-compose.yml
curl -sO https://raw.githubusercontent.com/tigges/YAI/main/docker-compose.synology.yml
curl -sO https://raw.githubusercontent.com/tigges/YAI/main/.env.aviori
curl -sO https://raw.githubusercontent.com/tigges/YAI/main/Caddyfile
curl -sO https://raw.githubusercontent.com/tigges/YAI/main/deploy.sh
chmod +x deploy.sh

# 3. Copy and edit the env template
cp .env.aviori .env.production
nano .env.production

# 4. Create volume directories and start
mkdir -p pgdata valkey minio caddy/data caddy/config
export IMAGE_TAG=latest
docker compose -f docker-compose.yml -f docker-compose.synology.yml \
  --env-file .env.production pull
docker compose -f docker-compose.yml -f docker-compose.synology.yml \
  --env-file .env.production up -d
```

---

## Environment variables

Copy `.env.aviori` to `.env.production` and fill in these required values:

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | **yes** | 64-char random string — `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | **yes** | Strong password for Postgres |
| `REDIS_PASSWORD` | **yes** | Strong password for Valkey |
| `MINIO_ROOT_PASSWORD` | **yes** | Strong password for MinIO |
| `FRONTEND_URL` | **yes** | URL users browse to, e.g. `http://aviori:8080` |
| `OLLAMA_BASE_URL` | LLM | e.g. `http://host.docker.internal:11434` (local) |
| `GEMINI_API_KEY` | LLM | Free default (Gemini Flash) |
| `GROQ_API_KEY` | LLM | Free tier |
| `OPENAI_API_KEY` | LLM | Paid alternative |

At least one LLM option must be configured.

---

## Accessing the app

| Service | URL |
|---|---|
| YBot UI | `http://aviori:8080` |
| API health | `http://aviori:8080/api/v1/health` |
| MinIO console | `http://aviori:9001` (direct, no proxy) |

Default admin credentials are created by the seed script:
- **Email:** `admin@ybot.local`
- **Password:** `Admin1234!`

Change these immediately after first login.

---

## Updating

```bash
# Pull latest images and restart (zero-downtime for stateless services)
cd /volume1/docker/ybot/src
./deploy.sh latest

# Or a specific release tag:
./deploy.sh v1.2.3
```

### Automatic updates via GitHub Actions

The workflow in `.github/workflows/docker.yml` builds and pushes new images on every push to `main`. To enable automatic deployment to AVIORI, add these repository secrets in GitHub:

| Secret | Value |
|---|---|
| `AVIORI_HOST` | IP or hostname of the NAS |
| `AVIORI_USER` | SSH user (usually `admin`) |
| `AVIORI_KEY` | Contents of your SSH private key |
| `AVIORI_PATH` | Path to compose files, e.g. `/volume1/docker/ybot/src` |

---

## Custom domain with HTTPS

1. Point your domain's A record to your public IP (or use Synology DDNS).
2. Forward ports 80/443 on your router to the NAS.
3. Update `Caddyfile` — uncomment the TLS block and replace `ybot.yourdomain.com`:

```caddyfile
ybot.yourdomain.com {
    tls { protocols tls1.2 tls1.3 }
    handle /api/* { reverse_proxy ybot-api:3001 }
    handle /ws    { reverse_proxy ybot-api:3001 }
    handle        { reverse_proxy ybot-web:80 }
}
```

4. In `.env.production`, change `HTTP_PORT`/`HTTPS_PORT` back to `80`/`443` and update `FRONTEND_URL` to your domain.
5. Restart Caddy: `docker compose ... restart caddy`

---

## Troubleshooting

```bash
# View logs for all services
docker compose -f docker-compose.yml -f docker-compose.synology.yml \
  --env-file .env.production logs -f

# View logs for a specific service
docker compose ... logs -f api

# Check service health
docker compose ... ps

# Re-run migrations manually
docker compose ... run --rm api \
  sh -c 'npx prisma migrate deploy --schema packages/db/prisma/schema.prisma'

# Open a DB shell
docker compose ... exec postgres psql -U ybot ybot
```

### Common issues

| Symptom | Fix |
|---|---|
| Port 80/443 already in use | DSM uses those ports — keep `HTTP_PORT=8080` in `.env.production` |
| `JWT_SECRET is required` error | Add `JWT_SECRET=...` to `.env.production` |
| Ollama not reachable | Ensure Ollama is running on the NAS and `OLLAMA_BASE_URL=http://host.docker.internal:11434` is set |
| Cannot pull GHCR images | Run `docker login ghcr.io` first if images are private |
