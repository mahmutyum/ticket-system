#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf '%s\n' "Kullanım: $0 <backup-dizini>" >&2
  exit 2
fi

source_dir="$1"
test -f "$source_dir/database.dump"
test -f "$source_dir/uploads.tar.gz"
test -f "$source_dir/SHA256SUMS"
source_abs="$(cd "$source_dir" && pwd)"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$source_abs" && sha256sum -c SHA256SUMS)
else
  (cd "$source_abs" && shasum -a 256 -c SHA256SUMS)
fi

docker compose exec -T postgres pg_restore --list >/dev/null < "$source_abs/database.dump"
docker compose run --rm --no-deps -v "$source_abs:/backup:ro" --entrypoint sh backend -c \
  'tar -tzf /backup/uploads.tar.gz >/dev/null'

printf '%s' "Mevcut veriler değiştirilecek ve backend geçici olarak duracak. Devam etmek için RESTORE yazın: "
read -r confirmation
test "$confirmation" = "RESTORE"

restart_backend() {
  docker compose up -d backend >/dev/null
}
trap restart_backend EXIT
trap 'exit 130' INT TERM

docker compose stop backend
docker compose exec -T postgres pg_restore -U "${DB_USER:-ticket}" -d "${DB_NAME:-ticketdb}" --clean --if-exists --exit-on-error < "$source_abs/database.dump"
docker compose run --rm --no-deps -v "$source_abs:/backup:ro" --entrypoint sh backend -c \
  'find /app/uploads -mindepth 1 -delete && tar -xzf /backup/uploads.tar.gz -C /app/uploads'

restart_backend
trap - EXIT INT TERM

printf '%s\n' "Restore tamamlandı. environment.snapshot değerlerini ayrıca doğrulayın."
