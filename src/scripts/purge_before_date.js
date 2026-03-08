#!/usr/bin/env node
/* Purge all HK rows older than a cutoff date (YYYY-MM-DD) from quarterly workbooks.
 * Creates per-file backups and rewrites only monthly sheets.
 * Usage: node purge_before_date.js --base-dir /home/molt/HisabKitab --before 2025-04-01
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function getArg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

function isMonthlySheetName(name) {
  return /^[A-Z][a-z]{2}-\d{4}$/.test(String(name || ''));
}

function listWorkbooks(baseDir) {
  return fs.readdirSync(baseDir)
    .filter(f => /^HK_\d{4}_Q[1-4]\.xlsx$/i.test(f))
    .map(f => path.join(baseDir, f));
}

function main() {
  const baseDir = getArg('--base-dir');
  const before = String(getArg('--before') || '').trim();
  if (!baseDir) throw new Error('missing --base-dir');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new Error('bad --before (expected YYYY-MM-DD)');

  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('Z', 'Z');
  const files = listWorkbooks(baseDir);

  let removed = 0;
  let kept = 0;
  let touchedFiles = 0;
  const backups = [];

  for (const fp of files) {
    const wb = XLSX.readFile(fp);
    const monthSheets = wb.SheetNames.filter(isMonthlySheetName);
    const targetSheets = monthSheets.length ? monthSheets : wb.SheetNames;

    let changedFile = false;

    for (const sn of targetSheets) {
      const ws = wb.Sheets[sn];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) continue;

      const out = [];
      let changedSheet = false;

      for (const r of rows) {
        const d = String(r.date || '').trim();
        if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < before) {
          removed++;
          changedSheet = true;
          continue;
        }
        out.push(r);
        kept++;
      }

      if (changedSheet) {
        const headers = Object.keys(rows[0] || {});
        wb.Sheets[sn] = XLSX.utils.json_to_sheet(out, { header: headers });
        changedFile = true;
      }
    }

    if (changedFile) {
      const bak = fp + `.bak.purge_before_${before}.${stamp}`;
      if (!fs.existsSync(bak)) fs.copyFileSync(fp, bak);
      XLSX.writeFile(wb, fp);
      touchedFiles++;
      backups.push({ workbook: fp, backup: bak });
    }
  }

  process.stdout.write(JSON.stringify({ ok: true, before, touchedFiles, removedRows: removed, keptRows: kept, backups }, null, 2));
  process.stdout.write('\n');
}

main();
