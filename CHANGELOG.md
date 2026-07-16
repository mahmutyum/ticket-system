# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Planned work is tracked in [docs/yol-haritasi.md](docs/yol-haritasi.md)._

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
