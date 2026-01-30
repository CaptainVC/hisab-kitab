#!/usr/bin/env node
/* Normalize an existing weekly workbook:
 * - infer merchant_code from raw_text/notes using refs/merchants + aliases
 * - set type=INCOME for "received from" lines
 * - apply merchant defaults for category/subcategory
 * - add simple tags (food_delivery/subscription/recharge/refund_expected/etc.) when confident
 * - ensure location default
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');
const { DateTime } = require('luxon');

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function readJson(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}

function loadRefs(baseDir) {
  const refsDir = path.join(baseDir, 'refs');
  const merchants = readJson(path.join(refsDir, 'merchants.json'), {});
  const aliases = readJson(path.join(refsDir, 'aliases.json'), {});
  const tags = readJson(path.join(refsDir, 'tags.json'), {});
  const locations = readJson(path.join(refsDir, 'locations.json'), { BENGALURU: { name: 'Bengaluru', default: true } });
  return { merchants, aliases, tags, locations };
}

function inferMerchantCode(text, refs) {
  if (!text) return '';
  const t = String(text);
  const tokens = t.split(/\s+/).filter(Boolean);
  const first = tokens[0];
  if (refs.aliases[first]?.kind === 'merchant') return refs.aliases[first].value;

  const hay = t.toLowerCase();
  for (const [code, m] of Object.entries(refs.merchants)) {
    const name = (m?.name || '').toLowerCase();
    if (!name) continue;
    if (hay.includes(name)) return code;
  }
  return '';
}

function ensureTagSet(tagStr) {
  const set = new Set();
  if (tagStr && String(tagStr).trim()) {
    for (const t of String(tagStr).split(',').map(s => s.trim()).filter(Boolean)) set.add(t);
  }
  return set;
}

function addTag(set, tag) {
  if (!tag) return;
  set.add(tag);
}

function applyHeuristicTags(row, refs) {
  const set = ensureTagSet(row.tags);
  const text = `${row.raw_text || ''} ${row.notes || ''}`.toLowerCase();

  // delivery merchants
  if (row.merchant_code === 'ZOMATO' || row.merchant_code === 'SWIGGY') addTag(set, 'food_delivery');

  // recharge/subscription
  if (row.category === 'RECHARGES') {
    if (text.includes('monthly') || text.includes('subscription') || row.subcategory === 'RECHARGE_SUBSCRIPTIONS') addTag(set, 'subscription');
    if (text.includes('recharge') || row.subcategory === 'RECHARGE_MOBILE' || row.subcategory === 'RECHARGE_DATA') addTag(set, 'recharge');
  }

  // refund expectations
  if (text.includes('could be refunded')) addTag(set, 'refund_expected');

  // adjustments
  if (row.type === 'ADJUSTMENT') {
    if (text.includes('cashback')) addTag(set, 'cashback');
    if (text.includes('refund') || text.includes('refunded')) addTag(set, 'refund');
  }

  row.tags = [...set].join(',');
  return row;
}

function applyMerchantDefaults(row, refs) {
  const d = row.merchant_code && refs.merchants[row.merchant_code]?.default;
  if (!d) return row;
  if (!row.category && d.category) row.category = d.category;
  if (!row.subcategory && d.subcategory) row.subcategory = d.subcategory;
  if ((!row.tags || row.tags === '') && d.tags) {
    row.tags = Array.isArray(d.tags) ? d.tags.join(',') : String(d.tags);
  }
  return row;
}

function defaultLocationKey(refs) {
  const entries = Object.entries(refs.locations || {});
  const def = entries.find(([k, v]) => v && v.default);
  return def ? def[0] : 'BENGALURU';
}

function normalizeWorkbook(filePath, baseDir) {
  const refs = loadRefs(baseDir);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['Transactions'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const defLoc = defaultLocationKey(refs);
  let changed = 0;

  for (const r of rows) {
    const before = JSON.stringify(r);

    // ensure location
    if (!r.location) r.location = defLoc;

    // type: income heuristic
    const body = String(r.raw_text || r.notes || '');
    if (r.type === 'EXPENSE' && /\breceived\s+from\b/i.test(body)) r.type = 'INCOME';

    // infer merchant
    if (!r.merchant_code) {
      const mc = inferMerchantCode(body, refs);
      if (mc) r.merchant_code = mc;
    }

    applyMerchantDefaults(r, refs);
    applyHeuristicTags(r, refs);

    const after = JSON.stringify(r);
    if (before !== after) changed++;
  }

  const newWs = XLSX.utils.json_to_sheet(rows, { header: Object.keys(rows[0] || {}) });
  wb.Sheets['Transactions'] = newWs;
  if (!wb.SheetNames.includes('Transactions')) wb.SheetNames.unshift('Transactions');
  XLSX.writeFile(wb, filePath);

  return { rows: rows.length, changed };
}

function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return null;
    return args[i + 1] ?? null;
  };

  const baseDir = expandHome(getArg('--base-dir') || '~/HisabKitab');
  const file = getArg('--file');
  if (!file) {
    console.error('Usage: node normalize.js --file <xlsx> [--base-dir ~/HisabKitab]');
    process.exit(2);
  }
  const fp = expandHome(file);
  const res = normalizeWorkbook(fp, baseDir);
  process.stdout.write(JSON.stringify({ ok: true, file: fp, ...res }, null, 2) + '\n');
}

main();
