#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf '%s\n' "Kullanım: $0 <backup-dizini>" >&2
  exit 2
fi

source_dir="$1"
test -f "$source_dir/database.dump"
test -f "$source_dir/uploads.tar.gz"

printf '%s' "Mevcut veriler değiştirilecek. Devam etmek için RESTORE yazın: "
read -r confirmation
test "$confirmation" = "RESTORE"

docker compose exec -T postgres pg_restore -U "${DB_USER:-ticket}" -d "${DB_NAME:-ticketdb}" --clean --if-exists < "$source_dir/database.dump"
docker run --rm -v ticket-system_uploads:/target -v "$(cd "$source_dir" && pwd):/backup:ro" alpine sh -c 'find /target -mindepth 1 -delete && tar -xzf /backup/uploads.tar.gz -C /target'

printf '%s\n' "Restore tamamlandı. environment.snapshot değerlerini ayrıca doğrulayın."
