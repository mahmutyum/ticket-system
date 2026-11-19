# Roadmap

🇬🇧 **English** · [🇹🇷 Türkçe](roadmap.tr.md)

The project's current maturity and planned work. Status: 2026-11-14 (v1.3.0).

## Maturity summary

| Area | Status |
|---|---|
| Feature scope | 🟢 Ticket lifecycle, SLA, reports, tasks, credential vault, MFA |
| Bilingual support | 🟢 TR/EN (UI + API messages + email/SMS templates) |
| Setup / deploy | 🟢 Docker Compose, Coolify and Nginx documented |
| Migration | 🟢 Versioned; verifiable on real PostgreSQL |
| Backend tests | 🟢 444 unit/route/worker tests |
| Frontend tests | 🟢 26 unit tests + 6 Playwright smoke/axe scenarios |
| Integration | 🟢 61 tests — real PostgreSQL + Redis; end-to-end with a fake OIDC provider, a signed SAML response and a local webhook receiver |
| API documentation | 🟢 Request/response contracts on critical routes (OpenAPI) |
| Code quality | 🟢 Backend + frontend lint-clean, typed |
| SLA accuracy | 🟢 Pausing, business-hours calendar/holidays, pre-breach warnings, escalation (v1.1) |
| Channels and integration | 🟢 Reply by email (IMAP/M365/Gmail), SSO (OIDC/SAML/LDAP), webhooks + Teams/Slack (v1.1) |
| Observability | 🟢 Prometheus `/metrics` + sample alert rules (v1.1) |
| Backup | 🟢 Automatic (backup profile): rclone remote targets, age encryption, GFS, restore drills (v1.2) |
| Manageability | 🟢 Dictionaries ("Sözlükler") managed from the panel; behavior depends on the status CLASS (v1.3) |

## Release plan

| Release | Theme |
|---|---|
| **v1.1** ✅ | SLA accuracy, ticket lifecycle, enterprise integration, product maturity, observability |
| **v1.2** ✅ | Automatic backup, central scheduled-job (cron) infrastructure, remote backup targets |
| **v1.3** | DB-managed dictionaries (company type, status, priority…), "Taleplerim" (My tickets), S3 storage, Docker Hub images, release automation |

---

## v1.1 — ✅ completed

All of the items below have been implemented (details: [CHANGELOG](../CHANGELOG.md)). Decisions
taken during implementation that deviate from the plan:

- **SLA-pausing statuses:** `waiting_user_response`, `waiting_other_department`,
  `process_outside_it`, `on_hold` (`config/constants.ts`, to be moved to the status class in
  v1.3). Company SLA settings, auto-close and survey settings live in a single JSON
  (`companies.sla_settings`).
- **Auto-close defaults:** resolved → close after 7 days is on; waiting-for-response
  reminder/close is off.
- **Reply by email:** a message that fails processing is not retried (it is saved and marked
  read); a reply to a closed ticket becomes a new ticket referencing the previous number.
- **SSO:** IdP-initiated sign-in is not supported for SAML (`InResponseTo` is required); the
  OIDC issuer must be HTTPS in production. If a role mapping is defined, unmatched users
  cannot sign in.
- **Private-network integrations:** `ALLOW_PRIVATE_INTEGRATION_HOSTS=true` allows
  in-organization SMTP/IMAP/LDAP/OIDC/webhook targets (loopback and cloud metadata are
  blocked in all cases).
- **Satisfaction survey:** the stars in the email only pre-select the score; submission is
  confirmed on the page (link scanners cannot vote).
- **Left out of scope:** react-router 6 → 7 (medium-severity security finding, major-version
  migration) was deferred to a separate task.

### 1. SLA accuracy

Today's `sla-check.worker.ts` only compares `slaResponseDue` / `slaResolveDue` with the
current time. This makes the SLA rates in reports misleading.

**1.1 SLA pausing in waiting statuses**
- In the `waiting_user_response`, `waiting_other_department`, `on_hold` (and, if so decided,
  `process_outside_it`) statuses the SLA clock stops; on return to an active status it is
  shifted forward by the remaining time.
- `slaPausedAt` and cumulative `slaPausedMinutes` fields on the ticket; pause/resume is
  written to `TicketHistory`.
- Which statuses stop the SLA is defined in a single list in `config/constants.ts`.
- Reports show "paused time" separately.

**1.2 Business hours and holiday calendar**
- Per-company working calendar: day/hour ranges + time zone.
- Per-company public holiday / custom closed-day list (easy year-over-year copying).
- The SLA due time is calculated by counting only the minutes within business hours; if no
  calendar is defined, today's 24/7 behavior is preserved (backward compatible).
- Per-priority "24/7 SLA" exception (e.g. `critical`).

**1.3 Pre-breach warnings and escalation**
- Threshold-based warning (default 80%, configurable per company); each threshold is sent
  once per ticket.
- For unassigned tickets the warning goes to the company-scoped `it_manager`s.
- Post-breach escalation: notification to the manager + optional priority bump.
- SLA warning event on the staff SSE channel (live badge in the panel).

**1.4 i18n fix in SLA notifications**
- The `slaType` value currently appears in the worker as hardcoded Turkish text
  (`'Yanıt Süresi'`, `'Çözüm Süresi'`); it must be generated according to the recipient's
  language via `backend/src/i18n/labels.ts`. The same sweep is done for the other worker
  variables too.

### 2. Ticket lifecycle

**2.1 Auto-close**
- A ticket in `resolved` status becomes `closed` if it is not reopened within N days
  (default 7).
- In `waiting_user_response` status, if no reply arrives within N days: first a reminder,
  then closure.
- Durations are per-company; the closure is written to `TicketHistory` with a system actor
  and a bilingual notification goes to the requester.

**2.2 Reply by email (inbound)**
- Per-company IMAP (or Microsoft 365 / Gmail OAuth) mailbox; periodic polling with BullMQ.
- An incoming reply is attached as a public note by matching the ticket number in the
  subject/`In-Reply-To` header + the sender email; the quoted previous message is trimmed.
- Attachments pass the existing MIME allowlist + magic-byte validation.
- Creating a new ticket from an unmatched email (optional, per company).
- Loop protection: automatic replies (`Auto-Submitted`, `X-Autoreply`) are ignored;
  rate limit per sender.
- Mailbox credentials are stored encrypted with AES-256-GCM.

**2.3 Merging, parent/child relations and watchers**
- Ticket merging: notes/attachments are moved to the target ticket, the source becomes
  `closed` + redirect.
- Parent/child relation: a single parent ticket for a widespread incident; child tickets
  can be bulk-closed when the parent is resolved.
- CC / watchers: email addresses other than the requester and staff watchers receive
  notifications. Company-scope checks are preserved.

### 3. Enterprise integration

**3.1 SSO / directory integration for staff**
- OIDC (Entra ID, Keycloak, Google Workspace) first; SAML 2.0 as the second step.
- Bind-based sign-in with LDAP/Active Directory and group → role / company mapping.
- Creating staff records on first sign-in (JIT provisioning) is optional; role and company
  assignment is still done only with admin approval or an explicit group mapping.
- Local password sign-in can be disabled by the admin (except the break-glass admin
  account).
- For accounts signing in with SSO, MFA is delegated to the IdP.

**3.2 Webhooks and chat notifications**
- Event-based outbound webhook (ticket created/updated/SLA breach); HMAC-signed body,
  retries via BullMQ.
- Microsoft Teams and Slack channel notifications (incoming webhook).
- Existing SSRF protections apply to target URLs; internal notes do not go to external
  channels.

### 4. Product maturity

**4.1 Satisfaction survey (CSAT)**
- On closure, a one-click 1–5 rating + optional comment for the requester (over the
  existing access-token link, no separate account).
- CSAT averages by company / category / staff in reports.

**4.2 Knowledge base**
- Per-company and global articles (Markdown, bilingual), linked to categories.
- Search in the public portal; in the ticket wizard, suggested articles based on the
  selected category ("Did this solve it?" as a metric for exits without opening a ticket).
- On the staff side, attaching an article to a ticket as a canned response.

**4.3 Asset (inventory) linking**
- Lightweight asset record: type, tag/serial number, location, assignee email.
- Linking an asset to a ticket; per-asset ticket history.
- A full CMDB is not the goal; CSV import is a sufficient starting point.

### 5. Observability

- Prometheus-compatible `/metrics` (internal network only): HTTP latency/errors, BullMQ
  queue depth and failed-job count, unsent notifications, open SLA breaches, SSE connection
  count.
- Sample alert rules for the alert starting points in `operations.md`.

---

## v1.2 — ✅ completed

All of the items below have been implemented (details: [CHANGELOG](../CHANGELOG.md)).
Decisions that deviated from the plan during implementation:

- **Job-failure webhook limited to email in this release:** the webhook event model is
  ticket-centric; an event without a ticket was left to a separate design.
- **The backup worker runs in a separate container** (`backup` compose profile): the
  pg_dump/rclone/age tools are not put into the backend image; triggering arrives via the
  `backup` queue, and the run record is written to `scheduled_job_runs` by the worker.
- **Restore drills run on the same Postgres instance with a temporary database**
  (`restore_drill_*`) — no docker socket required.

Today backups are taken **manually** with `scripts/backup.sh` and written only to local disk
(`database.dump` + `uploads.tar.gz` + `environment.snapshot` + `SHA256SUMS`). Scheduling is
left to the host cron and the remote copy to the operator. v1.2 turns this into a
system-managed, observable process.

### 1. Central scheduled-job (cron) infrastructure

Periodic jobs are scattered today: SLA checking is a 5-minute BullMQ job embedded in the
code, retention checking is a host cron. The goal is to manage all periodic jobs from a
single place.

- A **job registry** on top of BullMQ repeatable jobs: each job's key, cron expression,
  time zone, active/inactive state and defaults are defined in code; the admin panel only
  changes the allowed fields.
- Jobs covered: SLA checking, auto-close (v1.1), inbound email polling (v1.1), retention
  **check**, backup, backup verification / restore drill.
- `scheduled_job_runs` table: start/end, duration, result, summary output, error.
- **Single-run lock** (Redis): the same job does not overlap; with multiple backend
  replicas only one runs.
- Admin panel "Zamanlanmış Görevler" (Scheduled jobs) page: last/next run, history, manual
  trigger, pause. The cron expression is validated before saving and the next 5 run times
  are previewed.
- On a failed run, notification to managers (email + v1.1 webhook/Teams/Slack).
- Retention **apply** deliberately cannot be scheduled automatically; the human-approval
  principle is preserved.

### 2. Automatic backup

- Backup is executed by a separate **`backup` service** containing `pg_dump` + `tar` +
  transfer tools (optional profile in compose); the backend image is not bloated.
  Triggering comes from the scheduler in the backend via the queue, and the result is
  written to `scheduled_job_runs`.
- The content is in the same format as today's script (restore compatibility is
  preserved): PostgreSQL custom-format dump, uploads archive, environment snapshot,
  `SHA256SUMS`. If the S3-compatible storage driver (v1.3) is enabled, bucket
  versioning/replication can be used instead of the uploads archive.
- Backup types: full backup (daily by default); optional incremental archive for uploads.
- **Encryption mandatory (on remote targets):** the archive is encrypted with an `age`
  public key (or password-based AES-256) before being uploaded. Because
  `environment.snapshot` contains secrets, an unencrypted remote copy is rejected. The
  decryption key is not kept on the system.
- Compression and size report; a run counts as failed on an empty/suspiciously small dump.
- Disk space check before the backup.

### 3. Remote backup targets

The transfer layer is **rclone**-based; a large number of targets are supported through a
single interface. Multiple targets can be defined at the same time (e.g. local + S3 +
Google Drive).

| Target | Authentication | Notes |
|---|---|---|
| Local disk / mounted volume | — | Default; includes NAS mounts |
| S3-compatible (AWS S3, MinIO, Cloudflare R2, Backblaze B2, Wasabi) | Access key / secret, endpoint, region | Object Lock / versioning recommended |
| Google Drive | OAuth (service account or user authorization) | Shared Drive folders supported |
| FTP / FTPS | User / password | Only FTPS recommended; plain FTP with a warning |
| SFTP | Password or SSH key | Host key verification mandatory |
| WebDAV (Nextcloud etc.) | User / app password | |
| SMB / Windows share | User / password / domain | For in-organization file servers |
| Azure Blob, OneDrive / SharePoint | Connection string / OAuth | Second phase |

- Target definitions are managed from the admin panel; credentials are stored
  AES-256-GCM-encrypted the same way as the credential vault, shown masked in the UI, and
  changes are written to the audit log.
- "Bağlantıyı test et" (Test connection): writes a small probe file, reads it back and
  deletes it.
- After the upload, the remote file's size/checksum is verified.
- One target's failure does not stop the others; results are reported per target.
- SSRF protections for target URLs (internal network addresses only if explicitly
  allowed).

### 4. Retention policy

- GFS rotation per target: keep the last N daily, N weekly, N monthly backups
  (default 7 / 4 / 6).
- Old backups are deleted only **after** the new backup is **successfully verified**.
- The last successful backup is never deleted under any circumstance.

### 5. Verification and restore

- Periodic **restore drill**: the latest backup is restored into a temporary PostgreSQL
  container, table/row counts and the migration version are checked, then the environment
  is deleted.
- Backup list in the admin panel (from all targets), with size, duration, verification
  status.
- Download from a remote target + restore with the existing `restore.sh` flow; restore is
  not triggered from the web UI (destructive operation, from the CLI with operator
  approval).
- The `operations.md` "backup older than 26 hours" alert is monitored automatically via
  `/metrics` (`backup_last_success_timestamp`).

### 6. Configuration (draft)

```env
BACKUP_ENABLED=true
BACKUP_CRON=0 3 * * *
BACKUP_TZ=Europe/Istanbul
BACKUP_ENCRYPTION_RECIPIENT=age1...        # mandatory for remote targets
BACKUP_RETENTION_DAILY=7
BACKUP_RETENTION_WEEKLY=4
BACKUP_RETENTION_MONTHLY=6
BACKUP_VERIFY_CRON=0 5 * * 0               # weekly restore drill
```

The env values are defaults; changes made from the panel are stored in the database and
take precedence. Target credentials are not written to env.

---

## v1.3 — Manageability and deployment

### 1. DB-managed dictionaries (reference data)

Today company type, ticket status, priority, task status and on-site support type/status
are fixed in code as **Prisma enums**. Adding a new value requires a migration + deploy +
translation-file update; labels and colors are scattered across backend
`config/constants.ts`, frontend `types/index.ts` and `i18n/locales/*.json`. The goal: these
lists become database tables that can be **added to and edited** from the admin panel.

**Scope**

| Dictionary | Today | v1.3 | System behavior tied to the value |
|---|---|---|---|
| Company type | `CompanyGroupType` enum | `company_types` table | — (label, color, order) |
| Ticket status | `TicketStatus` enum | `ticket_statuses` table | **Status class** (below) |
| Priority | `Priority` enum | `priorities` table | Sort weight, default SLA minutes, 24/7 SLA flag (v1.1) |
| Task status | `TaskStatus` enum | `task_statuses` table | Status class: open / active / completed / cancelled |
| On-site support type | `OnsiteType` enum | `onsite_types` table | Default duration, whether location/room is required |
| On-site support status | `OnsiteStatus` enum | `onsite_statuses` table | Status class: scheduled / active / completed / cancelled |

**Deliberately kept in code**
- `StaffRole`: tied to RBAC and company-scope security decisions; defining roles from the
  panel requires a separate authorization-model design, out of scope for this release.
- `CustomFieldType`: each type's validation and render behavior lives in code.
- `NotificationType` / `NotificationStatus`: queue and worker internal state.

**Common dictionary model**
- Each record: an immutable `key` (slug), bilingual label (`labelTr`, `labelEn` or a
  translation table — per the i18n decision), color, optional icon, order, `isActive`,
  `isSystem`.
- `isSystem` records (counterparts of the current enum values) cannot be deleted; only
  label / color / order can be edited, and they can be deactivated if needed.
- A record in use is not deleted; it is **deactivated** (no longer selectable in new
  records, still visible in old ones) or moved with "merge into another value".
- Optional company scoping: a record is global or active in specific companies. Global
  record management is admin-only (the existing "global records are admin-only" rule).
- All changes are written to the audit log.

**Status class — behavior binds to the class, not the key**

Today the code looks at statuses by name (e.g. in SLA checking
`status: { notIn: ['resolved', 'closed'] }`; ~50 constant literals across ~17 files in
backend + frontend). So that a freely added status does not break the system, every status
maps to a fixed **class** and the code looks only at the class:

| Class | Meaning | Current counterparts |
|---|---|---|
| `new` | New, not yet acted on | `open` |
| `active` | Being worked on; SLA runs | `in_progress`, `topic_transferred` |
| `waiting` | Waiting on an external party; **SLA stops** (v1.1) | `waiting_user_response`, `waiting_other_department`, `on_hold`, `process_outside_it` |
| `resolved` | Resolved; the auto-close counter starts (v1.1) | `resolved` |
| `closed` | Closed; the public-access timer starts | `closed` |

- The "SLA-stopping statuses" list to be written into `constants.ts` in v1.1 moves to this
  class.
- Optional: a definition of allowed status transitions (workflow); if undefined, all
  transitions are free.
- Each class must contain at least one active status; the default "new ticket" status is
  selectable.

**Migration plan**
1. Create the dictionary tables and seed the current enum values as `isSystem` **with the
   same keys** (TR/EN labels from the existing translation files).
2. Convert the relevant columns from enums to FKs to the dictionary tables (data conversion
   via key, lossless); `TicketHistory` keeps storing old/new values as keys.
3. Convert the fixed-literal checks in code to class-based queries; a lint rule for the
   sweep (ban dictionary keys from being used as string literals).
4. Zod validation is done against the active key set read from the DB and cached in Redis,
   instead of `z.nativeEnum`; the cache is invalidated when a dictionary changes.
5. Frontend: a single `GET /lookups` endpoint (TanStack Query, long `staleTime`);
   `STATUS_LABELS` / `STATUS_COLORS` / `PRIORITY_WEIGHT` etc. in `types/index.ts` and the
   `enums.*` dictionaries in `i18n/locales/*.json` are removed, `useEnumLabels` reads DB
   data.
6. Notification templates, reports and CSV export labels are taken from the DB according to
   the recipient's / request's language (`backend/src/i18n/labels.ts`).
7. Admin panel: the "Sözlükler" (dictionaries) page — list, drag-and-drop ordering, color
   picker, bilingual labels, deactivate / merge.

**Acceptance criteria:** a new company type, ticket status or priority can be added from
the panel without a code change or deploy and renders correctly in the TR/EN UI,
notifications and reports; SLA and auto-close behavior works correctly according to the
status class.

### 2. "Taleplerim" (My tickets) — unified tracking for requesters

Today access to a ticket is provided through a ticket-specific link (or ticket number +
email); there is no flow for a user who has opened multiple tickets to see them all in one
place.

**Plan:** The user enters their email; via a **short-lived verification link** sent to
their inbox, they see and track all tickets belonging to that email in a single list. No
password — email ownership is verified. It uses the existing infrastructure (short-lived
token, Redis, BullMQ email queue, rate limit); it requires no new table. A new bilingual
notification template (`my_tickets_link`) and a public page (`MyTicketsPage`) are added.

### 3. Docker Hub images and one-command setup

> **⏸ Deferred (2026-11-14):** A cost/effort investigation was done — on public repos
> Actions are unlimited + a free arm64 runner is available, and public repos on the Hub are
> unlimited; i.e. free and roughly a half-day setup. Due to priority ordering it was
> **postponed** this cycle. With this item deferred, the **automatic changelog** (item 4)
> was deferred too: the image tags depended on the Hub publish; the CHANGELOG continues to
> be maintained by hand. Research summary: Docker Hub pull limits only affect the PULLING
> side (~10 pulls/hour/IP unauthenticated, April 2025); publishing to GHCR in parallel is
> an unlimited alternative.

Today `docker compose` **builds** the images locally. The goal: **publish** the backend and
frontend images to **Docker Hub** via CI and provide a compose file that can be
`docker pull`ed with a release tag (`:1.0.0`, `:latest`) and run without building — so the
system can be downloaded and installed without cloning the source.

- Multi-arch (amd64/arm64) image build + push with GitHub Actions on `main`/tag push.
- `docker-compose.hub.yml` using the published images (`image:` instead of build).
- Release tagging: `:MAJOR.MINOR.PATCH`, `:MAJOR.MINOR`, `:latest`.
- The v1.2 `backup` service image is published through the same flow.

### 4. Release tracking and automatic changelog

- SemVer git tags + GitHub Releases.
- **Automatic CHANGELOG** generation from Conventional Commits (instead of manual
  maintenance).
- Image tags in sync with releases. *(Deferred too, because Docker Hub was deferred.)*

### 5. S3-compatible storage (AWS S3 / MinIO)

Attachments and logos are written to local disk today (`UPLOAD_DIR`). The goal: put the
upload layer behind **S3-compatible object storage** (AWS S3, MinIO, R2) — for horizontal
scale, redundancy and persistence outside the container.

- Pluggable storage adapter behind `storage.service.ts` (local disk | S3).
- Selection via env (`STORAGE_DRIVER=local|s3`, `S3_ENDPOINT`, `S3_BUCKET`, keys).
- Download authorization stays in the backend (signed/proxied access); no directly public
  bucket.
- Relation to v1.2 backup: if the S3 driver is active, the uploads backup can be delegated
  to bucket versioning / replication; the database backup is still taken with the v1.2
  flow.

---

## Ongoing operations

- Besides taking backups, also run the restore drill periodically (automated with v1.2).
- Monitor the retention job (`db:retention:check`) and apply it in an approved maintenance
  window.
- For internet-facing installations, treat access control and `ENABLE_API_DOCS=false` as
  mandatory.

## Product preferences (deliberate)

- No permanent user accounts / passwords in the public portal; access is link-based.
- No separate component library is used; the UI is kept in-project with Tailwind.
- On-site support appointments are not assigned to staff; parallel appointments do not
  count as conflicts.
- Staff passwords are at least 12 characters.
- Destructive operations (retention apply, restore) are not scheduled automatically and are
  not triggered from the web UI.

## Contribution standard

Keep the same typed-contract, scope/RBAC and regression-test standard on new routes and
screens. For vulnerability reports see [SECURITY.md](../SECURITY.md), for the contribution
guide [CONTRIBUTING.md](../CONTRIBUTING.md).
