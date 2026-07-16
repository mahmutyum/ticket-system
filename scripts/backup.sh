#!/bin/sh
set -eu

backup_dir="${BACKUP_DIR:-./backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_dir/$stamp"
mkdir -p "$target"

docker compose exec -T postgres pg_dump -U "${DB_USER:-ticket}" -d "${DB_NAME:-ticketdb}" -Fc > "$target/database.dump"
docker run --rm -v ticket-system_uploads:/source:ro -v "$(cd "$target" && pwd):/backup" alpine tar -czf /backup/uploads.tar.gz -C /source .
cp .env "$target/environment.snapshot"
chmod 600 "$target/environment.snapshot"

printf '%s\n' "Backup hazır: $target"
printf '%s\n' "UYARI: environment.snapshot sır içerir; backup hedefini şifrele ve erişimini sınırla."
