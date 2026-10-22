# Deploying BotStudio to AVIORI (Synology NAS)

BotStudio ships as two Docker images, `ghcr.io/tigges/botstudio-api` and `ghcr.io/tigges/botstudio-web`. They run the same on a Synology NAS, a VPS or any Linux box with Docker.

Every merge to `main` builds both images and Watchtower on AVIORI deploys them. The compose files, `Caddyfile` and `.env.production` on the NAS are **not** deployed automatically: copy them by hand when they change, as described in [Updating the host files](#updating-the-host-files).

The NAS folder stays `/volume1/docker/ybot`, and the Postgres database and user stay `ybot`. Both hold live data; do not rename them.

---

## Architecture on AVIORI

```
Internet / LAN
      │
      ▼
  ┌────────┐   :8080 / :8443
  │ Caddy  │◄──────────────── browser
  └────┬───┘
       │ reverse proxy (holds requests up to 45 s while a container restarts)
  ┌────┴────────────────────────────────────────────────┐
  │                 botstudio-net (bridge)              │
  │                                                     │
  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐       │
  │  │   api    │  │  worker  │  │     web      │       │
  │  │  :3001   │  │ (queues) │  │     :80      │       │
  │  └────┬─────┘  └────┬─────┘  └──────────────┘       │
  │       │             │                               │
  │  ┌────┴───┐  ┌──────┴──┐  ┌──────────────┐          │
  │  │postgres│  │  valkey │  │ docker-proxy │ read-only│
  │  │  :5432 │  │  :6379  │  │    :2375     │ container│
  │  └────────┘  └─────────┘  └──────────────┘ list     │
  │                                                     │
  │  watchtower: pulls new images, rolling restart      │
  └─────────────────────────────────────────────────────┘

Optional: Ollama running natively on the NAS → http://host.docker.internal:11434
```

| Container | What it does |
|---|---|
| `botstudio-api` | HTTP API and WebSocket (`PROCESS_ROLE=api`) |
| `botstudio-worker` | Same image. Knowledge sync, webhook delivery, campaigns, chat analysis, the quiet-chat and memory sweeps (`PROCESS_ROLE=worker`) |
| `botstudio-web` | Console and landing page |
| `botstudio-postgres`, `botstudio-valkey` | Data. Valkey also carries WebSocket fan-out, inbound dedupe and rate limits between API replicas |
| `botstudio-docker-proxy` | Lets System Status list containers without giving the API the Docker socket |
| `botstudio-caddy`, `botstudio-watchtower` | Proxy and auto-deploy |

---

## Switching the host to the BotStudio names

Do this once. Until then the host keeps running the `ybot-*` containers on the old image names, which CI still pushes, so nothing breaks if it waits.

Expect about a minute of downtime while compose recreates the containers. Data is untouched: the volume paths and database names do not change.

```bash
ssh admin@aviori
cd /volume1/docker/ybot          # always the same folder: it sets the compose project name

# 1. Back up the current host files
sudo cp docker-compose.yml docker-compose.yml.bak
sudo cp docker-compose.synology.yml docker-compose.synology.yml.bak
sudo cp Caddyfile Caddyfile.bak
sudo cp .env.production .env.production.bak

# 2. Fetch the new files from main
REPO=tigges/YAI                  # tigges/botstudio once the repository is renamed
for f in docker-compose.yml docker-compose.synology.yml Caddyfile deploy.sh; do
  sudo curl -fsSL -o "$f" "https://raw.githubusercontent.com/$REPO/main/$f"
done
sudo chmod +x deploy.sh

# 3. Check .env.production (see "Environment variables"): JWT_SECRET,
#    POSTGRES_PASSWORD and REDIS_PASSWORD must be set or compose refuses to start.
#    MINIO_* and S3_* lines can be deleted.
sudo nano .env.production

# 4. Validate, then recreate everything under the new names
sudo docker compose -f docker-compose.yml -f docker-compose.synology.yml \
  --env-file .env.production config --quiet
sudo docker compose -f docker-compose.yml -f docker-compose.synology.yml \
  --env-file .env.production pull
sudo docker compose -f docker-compose.yml -f docker-compose.synology.yml \
  --env-file .env.production up -d --remove-orphans

# 5. Check: every container is botstudio-* and running
sudo docker ps -a --filter name=botstudio
sudo docker ps -a --filter name=ybot        # should list nothing
sudo docker network prune -f                # removes the unused ybot-net
```

`--remove-orphans` removes the old MinIO container. Its data in `/volume1/docker/ybot/minio` is left alone; nothing in BotStudio reads it, so delete it when you are sure.

Then open **Settings → System Status**. The "Needs attention" banner must be absent, "Background workers" must show one worker, and the container list must show the `botstudio-*` containers.

If something goes wrong, restore the `.bak` files and run step 4 again.

### After the switch

1. In `.github/workflows/docker.yml`, delete `LEGACY_API_IMAGE`, `LEGACY_WEB_IMAGE` and the `legacy` tags so CI stops pushing the `yai/ybot-*` images.
2. In GitHub → Packages, delete `yai/ybot-api` and `yai/ybot-web` once nothing pulls them.
3. Optional: rename the repository to `botstudio` (GitHub → Settings → General). The image names do not depend on it, the GitHub Pages build reads the new name automatically, and GitHub redirects the old URLs. Update local clones with `git remote set-url origin https://github.com/tigges/botstudio.git`.

---

## Environment variables

Copy `.env.aviori` to `.env.production` and fill in these values:

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | **yes** | `openssl rand -hex 32`. The API refuses to start in production with a missing or example value. |
| `POSTGRES_PASSWORD` | **yes** | Strong password for Postgres |
| `REDIS_PASSWORD` | **yes** | Strong password for Valkey |
| `SECRETS_KEY` | recommended | Seals Auth Profile secrets — `openssl rand -hex 32`. Without it a key is derived from `JWT_SECRET`. Changing either later means re-entering every Auth Profile secret. |
| `FRONTEND_URL` | **yes** | URL users browse to, e.g. `https://app.botstudio.uk` |
| `DEMO_SEED_ON_BOOT` | no | `true` (default on AVIORI) re-applies the demo companies on every API start; Live QA expects them. Set `false` on a customer install. |
| `TOOLS_ALLOW_PRIVATE_NETWORK` | no | `true` lets HTTP and MCP tools call addresses on your own network. Off by default. |
| `WATCHTOWER_HTTP_API_UPDATE`, `WATCHTOWER_HTTP_API_TOKEN` | no | Deploy as soon as CI pushes. See [Instant deploys](#instant-deploys). |
| `OLLAMA_BASE_URL` | LLM | e.g. `http://host.docker.internal:11434` (local) |
| `GEMINI_API_KEY` | LLM | Free default (Gemini Flash) |
| `GROQ_API_KEY` | LLM | Free tier |
| `OPENAI_API_KEY` | LLM | Paid alternative |

At least one LLM option must be configured.

On a customer install with `DEMO_SEED_ON_BOOT=false`, load the demo companies once by hand if you want them:

```bash
sudo docker compose ... exec api node apps/api/dist/scripts/apply-demos.js
```

---

## First-time install on a new host

```bash
ssh admin@aviori
sudo mkdir -p /volume1/docker/ybot && cd /volume1/docker/ybot

REPO=tigges/YAI                  # tigges/botstudio once the repository is renamed
for f in docker-compose.yml docker-compose.synology.yml Caddyfile deploy.sh .env.aviori; do
  sudo curl -fsSL -o "$f" "https://raw.githubusercontent.com/$REPO/main/$f"
done
sudo chmod +x deploy.sh

sudo ./deploy.sh --first-run     # creates the data folders and .env.production
sudo nano .env.production        # see "Environment variables"
sudo ./deploy.sh --first-run     # pulls, migrates, seeds and starts
```

Then set up Watchtower's GHCR login as described in `docker-compose.synology.yml` and start it with `up -d watchtower`.

---

## Accessing the app

| Service | URL |
|---|---|
| Console | `https://app.botstudio.uk` (LAN: `http://aviori:8080`) |
| API health | `/api/v1/health` |
| System Status | Console → Settings → System Status (admins) |

---

## Updating

Images deploy themselves: CI pushes on every merge to `main`, and Watchtower pulls within 5 minutes and replaces one container at a time while Caddy holds requests. The web image only changes when web code changes, so most API releases do not restart the console.

To pin or roll back to a specific build:

```bash
cd /volume1/docker/ybot
sudo ./deploy.sh sha-<short-sha>     # or a release tag such as v1.2.3; ./deploy.sh alone returns to latest
```

### Updating the host files

When a change touches `docker-compose.yml`, `docker-compose.synology.yml`, `Caddyfile` or `.env.aviori`, copy the new files to the NAS (step 2 of the switch) and run:

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.synology.yml \
  --env-file .env.production up -d --remove-orphans
```

### Instant deploys

To deploy as soon as the images are pushed, turn on Watchtower's update endpoint. CI calls it through Caddy at `https://app.botstudio.uk/deploy/watchtower`:

1. Pick a long random token: `openssl rand -hex 32`.
2. On AVIORI, add both lines to `.env.production`:
   ```bash
   WATCHTOWER_HTTP_API_UPDATE=true
   WATCHTOWER_HTTP_API_TOKEN=<token>
   ```
3. Restart Watchtower and Caddy:
   ```bash
   sudo docker compose -f docker-compose.yml -f docker-compose.synology.yml \
     --env-file .env.production up -d watchtower caddy
   ```
4. In GitHub, add the repository secret `WATCHTOWER_HTTP_API_TOKEN` with the same token. To call a different URL, set the repository variable `WATCHTOWER_DEPLOY_URL`.

Set both values in step 2 together: Watchtower exits at start if the update endpoint is on and the token is empty. Polling stays on, so a failed call only delays the deploy by up to 5 minutes.

---

## Custom domain with HTTPS

1. Point your domain's A record to your public IP (or use Synology DDNS).
2. Forward ports 80/443 on your router to the NAS.
3. In `Caddyfile`, uncomment the example site block at the bottom and replace `app.example.com` with your domain. Keep the upstreams as compose service names (`api:3001`, `web:80`) and keep `import deploy_retry` on each proxy.
4. In `.env.production`, change `HTTP_PORT`/`HTTPS_PORT` back to `80`/`443` and update `FRONTEND_URL` to your domain.
5. Restart Caddy: `sudo docker compose ... up -d caddy`

---

## Troubleshooting

```bash
# Container status
sudo docker ps -a --filter name=botstudio

# Logs for all services, or one
sudo docker compose -f docker-compose.yml -f docker-compose.synology.yml \
  --env-file .env.production logs -f
sudo docker compose ... logs -f api
sudo docker compose ... logs -f worker

# Re-run migrations manually
sudo docker compose ... run --rm api \
  sh -c 'npx prisma migrate deploy --schema packages/db/prisma/schema.prisma'

# Open a DB shell
sudo docker compose ... exec postgres psql -U ybot ybot
```

### Common issues

| Symptom | Fix |
|---|---|
| `required variable JWT_SECRET is missing a value` from compose | Add it to `.env.production`. Same for `POSTGRES_PASSWORD` and `REDIS_PASSWORD`. |
| API container restarts in a loop and its log names `JWT_SECRET` | The value is missing or a published example. Set a real one: `openssl rand -hex 32`. |
| System Status: "No background worker" | `sudo docker compose ... up -d worker` and check `logs -f worker`. |
| System Status: container list empty | `sudo docker compose ... up -d docker-proxy`. |
| Port 80/443 already in use | DSM uses those ports — keep `HTTP_PORT=8080` in `.env.production`. |
| Ollama not reachable | Ensure Ollama is running on the NAS and `OLLAMA_BASE_URL=http://host.docker.internal:11434` is set. |
| Watchtower never updates | Check `sudo docker logs botstudio-watchtower`; the GHCR login file is described in `docker-compose.synology.yml`. |
