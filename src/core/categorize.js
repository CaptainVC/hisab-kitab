#!/usr/bin/env node
/* Categorize rows using:
 * - merchant defaults (already in refs)
 * - keyword heuristics for missing merchant/category/subcategory
 * This is the "AI flavor" v0: deterministic but acts like an auto-categorizer.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');

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
  return {
    merchants: readJson(path.join(refsDir, 'merchants.json'), {}),
    subcategories: readJson(path.join(refsDir, 'subcategories.json'), {}),
    tags: readJson(path.join(refsDir, 'tags.json'), {}),
    locations: readJson(path.join(refsDir, 'locations.json'), { BENGALURU: { name: 'Bengaluru', default: true } })
  };
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

function applyTagsFromText(row) {
  const set = ensureTagSet(row.tags);
  const text = `${row.raw_text || ''} ${row.notes || ''}`.toLowerCase();

  if (text.includes('monthly') || text.includes('subscription')) addTag(set, 'subscription');
  if (text.includes('recharge')) addTag(set, 'recharge');
  if (text.includes('could be refunded')) addTag(set, 'refund_expected');
  if (row.type === 'ADJUSTMENT') {
    if (text.includes('cashback')) addTag(set, 'cashback');
    if (text.includes('refund') || text.includes('refunded')) addTag(set, 'refund');
  }

  // merchants
  if (row.merchant_code === 'ZOMATO' || row.merchant_code === 'SWIGGY') addTag(set, 'food_delivery');

  row.tags = [...set].join(',');
  return row;
}

function setCatSub(row, category, subcategory) {
  if (!row.category) row.category = category;
  if (!row.subcategory) row.subcategory = subcategory;
}

function forceCatSub(row, category, subcategory) {
  row.category = category;
  row.subcategory = subcategory;
}

function keywordCategorize(row) {
  const text = `${row.raw_text || ''} ${row.notes || ''}`.toLowerCase();

  // Transportation
  if (text.includes('petrol')) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_PETROL');
  if (text.includes('parking')) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_PARKING');
  if (text.includes('bus')) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_BUS');
  if (text.includes('uber') || text.includes('cab')) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_CAB');
  if (text.includes('auto')) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_AUTO');
  if (text.includes('policy') || text.includes('insurance')) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_INSURANCE');

  // Housing
  if (text.includes('laundry')) return setCatSub(row, 'HOUSING_UTILITIES', 'HOME_LAUNDRY');

  // Healthcare
  if (text.includes('lab test') || text.includes('test; tata 1mg') || text.includes('medical test')) return setCatSub(row, 'HEALTHCARE', 'HEALTH_TESTS');
  if (text.includes('1mg') || text.includes('pharmeasy') || text.includes('medicine')) return setCatSub(row, 'HEALTHCARE', 'HEALTH_MEDICINES');

  // Entertainment
  if (text.includes('movie') || text.includes('multiplex') || text.includes('bookmyshow') || row.merchant_code === 'DISTRICT') {
    return setCatSub(row, 'ENTERTAINMENT', 'ENT_MOVIES');
  }

  // Recharges/subscriptions
  if (text.includes('icloud') || text.includes('storage') || text.includes('hotstar') || text.includes('netflix') || text.includes('youtube premium')) {
    return setCatSub(row, 'RECHARGES', 'RECHARGE_SUBSCRIPTIONS');
  }
  if (text.includes('recharge')) {
    return setCatSub(row, 'RECHARGES', 'RECHARGE_MOBILE');
  }

  // Grocery / quick-commerce item rules (Zepto/Blinkit/etc.)
  // These are applied on *items* (raw_text often equals product name).
  if (row.merchant_code === 'ZEPTO' || row.merchant_code === 'BLINKIT') {
    // For quick-commerce *item rows*, we intentionally override merchant defaults.

    // toiletries / household
    if (text.includes('dettol') || text.includes('soap') || text.includes('shampoo') || text.includes('toothpaste') || text.includes('tooth brush') || text.includes('sanitizer')) {
      forceCatSub(row, 'SHOPPING', 'SHOP_TOILETRIES');
      return row;
    }

    // dairy
    if (text.includes('milk') || text.includes('dahi') || text.includes('curd') || text.includes('paneer')) {
      forceCatSub(row, 'FOOD_DINING', 'FOOD_MILK');
      return row;
    }

    // fruits
    if (text.includes('mango') || text.includes('banana') || text.includes('apple') || text.includes('orange') || text.includes('grapes')) {
      forceCatSub(row, 'FOOD_DINING', 'FOOD_FRUITS');
      return row;
    }

    // water
    if (text.includes('bisleri') || text.includes('kinley') || text.includes('water')) {
      forceCatSub(row, 'FOOD_DINING', 'FOOD_WATER');
      return row;
    }

    // snacks
    if (text.includes('chips') || text.includes('namkeen') || text.includes('bhel') || text.includes('cookies') || text.includes('biscuit') || text.includes('cake')) {
      forceCatSub(row, 'FOOD_DINING', 'FOOD_SNACKS');
      return row;
    }

    // fallback for quick-commerce items
    forceCatSub(row, 'SHOPPING', 'SHOP_GROCERIES');
    return row;
  }

  // Food clues (eating out)
  if (text.includes('poha') || text.includes('momos') || text.includes('paratha') || text.includes('dosa') || text.includes('chai')) {
    // if Zomato/Swiggy or looks like ordering out
    if (text.includes('zomato') || text.includes('swiggy')) return setCatSub(row, 'FOOD_DINING', 'FOOD_ONLINE_DELIVERY');
    return setCatSub(row, 'FOOD_DINING', 'FOOD_DINEIN');
  }

  // Shopping clues
  if (text.includes('joggers') || text.includes('nobero') || text.includes('myntra') || text.includes('ajio')) return setCatSub(row, 'SHOPPING', 'SHOP_CLOTHES');
  if (text.includes('soap')) return setCatSub(row, 'SHOPPING', 'SHOP_TOILETRIES');

  // Fees
  if (text.includes('debit card charges') || text.includes('charges')) {
    if (!row.category) row.category = 'OTHERS';
    addTag(ensureTagSet(row.tags), 'bill');
  }

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

function run(filePath, baseDir) {
  const refs = loadRefs(baseDir);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['Transactions'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const defLoc = defaultLocationKey(refs);
  let changed = 0;

  for (const r of rows) {
    const before = JSON.stringify(r);

    if (!r.location) r.location = defLoc;

    // Merchant defaults
    applyMerchantDefaults(r, refs);

    // Keyword categorization:
    // - For Zepto/Blinkit item-level rows we *always* run (it may override merchant defaults).
    // - Otherwise, only if still missing.
    if (r.merchant_code === 'ZEPTO' || r.merchant_code === 'BLINKIT') keywordCategorize(r);
    else if (!r.category || !r.subcategory) keywordCategorize(r);

    // Tags
    applyTagsFromText(r);

    const after = JSON.stringify(r);
    if (before !== after) changed++;
  }

  const headers = Object.keys(rows[0] || {});
  const newWs = XLSX.utils.json_to_sheet(rows, { header: headers });
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
    console.error('Usage: node categorize.js --file <xlsx> [--base-dir ~/HisabKitab]');
    process.exit(2);
  }
  const fp = expandHome(file);
  const res = run(fp, baseDir);
  process.stdout.write(JSON.stringify({ ok: true, file: fp, ...res }, null, 2) + '\n');
}

main();
