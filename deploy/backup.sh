#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/weiduoxian
mkdir -p /var/backups/weiduoxian
exec 9>/run/weiduoxian-backup.lock
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d /var/backups/weiduoxian/.pending.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --quick --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF weiduoxian' | gzip > "$work/database.sql.gz"
gzip -t "$work/database.sql.gz"
minio_path=$(docker volume inspect weiduoxian_minio_data --format '{{.Mountpoint}}')
test -d "$minio_path"
# Object keys are immutable; capture objects after the transactional database dump.
tar -czf "$work/objects.tar.gz" -C "$minio_path" .
tar -czf "$work/config.tar.gz" -C /opt/weiduoxian .env compose.yml nginx sites -C /etc letsencrypt
tar -czf "/var/backups/weiduoxian/$stamp.tar.gz.partial" -C "$work" .
mv "/var/backups/weiduoxian/$stamp.tar.gz.partial" "/var/backups/weiduoxian/$stamp.tar.gz"
find /var/backups/weiduoxian -maxdepth 1 -type f -name '????????T??????Z.tar.gz' -mtime +7 -delete
echo "Backup complete: $stamp"
