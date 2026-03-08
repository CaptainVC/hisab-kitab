#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[hisab-kitab] building web client..."
cd "$ROOT_DIR/web/client"
npm ci
npm run build

echo "[hisab-kitab] building web server..."
cd "$ROOT_DIR/web/server"
npm ci
npm run build

# Derive app version from git
cd "$ROOT_DIR"
APP_VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"

# Patch env file (if present)
ENV_FILE="$HOME/HisabKitab/web/web.env"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^HK_APP_VERSION=' "$ENV_FILE"; then
    sed -i "s/^HK_APP_VERSION=.*/HK_APP_VERSION=$APP_VERSION/" "$ENV_FILE"
  else
    echo "HK_APP_VERSION=$APP_VERSION" >> "$ENV_FILE"
  fi
fi

echo "[hisab-kitab] build complete"

if command -v systemctl >/dev/null 2>&1; then
  echo "[hisab-kitab] restarting systemd service (user)"
  systemctl --user daemon-reload || true
  systemctl --user restart hisab-kitab-web.service || true
  # small grace period so health checks don't race the restart
  sleep 1
  systemctl --user status hisab-kitab-web.service --no-pager | sed -n '1,16p' || true
fi
