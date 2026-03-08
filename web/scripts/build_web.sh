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
