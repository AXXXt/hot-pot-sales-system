#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/weiduoxian
release=${1:?release required}
expected=${2:?archive sha256 required}
[[ "$release" =~ ^ai-[0-9]{8}-[0-9]+$ ]]
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
archive="/home/ubuntu/$release.tar.gz"
printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
backup="/opt/weiduoxian/.release-backups/$release"
if [[ "${3:-}" == --resume-prepared ]]; then
  test -s "$backup/.env"
  test -s "$backup/compose.yml"
  test -s "$backup/admin.tar.gz"
  test -s "$backup/backend-image.json"
else
  test ! -e "releases/$release"
  test ! -e "$backup"
  mkdir -p "releases/$release" "$backup"
  chmod 700 .release-backups "$backup"
  cp -p .env "$backup/.env"
  cp -p compose.yml "$backup/compose.yml"
  cp -p nginx/api.inc "$backup/api.inc"
  tar -czf "$backup/admin.tar.gz" sites/admin
  docker compose images backend --format json > "$backup/backend-image.json"
  tar --no-same-owner -xzf "$archive" -C "releases/$release"
fi
test -s "releases/$release/sites/admin/index.html"
test -s "releases/$release/ai-production.cjs"
test -s "releases/$release/admin-manifest.json"
test -s "releases/$release/release-test.jpg"
docker image inspect "weiduoxian-backend:$release" >/dev/null
rollback() {
  trap - ERR
  cp -p "$backup/compose.yml" compose.yml
  cp -p "$backup/api.inc" nginx/api.inc
  docker run --rm --user 0 --network none -v /opt/weiduoxian:/deployment -v "/opt/weiduoxian/releases/$release/ai-production.cjs:/app/ai-production.cjs:ro" "weiduoxian-backend:$release" node /app/ai-production.cjs restore-env "$release"
  tar -xzf "$backup/admin.tar.gz" -C /opt/weiduoxian
  docker compose up -d --no-deps --pull never --wait --wait-timeout 120 backend
  docker compose exec -T nginx nginx -t </dev/null
  docker compose exec -T nginx nginx -s reload </dev/null
  printf 'Release failed. Previous backend and admin restored. Additive AI migration retained. Backup: %s\n' "$backup" >&2
  exit 1
}
trap rollback ERR
docker run --rm --user 0 --network none -v /opt/weiduoxian:/deployment -v "/opt/weiduoxian/releases/$release/ai-production.cjs:/app/ai-production.cjs:ro" "weiduoxian-backend:$release" node /app/ai-production.cjs prepare "$release"
docker compose config --quiet
docker compose exec -T nginx nginx -t </dev/null
# Migrate only after the independent full backup has completed. Never run seed/reset here.
docker compose run -T --rm --no-deps --pull never backend node node_modules/prisma/build/index.js migrate deploy </dev/null
docker compose up -d --no-deps --pull never --wait --wait-timeout 120 backend
docker compose exec -T nginx nginx -t </dev/null
docker compose exec -T nginx nginx -s reload </dev/null
rsync -rp --delay-updates --chmod=D755,F644 --exclude=index.html "releases/$release/sites/admin/" sites/admin/
install -m 644 "releases/$release/sites/admin/index.html" "sites/admin/.index-$release"
mv -f "sites/admin/.index-$release" sites/admin/index.html
for domain in weiduoxian.cn app.weiduoxian.cn admin.weiduoxian.cn; do
  curl -fsS --max-time 15 --resolve "$domain:443:127.0.0.1" "https://$domain/health" >/dev/null
done
docker cp "releases/$release/ai-production.cjs" weiduoxian-backend-1:/app/ai-production.cjs
docker cp "releases/$release/admin-manifest.json" weiduoxian-backend-1:/app/ai-admin-manifest.json
docker cp "releases/$release/release-test.jpg" weiduoxian-backend-1:/app/ai-release-test.jpg
trap - ERR
printf 'RELEASE=%s\nROLLBACK_DIRECTORY=%s\n' "$release" "$backup"
