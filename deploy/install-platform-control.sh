#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/weiduoxian
release=${1:?release required}
expected=${2:?archive sha256 required}
mode=${3:-bootstrap}
[[ "$release" =~ ^ai-[0-9]{8}-[0-9]+$ ]]
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
[[ "$mode" == bootstrap || "$mode" == stage ]]
archive="/home/ubuntu/$release.tar.gz"
printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
test ! -e "releases/$release"
docker image inspect "weiduoxian-backend:$release" >/dev/null
mkdir "releases/$release"
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "releases/$release"
python3 "releases/$release/install-platform-control.py" "$release" "$mode"
