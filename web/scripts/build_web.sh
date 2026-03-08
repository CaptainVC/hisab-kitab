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

echo "[hisab-kitab] build complete"

if command -v systemctl >/dev/null 2>&1; then
  echo "[hisab-kitab] restarting systemd service (user)"
  systemctl --user daemon-reload || true
  systemctl --user restart hisab-kitab-web.service || true
  systemctl --user status hisab-kitab-web.service --no-pager | sed -n '1,16p' || true
fi
