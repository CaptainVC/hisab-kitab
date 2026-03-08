# Hisab Kitab Web (server)

## Env

Required:
- `HK_COOKIE_SECRET` (>=16 chars)

Optional:
- `HK_BASE_DIR` (defaults to `~/HisabKitab`)
- `HK_BIND_HOST` (defaults to tailscale0 IPv4; for local dev set `127.0.0.1`)
- `HK_PORT` (default `8787`)

## Set password

```bash
cd web/server
HK_COOKIE_SECRET='...' HK_BIND_HOST=127.0.0.1 HK_BASE_DIR=~/HisabKitab \
  HK_ADMIN_PASSWORD='your-password' \
  node dist/scripts/set_password.js
```

## Run

```bash
cd web/server
npm run build
HK_COOKIE_SECRET='...' HK_BIND_HOST=127.0.0.1 HK_BASE_DIR=~/HisabKitab node dist/index.js
```
