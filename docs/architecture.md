# Architecture

🇬🇧 **English** · [🇹🇷 Türkçe](architecture.tr.md)

Technical overview. For installation see [installation.md](installation.md), for usage
[usage.md](usage.md).

---

## General layout

```
Internet/VPN → NPM (SSL + FQDN) → frontend:1111 ─┬─ /                        → SPA (nginx)
                                                  ├─ /api/*                   → backend:4000
                                                  └─ /attachments, /branding  → backend:4000
                                                        │
                                          ┌─────────────┴─────────────┐
                                          │                           │
                                    postgres:5432               redis:6379
                                    (Prisma)                    (cache, queue,
                                                                 refresh token)
                                          ↑
                    backup service (optional `--profile backup`):
                    pg_dump + uploads archive + rclone targets
                    + restore drill — trigger: `backup` queue
```

Only the `frontend` is exposed to the host. `backend`, `postgres` and `redis` stay on the
internal `app-network`.

**API prefix:** The frontend calls `/api/*` → nginx **strips** the prefix → the backend sees
the raw path (`/auth/staff/login`). The paths in `/docs` are the raw paths the backend sees.

---

## Repository structure

```
ticket-system/
├── docker-compose.yml          # Production
├── docker-compose.dev.yml      # Dev override (hot reload, NODE_ENV=development)
├── docker-compose.local.yml    # Exposes DB/Redis on 127.0.0.1 (for local tools)
├── nginx/                      # Optional internal proxy (--profile proxy)
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma       # 34 models
│   │   ├── migrations/         # Versioned migrations
│   │   └── seed.ts             # Demo data
│   └── src/
│       ├── app.ts              # Fastify instance, plugin and route registration
│       ├── server.ts           # Entry point, workers, periodic jobs
│       ├── config/             # Zod env validation, constants
│       ├── plugins/            # prisma, redis, auth
│       ├── modules/<name>/     # <name>.routes.ts — each module in its own file
│       ├── services/           # email, sms, sse, storage, mail/ (inbox), sso/, webhooks/, metrics, ticket-intake, sla-context
│       ├── jobs/               # BullMQ queue + workers
│       ├── middleware/         # audit log
│       └── utils/              # crypto, staff-scope, ticket-number, sla, business-hours, ticket-lifecycle, net-guard, trust-proxy, csv-parse
└── frontend/
    └── src/
        ├── api/client.ts       # Axios + JWT interceptor + auto-refresh
        ├── stores/auth.store.ts
        ├── hooks/useSSE.ts
        ├── components/
        └── pages/{public,staff}/
```

---

## Backend

**Stack:** Fastify 5, TypeScript (ESM), Prisma 6, Zod, BullMQ, nodemailer.

### Startup sequence

`server.ts`:
1. `buildApp()` → Fastify instance (`app.ts`).
2. Warms the ticket counter (`utils/ticket-number.ts`).
3. Idempotently seeds the task and system (SLA, auto-close, merge, survey) email templates.
4. BullMQ scheduler: SLA check every 5 min, auto-close every 15 min, incoming mail every
   2 min.
5. Workers start via side-effect import (`email`, `sms`, `sla-check` (+auto-close),
   `mail-fetch`, `webhook`).
6. Listens on `0.0.0.0:${PORT}`.

Before this, `prisma migrate deploy` runs in the container (see `backend/Dockerfile` CMD).

### `app.ts` ordering

`trustProxy` (`TRUST_PROXY`: hop count + every hop must be an internal-network address, or
an IP/CIDR list — `utils/trust-proxy.ts`) → rate limit (global 100/min) → CORS
(`config.APP_ORIGINS`) → helmet (including CSP) → cookie (signed with `JWT_SECRET`) →
multipart → prisma/redis/auth plugins → attachment/logo routes (`/attachments/:id`,
`/branding/:companyId/:file` — no static serving; see the note in `app.ts`) → **swagger
`/docs`** → `/health` → module routes → global error handler (Turkish; hides 500 details in
production).

**About CSP:** The backend's CSP only affects its own responses. Since the SPA is served by
the nginx in the frontend container, the UI's actual policy lives in `frontend/nginx.conf`
(`script-src 'self'`, no unsafe-inline/eval — the Vite build produces no inline scripts).
On the backend the policy is the strictest setting that still lets Swagger UI run; the real
win is the `default-src 'none'; sandbox` the `/attachments` endpoint sets on each response.

### Modules

| Prefix | Responsibility |
|---|---|
| `/auth` | Staff JWT login/refresh/logout (login 5/min), public email lookup (10/5min) |
| `/companies` | Company CRUD, branding (`/branding/by-host`), company SMTP, logo |
| `/locations` `/categories` `/custom-fields` | Company-scoped definitions; categories hierarchical + sortable |
| `/tickets` | CRUD, bulk, search, attachments; `/notes` under the same prefix (public + internal) |
| `/public` | Token-based ticket viewing, reply, attachments, tracking |
| `/staff` | Staff CRUD + company scope assignment |
| `/dashboard` | Statistics, SLA, my-tickets |
| `/onsite-support` | Appointment CRUD + calendar |
| `/notifications` | Notification list, retry, stats |
| `/events` | SSE — staff, ticket, stats |
| `/templates` | Email / SMS templates, canned responses |
| `/reports` | Tickets, staff performance, category, SLA trend, CSV export |
| `/tasks` | Task CRUD + comments |
| `/credentials` | Credential vault — `admin` + `it_manager` (company-scoped; global records admin-only) |
| `/companies/:id/sla`, `/holidays` | Company SLA settings, business-hours calendar, holidays, auto-close, survey |
| `/companies/:id/mailbox` | Inbound mailbox (IMAP / M365 / Gmail OAuth) — admin only |
| `/tickets/:id/merge` `/parent` `/watchers` `/asset` | Merge, parent/child, watchers (CC), asset link |
| `/auth/sso` | OIDC / SAML / LDAP sign-in; `/auth/sso/admin/*` provider management |
| `/webhooks` | Outgoing webhooks + Teams/Slack — admin only |
| `/kb`, `/public/kb` | Knowledge base (staff CRUD, public search/read/feedback) |
| `/assets` | Asset inventory + CSV import |
| `/scheduled-jobs` | Scheduled jobs — registry, cron/active state, run history (v1.2) |
| `services/lookups.ts` | Dictionary cache — class-based behavior queries (v1.3) |
| `/backups` | Backup targets — rclone definition (encrypted, write-only), connection test (v1.2) |
| `/lookups` | "Sözlükler" (dictionaries) — staff view + public active entries; admin add/update/merge (v1.3) |
| `/public/my-tickets` | "Taleplerim" (My tickets) — email-verified unified list (v1.3) |
| `/metrics` | Prometheus (only with `METRICS_TOKEN`) |

### API contract

All responses: `{ success: boolean, data?: T, error?: string }`

Input and response contracts are defined with Zod in the route `schema:` field
(`fastify-type-provider-zod`): validation happens at the Fastify boundary, responses cannot
leak fields that don't pass the schema, and `/docs` (OpenAPI) is generated from the same
schemas.

---

## Auth

**Staff — dual token:**

- **Access token:** 15 min. Accepted only via the `Authorization: Bearer` header
  (no cookie fallback — to avoid opening a CSRF surface).
- **Refresh token:** 7 days, httpOnly cookie. Also stored in Redis under `refresh:<staffId>`
  and **compared** on renewal — so logout truly revokes the session server-side.

The frontend keeps the access token **in memory** (Zustand `partialize` persists only
`user`). On startup `initializeAuth()` restores the session from the refresh cookie.
The Axios interceptor auto-refreshes once on a 401 (`_retry` guard) and redirects to
`/staff/login` on failure.

**SSO (staff):** OIDC, SAML 2.0, LDAP/AD (`services/sso/`). Identity → staff mapping,
group → role/company sync and JIT rules live in `services/sso/resolve.ts`. Browser flows
set the refresh cookie and return to `/staff/login?sso=ok`; the frontend obtains the
session with the refresh flow (the access token is never written to the URL). Local
password sign-in can be turned off via `system_settings.auth`; admins keep local sign-in
for emergencies.

**Public — passwordless:** The requester provides an email; the ticket gets a nanoid
`accessToken`. Whoever has the link has access.

**Decorators** (`plugins/auth.ts`): `authenticate`, `authenticateOptional`,
`requireRole(...roles)`.

**Roles:** `admin`, `it_manager`, `it_staff`. There is no hierarchy — `requireRole` does a
plain list check and grants admin no implicit override.

**Company scope** (`utils/staff-scope.ts`) — the single foundation of multi-company
isolation:

| Role | `getStaffCompanyScope` returns |
|---|---|
| `admin` | `null` — no restriction |
| `it_manager`, `it_staff` | assigned company ids (`StaffCompany` M:N) |
| no assignment | **empty array** — sees nothing (fail-closed) |

The scope is **not carried in the JWT**; it is read from the DB on every request —
assignment changes take effect immediately, no token renewal needed.

There are four helpers, and role checking must **not** be spread outside this file:

- `getStaffCompanyScope(prisma, staffId, role)` — resolves the scope.
- `companyWhereClause(scope)` — `where` fragment (`{}` or `{ companyId: { in } }`).
- `isCompanyInScope(scope, companyId)` — single check. **`companyId = null` ("global"
  records) is open to admin only** and this is enforced explicitly; Postgres `IN` semantics
  excluding NULLs is not relied upon.
- `resolveCompanyFilter(scope, requested)` — **intersects** the `companyId` filter coming
  from the client with the scope. If the scope were written into `where` and then
  overwritten by a parameter, a single-parameter privilege escalation would arise
  (`?companyId=<another-company>`); that is why the client filter must always go through
  here.

`Task` has no `companyId` — the scope is built in two steps via `location → company` and
`locationId` may be null; assignee/creator access is additionally protected so a person is
never locked out of their own task.

⚠️ **Company assignment (`PUT /staff/:id/companies`) is `admin` only.** This is a deliberate
authorization decision: opening it to `it_manager` would let them assign themselves every
company and render the scope meaningless.

---

## Data model

34 models, 13 enums. Status, priority, role and type fields are **Prisma enums** — the
valid set is enforced at the database level (previously they were plain `String` and
protected only by Zod).

`config/constants.ts` is **derived** from these enums; no hand-maintained lists. Label
dictionaries are typed `Record<Enum, string>`, so if you add a value to the schema and
forget to write its label, `tsc` errors. Zod schemas are bound with `z.nativeEnum(...)`.

`Notification.channel` is deliberately `String` (it matches template slugs, and templates
are managed from the DB). Making lists like status/priority/company type manageable from
the panel is planned for v1.3 ([roadmap.md](roadmap.md)).

**Multi-company:** `Company` → `Location`, `Category` (self-referencing hierarchy +
category-based SLA minutes + auto-assignment), `CustomField`, `CompanySmtp` (1:1),
`StaffCompany` (Staff ↔ Company M:N).

**People:** `User` (requesters, passwordless) and `Staff` (`passwordHash`, `role`) are
separate models.

**Core:** `Ticket` — unique `ticketNumber`, unique `accessToken` (public access), SLA
fields; indexes on `status`/`companyId`/`assignedToId`/`createdByEmail`/`createdAt`.
Related: `TicketCustomValue`, `TicketNote` (`isInternal`), `TicketHistory`, `Attachment`,
`OnsiteSupport`, `Notification`, `TicketWatcher` (CC / staff watcher); on the ticket:
`parentId` (single level), `mergedIntoId`, `assetId`, SLA pause/warning fields,
`statusChangedAt`, satisfaction survey fields.

**Added in v1.1:** `CompanyHoliday`, `CompanyMailbox` + `InboundMessage`,
`IdentityProvider` + `SystemSetting`, `Webhook` + `WebhookDelivery`, `KbArticle`, `Asset`.
Company SLA/business-hours/auto-close/survey settings live in the `Company.slaSettings`
JSON (format: `utils/sla-settings.ts`).

**Templates:** `TicketTemplate`, `CannedResponse`, `EmailTemplate`, `SmsTemplate`.

**Tasks:** `Task` → `TaskAssignee` (M:N), `TaskComment`.

**Other:** `AuditLog`, `CredentialEntry` (`passwordEnc`, `notesEnc`).

Migrations are versioned under `prisma/migrations/`; `migrate deploy` runs at startup.
`db push` is not used.

---

## Queue and background jobs

**Scheduled jobs (v1.2):** all periodic jobs (`jobs/scheduler.ts` JOB_REGISTRY: sla-check,
auto-close, mail-fetch, retention-check, backup, backup-verify) are applied to the BullMQ
schedulers with `syncSchedules()` using the cron/timezone/active preferences in the
`ScheduledJob` table. Every run is wrapped with a Redis single-instance lock + a
`ScheduledJobRun` record; on failure an email goes to the admins. The `backup` queue's
worker lives in a separate `backup` service (no pg_dump/rclone/age in the backend image).

**BullMQ + Redis.** Email and SMS sending is async: **3 retries, exponential backoff**.
Failed attempts are written to the `Notification` table and can be retried from the panel.

- `email.worker` — nodemailer. **Per-company SMTP:** sends with the company's `CompanySmtp`
  record if it has one, otherwise with the global SMTP. Transporters are cached for 10 min.
- `sms.worker` — SMS gateway adapter. Disabled if no gateway is configured.
- `mail-fetch.worker` — every 2 min; reads the active company mailboxes (`services/mail/`:
  IMAP, Microsoft Graph, Gmail API — all three return raw MIME), `jobs/mail-fetch.ts` does
  the matching. Replies and new tickets go through the same `services/ticket-intake.ts`
  path as the portal. Processed messages are kept in `inbound_messages` (mailbox +
  Message-ID unique).
- `sla-check.worker` — every 5 min; runs the `jobs/sla-check.ts` pass: pre-breach warning
  (`sla*WarnAt`), breach recording (`sla*Met=false`) and escalation. Paused (`slaPausedAt`
  set) tickets are skipped. Due dates are computed at ticket creation from the company's
  business-hours calendar (`utils/business-hours.ts`); the SLA effects of status
  transitions live in one place, the `utils/ticket-lifecycle.ts` planner (single/bulk
  update and public user reply go through the same path). `auto-close` (15 min) runs in the
  same queue: `jobs/auto-close.ts` — closing resolved/waiting-for-response tickets and
  sending reminders.
- `webhook.worker` — delivers `webhook_deliveries` records (5 retries, exponential backoff,
  SSRF check on every delivery, redirects not followed). Events are emitted via
  `services/webhooks/emit.ts`; production swallows errors so ticket processing is not
  broken.

---

## Realtime — SSE

One-way Server-Sent Events. `hooks/useSSE.ts` reconnects with exponential backoff.

Channels: `/events/staff` (panel), `/events/ticket/:accessToken` (requester's status page),
`/events/stats`.

⚠️ Because the browser `EventSource` API cannot send custom headers, the staff channel
takes its identity **in a query parameter**: not a JWT but a 30-second single-use ticket
obtained via `/events/ticket-grant` (`?ticket=`). Events: `ticket_created`,
`ticket_updated`, `note_added`, `user_reply`, `sla_alert`.

**If you use NPM, Websockets Support must be enabled on the proxy host**, otherwise SSE
won't work.

---

## Frontend

**Stack:** React 18, Vite 6, TypeScript, TailwindCSS 3, TanStack Query 5, Zustand 5,
axios, recharts, lucide-react, react-hot-toast. There is **no** component library —
hand-written Tailwind.

**State management:** Server state via TanStack Query (`staleTime: 30s`, `retry: 1`).
Client state is Zustand, only for auth.

**No build-time env:** The SPA never uses `import.meta.env`. Only in dev does the vite
proxy read `VITE_API_PROXY_TARGET`. That means **a single frontend image runs in every
environment**.

**Branding:** `BrandingProvider` calls `/companies/branding/by-host` at startup; applies
the company's logo and theme color by host. `ThemeProvider` manages dark mode.

---

## Notable architectural decisions

| Decision | Rationale |
|---|---|
| No password on the public portal, nanoid `accessToken` link | Requesters shouldn't have to open an account/remember a password. The system sits on an internal network. |
| **AES-256-GCM**, not a hash, in the credential vault | Passwords need to be **viewable** again; a hash is irreversible. The key lives only in env. |
| Only `password`/`notes` encrypted in the vault | `title`/`category`/`url`/`username` stay plain so search keeps working. |
| Custom fields in a separate table (not JSON) | Easier reporting and validation. |
| One `routes.ts` per module | Small surface, easy to navigate. No controller/service layer. |
| Frontend without build-time env | One image, every environment. Configuration is entirely runtime/backend-side. |
| `trustProxy: TRUST_PROXY` (hop count; every hop internal/loopback or IP/CIDR) | Real client IP behind NPM/Coolify but with spoof protection — trusting the whole chain (`true`) would let rate limiting be bypassed with a single `X-Forwarded-For` header. |
| No conflicts on appointments | Appointments aren't assigned to staff; parallel appointments are normal. |

---

## Coding conventions

- Backend is **ESM** (`"type": "module"`) — relative imports **require the `.js` extension**
  (`./foo.js`, even when the source is `.ts`).
- All input is validated with Zod.
- API response: `{ success, data?, error? }`.
- Turkish error messages and UI labels.
- Status/priority/role constants in `config/constants.ts`.
- `createAuditLog()` is called on admin/staff CRUD operations.
- Frontend: one component per file, data fetching via TanStack Query.
