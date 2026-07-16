<div align="center">

# 🎫 IT Ticket System

**A dockerized, multi-tenant ticket system for internal IT support.**
Passwordless public portal for requesters · role-based admin panel for the IT team · **Turkish / English bilingual.**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Stack](https://img.shields.io/badge/stack-Fastify%20%2B%20React%20%2B%20Postgres-blue)
![i18n](https://img.shields.io/badge/i18n-TR%20%2F%20EN-green)
![Tests](https://img.shields.io/badge/tests-261%20passing-success)

[🇹🇷 Türkçe](README.md) · 🇬🇧 **English**

[Features](#-features) · [Screenshots](#-screenshots) · [Quick start](#-quick-start) · [Documentation](#-documentation)

</div>

---

## ✨ Features

**👤 Requester (public, no login)**
- Creates a ticket — picks company / location / category, fills per-company dynamic fields, attaches files.
- Tracks status live through an **access link**, posts replies, sends attachments.
- Looks up a past ticket with its number + email.

**🛠️ IT team (admin panel)**
- **Dashboard** — open/closed stats, SLA status, work assigned to you.
- **Ticket management** — list / filter / search, detail, status & assignment, internal notes (hidden from the requester) + public replies, bulk actions.
- **On-site support calendar** — create appointments, pick durations, calendar view.
- **Tasks** — work independent of tickets, multi-assignee, comments.
- **Reports** — distribution, staff performance, category breakdown, SLA trend, CSV export.

**🔐 Administrator (role-based)**
- `admin` + `it_manager` — company / location / category / custom fields, per-company SMTP, email & SMS templates, canned responses.
- `admin` — staff management and a **credential vault** (AES-256-GCM, every reveal is audited).

**⚙️ Behind the scenes**
- Email / SMS notifications async via BullMQ (3 retries, exponential backoff).
- SLA checks every 5 minutes; per-category response/resolution targets.
- Live panel updates over SSE; per-domain company branding (logo + theme).
- **Bilingual**: UI follows the browser language and switches instantly; API messages by `Accept-Language`, notifications in the recipient's language.

---

## 📸 Screenshots

Every screen is captured in both Turkish and English — **[full gallery: docs/screenshots →](docs/screenshots/)** (14 pages × TR/EN).

| Public portal · TR | Admin panel · EN |
|:---:|:---:|
| [<img src="docs/screenshots/public-home-tr.png" width="420">](docs/screenshots/public-home-tr.png) | [<img src="docs/screenshots/staff-dashboard-en.png" width="420">](docs/screenshots/staff-dashboard-en.png) |
| Ticket creation wizard · TR | Ticket list · EN |
| [<img src="docs/screenshots/public-create-ticket-tr.png" width="420">](docs/screenshots/public-create-ticket-tr.png) | [<img src="docs/screenshots/staff-tickets-en.png" width="420">](docs/screenshots/staff-tickets-en.png) |

---

## 🧰 Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 22 · Fastify 5 · TypeScript (ESM) · Prisma 6 · Zod |
| Frontend | React 18 · Vite 6 · TailwindCSS 3 · TanStack Query 5 · Zustand 5 |
| Database | PostgreSQL 16 |
| Queue / Cache | Redis 7 + BullMQ |
| Realtime | SSE (Server-Sent Events) |
| i18n | react-i18next · `Accept-Language`-based API messages |
| Deploy | Docker Compose (Coolify + Nginx Proxy Manager compatible) |

---

## 🚀 Quick start

> **Requirement:** Docker + Docker Compose. Nothing else to install.

**1. Clone and prepare `.env`**

```bash
git clone https://github.com/mahmutyum/ticket-system.git
cd ticket-system
cp .env.example .env
```

**2. Generate the required secrets** (none have defaults — the backend won't boot if they're empty):

```bash
openssl rand -base64 48   # → JWT_SECRET
openssl rand -base64 48   # → JWT_REFRESH_SECRET  (different from JWT_SECRET)
openssl rand -hex 32      # → CREDENTIALS_ENC_KEY (exactly 64 hex)
```

Also set `DB_PASSWORD` and `REDIS_PASSWORD`; mirror both into `DATABASE_URL` / `REDIS_URL` with the **same** value.

**3. Start** (the schema is applied automatically):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

**4. Load sample data:**

```bash
docker compose exec backend npx tsx prisma/seed.ts   # base data
docker compose exec backend npm run db:seed:demo     # 36 tickets, 24 tasks, vault, etc. (optional)
```

UI at **http://localhost:1111** · API docs at **http://localhost:4000/docs**

### Sample logins (seed)

| Role | Email | Password |
|---|---|---|
| admin | `admin@company.com` | `admin123` |
| it_manager | `manager@company.com` | `staff123` |
| it_staff | `it@company.com` | `staff123` |

> ⚠️ Development only. **Never run `seed.ts` against production** — create the first admin manually there.

---

## 🌐 Production

Full guide: **[docs/kurulum.md](docs/kurulum.md)** (in Turkish). In short, behind Coolify + Nginx Proxy Manager:

```
Internet/VPN → NPM (SSL + FQDN) → frontend:1111 ─┬─ /              → SPA
                                                  ├─ /api/*         → backend:4000
                                                  ├─ /attachments/* → backend:4000  (authorized)
                                                  └─ /branding/*    → backend:4000  (public logos)
```

Only `frontend` is exposed to the host (`FRONTEND_PORT`, default `1111`); backend, Postgres and Redis stay on the internal Docker network. Attachments and logos are served **through the backend**, not from disk (token and company-scope checks happen there).

> **Upgrading an existing install?** The project moved from `prisma db push` to versioned migrations; for the one-time baseline see [docs/kurulum.md](docs/kurulum.md#mevcut-veritabanını-baselineleme).

---

## 📚 Documentation

| Document | Content |
|---|---|
| [docs/kurulum.md](docs/kurulum.md) | Installation: development, production, Coolify/NPM, env, migrations, troubleshooting |
| [docs/kullanim.md](docs/kullanim.md) | Usage: requester flow, IT team panel, admin operations |
| [docs/mimari.md](docs/mimari.md) | Architecture: modules, data model, auth, queue, SSE |
| [docs/yol-haritasi.md](docs/yol-haritasi.md) | Maturity and planned features |
| [docs/operasyon.md](docs/operasyon.md) | Backup, restore, retention, health checks |
| [CHANGELOG.md](CHANGELOG.md) | Release history (SemVer) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guide and coding conventions |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting |

> The detailed docs are written in Turkish; this English README mirrors the overview.

---

## 🔒 Before you deploy

This system is designed to run **behind a VPN / on an internal network**. The public portal
intentionally performs no authentication (access relies on unguessable link tokens). Before
exposing it directly to the internet, add your own access-control layer (VPN, IP allowlist, or
an authenticating reverse proxy). Details: [SECURITY.md](SECURITY.md).

---

## 🤝 Contributing

Contributions are welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md). For new routes and
screens, keep the typed-contract, scope/RBAC, and regression-test standards.

## 📄 License

[MIT](LICENSE) © Mahmut YUM

---

<div align="center">

**🇹🇷 Türkçe mi arıyorsun? → [README.md](README.md)**

</div>
