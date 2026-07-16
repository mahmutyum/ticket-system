#!/usr/bin/env sh
set -eu

fail=0

for path in $(git ls-files); do
  case "$path" in
    .env|.env.*|*.pem|*.key|*.crt|*.cer|*.p12|*.pfx|*.jks|*.keystore|*.mobileprovision|\
    *.dump|*.backup|*.bak|*.sqlite|*.sqlite3|*.db|*.log|*.tar|*.tar.gz|*.tgz|*.zip|*.7z|\
    *kubeconfig*|*service-account*.json)
      if [ "$path" != ".env.example" ]; then
        echo "Yasaklı dosya türü takip ediliyor: $path" >&2
        fail=1
      fi
      ;;
    uploads/*)
      if [ "$path" != "uploads/.gitkeep" ]; then
        echo "Kullanıcı yüklemesi takip ediliyor: $path" >&2
        fail=1
      fi
      ;;
  esac
done

if git grep -I -E -n -- \
  '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}' \
  ':!scripts/check-public-repo.sh'
then
  echo "Olası secret kalıbı bulundu." >&2
  fail=1
fi

if git ls-files | grep -E '(^|/)(secrets?|private|backups?|logs?|test-results|playwright-report|\.agents?|\.codex|\.claude)(/|$)' >/dev/null; then
  echo "Yerel/özel içerik dizini takip ediliyor." >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "Public repo temel kontrolü başarılı."
