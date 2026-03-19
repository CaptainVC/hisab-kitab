#!/usr/bin/env node
/*
Update category/subcategory for rows matching a merchant + current category.

Usage:
  node update_by_merchant_and_category.js \
    --base-dir /home/molt/HisabKitab \
    --merchant SWIGGY_INSTAMART \
    --from-category OTHERS \
    --to-category FOOD_DINING \
    --to-subcategory FOOD_FRUITS \
    [--only-blank-subcat] \
    [--dry-run]

Backups created in baseDir/backups/update_by_merch_cat_<ts>/
*/

const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

function getArg(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}
function pad2(n) { return String(n).padStart(2, '0'); }
function ts() {
  const d = new Date();
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}
function listHK(baseDir) {
  return fs.readdirSync(baseDir)
    .filter(f => /^HK_\d{4}_Q[1-4]\.xlsx$/i.test(f))
    .map(f => path.join(baseDir, f));
}
function backupFiles(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const fp of files) {
    if (!fs.existsSync(fp)) continue;
    fs.copyFileSync(fp, path.join(dir, path.basename(fp)));
  }
}
function pickKey(sample, candidates, fallback) {
  for (const k of candidates) {
    if (Object.prototype.hasOwnProperty.call(sample, k)) return k;
  }
  return fallback;
}

function main() {
  const args = process.argv.slice(2);
  const baseDir = String(getArg(args, '--base-dir') || '/home/molt/HisabKitab');
  const merchant = String(getArg(args, '--merchant') || '').trim();
  const fromCategory = String(getArg(args, '--from-category') || '').trim();
  const toCategory = String(getArg(args, '--to-category') || '').trim();
  const toSubcategory = String(getArg(args, '--to-subcategory') || '').trim();
  const onlyBlankSubcat = args.includes('--only-blank-subcat');
  const dryRun = args.includes('--dry-run');

  if (!merchant || !fromCategory || !toCategory || !toSubcategory) {
    throw new Error('Missing required args: --merchant --from-category --to-category --to-subcategory');
  }

  const hkFiles = listHK(baseDir);
  const stamp = ts();
  const backupDir = path.join(baseDir, 'backups', `update_by_merch_cat_${stamp}`);
  if (!dryRun) backupFiles(backupDir, hkFiles);

  let rowsChanged = 0;
  let booksTouched = 0;
  const touched = [];

  for (const fp of hkFiles) {
    const wb = XLSX.readFile(fp);
    let wbChanged = false;

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) continue;
      const sample = rows[0] || {};

      const kMerch = pickKey(sample, ['merchant_code', 'Merchant', 'merchant'], 'merchant_code');
      const kCat = pickKey(sample, ['category', 'Category'], 'category');
      const kSub = pickKey(sample, ['subcategory', 'Subcategory', 'Subcat'], 'subcategory');

      let sheetChanged = false;
      for (const r of rows) {
        const mc = String(r[kMerch] || '').trim();
        const cat = String(r[kCat] || '').trim();
        const sub = String(r[kSub] || '').trim();
        if (mc !== merchant) continue;
        if (cat !== fromCategory) continue;
        if (onlyBlankSubcat && sub) continue;

        r[kCat] = toCategory;
        r[kSub] = toSubcategory;
        rowsChanged++;
        sheetChanged = true;
      }

      if (sheetChanged) {
        const headers = Object.keys(rows[0] || {});
        wb.Sheets[sheetName] = XLSX.utils.json_to_sheet(rows, { header: headers });
        wbChanged = true;
      }
    }

    if (wbChanged) {
      booksTouched++;
      touched.push(path.basename(fp));
      if (!dryRun) XLSX.writeFile(wb, fp);
    }
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    dryRun,
    backupDir: dryRun ? null : backupDir,
    merchant,
    fromCategory,
    toCategory,
    toSubcategory,
    onlyBlankSubcat,
    rowsChanged,
    booksTouched,
    touched
  }, null, 2) + '\n');
}

main();
