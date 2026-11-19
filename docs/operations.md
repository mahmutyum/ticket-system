# Operations guide

🇬🇧 **English** · [🇹🇷 Türkçe](operations.tr.md)

## Backup and restore

PostgreSQL, the `uploads` volume and the `CREDENTIALS_ENC_KEY` in `.env` must be protected
together. Without the key, the credential vault cannot be restored.

```bash
BACKUP_DIR=/guvenli/hedef ./scripts/backup.sh
./scripts/restore.sh /guvenli/hedef/20260716T120000Z
```

Encrypt the backup target at the disk level, expose it only to operators, and keep a second
copy on a different machine/region. The recommended starting point is daily backups, 30-day
retention and a monthly restore drill in an isolated environment.

Every backup includes a `SHA256SUMS` integrity manifest. Before the restore starts, the
manifest, the PostgreSQL dump catalog and the uploads archive are verified; if verification
fails, the current data is left untouched. During the restore the backend is stopped and
restarted even if the operation fails. `environment.snapshot` contains secrets and is never
automatically written over the active `.env`; the operator must compare the keys manually.

## Automatic backups (v1.2)

The `backup` service (optional compose profile) schedules backups, uploads them to remote
targets and runs restore drills. The manual script flow (`backup.sh`/`restore.sh`) is kept
in the same format and is always a valid recovery path.

```bash
docker compose --profile backup up -d
```

- **Targets** are defined from the panel (`/staff/backups`, admin): target type (local
  disk, S3-compatible, Google Drive, FTPS, SFTP, WebDAV, SMB), rclone config INI (stored
  encrypted, never returned by the API), per-target GFS retention counts.
- **Scheduling and retention defaults** come from the `BACKUP_*` environment variables
  (see [installation](installation.md)); changes made from the panel are stored in the
  database and take precedence.
- **Encryption:** if a remote target exists, `BACKUP_ENCRYPTION_RECIPIENT` (an age public
  key) is MANDATORY — because `environment.snapshot` contains secrets, an unencrypted
  remote copy is rejected. The decryption private key is not kept on the system; restores
  are done with the operator's key.
- From the **"Zamanlanmış Görevler"** (Scheduled jobs) page, backups, restore drills and
  all periodic jobs can be triggered/paused manually; the run history is recorded.
- **Restore is still CLI-only** (`scripts/restore.sh`) — a destructive operation is never
  triggered from the web.

## Data retention

The retention command only produces a report by default:

```bash
docker compose exec backend npm run db:retention:check
docker compose exec backend npm run db:retention:apply
```

`RETENTION_CLOSED_TICKET_DAYS` defaults to 365 days and cannot be smaller than 30. Take a
backup before deleting. On the first run, do not run `apply` without confirming the file
count and byte total in the `check` output.

For automatic reporting, run only check mode daily via a host cron/systemd timer; `apply`
must not be scheduled without human approval:

```cron
15 3 * * * cd /opt/ticket-system && docker compose exec -T backend npm run db:retention:check >> /var/log/ticket-retention.log 2>&1
```

For deletion, run `db:retention:apply` in a maintenance window after a fresh backup. The
output is JSON and can be monitored by a central log/alerting system.

## Metrics (Prometheus)

If `METRICS_TOKEN` is defined, the backend exposes the `/metrics` endpoint with a Bearer
token (when it is empty there is no endpoint). Connect Prometheus to the backend **from
inside the Docker network**:

```yaml
scrape_configs:
  - job_name: ticket-system
    metrics_path: /metrics
    authorization: { type: Bearer, credentials: "<METRICS_TOKEN>" }
    static_configs: [{ targets: ["backend:4000"] }]
```

| Metric | Meaning |
|---|---|
| `ticket_http_request_duration_seconds` | HTTP duration histogram (`method`, `route` template, `status`) |
| `ticket_http_errors_total` | 5xx responses |
| `ticket_queue_jobs{queue,state}` | BullMQ jobs: email, sms, sla-check, mail-fetch, webhook × waiting/active/delayed/failed |
| `ticket_notifications_failed{type}` | Permanently failed email/SMS |
| `ticket_sla_breaches_open{kind}` | Unresolved tickets with a breached SLA |
| `ticket_open_tickets` | Open ticket count |
| `ticket_webhook_deliveries_failed` | Failed webhook deliveries in the last 24 hours |
| `ticket_mailbox_errors` | Inbound mailboxes that errored on the last fetch |
| `ticket_sse_connections{type}` | Open SSE connections |
| `ticket_process_*`, `ticket_nodejs_*` | Process and Node.js defaults |

Sample alert rules:

```yaml
groups:
  - name: ticket-system
    rules:
      - alert: TicketBackendDown
        expr: up{job="ticket-system"} == 0
        for: 2m
      - alert: TicketHighErrorRate
        expr: sum(rate(ticket_http_errors_total[5m])) / sum(rate(ticket_http_request_duration_seconds_count[5m])) > 0.05
        for: 10m
      - alert: TicketQueueBacklog
        expr: ticket_queue_jobs{state="waiting"} > 100
        for: 15m
      - alert: TicketQueueFailures
        expr: increase(ticket_queue_jobs{state="failed"}[1h]) > 10
      - alert: TicketNotificationsFailing
        expr: increase(ticket_notifications_failed[1h]) > 5
      - alert: TicketMailboxError
        expr: ticket_mailbox_errors > 0
        for: 15m
      - alert: TicketSlaBreaches
        expr: sum(ticket_sla_breaches_open) > 10
        for: 30m
```

## Health and shutdown

- `/health/live`: whether the Node.js process is responding.
- `/health/ready`: whether PostgreSQL and Redis are accepting requests.
- `SIGTERM`/`SIGINT`: HTTP, worker, queue, Redis and Prisma connections are shut down in a
  controlled way within at most 30 seconds.

Alert starting points: readiness failing for 2 minutes, disk usage at 80 percent, last
successful backup older than 26 hours, and an unusual increase in the failed notification
count. The "backup older than 26 hours" alert has been monitored automatically via the
`ticket_backup_last_success_timestamp` metric since v1.2 (if no backup was ever taken the
value is 0 and the alert still fires).

## Pre-deploy production check

```bash
./scripts/check-production-env.sh .env
docker compose config --quiet
```

The check rejects missing/`changeme_*` secrets, development mode, identical or short JWT
keys, a wrong vault key and a non-HTTPS `APP_URL` value. It additionally warns if the API
documentation is left open.
