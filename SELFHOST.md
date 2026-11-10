# Self-hosting this Overleaf instance

This repository runs **Overleaf Community Edition** behind Docker Compose: one
`sharelatex` application container plus MongoDB and Redis. Everything is
configured through `.env`, and all persistent data lives in Docker named
volumes (`sharelatex_data`, `mongo_data`, `redis_data`).

> **Community Edition is for trusted users.** It has no sandboxed compiles: a
> LaTeX compile can read and write anything the `sharelatex` container can.
> Do not open a public CE instance to untrusted users.

---

## 1. Requirements

| | Minimum | Recommended |
|---|---|---|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 50 GB (TeX Live + projects) |
| Software | Docker Engine 24+ with Compose v2 | same |

On Windows/macOS install **Docker Desktop**; on a Linux server install Docker
Engine and the Compose plugin.

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

- `OVERLEAF_SITE_URL` — the public URL, e.g. `https://overleaf.example.com`
  (locally `http://localhost`).
- `OVERLEAF_PORT` — host port, `80` by default.
- `OVERLEAF_APP_NAME` — the name shown in the header.
- `OVERLEAF_ADMIN_EMAIL` — where system notifications go.
- `OVERLEAF_INVITE_TOKEN_SECRET` — generate with
  `openssl rand -base64 32`. On Windows PowerShell:
  `$b = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`

`.env` is git-ignored — keep the real secret out of git.

## 3. Run

```bash
docker compose up -d          # start
docker compose ps             # wait until sharelatex is "running"
docker compose logs -f sharelatex
```

Open the URL from `OVERLEAF_SITE_URL` (locally <http://localhost>). First
start-up takes a few minutes while the container initialises MongoDB and
copies its seed data.

### Create accounts

Community Edition has no self-service sign-up: an admin creates every account.

Create your admin account:

```bash
docker exec sharelatex /bin/bash -ce \
  "cd /overleaf/services/web && node modules/server-ce-scripts/scripts/create-user.mjs \
   --admin --email=you@example.com"
```

The command prints a one-time **Set password** URL (it is also emailed when
SMTP is configured). Open it in a browser, choose a password, and you are
signed in. The `--admin` flag grants access to `/admin`.

Create additional users the same way, without `--admin`, and send them the
printed link:

```bash
docker exec sharelatex /bin/bash -ce \
  "cd /overleaf/services/web && node modules/server-ce-scripts/scripts/create-user.mjs \
   --email=colleague@example.com"
```

**Password reset.** The *Forgot your password?* page sends a reset link by
email. Without SMTP the link is only written to the container log:

```bash
docker exec sharelatex grep -o 'http://[^"]*passwordResetToken=[^"]*' \
  /var/log/overleaf/web.log | tail -n 1
```

**Promote an existing account to admin.** There is no CLI flag for this; set
`isAdmin` directly in MongoDB:

```bash
docker exec mongo mongosh sharelatex --quiet \
  --eval 'db.users.updateOne({email:"you@example.com"},{$set:{isAdmin:true}})'
```


## 4. Put it on the internet

1. Point a DNS `A`/`AAAA` record (`overleaf.example.com`) at the server.
2. Allow inbound TCP 80 and 443 in the firewall/security group.
3. Set `OVERLEAF_SITE_URL=https://overleaf.example.com` in `.env` and restart:
   `docker compose up -d`.
4. Terminate TLS on the host — do **not** expose the `sharelatex` container
   directly to the internet without HTTPS.

**Caddy** (automatic certificates, simplest):

```caddyfile
overleaf.example.com {
    reverse_proxy 127.0.0.1:80
    request_body {
        max_size 200MB
    }
}
```

**nginx**:

```nginx
server {
    listen 443 ssl http2;
    server_name overleaf.example.com;

    ssl_certificate     /etc/letsencrypt/live/overleaf.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/overleaf.example.com/privkey.pem;

    client_max_body_size 200M;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

If Overleaf runs on another machine than the proxy, bind the port to the private
interface instead: `OVERLEAF_PORT=127.0.0.1:80` is **not** supported by the
compose port mapping — publish `"80:80"` on the host and firewall it so only the
proxy can reach it.

## 5. Backups

Data lives in Docker named volumes:

| Volume | Contents |
|---|---|
| `overleaf_sharelatex_data` | project files, uploads, compiles, templates |
| `overleaf_mongo_data` | users, project metadata, history |
| `overleaf_redis_data` | cache (safe to lose) |

Take a consistent backup with the stack stopped:

```bash
docker compose stop
docker run --rm \
  -v overleaf_sharelatex_data:/data \
  -v "$PWD":/backup \
  alpine tar czf /backup/sharelatex-$(date +%F).tar.gz -C /data .
docker exec mongo mongodump --archive --gzip > mongo-$(date +%F).archive
docker compose start
```

Restore on a fresh host: `docker compose up -d` once to create the empty
volumes, then

```bash
docker compose stop
docker run --rm \
  -v overleaf_sharelatex_data:/data \
  -v "$PWD":/backup \
  alpine tar xzf /backup/sharelatex-YYYY-MM-DD.tar.gz -C /data
docker compose start
docker exec -i mongo mongorestore --archive --gzip < mongo-YYYY-MM-DD.archive
```

Redis can be dropped; Overleaf rebuilds its cache. The volume names are
prefixed with the compose project name (`overleaf` by default, i.e. the folder
name); run `docker volume ls` to confirm.

## 6. Upgrades

```bash
docker compose pull
docker compose up -d
```

The `sharelatex` container runs its own migration scripts on start-up. Read the
release notes first, and take a backup before a major version jump. Pin
`OVERLEAF_IMAGE_TAG` to a specific tag if you want controlled upgrades.

## 7. Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `OVERLEAF_SITE_URL` | `http://localhost` | Public URL used in links and emails |
| `OVERLEAF_PORT` | `80` | Host port mapped to the container |
| `OVERLEAF_APP_NAME` | `Overleaf` | Brand name in header/emails |
| `OVERLEAF_ADMIN_EMAIL` | — | System notifications address |
| `OVERLEAF_INVITE_TOKEN_SECRET` | — | **Required.** Signs invite tokens |
| `OVERLEAF_IMAGE_TAG` | `latest` | Image tag to deploy |
| `OVERLEAF_EMAIL_SMTP_*` | — | Outgoing mail; otherwise emails go to the log |

## 8. Troubleshooting

**Port 80 already in use** — set `OVERLEAF_PORT=8080` in `.env`, update
`OVERLEAF_SITE_URL` to match, then `docker compose up -d`.

**`sharelatex` restarts in a loop** — almost always MongoDB:
`docker logs mongo`. A `mongo_data` volume created by a different MongoDB major
version must be removed or restored, not reused.

**Compiles fail with "compilation timed out"** — TeX Live needs RAM; give Docker
at least 4 GB. Large `tikz`/`pgfplots` documents need more.

**"Too many open files"** — raise Docker's `nofile` limit or the server's
`fs.file-max`.

**Forgot the admin password** — use *Forgot your password?* on the login page,
then read the reset link from the log (no SMTP required):

```bash
docker exec sharelatex grep -o 'http://[^"]*passwordResetToken=[^"]*' \
  /var/log/overleaf/web.log | tail -n 1
```

**Emails are not delivered** — without SMTP they are written to
`/var/log/overleaf/web.log` inside the `sharelatex` container (and not sent):

```bash
docker exec sharelatex tail -n 20 /var/log/overleaf/web.log
```

## 9. Committing your deployment

`.env` is git-ignored, so the secret never leaves the machine. Everything else
in this guide is versioned:

```bash
git add docker-compose.yml .env.example .gitignore SELFHOST.md
git commit -m "Add self-hosted Overleaf deployment"
git push origin main
```

On the server: `git clone`, `cp .env.example .env`, edit `.env`, then
`docker compose up -d`.

Changing the site name or public URL later only needs `.env` plus
`docker compose up -d` — no rebuild.
