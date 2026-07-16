#!/bin/sh
set -eu

env_file="${1:-.env}"
test -f "$env_file" || { echo "Env dosyası bulunamadı: $env_file" >&2; exit 1; }
fail=0

value() {
  sed -n "s/^$1=//p" "$env_file" | tail -n 1
}

required='APP_URL DB_PASSWORD DATABASE_URL REDIS_PASSWORD REDIS_URL JWT_SECRET JWT_REFRESH_SECRET CREDENTIALS_ENC_KEY'
for key in $required; do
  current="$(value "$key")"
  if [ -z "$current" ]; then
    echo "Eksik zorunlu değer: $key" >&2
    fail=1
  fi
  case "$current" in *changeme*) echo "Placeholder değiştirilmemiş: $key" >&2; fail=1 ;; esac
done

test "$(value NODE_ENV)" = "production" || { echo "NODE_ENV=production olmalı" >&2; fail=1; }

jwt="$(value JWT_SECRET)"
refresh="$(value JWT_REFRESH_SECRET)"
test "${#jwt}" -ge 32 || { echo "JWT_SECRET en az 32 karakter olmalı" >&2; fail=1; }
test "${#refresh}" -ge 32 || { echo "JWT_REFRESH_SECRET en az 32 karakter olmalı" >&2; fail=1; }
test "$jwt" != "$refresh" || { echo "JWT anahtarları birbirinden farklı olmalı" >&2; fail=1; }

enc_key="$(value CREDENTIALS_ENC_KEY)"
if ! printf '%s' "$enc_key" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  echo "CREDENTIALS_ENC_KEY tam 64 hex karakter olmalı" >&2
  fail=1
fi

case "$(value APP_URL)" in
  https://*) ;;
  *) echo "Production APP_URL https:// ile başlamalı" >&2; fail=1 ;;
esac

if [ "$(value ENABLE_API_DOCS)" != "false" ]; then
  echo "UYARI: ENABLE_API_DOCS=false değil; internete açık kurulumda endpoint listesi yayınlanır." >&2
fi

test "$fail" -eq 0 || exit 1
echo "Production env kontrolü başarılı."
