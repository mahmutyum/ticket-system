#!/bin/sh
# README rozetlerini tek kaynaktan günceller — release sonrası çalıştırın:
#
#   scripts/update-readme-badges.sh [test-sayısı]
#
# Sürüm her zaman backend/package.json'dan okunur. Test sayısı argüman olarak
# verilmezse backend vitest koşusu çıktısından yakalanır (yavaş ama kesin).
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$root/backend/package.json').version")"

tests="${1:-}"
if [ -z "$tests" ]; then
  # Vitest özet satırı: "Tests  408 passed (408)" — sayıyı oradan al.
  summary="$(cd "$root/backend" && npm test 2>&1 | grep -E '^ *Tests +[0-9]+ passed' | tail -1 || true)"
  if [ -z "$summary" ]; then
    echo "HATA: test sayısı çıktıda bulunamadı; argüman olarak verin." >&2
    exit 1
  fi
  tests="$(printf '%s' "$summary" | grep -oE '[0-9]+' | head -1)"
fi

for f in "$root/README.md" "$root/README.en.md"; do
  sed -i.bak \
    -e "s|badge/version-[0-9][0-9.]*-blue|badge/version-$version-blue|" \
    -e "s|badge/tests-[0-9][0-9]*%20passing|badge/tests-$tests%20passing|" \
    "$f"
  rm -f "$f.bak"
done

echo "Rozetler güncellendi: version=$version tests=$tests"
