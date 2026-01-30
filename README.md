# Hisab Kitab

Personal expense tracker + insights dashboard.

- Input: Telegram-style `/hisab` messages (plain text)
- Storage: weekly Excel workbooks (INR)
- Output: interactive dashboard + curated exports
- Optional: Gmail receipts ingestion (label-based)

## What this repo is
This repo contains the local scripts that:
1) parse your `/hisab` text into structured transactions
2) apply categorization rules (merchant defaults + heuristics)
3) generate reports (Excel export + interactive HTML dashboard)
4) (optional) fetch and parse labeled Gmail receipts

## Local directory layout (expected)

Configuration is stored in a separate private repo (recommended).
Clone it into `~/HisabKitab/refs`.

The scripts assume a local data folder (not committed):

```
~/HisabKitab/
  refs/                     # your editable reference data (merchants/categories/etc.)
  HK_YYYY-MM-WeekN.xlsx     # weekly workbooks
  hisab_dashboard.html
  hisab_data.json
  orders_unmatched.json
  credentials.json          # Gmail OAuth client (DO NOT COMMIT)
  gmail_token.json          # Gmail token (DO NOT COMMIT)
```

## Install
```bash
npm install
```

## CLI usage
### Import
```bash
node src/cli/hk.js import --text "/hisab\nDay (30/1/26)\n100/- Poha (mk)" --base-dir ~/HisabKitab
```

### Normalize + auto-categorize
```bash
node src/core/normalize.js --file ~/HisabKitab/HK_2026-01-Week5.xlsx --base-dir ~/HisabKitab
node src/core/categorize.js --file ~/HisabKitab/HK_2026-01-Week5.xlsx --base-dir ~/HisabKitab
```

### Build dashboard (aggregated)
```bash
node src/dashboard/build_dashboard.js ~/HisabKitab hisab_data.json hisab_dashboard.html
```

### Export a clean Excel (light theme)
```bash
node src/excel/export_pretty_excel.js --in ~/HisabKitab/HK_2026-01-Week5.xlsx --out ~/HisabKitab/HK_2026-01-Week5.pretty.xlsx --base-dir ~/HisabKitab
```

## Gmail receipts (optional)
This project only reads emails that you explicitly label `HisabKitab`.

- Configure supported receipt senders in: `~/HisabKitab/refs/email_merchants.json`

See: `docs/gmail.md`

## Security
- Never commit `credentials.json` or `gmail_token.json`
- Keep `~/HisabKitab` private to your user (chmod 700) and secret files chmod 600

## License
MIT

<!-- ci check: 2026-01-30T15:43:52Z -->
<!-- ci recheck: 2026-01-30T15:48:46Z -->
