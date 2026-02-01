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
    people: readJson(path.join(refsDir, 'people.json'), {}),
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
  if (row.merchant_code === 'BLINKIT' || row.merchant_code === 'ZEPTO' || row.merchant_code === 'SWIGGY_INSTAMART') addTag(set, 'quick_commerce');

  // category/subcategory driven tags (broad, useful for filtering)
  if (row.category === 'FOOD_DINING') addTag(set, 'food');
  if (row.subcategory === 'FOOD_ONLINE_DELIVERY') addTag(set, 'online_order');
  if (row.subcategory === 'FOOD_SNACKS') addTag(set, 'snacks');
  if (row.category === 'TRANSPORT') addTag(set, 'transport');
  if (row.subcategory === 'TRANSPORT_FUEL') addTag(set, 'fuel');
  if (row.subcategory === 'TRANSPORT_PARKING') addTag(set, 'parking');
  if (row.subcategory === 'TRANSPORT_INSURANCE') addTag(set, 'insurance');
  if (row.category === 'ENTERTAINMENT') addTag(set, 'entertainment');
  if (row.subcategory === 'ENT_MOVIES') addTag(set, 'movies');
  if (row.category === 'HEALTHCARE') addTag(set, 'health');
  if (row.category === 'SHOPPING') addTag(set, 'shopping');
  if (row.category === 'PERSONAL_CARE') addTag(set, 'personal_care');

  // extra text-driven tags (safe)
  if (text.includes('gym')) addTag(set, 'gym');
  if (text.includes('recharge')) addTag(set, 'recharge');
  if (text.includes('refund') || text.includes('refunded')) addTag(set, 'refund');

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

function keywordCategorize(row, refs) {
  const text = `${row.raw_text || ''} ${row.notes || ''}`.toLowerCase();
  const itemText = `${row.raw_text || ''}`.toLowerCase();

  // Paid for someone else (non-reimbursable): treat as cashflow, not personal expense.
  // Configurable via refs/people.json
  if (row.type === 'EXPENSE') {
    for (const [code, p] of Object.entries(refs.people || {})) {
      const name = String(p?.name || code).trim();
      if (!name) continue;
      const needle = name.toLowerCase();
      if (needle && text.includes(needle)) {
        row.type = 'TRANSFER';
        row.category = 'TRANSFER';
        row.subcategory = 'TRANSFER_FOR_OTHERS';
        row.counterparty = name;
        const set = ensureTagSet(row.tags);
        addTag(set, 'cashflow');
        addTag(set, 'for_someone_else');
        row.tags = [...set].join(',');
        return row;
      }
    }
  }

  // Credit card bill/payment (cashflow, not an expense)
  // Covers older shorthands like "July CC" as well.
  const looksLikeCcBill = (
    text.includes('credit card payment') ||
    text.includes('credit card bill') ||
    text.includes('cc payment') ||
    text.includes('cc bill') ||
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+cc\b/.test(text) ||
    /\bcc\s*\b.*\bbill\b/.test(text)
  );
  if (looksLikeCcBill) {
    row.type = 'TRANSFER';
    row.category = 'TRANSFER';
    row.subcategory = 'TRANSFER_CC_BILL';
    const set = ensureTagSet(row.tags);
    addTag(set, 'cashflow');
    row.tags = [...set].join(',');
    return row;
  }

  // Education / courses
  if (text.includes('course') || text.includes('upskilling') || text.includes('dsa') || text.includes('system design')) {
    return setCatSub(row, 'EDUCATION', 'EDU_COURSES');
  }

  // Tax
  if (text.includes(' tax') || text.startsWith('tax') || text.includes(' gst') || text.includes('tds')) {
    forceCatSub(row, 'OTHERS', 'OTH_MISC');
    const set = ensureTagSet(row.tags);
    addTag(set, 'tax');
    row.tags = [...set].join(',');
    return row;
  }

  // Medical tests / scans
  if (text.includes('ct scan') || text.includes('mri') || text.includes('scan') || text.includes('audiogram') || text.includes('x-ray') || text.includes('xray')) {
    return setCatSub(row, 'HEALTHCARE', 'HEALTH_TESTS');
  }

  // Sports equipment
  if (text.includes('badminton racket') || text.includes('racket')) {
    return setCatSub(row, 'SPORTS', 'SPORTS_EQUIPMENT');
  }

  // Trip keywords
  if (text.includes('coorg')) {
    return setCatSub(row, 'TRAVEL', 'TRAVEL_TOURS');
  }

  // Rent
  if (text.includes(' rent') || text.includes('rent ')) {
    return setCatSub(row, 'HOUSING_UTILITIES', 'HOME_RENT');
  }

  // Travel payments (incl. paying for someone else, non-reimbursable)
  if (text.includes('travel')) {
    return setCatSub(row, 'TRAVEL', 'TRAVEL_TOURS');
  }

  // Transportation
  if (text.includes('petrol') || text.includes('diesel') || text.includes('fuel')) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_FUEL');
  if (text.includes('parking')) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_PARKING');
  if (/\bbus\b/.test(text)) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_BUS');
  if (text.includes('uber') || text.includes('cab')) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_CAB');
  if (text.includes('auto')) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_AUTO');
  // Activa policy/insurance
  if (text.includes('activa') && (text.includes('policy') || text.includes('insurance') || text.includes('renewal'))) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_INSURANCE');
  if (text.includes('policy') || text.includes('insurance')) return setCatSub(row, 'TRANSPORT', 'TRANSPORT_INSURANCE');

  // Personal care
  if (text.includes('haircut') || text.includes('salon') || text.includes('barber')) return setCatSub(row, 'PERSONAL_CARE', 'PERSONAL_HAIRCUT');

  // Housing
  if (text.includes('laundry')) return setCatSub(row, 'HOUSING_UTILITIES', 'HOME_LAUNDRY');

  // Healthcare
  if (text.includes('lab test') || text.includes('test; tata 1mg') || text.includes('medical test')) return setCatSub(row, 'HEALTHCARE', 'HEALTH_TESTS');
  if (text.includes('1mg') || text.includes('pharmeasy') || text.includes('medicine')) return setCatSub(row, 'HEALTHCARE', 'HEALTH_MEDICINES');

  // Entertainment
  if (text.includes('movie') || text.includes('multiplex') || text.includes('cinema') || text.includes('bookmyshow') || row.merchant_code === 'DISTRICT') {
    // if it's clearly snacks at the cinema, still keep it under Movies but tag later
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
    // IMPORTANT: use *itemText* (raw_text) only, not notes, otherwise
    // items get polluted by the original order description.

    // fees/charges should be Misc (per user)
    if (itemText.includes('handling charge') || itemText.includes('delivery charge') || itemText.includes('delivery charges')) {
      forceCatSub(row, 'OTHERS', 'OTH_MISC');
      return row;
    }

    // toiletries / household
    if (itemText.includes('dettol') || itemText.includes('soap') || itemText.includes('shampoo') || itemText.includes('toothpaste') || itemText.includes('tooth brush') || itemText.includes('sanitizer')
        || itemText.includes('loofah') || itemText.includes('body sponge') || itemText.includes('scrubber')) {
      forceCatSub(row, 'SHOPPING', 'SHOP_TOILETRIES');
      return row;
    }

    // protein / supplements
    if (itemText.includes('protein') || itemText.includes('ritebite') || itemText.includes('whey')) {
      forceCatSub(row, 'FOOD_DINING', 'FOOD_PROTEIN');
      return row;
    }

    // dairy
    if (itemText.includes('milk') || itemText.includes('dahi') || itemText.includes('curd') || itemText.includes('paneer')) {
      forceCatSub(row, 'FOOD_DINING', 'FOOD_MILK');
      return row;
    }

    // fruits
    if (itemText.includes('mango') || itemText.includes('banana') || itemText.includes('apple') || itemText.includes('orange') || itemText.includes('grapes')) {
      forceCatSub(row, 'FOOD_DINING', 'FOOD_FRUITS');
      return row;
    }

    // water
    if (itemText.includes('bisleri') || itemText.includes('kinley') || itemText.includes('water')) {
      forceCatSub(row, 'FOOD_DINING', 'FOOD_WATER');
      return row;
    }

    // snacks / beverages / desserts
    if (itemText.includes('chips') || itemText.includes('namkeen') || itemText.includes('bhel') || itemText.includes('cookies') || itemText.includes('biscuit') || itemText.includes('cake')
        || itemText.includes('coca-cola') || itemText.includes('coke') || itemText.includes('sprite') || itemText.includes('soft drink') || itemText.includes('soda')
        || itemText.includes('ice cream') || itemText.includes('havmor')) {
      forceCatSub(row, 'FOOD_DINING', 'FOOD_SNACKS');
      return row;
    }

    // fallback for quick-commerce items
    forceCatSub(row, 'SHOPPING', 'SHOP_GROCERIES');
    return row;
  }

  // Amazon item-level rules (after split_from_orders)
  if (row.merchant_code === 'AMAZON') {
    // Dry fruits / nuts
    if (itemText.includes('almond') || itemText.includes('badam') || itemText.includes('walnut') || itemText.includes('kaju') || itemText.includes('cashew')
        || itemText.includes('pista') || itemText.includes('pistachio') || itemText.includes('dry fruit') || itemText.includes('dryfruit')
        || itemText.includes('raisins') || itemText.includes('kishmish') || itemText.includes('dates') || itemText.includes('fig')) {
      forceCatSub(row, 'FOOD_DINING', 'FOOD_DRY_FRUITS_NUTS');
      return row;
    }

    // Bottles / drinkware (Milton, flask, sipper)
    if (itemText.includes('bottle') || itemText.includes('water bottle') || itemText.includes('sipper') || itemText.includes('flask') || itemText.includes('thermos')
        || itemText.includes('steel bottle') || itemText.includes('milton')) {
      forceCatSub(row, 'SHOPPING', 'SHOP_BOTTLES');
      return row;
    }
  }

  // Food clues (eating out)
  if (text.includes('poha') || text.includes('momos') || text.includes('paratha') || text.includes('dosa') || text.includes('chai') || text.includes('fried') || /\bveg\b/.test(text)) {
    // if Zomato/Swiggy or looks like ordering out
    if (text.includes('zomato') || text.includes('swiggy')) return setCatSub(row, 'FOOD_DINING', 'FOOD_ONLINE_DELIVERY');
    return setCatSub(row, 'FOOD_DINING', 'FOOD_DINEIN');
  }

  // Shopping clues
  if (text.includes('joggers') || text.includes('nobero') || text.includes('myntra') || text.includes('ajio')) return setCatSub(row, 'SHOPPING', 'SHOP_CLOTHES');
  if (text.includes('soap')) return setCatSub(row, 'SHOPPING', 'SHOP_TOILETRIES');

  // Fees
  if (text.includes('debit card charges')) {
    // treat as yearly subscription (per user)
    forceCatSub(row, 'RECHARGES', 'RECHARGE_SUBSCRIPTIONS');
    const set = ensureTagSet(row.tags);
    addTag(set, 'subscription');
    addTag(set, 'yearly');
    row.tags = [...set].join(',');
    return row;
  }
  if (text.includes('charges')) {
    if (!row.category) row.category = 'OTHERS';
    const set = ensureTagSet(row.tags);
    addTag(set, 'bill');
    row.tags = [...set].join(',');
  }

  // Cinema snacks
  if ((text.includes('pepsi') || text.includes('popcorn') || text.includes('nachos') || text.includes('coke'))
      && (text.includes('multiplex') || text.includes('movie') || text.includes('cinema'))) {
    const set = ensureTagSet(row.tags);
    addTag(set, 'cinema_snacks');
    row.tags = [...set].join(',');
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
    // - For Zepto/Blinkit/Amazon item-level rows we *always* run (it may override merchant defaults).
    // - Otherwise, only if still missing.
    if (r.merchant_code === 'ZEPTO' || r.merchant_code === 'BLINKIT' || r.merchant_code === 'AMAZON') keywordCategorize(r, refs);
    else if (!r.category || !r.subcategory) keywordCategorize(r, refs);

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
