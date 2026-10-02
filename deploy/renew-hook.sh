#!/usr/bin/env bash
set -euo pipefail
cd /opt/weiduoxian
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload
