#!/usr/bin/env node
/* One-time migration:
 * - From legacy weekly workbooks: HK_YYYY-MM-WeekN.xlsx (Transactions sheet)
 * - To quarterly workbooks: HK_YYYY_QN.xlsx with monthly sheets (MMM-YYYY)
 *
 * Usage:
 *   node src/migrate/migrate_weekly_to_quarterly.js --base-dir ~/HisabKitab [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');
const { DateTime } = require('luxon');
const {
  IST,
  quarterWorkbookName,
  monthSheetName,
  ensureWorkbook,
  ensureSheetWithHeaders,
  readSheetRows,
  appendRowsToSheet,
} = require('../excel/workbook_store');

function expandHome(p) {
  if (!p) return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const has = (k) => args.includes(k);
  const get = (k) => {
    const i = args.indexOf(k);
    return i === -1 ? null : (args[i + 1] ?? null);
  };
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    dryRun: has('--dry-run'),
  };
}

function listWeeklyFiles(baseDir) {
  const re = /^HK_\d{4}-\d{2}-Week\d+(?:\.(ai|rebuild))?\.xlsx$/i;
  return fs.readdirSync(baseDir)
    .filter(f => re.test(f))
    .map(f => path.join(baseDir, f))
    .sort((a, b) => a.localeCompare(b));
}

function canonicalKey(row) {
  // Fallback de-dupe key when messageId missing.
  const date = String(row.date || '').trim();
  const amt = String(row.amount || '').trim();
  const merch = String(row.merchant_code || '').trim();
  const raw = String(row.raw_text || row.notes || '').trim().slice(0, 80);
  return `${date}|${amt}|${merch}|${raw}`;
}

function normalizeRow(r, headers) {
  const out = {};
  for (const h of headers) out[h] = r[h] ?? '';
  if (out.messageId === undefined) out.messageId = '';
  return out;
}

function main() {
  const { baseDir, dryRun } = parseArgs(process.argv);
  const weekly = listWeeklyFiles(baseDir);

  const headers = [
    'txn_id','group_id','date','type','amount','source','location','merchant_code','category','subcategory','tags',
    'beneficiary','reimb_status','counterparty','linked_txn_id','notes','raw_text','parse_status','parse_error',
    'messageId'
  ];

  const summary = {
    ok: true,
    baseDir,
    dryRun,
    weeklyFiles: weekly.length,
    migratedRows: 0,
    skippedDuplicates: 0,
    targetsTouched: new Set(),
    errors: []
  };

  // Cache existing keys per target workbook+sheet to avoid re-reading repeatedly.
  const existingCache = new Map();
  const cacheKey = (wbPath, sheet) => `${wbPath}::${sheet}`;

  for (const wk of weekly) {
    let rows = [];
    try {
      const wb = XLSX.readFile(wk);
      const ws = wb.Sheets['Transactions'] || wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    } catch (e) {
      summary.errors.push({ file: wk, error: String(e?.message || e) });
      continue;
    }

    for (const r of rows) {
      const dt = DateTime.fromISO(String(r.date || ''), { zone: IST });
      if (!dt.isValid) continue;

      const outWbName = quarterWorkbookName(dt);
      const sheet = monthSheetName(dt);
      const outPath = path.join(baseDir, outWbName);
      const ck = cacheKey(outPath, sheet);

      if (!existingCache.has(ck)) {
        const outWb = ensureWorkbook(outPath);
        ensureSheetWithHeaders(outWb, sheet, headers);
        const existing = readSheetRows(outWb, sheet);
        const keys = new Set();
        for (const ex of existing) {
          const mid = String(ex.messageId || '').trim();
          if (mid) keys.add(`mid:${mid}`);
          keys.add(`k:${canonicalKey(ex)}`);
        }
        existingCache.set(ck, { wb: outWb, keys });
      }

      const { wb: outWb, keys } = existingCache.get(ck);

      const mid = String(r.messageId || '').trim();
      const key = canonicalKey(r);
      const dupe = (mid && keys.has(`mid:${mid}`)) || keys.has(`k:${key}`);
      if (dupe) {
        summary.skippedDuplicates++;
        continue;
      }

      // mark as seen
      if (mid) keys.add(`mid:${mid}`);
      keys.add(`k:${key}`);

      const nr = normalizeRow(r, headers);
      appendRowsToSheet(outWb, sheet, [nr], headers);
      summary.migratedRows++;
      summary.targetsTouched.add(outWbName);
    }
  }

  if (!dryRun) {
    // Write out each touched workbook once.
    for (const [ck, { wb }] of existingCache.entries()) {
      const wbPath = ck.split('::')[0];
      XLSX.writeFile(wb, wbPath);
    }
  }

  summary.targetsTouched = Array.from(summary.targetsTouched);
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main();
