# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Planned work is tracked in [docs/roadmap.md](docs/roadmap.md)._

## [1.3.2] - 2026-11-21

Dependency maintenance across both apps — every minor/major worth taking (Prisma 7,
BullMQ 6, React 19, Vite 8, Tailwind 4, …), the container-image publish pipeline moves to
GHCR, and the changelog becomes commit-generated. Docker Hub stays deliberately out of
scope (deferred indefinitely — no date/version).

### Upgrade notes
- Rebuild all images (backend, frontend, backup-service, nginx proxy) — or switch to the
  published GHCR images (`docker-compose.hub.yml`). No database migration; no API or
  behavior change.
- **Prisma 6 → 7**: the client now uses driver adapters — `PrismaClient` is constructed
  with `@prisma/adapter-pg`; the generated client lives in `src/generated/prisma`
  (`prisma-client` generator, git-ignored, rebuilt by the `postinstall` script); the CLI
  reads the connection from the new `backend/prisma.config.ts` (v7 no longer auto-loads
  `.env` — the repo-root file is loaded via dotenv there). Deployments are unaffected:
  `prisma migrate deploy` still runs at container start.
- **BullMQ 5 → 6** keeps its scheduler registry unchanged (the codebase already used the
  v5 job-scheduler API, the only non-removed path); **ioredis 6** connections pin
  `protocol: 2` (RESP2) so runtime behavior is identical.
- **Tailwind 3 → 4**: configuration moved to CSS (`@theme`, `@custom-variant dark`);
  the runtime brand palette (per-company primary color) is preserved via `@theme inline`;
  class renames were applied with v3-parity values (`border` color default restored,
  `backdrop-blur-sm` → `backdrop-blur-xs`, …). Verified with the full axe e2e suite plus
  a manual dark-mode review; `body` also gained `dark:bg-slate-950` to remove the light
  flash on dark-mode loads.
- ESLint 10 with react-hooks 7: the new React Compiler adoption rules run as **warnings**
  (16 flagged call sites are future refactor candidates; classic correctness rules stay
  errors).
- Node.js minimum is now **24** (`engines` field on all three packages); the frontend
  `tsconfig` lib moved to ES2022.

### Added
- GHCR release pipeline (`.github/workflows/release.yml`): on `v*` tag pushes CI runs
  first, then the four first-party images publish multi-arch (linux/amd64 + linux/arm64)
  to `ghcr.io/mahmutyum/ticket-system-{backend,frontend,backup,proxy}` with
  `:X.Y.Z` / `:X.Y` / `:latest` tags (pre-release tags never receive `:latest`), followed
  by a git-cliff generated GitHub Release.
- `docker-compose.hub.yml` — install without cloning the source
  (`VERSION=1.3.2 docker compose -f docker-compose.hub.yml up -d`); documented in the
  README and the installation guide as "Option A". `docker-compose.yml` carries the same
  `image:` names for local builds.
- `cliff.toml` + `scripts/release-changelog.sh`: CHANGELOG release sections are generated
  from Conventional Commits (the hand-written narrative style is preserved; only the new
  section is prepended and polished before tagging).

### Changed
- Backend majors: `prisma`/`@prisma/client` 7.10.1 (pinned — npm `latest` points at the
  v8 RC), `bullmq` 6.7.8, `ioredis` 6, `cron-parser` 5 (`CronExpressionParser.parse`),
  fastify 5.12.8 with the latest fastify-5 plugin majors; `effect` overridden to ^3.22.5
  (ReDoS advisory GHSA-7589-6fvf-x4pw sits behind @prisma/config 7.10.1's exact pin).
- Frontend majors: `react`/`react-dom` 19.3, `recharts` 3.11, `react-hot-toast` 2.6,
  `lucide-react` 1.x, `vite` 8.3 (Rolldown) + `@vitejs/plugin-react` 6, `vitest` 5.1,
  `tailwindcss` 4.3, `eslint` 10.15 + `typescript-eslint` 8.73 + `react-hooks` 7.1,
  `i18next` 27 + `react-i18next` 18, `jsdom` 31, `@types/node` 24. `npm audit` stays at
  0 vulnerabilities (dev included) in both apps.
- TypeScript stays on 5.9.x deliberately (TS 7 has no compiler API for toolchains yet;
  tracked as a v1.4 candidate).
- Documentation: roadmap status/test counts refreshed; the production guide gained the
  GHCR prebuilt-images option; CONTRIBUTING "where to start" now points at v1.4
  candidates.
- Node.js 24 minimum enforced via `engines` on backend, frontend and backup-service.

## [1.3.1] - 2026-11-19

Security and maintenance release: dependency vulnerabilities closed (including
breaking-major bumps), Node.js base image moved to 24 LTS, nginx to the 1.30 stable
branch, and the documentation set is now English-primary with Turkish counterparts.

### Upgrade notes
- Rebuild all images (backend, frontend, backup-service, nginx proxy). No database
  migration in this release; no API or behavior change.
- Zod was upgraded 3 → 4 internally (with `fastify-type-provider-zod` 4 → 7). Schemas
  keep their runtime semantics — env boolean parsing was reordered to
  `z.string().default('..').transform(..)` because zod 4 no longer parses default values
  through the chain (the old order silently returned raw strings).
- Documentation moved to English-primary: every document now has a plain filename
  (English) plus a `.tr.md` Turkish counterpart — `README.md` / `README.tr.md`,
  `docs/installation.md` / `docs/installation.tr.md`, etc. Old Turkish filenames
  (`docs/kurulum.md`, `docs/kullanim.md`, ...) no longer exist; update your links.
  `README.en.md` was replaced by `README.md`.

### Changed
- **Node.js 22 → 24 LTS** (supported until April 2028) across all five Dockerfiles,
  CI (`.github/workflows/ci.yml`) and a new `.nvmrc`; `@types/node` bumped to 24.
- **nginx 1.25 → 1.30** (current stable) for the frontend runtime image and the proxy.
- Dependency security updates — `npm audit` is now clean (0 vulnerabilities, dev
  included) in both backend and frontend:
  - backend: `zod` 3.25 → 4.6 (GHSA-mrhx-c7xc-m3w5, high), `fastify-type-provider-zod`
    4.0 → 7.0, `nodemailer` 9 → 10 (GHSA fix) with `@types/nodemailer` aligned,
    `vitest`/`@vitest/coverage-v8` → 4.1.12 (mocker advisories).
  - frontend: `react-router-dom` 6.30 → 7.18 (declarative v6 API unchanged in the
    codebase), `vite` 6.0 → 6.4.6 (multiple launch-editor/fs-allow advisories),
    `vitest` → 4.1.12.
- zod 4 code adaptations: `z.record` now two-argument, removed `z.ZodIssueCode` usage,
  explicit full-object `.default()` values for SLA sub-settings, typed lookup response
  record; deprecated-but-working string format validators (`.email()` etc.) left as-is.

### Added
- English-primary documentation: English versions of the installation, usage,
  architecture, operations, roadmap, public-repo-security and contributing guides
  (Turkish originals preserved as `*.tr.md`), plus a Turkish `SECURITY.tr.md` and
  language-switcher links on every document pair.

### Fixed
- Pre-existing lint error (unused `Save` import) in the staff Dictionaries page.

## [1.3.0] - 2026-11-14

DB-managed dictionaries ("Sözlükler"), "Taleplerim" unified requester view, S3-compatible
storage driver and accessibility/UX hardening. The Docker Hub publishing pipeline is
deliberately deferred (see docs/roadmap.md).

### Upgrade notes
- Run migrations (`prisma migrate deploy`, automatic on container start): new `dict_*`
  dictionary tables with system rows seeded from the previous enum values (same keys —
  data conversion is lossless). `StatusClass` (new/active/waiting/resolved/closed) stays
  in code: it is the behavior contract, not panel data.
- Old Prisma enums (`TicketStatus`, `Priority`, `TaskStatus`, `OnsiteType`,
  `OnsiteStatus`, `CompanyGroupType`) become TEXT columns with FK to the dictionary
  tables (RESTRICT — in-use keys cannot be deleted, only deactivated).
- S3 storage is opt-in (`STORAGE_DRIVER=local|s3`); the default remains local disk.
  Driver is global — files stored locally are not served in s3 mode; migrate files
  before switching (roadmap: bucket versioning alternative).

### Added
- **DB-managed dictionaries** ("Sözlükler" admin page): statuses, priorities, task
  statuses, onsite types/statuses and company types are manageable from the panel —
  bilingual labels, color token, sort order, deactivate, merge (usage rows are moved to
  the target key). Guard: at least one ACTIVE status per behavior class.
- **Behavior by status CLASS**: SLA pausing keys off the `waiting` class, auto-close off
  the `resolved` class, escalation off dictionary `weight` — panel-added statuses
  inherit correct behavior without code changes.
- **`GET /lookups`** (staff) and **`GET /lookups/public`** (portal): dictionary entries
  consumed by the frontend with long staleTime; unknown keys fall back to raw value.
- **"Taleplerim"** (`/my`): passwordless requester view — email in, short-lived (15 min)
  magic link out, all tickets of that email in one list. Enumeration-safe: unknown
  addresses receive the same generic response (and an empty-list mail).
- **S3-compatible storage driver** (`STORAGE_DRIVER=local|s3`): attachments and logos on
  AWS S3 / MinIO / R2; downloads stay backend-authorized; logo pruning by prefix;
  SDK loaded only when the driver is s3.
- Zod validation for dictionary keys is driven by the cached ACTIVE key set
  (`zLookupKey`); unknown/passive keys are rejected.

### Quality
- ESLint rule bans behavioral dictionary-key literals in src (class-based lookups are
  the only sanctioned path; tests and the constants shim are exempt).
- Dictionary integration tests cover the roadmap acceptance criteria: panel-added
  status usable without deploy, TR/EN display, SLA pause by class, merge, last-active
  guard.

### Deferred
- Docker Hub images + auto-changelog (v1.3 items 3–4): verified free (~half a day) via
  public-repo Actions with free arm64 runners; postponed for prioritization. CHANGELOG
  stays hand-maintained.

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
  26h" sample alert in `docs/operations.md` becomes automatically monitorable.

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

[Unreleased]: https://github.com/mahmutyum/ticket-system/compare/v1.3.2...HEAD
[1.3.2]: https://github.com/mahmutyum/ticket-system/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/mahmutyum/ticket-system/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/mahmutyum/ticket-system/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/mahmutyum/ticket-system/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/mahmutyum/ticket-system/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mahmutyum/ticket-system/releases/tag/v1.0.0
