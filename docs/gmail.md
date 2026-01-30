# Gmail receipts integration (label-based)

## Overview
The scripts only fetch messages that have a specific Gmail label (default: `HisabKitab`).

Flow:
1) You label receipt emails in Gmail (or create filters to auto-label).
2) The fetcher reads ONLY labeled messages.
3) The parser classifies messages based on `~/HisabKitab/refs/email_merchants.json`.

## Setup
### 1) Create label
Create a Gmail label named `HisabKitab`.

### 2) OAuth
- Download OAuth Client JSON from Google Cloud (Desktop app)
- Save locally as: `~/HisabKitab/credentials.json`
- Generate a token (run on YOUR machine): see `docs/gmail_auth.sample.js`
- Copy the resulting token to: `~/HisabKitab/gmail_token.json`

## Scripts
- `node src/gmail/gmail_fetch.js --base-dir ~/HisabKitab --label HisabKitab --max 10`
- `node src/gmail/gmail_parse_orders.js --base-dir ~/HisabKitab --label HisabKitab --max 50`
- `node src/gmail/gmail_receipts_status.js --base-dir ~/HisabKitab --label HisabKitab --max 50`

## Merchant rules
Edit: `~/HisabKitab/refs/email_merchants.json`

Emails that do not match any enabled rule are classified as `UNKNOWN`.
