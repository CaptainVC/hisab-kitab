#!/usr/bin/env node
/*
Replace quarterly workbook(s) with rows from a cleansed manual Hisab JSON file.

- Reads: <baseDir>/cache/hisab_manual_YYYY_QN.json (schemaVersion 1)
- Writes: HK_YYYY_QN.xlsx (recreated) by deleting existing file after backup
- Uses storeAppend to create sheets and append rows.

This is a DESTRUCTIVE operation on the target workbook (replace), but it creates a backup first.

Usage:
  node src/scripts/import_hisab_manual_to_excel.js --base-dir /home/molt/HisabKitab --in /home/molt/HisabKitab/cache/hisab_manual_2025_Q2.json --replace --include-transfers
*/

const fs = require('node:fs');
const path = require('node:path');

function getArg(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(fp) {
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function nowStamp() {
  const d = new Date();
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    'Z'
  );
}

function defaultLocation(baseDir) {
  try {
    const locs = readJson(path.join(baseDir, 'refs', 'locations.json'));
    for (const [code, v] of Object.entries(locs || {})) {
      if (v && v.default) return code;
    }
  } catch {}
  return 'BENGALURU';
}

function quarterFromDateIso(dateIso) {
  const m = Number(String(dateIso).slice(5, 7));
  if (!m) return null;
  return Math.floor((m - 1) / 3) + 1;
}

function workbookNameForDate(dateIso) {
  const y = Number(String(dateIso).slice(0, 4));
  const q = quarterFromDateIso(dateIso);
  if (!y || !q) return null;
  return `HK_${y}_Q${q}.xlsx`;
}

function rowsToWorkbookRows(baseDir, manualRows, opts) {
  const loc = defaultLocation(baseDir);
  const out = [];
  let i = 0;

  for (const r of manualRows) {
    if (!r || r.exclude) continue;
    const type = String(r.type || 'EXPENSE').toUpperCase();
    if (type === 'TRANSFER' && !opts.includeTransfers) continue;
    if (type !== 'EXPENSE' && type !== 'TRANSFER' && type !== 'INCOME') continue;

    const date = String(r.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const amount = Number(r.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) continue;

    const merchant_code = String(r.merchant_code || '').trim() || 'UNKNOWN';
    const category = String(r.category || '').trim();
    const subcategory = String(r.subcategory || '').trim();
    const source = String(r.source || '').trim() || 'cash';

    const tags = Array.isArray(r.tags) ? r.tags : [];
    const tagsCsv = tags.map(String).map(s => s.trim()).filter(Boolean).join(',');

    const notes = String(r.notes || '').trim();
    const raw_text = String(r.raw_text || '').trim();

    const txn_id = `hisab_${date}_${String(i).padStart(4, '0')}`;
    const group_id = opts.groupId;

    out.push({
      txn_id,
      group_id,
      date,
      type,
      amount,
      source,
      location: loc,
      merchant_code,
      category,
      subcategory,
      tags: tagsCsv,
      beneficiary: '',
      reimb_status: '',
      counterparty: '',
      linked_txn_id: '',
      notes,
      raw_text,
      parse_status: 'manual_hisab',
      parse_error: '',
      messageId: ''
    });

    i++;
  }

  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const baseDir = String(getArg(args, '--base-dir') || '');
  const inFp = String(getArg(args, '--in') || '');
  const replace = args.includes('--replace');
  const includeTransfers = args.includes('--include-transfers');

  if (!baseDir) throw new Error('missing --base-dir');
  if (!inFp) throw new Error('missing --in');
  if (!replace) throw new Error('Refusing to run without --replace');

  const doc = readJson(inFp);
  const manualRows = Array.isArray(doc.rows) ? doc.rows : [];
  const period = String(doc.period || 'manual');

  const wbName = manualRows.length ? workbookNameForDate(manualRows[0].date) : null;
  if (!wbName) throw new Error('could_not_determine_workbook');
  const wbFp = path.join(baseDir, wbName);

  // Backup existing workbook if present
  const backupDir = path.join(baseDir, 'backups', `manual_import_${period}_${nowStamp()}`);
  ensureDir(backupDir);
  if (fs.existsSync(wbFp)) {
    fs.copyFileSync(wbFp, path.join(backupDir, path.basename(wbFp)));
  }

  // Replace: delete workbook
  if (fs.existsSync(wbFp)) fs.unlinkSync(wbFp);

  const headers = [
    'txn_id','group_id','date','type','amount','source','location','merchant_code','category','subcategory','tags',
    'beneficiary','reimb_status','counterparty','linked_txn_id','notes','raw_text','parse_status','parse_error',
    'messageId'
  ];

  const groupId = `manual_${period}`;
  const rows = rowsToWorkbookRows(baseDir, manualRows, { includeTransfers, groupId });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { storeAppend } = require(path.join(process.cwd(), 'src', 'excel', 'workbook_store'));
  const outputs = storeAppend({ baseDir, headers, rows });

  process.stdout.write(JSON.stringify({ ok: true, period, workbook: wbFp, backupDir, imported: rows.length, outputs }, null, 2));
  process.stdout.write('\n');
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err?.message || err) + '\n');
  process.exit(1);
});
