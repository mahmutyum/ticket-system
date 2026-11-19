# Public repository security

🇬🇧 **English** · [🇹🇷 Türkçe](public-repo.tr.md)

This repository publishes the source code, migrations, example configuration and
user/operations documentation. It contains no data or credentials belonging to a running
installation.

## What belongs in the repository

- Application source code and tests
- Prisma schema and reproducible migration SQL
- Lock files such as `package-lock.json`
- `.env.example` with no real values
- Docker/Nginx configuration templates
- Installation, operations, security and contribution docs
- A development seed that generates synthetic data only

## What must never be in the repository

- `.env` files or real secrets/tokens/API keys
- Private keys, certificate bundles or keystores
- Database dumps, backups, SQLite files
- User uploads, logs, crash dumps and support records
- Real customer/company/staff names, emails, phone numbers, domains or IP addresses
- Production screenshots and real ticket content
- IDE, operating system, AI-agent working/instruction files
- Scratch plans, chat transcripts and internal progress notes

`.gitignore` blocks the common extensions of these classes; however, ignore is not a
security boundary. `git add -f` or files that were once tracked can still end up
committed.

## Pre-commit check

```bash
./scripts/check-public-repo.sh
git diff --cached
```

GitHub Actions automatic triggers are disabled by project preference. When the `CI`
workflow is run manually from the Actions tab, the `Public repo — secret ve veri dosyası
kontrolü` job repeats the same audit on a clean clone. This check rejects private keys,
common provider tokens, certificates/keystores, archives/backups, databases and local
agent files.

If available, also scan the entire history with Gitleaks or an equivalent secret scanner:

```bash
gitleaks git --redact
```

Even if the scanner comes back clean, the diff must be reviewed by a human eye. Synthetic
examples should use `company.com`, RFC 5737 documentation IPs and values explicitly
prefixed with `changeme_`.

Migration SQL files are a reproducible schema history and stay in the repository;
`.sql` exports/dumps taken from production must not be placed in the migrations folder.

## If a secret was committed

1. Revoke or rotate the secret immediately on the provider side.
2. Remove it from the current branch and audit the systems where it was used.
3. If necessary, purge it from the entire history with `git filter-repo`.
4. Coordinate with contributors before force-pushing; all clones must be freshly
   re-cloned.

Deleting from history alone is not enough: copies can remain in forks, clones, caches and
logs. That is why the first and mandatory response is always key rotation.

## Git author information

The commit name and email are part of the Git object and visible in a public repository.
Contributors who do not want to publish a personal email should configure the GitHub
`noreply` address before committing. Addresses in old commits can only be changed by
rewriting history.
