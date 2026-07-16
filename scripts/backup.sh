#!/bin/sh
set -eu

backup_dir="${BACKUP_DIR:-./backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_dir/$stamp"
mkdir -p "$target"
target_abs="$(cd "$target" && pwd)"

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

docker compose exec -T postgres pg_dump -U "${DB_USER:-ticket}" -d "${DB_NAME:-ticketdb}" -Fc > "$target/database.dump"
docker compose run --rm --no-deps -v "$target_abs:/backup" --entrypoint sh backend -c \
  'tar -czf /backup/uploads.tar.gz -C /app/uploads .'
cp .env "$target/environment.snapshot"
chmod 600 "$target/environment.snapshot"
(cd "$target" && checksum database.dump uploads.tar.gz environment.snapshot > SHA256SUMS)
chmod 600 "$target/SHA256SUMS"

printf '%s\n' "Backup hazır: $target"
printf '%s\n' "UYARI: environment.snapshot sır içerir; backup hedefini şifrele ve erişimini sınırla."
