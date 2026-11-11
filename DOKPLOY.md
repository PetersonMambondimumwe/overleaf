# Deploying on Dokploy

This is the Dokploy-specific runbook for the Overleaf + Clerk stack. It assumes
Dokploy is already installed on a Linux server and that you own a domain whose
DNS you can edit.

```
Internet ──▶ Dokploy Traefik (443, Let's Encrypt)
                │  Host(overleaf.example.com)
                ▼
        sharelatex  (container port 80, nginx + web + TeX Live)
                │
        ┌───────┴────────┐
      mongo           redis        (internal compose network only)
```

Traefik terminates TLS. The `sharelatex` container is **not** published on a
host port — Dokploy routes to it over the compose network.

## 0. Prerequisites

| | |
|---|---|
| Server | 2 vCPU / 4 GB RAM minimum, 8 GB recommended |
| Disk | ~30 GB (5.2 GB image + TeX Live + projects + builds) |
| DNS | `A`/`AAAA` record for `overleaf.example.com` → server IP |
| Dokploy | v0.7+ (native domains) |
| Repo | your fork pushed to GitHub |
| Clerk | production instance with Google enabled (or dev keys to try it) |

Community Edition has no sandboxed compiles: every user can run arbitrary code
in the container. Only invite people you trust.

## 1. Push this repo

The deployment changes live on `main`:

```bash
cd C:\Users\mambo\overleaf
git push origin main
```

Dokploy clones the repo on the server, so nothing else needs to be uploaded.

## 2. Create the Compose service

1. Dokploy → **Create Project** → **Create Service** → **Compose**.
2. **Compose Type**: `Docker Compose` (not Stack — Stack does not support `build`).
3. **Provider**: GitHub → repository `PetersonMambondimumwe/overleaf`, branch `main`.
4. **Compose Path**: `docker-compose.dokploy.yml`.
5. Save.

Do not add `container_name:` to the services — Dokploy relies on Compose's own
naming for logs, metrics and shell access. The Dokploy compose file already
omits them.

## 3. Environment variables

Open the **Environment** tab and paste (values in `<>` are yours):

```dotenv
OVERLEAF_SITE_URL=https://overleaf.example.com
OVERLEAF_APP_NAME=Overleaf
OVERLEAF_ADMIN_EMAIL=you@tuks.co.za
OVERLEAF_INVITE_TOKEN_SECRET=<openssl rand -base64 32>

OVERLEAF_CLERK_ENABLED=true
OVERLEAF_CLERK_PUBLISHABLE_KEY=<pk_live_...>
OVERLEAF_CLERK_SECRET_KEY=<sk_live_...>
OVERLEAF_CLERK_ALLOWED_DOMAINS=tuks.co.za

# Optional: AI writing assistant (Claude)
# ANTHROPIC_API_KEY=sk-ant-...
# OVERLEAF_AI_MODEL=claude-3-5-haiku-latest
```

Dokploy writes these to `.env` next to the compose file, and the compose file
reads them with `${VAR}`. Rules:

- `OVERLEAF_SITE_URL` must be the exact public URL — `https`, no trailing slash,
  no `www` unless that is the real host. Wrong values cause login redirect
  loops and broken links in emails.
- `OVERLEAF_INVITE_TOKEN_SECRET` is mandatory; the stack refuses to start
  without it (`:?` in the compose file).
- Keep `OVERLEAF_PORT` out of Dokploy: the container is reached internally on
  port 80, Traefik owns 80/443 on the host.
- Clerk keys are runtime configuration — changing them needs **Redeploy**, not a
  rebuild.

## 4. Add the domain

**Domains** tab → **Add Domain**:

| Field | Value |
|---|---|
| Service | `sharelatex` |
| Host | `overleaf.example.com` |
| Port | `80` |
| HTTPS | on |
| Certificate Provider | `letsencrypt` |

Save, then press **Deploy**. Dokploy injects the Traefik labels and attaches the
service to `dokploy-network` automatically; you do not need labels in the compose
file.

If the port selector does not list `80`, replace `expose: ["80"]` with
`ports: ["80"]` in `docker-compose.dokploy.yml` (a container port without a host
binding) and redeploy.

## 5. First deploy

Watch **Deployments → Logs**. The first build downloads
`sharelatex/sharelatex:latest` (~5.2 GB) and then applies the overlay — expect
5–20 minutes depending on the server's network. Later deploys reuse the layer
cache and take well under a minute.

The container needs up to ~5 minutes on first start (MongoDB replica set, seed
data, migrations); the healthcheck has a 300 s grace period, so `starting` is
normal.

### Create the admin account

Use the container terminal in Dokploy (service `sharelatex` → **Terminal**), or
SSH into the server:

```bash
docker exec -it $(docker ps -qf "name=sharelatex" | head -1) /bin/bash -ce \
  "cd /overleaf/services/web && node modules/server-ce-scripts/scripts/create-user.mjs \
   --admin --email=you@tuks.co.za"
```

Open the printed **Set password** URL. You can also sign in with Google straight
away if the email is on an allowed domain; the first Google sign-in links to the
existing account with the same address.

Open `https://overleaf.example.com/login` — you should see the redesigned page
with the Google button. `https://overleaf.example.com/login/classic` is the
password fallback.

## 6. Clerk in production

Development keys (`pk_test_…`) work but show a *Development mode* banner and have
usage limits. For production:

1. Claim the Clerk application (Dashboard → the banner → claim).
2. Create the production instance for `overleaf.example.com`
   (`npx -y clerk@latest deploy --mode agent --domain overleaf.example.com`, or
   the Dashboard).
3. In Clerk → **Domains**, add `https://overleaf.example.com` as an allowed
   origin / redirect target.
4. In Clerk → **Social Connections → Google**, either keep Clerk's shared
   credentials (dev only) or add your own Google OAuth client. Google Cloud
   needs the redirect URI that Clerk shows in that panel
   (`https://clerk.overleaf.example.com/v1/oauth_callback` for a Clerk-hosted
   domain).
5. Copy the `pk_live_…` / `sk_live_…` keys from
   `npx -y clerk@latest env pull --instance prod --print` into the Dokploy
   environment, then **Redeploy**.
6. Optionally disable GitHub/email/password in Clerk so the page only offers
   Google — the widget mirrors the instance's sign-in strategies.

## 7. Backups

Data lives in three named volumes, prefixed with the Dokploy project name:

```bash
docker volume ls | grep overleaf
# <project>_sharelatex_data  <project>_mongo_data  <project>_redis_data
```

Two options:

**Dokploy Volume Backups** (recommended): create a backup destination (S3), then
schedule a backup for `*_sharelatex_data` and `*_mongo_data`. Redis is cache and
can be skipped. Restores are done from the same screen.

**Manual**, with the stack stopped:

```bash
docker compose -p <project> stop
docker run --rm -v <project>_sharelatex_data:/data -v "$PWD":/backup \
  alpine tar czf /backup/sharelatex-$(date +%F).tar.gz -C /data .
docker exec <project>-mongo-1 mongodump --archive --gzip > mongo-$(date +%F).archive
docker compose -p <project> start
```

Test a restore once — a backup you never restored is a guess.

## 8. Updates

- **Code change**: `git push` → Dokploy auto-deploys (enable the webhook) or
  press **Redeploy**. The overlay rebuilds in seconds.
- **New Overleaf release**: set `OVERLEAF_IMAGE_TAG` (e.g. `2026-11-01`) in the
  environment, take a backup, then Redeploy. Migrations run automatically on
  start-up; read the release notes before a major jump.
- **Clerk key rotation**: change the two keys, Redeploy.

## 9. Alternative: deploy a prebuilt image

Building on a small VPS costs CPU, disk and a 5 GB base-image pull. If you
prefer, build locally and push to a registry:

```bash
docker build -f Dockerfile -t ghcr.io/<you>/overleaf-clerk:latest .
docker push ghcr.io/<you>/overleaf-clerk:latest
```

Then in `docker-compose.dokploy.yml` replace the whole `build:` block with:

```yaml
    image: ghcr.io/<you>/overleaf-clerk:latest
```

and add the registry under Dokploy → **Registry** (for private images). Deploys
then only pull the small overlay layer. The overlay `Dockerfile` at the repo root is the same file Dokploy would build.

## 10. Troubleshooting

**502 Bad Gateway right after deploy** — the container is still initialising.
Check `docker compose logs -f sharelatex` (or Dokploy logs); first start can take
5 minutes. The healthcheck stays `starting` until `/login` answers.

**`Bind for 0.0.0.0:80 failed: port is already allocated`** — Dokploy is building
the wrong file. Look at the `Command:` line in the deployment log: it must say
`-f ./docker-compose.dokploy.yml`. If it says `-f ./docker-compose.yml`, set
**General → Compose Path** to `docker-compose.dokploy.yml` and redeploy. The
local file publishes host port 80, which Traefik already owns.

**Login redirects in a loop / session not kept** — `OVERLEAF_SITE_URL` does not
match the browser URL exactly (scheme, host, port). Fix it and redeploy; also
confirm the domain is `https` in the Domains tab.

**Editor loads but real-time collaboration does not** — websockets are blocked
between browser and Traefik. Check the browser console; make sure the domain is
served by Traefik with HTTPS and that no Cloudflare proxy setting (if used)
strips `Upgrade`.

**"Google sign-in is not configured"** — Clerk keys are empty in the Dokploy
environment. Add them and Redeploy (no rebuild).

**Clerk widget shows GitHub/email too** — the Clerk instance still has those
strategies enabled; disable them in Clerk → User & Authentication.

**MongoDB unhealthy** — usually the volume was created by a different MongoDB
major version, or the replica set init did not run on the very first start.
Check `docker logs <project>-mongo-1`; a fresh `mongo_data` volume fixes a broken
initialisation (destroys data).

**Build fails with `COPY --parents`/syntax errors** — you are building
`server-ce/Dockerfile` (the full source build) instead of the root `Dockerfile` (the overlay). Point the compose
file at the overlay; the full source build needs a newer `sharelatex-base` than
the published image.

**Out of disk** — the base image plus TeX Live is ~6 GB, each rebuild can keep a
layer, and projects/compiles grow. Prune with `docker image prune` and give the
server at least 30 GB.

## 11. Sizing and hardening

- 8 GB RAM is comfortable for a department; compiles are the memory spike.
- Put Dokploy's Traefik behind Cloudflare only with *Full (strict)* TLS.
- Restrict `OVERLEAF_CLERK_ALLOWED_DOMAINS` to your domain; CE is not a
  multi-tenant sandbox.
- Keep `EMAIL_CONFIRMATION_DISABLED=true` only while Google is the only way in.
- Add SMTP (`OVERLEAF_EMAIL_SMTP_*`) so invites and password resets actually
  reach users; without it, links are only in `/var/log/overleaf/web.log`.
- Dokploy → **Monitoring** has per-service CPU/RAM; watch the first week.
