# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Instead, open a private
[GitHub Security Advisory](https://github.com/mahmutyum/ticket-system/security/advisories/new)
or contact the repository owner directly. We aim to acknowledge reports within a few days.

If a credential or personal data was committed by mistake, do **not** paste the value into
an issue. Revoke/rotate it first, then report privately so history can be cleaned.

## Supported versions

This project is developed on the `main` branch; security fixes land there. Pin to a commit
and update deliberately.

## Deployment note

This system is designed to run **behind a VPN / on an internal network**. The public
request portal is intentionally passwordless — access is via unguessable token links — so
**do not expose it directly to the internet** without your own access-control layer (VPN,
IP allowlist, or an authenticating reverse proxy). Deployment and hardening guidance is in
[docs/kurulum.md](docs/kurulum.md).
