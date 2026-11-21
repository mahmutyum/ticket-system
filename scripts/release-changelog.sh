#!/bin/sh
# git-cliff ile [Unreleased] birikmiş commit'leri yeni sürüm bölümü olarak
# CHANGELOG.md'nin başlığından hemen sonra ekler. Elle yazılmış eski bölümler
# korunur. Üretilen bölüm gözden geçirilir ve gerekirse elle cilalanır
# (Upgrade notes gibi anlatı blokları için).
#
# Kullanım:
#   ./scripts/release-changelog.sh v1.3.2
#
# git-cliff kurulumu: npm i -g git-cliff  (veya cargo install git-cliff)
set -eu

TAG="${1:?Kullanım: release-changelog.sh vX.Y.Z}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

command -v git-cliff >/dev/null 2>&1 || {
  echo "git-cliff bulunamadı — kurulum: npm i -g git-cliff" >&2
  exit 1
}

cd "$REPO_ROOT"
git cliff --unreleased --tag "$TAG" --prepend CHANGELOG.md
echo "CHANGELOG.md güncellendi — bölümü gözden geçir, gerekirse elle cila yap."
