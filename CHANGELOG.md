# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Planned work is tracked in [docs/yol-haritasi.md](docs/yol-haritasi.md)._

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
- Live `sla_alert` panel notifications; SLA events in the ticket timeline; paused-time
  metrics in the SLA report.

### Fixed
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

[Unreleased]: https://github.com/mahmutyum/ticket-system/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mahmutyum/ticket-system/releases/tag/v1.0.0
