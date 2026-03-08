#!/usr/bin/env node
/* Purge mail-ingested rows from HK excel workbooks.
 * - Removes rows that were imported from mail (messageId present OR tags contains from_mail OR parse_status starts with mail_ingest)
 * - Restores rows marked superseded_by_mail by removing the superseded tag and clearing parse_status.
 * Usage: node purge_mail_ingest.js --base-dir /home/molt/HisabKitab
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

function hasTag(tagsCsv, t) {
  const parts = String(tagsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.includes(t);
}

function removeTag(tagsCsv, t) {
  const parts = String(tagsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
  const next = parts.filter(x => x !== t);
  return next.join(',');
}

function shouldRemoveRow(r) {
  const mid = String(r.messageId || '');
  if (mid.trim()) return true;
  const tags = String(r.tags || '');
  if (hasTag(tags, 'from_mail')) return true;
  const ps = String(r.parse_status || '');
  if (ps.startsWith('mail_ingest')) return true;
  if (ps === 'split_instamart' || ps === 'split_from_invoice') return false;
  return false;
}

function shouldUnsupersede(r) {
  const ps = String(r.parse_status || '');
  const tags = String(r.tags || '');
  return ps === 'superseded_by_mail' || hasTag(tags, 'superseded');
}

function main() {
  const baseDir = getArg('--base-dir');
  if (!baseDir) throw new Error('missing --base-dir');

  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('Z', 'Z');
  const files = listWorkbooks(baseDir);

  let removed = 0;
  let unsuperseded = 0;
  let touchedFiles = 0;
  const out = [];

  for (const fp of files) {
    const wb = XLSX.readFile(fp);
    const sheetNames = wb.SheetNames.filter(isMonthlySheetName);
    const targetSheets = sheetNames.length ? sheetNames : wb.SheetNames;

    let changedFile = false;

    for (const sn of targetSheets) {
      const ws = wb.Sheets[sn];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) continue;

      const kept = [];
      let changedSheet = false;

      for (const r of rows) {
        if (shouldRemoveRow(r)) {
          removed++;
          changedSheet = true;
          continue;
        }

        if (shouldUnsupersede(r)) {
          const oldTags = String(r.tags || '');
          const nextTags = removeTag(oldTags, 'superseded');
          if (nextTags !== oldTags) {
            r.tags = nextTags;
            unsuperseded++;
            changedSheet = true;
          }
          if (String(r.parse_status || '') === 'superseded_by_mail') {
            r.parse_status = '';
            changedSheet = true;
          }
        }

        kept.push(r);
      }

      if (changedSheet) {
        const headers = Object.keys(rows[0] || {});
        wb.Sheets[sn] = XLSX.utils.json_to_sheet(kept, { header: headers });
        changedFile = true;
      }
    }

    if (changedFile) {
      // backup once per file
      const bak = fp + `.bak.purge_mail.${stamp}`;
      if (!fs.existsSync(bak)) fs.copyFileSync(fp, bak);
      XLSX.writeFile(wb, fp);
      touchedFiles++;
      out.push({ workbook: fp, backup: bak });
    }
  }

  process.stdout.write(JSON.stringify({ ok: true, touchedFiles, removedRows: removed, unsupersededRows: unsuperseded, backups: out }, null, 2));
  process.stdout.write('\n');
}

main();
