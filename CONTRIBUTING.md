# Contributing Guide

🇬🇧 **English** · [🇹🇷 Türkçe](CONTRIBUTING.tr.md)

Contributions are welcome. Before you start, read [docs/roadmap.md](docs/roadmap.md) —
known gaps and priorities live there.

---

## Getting started

```bash
git clone https://github.com/mahmutyum/ticket-system.git
cd ticket-system
cp .env.example .env         # fill in the values — see docs/installation.md
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
docker compose exec backend npx tsx prisma/seed.ts
```

Details and troubleshooting: [docs/installation.md](docs/installation.md).

For a technical overview of the codebase: [docs/architecture.md](docs/architecture.md).

---

## Before submitting a change

CI (`.github/workflows/ci.yml`) is **triggered manually** (GitHub → Actions → "Run workflow");
it does not run automatically on push/PR. So CI will not validate your change for you —
passing the following checks locally is mandatory:

```bash
# Backend
cd backend
npm run typecheck         # type-check the source
npm run typecheck:tests   # test files (separate tsconfig — main build rootDir:src)
npm run lint
npm test

# Frontend
cd ../frontend
npm run typecheck
npm run lint
npm run build
```

CI also applies migrations to a **real Postgres** and verifies the schema matches the
database — if you change the schema and forget to generate a migration, it gets caught there.

---

## Coding conventions

- **The backend is ESM.** Relative imports **must use the `.js` extension** — even though
  the source file is `.ts`: `import { foo } from './foo.js'`. If you forget, it blows up at
  runtime; `tsc` won't catch it.
- **All input is validated with Zod.**
- **API response shape:** `{ success: boolean, data?: T, error?: string }`.
- **Bilingual (TR/EN).** User-facing text is never hardcoded: the frontend uses
  `react-i18next` (`i18n/locales` + per-page `i18n/pages`), backend API messages use
  `i18n/messages/*` + `t(request, key)` (Accept-Language). TR is the original, EN the translation.
- Status/priority/role constants live in `backend/src/config/constants.ts` — no scattered
  string literals.
- Call `createAuditLog()` in admin/staff CRUD operations.
- Frontend: one component per file, data fetching through TanStack Query.
- Match the style of the surrounding code. ESLint + Prettier are configured
  (`npm run lint`, `npm run format` — in both backend and frontend).

---

## Database changes

If you changed the schema, generate a migration and **include it in the commit**:

```bash
docker compose exec backend npx prisma migrate dev --name a_descriptive_name
```

**Read** the generated SQL. If you opened a migration that drops a column or table,
call it out in the PR description.

> **Do not use `prisma db push`.** It bypasses migration history. The project deliberately
> moved to versioned migrations.

---

## Security-sensitive areas

If you touch these files, take extra care and justify it in the PR description:

| Area | Why |
|---|---|
| `plugins/auth.ts`, `utils/staff-scope.ts` | Auth and company scoping. Tested (`tests/utils/staff-scope`, `tests/routes/management-scope`) but the silent-regression risk is high — re-review the tests whenever they change. |
| `modules/tickets/public.routes.ts` | The unauthenticated surface. Internal notes must **never** leak through here. |
| `utils/crypto.ts`, `modules/credentials/` | The credential vault. Changing the encryption format makes existing records **unreadable**. |
| `modules/notes/` | The `isInternal` filter. |

If you found a security vulnerability, **do not open an issue** — follow the path in
[SECURITY.md](SECURITY.md).

For what may or may not enter the repository (secrets, real data, PII, production
screenshots) and the pre-commit checklist: [docs/public-repo.md](docs/public-repo.md).

---

## Commits and PRs

- Write descriptive commit messages. The `feat(scope): ...`, `fix(scope): ...` style is
  preferred. Turkish or English, both are fine.
- **No `Co-Authored-By` lines.**
- In the PR description: what changed, why, and how you tested it. Call out schema or
  behavior changes explicitly.
- Small, focused PRs move faster.

---

## Where to start

Relatively self-contained items from the [roadmap](docs/roadmap.md):

- **"Taleplerim" (My tickets) view** — a unified ticket list for the requester with email
  verification (the flow is described in the roadmap). A new public page + a short-lived
  verification flow.
- **Expand test coverage** — especially scope/RBAC and public-surface scenarios; existing
  examples live under `tests/routes/`.
- **Accessibility and UX** — extend the Playwright/axe scenarios.
