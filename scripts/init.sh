#!/bin/sh
# First-time setup: generate secrets, build, start, create the administrator.
set -e
cd "$(dirname "$0")/.."
mkdir -p secrets && chmod 700 secrets
[ -f secrets/db_password ] || head -c 32 /dev/urandom | base64 | tr -d '/+=\n' > secrets/db_password
[ -f secrets/master_key ] || head -c 32 /dev/urandom | base64 | tr -d '\n' > secrets/master_key
# The directory keeps other host users out; the files must be readable inside the containers (api runs as uid 1000, db as postgres).
chmod 644 secrets/*
[ -f .env ] || cp .env.example .env
V="${BATON_VERSION:-$(grep ^BATON_VERSION= .env | cut -d= -f2-)}"
if [ -n "$V" ] && docker image inspect "baton-api:$V" >/dev/null 2>&1; then
  echo "Using the loaded release images ($V)."   # from a release tarball: nothing is built on the server
  docker compose up -d --no-build
else
  docker compose build
  docker compose up -d
fi
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(grep ^ADMIN_PASSWORD= .env | cut -d= -f2-)}"
if [ -z "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '/+=\n')"
  GENERATED=1
fi
echo "Creating the administrator…"
docker compose exec -T -e ADMIN_PASSWORD="$ADMIN_PASSWORD" api node dist/seed.js
if [ -n "$GENERATED" ]; then
  echo
  echo "Administrator: ${ADMIN_EMAIL:-$(grep ^ADMIN_EMAIL= .env | cut -d= -f2-)}"
  echo "Password (shown once, not stored): $ADMIN_PASSWORD"
  echo "Sign in, enrol two-factor, then change it under Account."
fi
echo
echo "Pelo CRM is up. BACK UP secrets/master_key NOW — without it, attachments cannot be decrypted."
