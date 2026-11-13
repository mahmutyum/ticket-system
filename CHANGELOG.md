# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Planned work is tracked in [docs/yol-haritasi.md](docs/yol-haritasi.md)._

## [1.2.0] - 2026-11-13

Automatic backups, central scheduled-job (cron) infrastructure and repo-wide quality
hardening.

### Upgrade notes
- Run migrations (`prisma migrate deploy`, automatic on container start): new tables
  `scheduled_jobs`, `scheduled_job_runs`, `backup_targets`.
- Backup is **opt-in**: start the separate service with
  `docker compose --profile backup up -d`. The backend image stays unchanged; the backup
  container carries pg_dump/rclone/age. Restore remains CLI-only
  (`scripts/restore.sh`) by design — destructive operations are never exposed on the web.
- Scheduled jobs pick up their cron/timezone/enabled values from the `ScheduledJob` table
  (seeded from `BACKUP_*` env defaults on first boot; panel overrides take precedence).
  The legacy hard-coded intervals are replaced by the registry; existing behaviour
  (SLA 5 min, auto-close 15 min, mail 2 min) is preserved.
- Remote backup targets **require encryption**: uploads happen only after `age`
  encryption (`BACKUP_ENCRYPTION_RECIPIENT`). Unencrypted remote upload is refused —
  `environment.snapshot` contains secrets.
- `ticket_backup_last_success_timestamp` now exists on `/metrics`; the "backup older than
  26h" sample alert in `docs/operasyon.md` becomes automatically monitorable.

### Added
- **Central scheduled-job registry** (`Zamanlanmış Görevler` admin page): cron /
  timezone / pause per job, next-run preview, run history, manual trigger. Redis
  single-run lock prevents overlap and multi-replica double runs; every run is recorded
  (`ScheduledJobRun`) and failures email the admins. Retention **apply** is deliberately
  never schedulable.
- **Automatic backup service** (optional compose profile): `pg_dump` + uploads archive +
  environment snapshot + `SHA256SUMS` — same format as `scripts/backup.sh`, restore
  compatibility preserved. Disk-space pre-check and suspiciously-small dump detection.
- **Remote backup targets** (rclone-based): local, S3-compatible, Google Drive, FTPS,
  SFTP, WebDAV, SMB. Credentials stored AES-256-GCM encrypted, write-only in the API;
  connection test (write/read/delete probe), post-upload verification, per-target GFS
  retention (default 7/4/6), per-target result reporting, SSRF guard on target hosts.
- **Periodic restore drills**: the latest backup is restored into a temporary database,
  table count and latest migration are verified, then everything is cleaned up.
- **Admin `Backups` page**: target management (masked secret), test connection, backup
  listing per target, last upload result.
- `retention-check` as a scheduled job (report only; apply stays manual).
- `ticket_backup_last_success_timestamp` Prometheus gauge.

### Quality (repo-wide)
- Backend: KB list pagination; streaming/keyset report exports (removed silent 10k/50k
  caps); atomic CSV import (single transaction); shared route scope helper; request-ID
  propagation + `X-Request-Id`; Pino log redaction for `Authorization`/`Cookie`; startup
  warnings for disabled metrics/docs in production; seed idempotency; coverage
  measurement with thresholds; Swagger version read from `package.json`.
- Frontend: shared `Modal` (focus trap, Escape, a11y roles) replacing 15 copied overlays;
  visible error states on list pages; single-flight 401 refresh with return-URL
  preservation; central query keys (stale cross-page data fixed); URL-persisted ticket/task
  filters; dead legacy label maps removed; axe accessibility coverage extended to the staff
  panel; component tests for `Modal`.
- Docs/web: documentation drift fixes (trustProxy semantics, attachment topology, scope
  contradictions, dead links); public wiki synced to the release with a content-version
  gate that breaks the site build on drift.
- Fixed a pre-existing `typecheck:tests` failure (`it.each` typing) and hardened a flaky
  vault e2e scenario.

### Deliberate decisions
- Job-failure notifications are email-only for now: the webhook event model is
  ticket-centric; ticketless webhook events need a separate design.
- `retention-check` is schedulable; `retention-apply` is not — human approval stays
  mandatory.

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
