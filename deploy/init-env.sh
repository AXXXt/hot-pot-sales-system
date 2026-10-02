#!/usr/bin/env bash
set -euo pipefail
cd /opt/weiduoxian
if [ -e .env ]; then
  echo 'Existing .env preserved'
  exit 0
fi
umask 077
db_password=$(openssl rand -hex 24)
redis_password=$(openssl rand -hex 24)
minio_password=$(openssl rand -hex 24)
{
  printf 'RELEASE_TAG=20261002-1\nNGINX_CONFIG=http.conf\nNODE_ENV=production\nPORT=3000\n'
  printf 'MYSQL_ROOT_PASSWORD=%s\nMYSQL_PASSWORD=%s\n' "$(openssl rand -hex 32)" "$db_password"
  printf 'DATABASE_URL=mysql://weiduoxian:%s@mysql:3306/weiduoxian?connection_limit=5\n' "$db_password"
  printf 'REDIS_PASSWORD=%s\nREDIS_URL=redis://:%s@redis:6379\n' "$redis_password" "$redis_password"
  printf 'JWT_ACCESS_SECRET=%s\nJWT_REFRESH_SECRET=%s\n' "$(openssl rand -hex 48)" "$(openssl rand -hex 48)"
  printf 'CORS_ORIGIN=https://weiduoxian.cn,https://www.weiduoxian.cn,https://app.weiduoxian.cn,https://admin.weiduoxian.cn\n'
  printf 'MINIO_ENDPOINT=minio\nMINIO_PORT=9000\nMINIO_USE_SSL=false\nMINIO_ACCESS_KEY=weiduoxian-storage\nMINIO_SECRET_KEY=%s\n' "$minio_password"
  printf 'MINIO_BUCKET=b2b-miniapp\nMINIO_PUBLIC_URL=https://weiduoxian.cn\nMINIO_SIGNING_ENDPOINT=weiduoxian.cn\nMINIO_REGION=us-east-1\n'
  printf 'SMS_PROVIDER=disabled\n'
} > .env
echo 'Production secrets generated; .env is root-readable only'
