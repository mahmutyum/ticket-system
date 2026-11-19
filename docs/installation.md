# Installation

🇬🇧 **English** · [🇹🇷 Türkçe](installation.tr.md)

- [Requirements](#requirements)
- [Development environment](#development-environment)
- [Environment variables](#environment-variables)
- [Production](#production)
- [Coolify + Nginx Proxy Manager](#coolify--nginx-proxy-manager)
- [Database migrations](#database-migrations)
- [Baselining an existing database](#baselining-an-existing-database)
- [Connecting with local tools](#connecting-with-local-tools)
- [Troubleshooting](#troubleshooting)

---

## Requirements

- **Docker** and **Docker Compose** (v2, the `docker compose` command).
- Nothing else — Node.js, PostgreSQL and Redis run inside containers.
- `openssl` for generating secrets (bundled with macOS/Linux).

---

## Development environment

```bash
git clone https://github.com/mahmutyum/ticket-system.git
cd ticket-system
cp .env.example .env
```

Fill in the `changeme_*` values in `.env` (see [the table below](#environment-variables)),
then:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

This command:
- Brings up Postgres and Redis and waits for them to become healthy.
- Applies the database schema (`prisma migrate deploy`).
- Starts the backend with `tsx watch` (hot reload) and the frontend with `vite`.
- Sets `NODE_ENV` to `development`: readable logs, verbose error details.

Source code is bind-mounted — changes you make in `backend/src` or `frontend/src`
take effect without restarting the container.

Load the sample data (3 companies, locations, categories, staff, templates):

```bash
docker compose exec backend npx tsx prisma/seed.ts
```

To evaluate the ticket, task, report, on-site support and credential vault screens with
populated data, run the synthetic detail seed afterwards:

```bash
docker compose exec backend npm run db:seed:demo
```

The detail seed is re-runnable and only manages fictional records explicitly marked as
`DEMO`. It contains no real system, person or password data and refuses to run when
`NODE_ENV=production`.

| URL | What |
|---|---|
| http://localhost:1111 | UI (public portal + staff panel) |
| http://localhost:1111/staff/login | Staff login |
| http://localhost:4000/docs | API endpoint list (Swagger UI) |
| http://localhost:4000/health/live | Process liveness check |
| http://localhost:4000/health/ready | PostgreSQL + Redis readiness check |

**Seed login credentials:** `admin@company.com` / `admin123` · `manager@company.com` / `staff123` · `it@company.com` / `staff123`

> ⚠️ The seed is for demo purposes only. Do not run `prisma/seed.ts` against a production database.

Press `Ctrl+C` to stop. To wipe the data as well:

```bash
docker compose down -v   # -v also deletes the volumes: the database is reset
```

---

## Environment variables

The single source of truth is [`.env.example`](../.env.example). If you use Coolify, you
manage these variables from the panel — no code change required.

### Required — no defaults, the backend won't start if left empty

| Variable | How to generate / what to write |
|---|---|
| `JWT_SECRET` | `openssl rand -base64 48` — at least 32 characters |
| `JWT_REFRESH_SECRET` | `openssl rand -base64 48` — must be **different** from `JWT_SECRET` |
| `CREDENTIALS_ENC_KEY` | `openssl rand -hex 32` — **exactly 64 hex characters** |
| `DB_PASSWORD` | Anything. Write the same value into `DATABASE_URL`. |
| `REDIS_PASSWORD` | Anything. Write the same value into `REDIS_URL`. |
| `DATABASE_URL` | `postgresql://<DB_USER>:<DB_PASSWORD>@postgres:5432/<DB_NAME>` |
| `REDIS_URL` | `redis://:<REDIS_PASSWORD>@redis:6379` |
| `APP_URL` | FQDN(s) the system will be reachable at. Separate multiple values with commas. |
| `SMTP_HOST` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | Global SMTP. Zod enforces these; a value must be set even if you won't send email. |

> **About `CREDENTIALS_ENC_KEY`:** Encrypts the records in the credential vault
> (`/staff/passwords`) with AES-256-GCM. **If you lose or change this key, every password
> in the vault becomes permanently undecryptable.** Validation at startup enforces
> **exactly 64 hex characters** (`/^[0-9a-fA-F]{64}$/`); generate the value with
> `openssl rand -hex 32`. For key rotation there is the `npm run db:rotate-credentials-key`
> script (`prisma/scripts/`).

> **Why is `REDIS_PASSWORD` in two places?** It is used both when the `redis` container
> starts with `--requirepass` and inside `REDIS_URL`. If the two differ, the backend cannot
> connect to Redis. The same applies to `DB_PASSWORD` / `DATABASE_URL`.

> **`APP_URL` and CORS:** Takes a comma-separated list. **The first value is treated as
> canonical** and used in the tracking links inside emails; **the entire list** is added to
> the CORS whitelist. Example: `APP_URL=https://ticket.company.com,https://support.company.com`

### Backend variables with defaults

| Variable | Default | What it does |
|---|---|---|
| `NODE_ENV` | `development` | `production`: JSON logs, 500 error details hidden |
| `PORT` | `4000` | Port the backend listens on inside the container |
| `APP_NAME` | `IT Destek Sistemi` | Application name |
| `ACCESS_TOKEN_EXPIRY` | `15m` | Access token lifetime |
| `REFRESH_TOKEN_EXPIRY` | `7d` | Refresh token lifetime |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `false` | `true` enables TLS (usually port 465) |
| `MAX_FILE_SIZE` | `26214400` (25 MB) | Upper limit for file attachments |
| `UPLOAD_DIR` | `/app/uploads` | In-container upload directory (backed by a volume) |
| `SMS_GATEWAY_URL` `SMS_GATEWAY_API_KEY` `SMS_SENDER` | — | Optional. If empty, no SMS is sent. |
| `TRUST_PROXY` | `1` | Number of trusted reverse-proxy hops (see the "Production" section) |
| `METRICS_TOKEN` | — (disabled) | At least 24 characters; when set, `/metrics` opens with Bearer auth (v1.1) |
| `ENABLE_API_DOCS` | `true` | Set to `false` on internet-facing installs (v1.1) |
| `ALLOW_PRIVATE_INTEGRATION_HOSTS` | `false` | `true`: allow internal SMTP/IMAP/LDAP/OIDC/webhook targets (v1.1) |
| `BACKUP_TZ` `BACKUP_CRON` `BACKUP_VERIFY_CRON` | `UTC` · `0 3 * * *` · `0 5 * * 0` | Backup and restore-rehearsal defaults — written to the DB on first boot, admin panel preference takes precedence (v1.2) |
| `BACKUP_RETENTION_DAILY/WEEKLY/MONTHLY` | `7` / `4` / `6` | GFS retention counts per backup target (v1.2) |
| `BACKUP_ENCRYPTION_RECIPIENT` | — | age public key; **required when a remote target exists** — the archive is encrypted before upload (v1.2) |
| `STORAGE_DRIVER` | `local` | `s3`: attachments/logos are written to an S3-compatible store (v1.3) — the driver is GLOBAL, move your files before switching |
| `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_FORCE_PATH_STYLE` | — | bucket/keys required for `STORAGE_DRIVER=s3`; on MinIO/R2 use endpoint + force-path-style (v1.3) |

### Automatic backup profile (v1.2)

The backup service is optional; it runs as a separate profile:

```bash
docker compose --profile backup up -d
```

Target definitions, schedules and run history are managed from the admin panel
(`/staff/backups`, `/staff/scheduled-jobs`). `BACKUP_ENCRYPTION_RECIPIENT` is required for
remote targets; details: [operations](operations.md).

### Variables used only by Docker Compose

| Variable | Default | What it does |
|---|---|---|
| `FRONTEND_PORT` | `1111` | The single port exposed to the host. NPM forwards here. |
| `DB_NAME` | `ticketdb` | |
| `DB_USER` | `ticket` | |
| `BACKEND_PORT` `DB_PORT` `REDIS_PORT` | `4000` `5432` `6379` | Exposed to the host only when `docker-compose.local.yml` is active |
| `NGINX_HTTP_PORT` `NGINX_HTTPS_PORT` | `80` `443` | Only with `--profile proxy` |
| `PGADMIN_PORT` `PGADMIN_EMAIL` `PGADMIN_PASSWORD` | `5050` … | Only with `--profile tools` |

---

## Production

```bash
cp .env.example .env      # fill in the values
./scripts/check-production-env.sh .env
docker compose up -d --build
```

What happens:
- The `backend` image is built; on startup it runs `prisma migrate deploy`, then
  `node dist/server.js`.
- Only the `frontend` is exposed to the host (`FRONTEND_PORT`). `backend`, `postgres`,
  `redis` stay on the internal `app-network` only — **not exposed** to the host.
- The named volumes `uploads` and `pgdata` keep data persistent.

For production, make sure `.env` has:
- `NODE_ENV=production`
- `APP_URL` set to your real FQDN(s)
- All `changeme_*` values replaced with real, randomly generated ones

If you need the built-in nginx proxy (no NPM/Coolify):

```bash
docker compose --profile proxy up -d --build
```

This profile uses `nginx/conf.d/default.conf`: HTTP→HTTPS redirect, TLS 1.2/1.3,
rate limiting and an **IP whitelist restricted to RFC1918 private networks** (requests
from outside get a 403). Adjust `server_name` and the VPN subnets to your environment.
`nginx/Dockerfile` generates a **self-signed** certificate during build — replace it with
your own certificate in a real deployment.

---

## Coolify + Nginx Proxy Manager

```
Internet/VPN → NPM (SSL + FQDN) → frontend:1111 ─┬─ /          → SPA
                                                  ├─ /api/*     → backend:4000
                                                  └─ /uploads/* → backend:4000
```

1. Add the repo in Coolify — `docker-compose.yml` is detected automatically.
2. Enter all `.env` variables from the Coolify environment panel.
3. Create a proxy host in NPM:
   - **Domain Names:** `ticket.company.com` (multiple entries allowed)
   - **Scheme:** `http` · **Forward Hostname/IP:** the Coolify host IP · **Forward Port:** `FRONTEND_PORT` (`1111`)
   - **Websockets Support: ON** — **required** for SSE (live updates)
   - **Block Common Exploits:** ON
   - **SSL:** Let's Encrypt or your own certificate · **Force SSL:** ON · **HTTP/2:** ON
4. Put **all** of the FQDNs you defined in NPM into `APP_URL`, comma-separated —
   otherwise CORS requests will be rejected.

The backend only trusts the number of hops specified by `TRUST_PROXY` — every trusted hop
must be an internal network/loopback address. In an NPM/Coolify + frontend nginx topology
the typical value is `2`; after installation, verify that client IPs in the audit log match
real user IPs (if they don't match, your hop count is different).

---

## Database migrations

The schema lives in `backend/prisma/schema.prisma`; versioned migrations are kept under
`backend/prisma/migrations/`.

- **Automatic on startup:** both the dev and production compose files run
  `prisma migrate deploy`. It is idempotent — skips already-applied migrations and is safe
  to run on every restart.
- **When you change the schema, generate a new migration:**

  ```bash
  docker compose exec backend npx prisma migrate dev --name a_descriptive_name
  ```

  **Review** the generated SQL and include it in the commit.

> Do **not** use `prisma db push`. It skips migration history and can silently drop
> columns/tables with `--accept-data-loss`. This project previously used that method; it
> has since moved to versioned migrations.

### Baselining an existing database

If you have a **running** database that was created with `prisma db push`,
`migrate deploy` will throw:

```
Error: P3005 The database schema is not empty.
```

Because Prisma sees the tables but cannot find any applied migration records. A one-time
baseline is required.

**1. First verify the schema really matches.** If the output is empty, your database is
identical to `0_init`:

```bash
docker compose exec backend npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

**2. If the output is empty**, mark `0_init` as applied (runs no SQL, only records it):

```bash
docker compose exec backend npx prisma migrate resolve --applied 0_init
```

**3. If the output is not empty**, your database has drifted from the schema. The SQL above
is the difference — **do not apply it automatically.** Review it, take a backup if needed,
then apply it manually or turn it into a migration. When in doubt, try it on a copy first.

> **Take a database backup** before baselining:
> `docker compose exec postgres pg_dump -U ticket ticketdb > backup.sql`

---

## Connecting with local tools

To connect with tools like DBeaver or RedisInsight, use the override that exposes
Postgres/Redis **only on `127.0.0.1`**:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

| Service | Address |
|---|---|
| Postgres | `127.0.0.1:5432` |
| Redis | `127.0.0.1:6379` |
| Backend | `127.0.0.1:4000` |

If you prefer PgAdmin:

```bash
docker compose --profile tools up -d pgadmin   # http://localhost:5050
```

> ⚠️ Do **not** use `docker-compose.local.yml` in production — it exposes the database to
> the host network.

---

## Troubleshooting

**Backend exits right after startup, log shows `Invalid environment variables`**
Zod validation failed. The log states which variable is at fault. Most common causes:
`CREDENTIALS_ENC_KEY` missing or not 64 characters, or `JWT_SECRET` shorter than 32
characters.

**`CREDENTIALS_ENC_KEY must be 64 hex characters`**
Generate it with `openssl rand -hex 32`. Make sure no quotes or spaces are left.

**`Invalid key length` in the credential vault / passwords cannot be decrypted**
Since an invalid key is rejected at startup (exactly 64 hex is enforced), in practice this
error means the records were encrypted **with a different key**: `CREDENTIALS_ENC_KEY` has
been changed or lost. If the old key is lost, those records cannot be recovered;
`npm run db:rotate-credentials-key` performs key rotation (the old key is required).

**`P3005 The database schema is not empty`**
See [Baselining an existing database](#baselining-an-existing-database).

**Backend cannot connect to Redis**
The password in `REDIS_PASSWORD` and inside `REDIS_URL` differs. They must match. Run the
same check for `DB_PASSWORD` / `DATABASE_URL`.

**CORS error in the browser**
`APP_URL` doesn't contain the FQDN you use to reach the site. Add it (comma-separated) and
restart the backend.

**Live updates (SSE) not arriving in the admin panel**
The NPM proxy host must have **Websockets Support: ON**. If another proxy sits in between,
disable response buffering.

**Frontend loads but the API returns 502**
The backend is failing its healthcheck. Check `docker compose logs backend` — usually a
migration or env error.

**File upload fails with 413**
The upload exceeds `MAX_FILE_SIZE` (default 25 MB) or the nginx `client_max_body_size`
(`frontend/nginx.conf`, 25M). Increase both together.
