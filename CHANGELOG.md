# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Planned work is tracked in [docs/yol-haritasi.md](docs/yol-haritasi.md)._

## [1.1.0] - 2026-09-27

SLA accuracy, ticket lifecycle, enterprise integrations, knowledge base, assets, CSAT and
observability.

### Upgrade notes
- Run migrations (`prisma migrate deploy`, automatic on container start). Auto-close
  (resolved → closed after 7 days) is on by default; for tickets already resolved or
  awaiting the requester at upgrade time the countdown starts at the upgrade, so there is no
  mass closure/email burst on the first run. Set `autoClose.resolvedAfterDays` to 0 per
  company (SLA & Hours screen) to disable. No retroactive satisfaction surveys are sent.
- `TRUST_PROXY` keeps its meaning; each trusted hop must now be an internal/loopback
  address (or give an IP/CIDR list). Verify client IPs in the audit log after upgrading.
- New optional env: `ALLOW_PRIVATE_INTEGRATION_HOSTS`, `METRICS_TOKEN`.

### Added
- **SLA pausing**: the SLA clock stops while a ticket waits on the requester, another
  department, an outside process or is on hold; due dates shift by the paused time on resume.
- **Business hours & holidays** per company (time zone aware, split windows, DST safe);
  selected priorities can stay 24/7.
- **Pre-breach warnings** at a configurable threshold (default 80%) and **escalation** of
  breaches to the company's IT managers, with optional automatic priority bump.
- **Auto-close** per company: resolved tickets close after N days (default 7); tickets
  awaiting the requester can get a reminder and then close (off by default). Bilingual
  requester notifications (`ticket_waiting_reminder`, `ticket_auto_closed`).
- **Reply by email** per company mailbox — IMAP, Microsoft 365 (Graph, app-only) or Gmail
  (OAuth). Requester notifications carry the mailbox as Reply-To; replies are matched by
  ticket number + requester address, quoted text is stripped, attachments follow the upload
  rules; unmatched mail can open tickets (`source: email`). Auto-replies, own address and
  per-sender floods are ignored; every message is processed once and logged.
- **Ticket relations**: merge duplicates (notes/files move, source closes, requester becomes
  CC), single-level parent/child with "apply to children" status changes, and watchers —
  requester-side CC (portal field, email To/Cc, can reply by email) and staff watchers.
- **Staff SSO**: OpenID Connect (PKCE, nonce), SAML 2.0 (signed assertions, InResponseTo
  replay protection) and LDAP/AD (escaped filters, user bind); group → role/company
  mapping synced on every sign-in, opt-in JIT provisioning, account linking by subject,
  and an option to disable local password sign-in (admins keep break-glass access).
- **Assets**: lightweight per-company inventory with CSV import (upsert by tag, per-line
  errors), request–asset linking (same company only) and per-asset request history;
  requester-assigned devices are suggested first.
- **Knowledge base**: per-company or global Markdown articles (TR/EN, raw HTML disabled),
  portal search and article pages, category-based suggestions in the request wizard with a
  deflection counter, helpful/not-helpful feedback, staff editor with preview and
  "insert article link" in ticket notes. Company scoping mirrors company data rules.
- **Satisfaction survey (CSAT)**: a one-time survey email on resolution/closure (per-company
  toggle); star links only preselect the rating on the tracking page — the vote is saved on
  confirmation, so link scanners cannot cast votes. One rating per request (DB-checked 1–5),
  a `ticket.rated` webhook event and a Satisfaction report tab.
- **Webhooks & chat notifications**: Microsoft Teams (Adaptive Card), Slack (Block Kit) and
  HMAC-SHA256 signed generic webhooks for ticket and SLA events; encrypted targets,
  queued delivery with retries, SSRF-checked per delivery, no redirects, delivery log with
  retry. Internal notes and requester tracking links are never sent.
- **Prometheus metrics** at `/metrics` behind a `METRICS_TOKEN` bearer token (disabled when
  unset): HTTP latency/5xx by route template, BullMQ queue depth, failed notifications, open
  SLA breaches, failed webhook deliveries, mailbox errors, SSE connections and process
  defaults; sample alert rules in the operations guide.
- `ALLOW_PRIVATE_INTEGRATION_HOSTS` to allow internal-network SMTP/IMAP/LDAP/OIDC hosts
  (loopback and cloud metadata stay blocked).
- Live `sla_alert` panel notifications; SLA events in the ticket timeline; paused-time
  metrics in the SLA report.

### Security
- Dependencies updated (`npm audit fix`; `@fastify/swagger-ui` 6). Fastify 5.12 dropped
  numeric hop-count `trustProxy`; `TRUST_PROXY=N` keeps its meaning but now also requires
  every trusted hop to be an internal/loopback address, and accepts an IP/CIDR list.
  Without this, all clients would have shared one rate-limit bucket after the upgrade.

### Fixed
- Token refresh rejected the empty JSON body the frontend sends, so sessions were not
  restored on page reload and automatic token renewal failed.
- SLA notification labels ("Response/Resolution Time") now follow the recipient's language.
- Bulk ticket updates now record history and apply the same SLA/first-response/link-expiry
  rules as single updates; a requester reply now resumes the SLA and is recorded in history.
- Moving a ticket out of `open` to any status (or a staff public note) counts as the first
  response.
- Internal SLA events are no longer exposed in the public ticket history.
- The staff SSE connection no longer reconnects on every page re-render.

## [1.0.0] - 2026-07-17

First tagged release. A production-ready, multi-tenant internal IT helpdesk.

### Added

**Public portal (passwordless)**
- Ticket creation wizard: company / location / category selection, per-company dynamic
  custom fields, file attachments.
- Live ticket tracking via unguessable access-token links; public replies and attachments.
- Ticket lookup by number + email.

**Staff panel (role-based)**
- Dashboard with open/closed stats, SLA status, and assigned workload.
- Ticket management: list / filter / search, detail, status & assignment changes,
  internal vs. public notes, bulk actions.
- On-site support calendar (appointments, durations, calendar view).
- Task management independent of tickets (multi-assignee, comments).
- Reporting: distribution, staff performance, category breakdown, SLA trends, CSV export.

**Administration**
- Company / location / category / custom-field management, per-company SMTP.
- Email & SMS templates, canned responses.
- Staff management and an admin-only **credential vault** (AES-256-GCM, audited reveals).

**Localization (TR / EN)**
- Bilingual UI (browser-detected + instant switch, persisted).
- API messages localized via `Accept-Language`.
- Email/SMS templates delivered in the recipient's language.

**Security**
- TOTP MFA (opt-in) with a warning for privileged accounts.
- Upload hardening: MIME-derived extensions, magic-byte content validation,
  authenticated downloads, `nosniff` + attachment disposition, per-ticket quota.
- Credential-vault key rotation script.
- Fail-closed RBAC and per-company scope; session-based refresh-token revocation.
- CSV formula-injection, SSRF, and template-escaping protections.

**Platform**
- Async email/SMS via BullMQ (retries, backoff); SLA checks every 5 minutes.
- Live updates over SSE; per-domain company branding.
- Dockerized (Compose), versioned Prisma migrations, real PostgreSQL + Redis integration
  tests, backend + frontend test suites, and OpenAPI request/response contracts.

[Unreleased]: https://github.com/mahmutyum/ticket-system/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/mahmutyum/ticket-system/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mahmutyum/ticket-system/releases/tag/v1.0.0
