#!/usr/bin/env node
/* Hisab Kitab v0
 * - Parse /hisab text blocks
 * - Append to weekly Excel workbook in ~/HisabKitab
 * - Generate a simple HTML dashboard for that week
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');
const { DateTime } = require('luxon');
const { nanoid } = require('nanoid');

const IST = 'Asia/Kolkata';

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function weekOfMonth(dt, weekStart = 1 /* 1=Mon */) {
  // dt: luxon DateTime
  const first = dt.startOf('month');
  const firstWeekday = first.weekday; // 1..7 (Mon..Sun)
  const offset = (firstWeekday - weekStart + 7) % 7;
  return Math.floor((dt.day + offset - 1) / 7) + 1;
}

function quarterOf(dt) {
  return Math.floor((dt.month - 1) / 3) + 1;
}

function parseDayHeader(line) {
  // Supports:
  // - Day (30/1/26)
  // - Day (30/1/26) [Balotra]
  const m = line.match(/\bDay\s*\(\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})\s*\)\s*(?:\[\s*([^\]]+)\s*\])?\s*$/i);
  if (!m) return null;
  let [_, d, mo, y, loc] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const dt = DateTime.fromObject({ year, month: Number(mo), day: Number(d) }, { zone: IST });
  if (!dt.isValid) return null;
  const locKey = loc ? String(loc).trim() : '';
  return { dt: dt.startOf('day'), loc: locKey };
}

function loadRefs(baseDir) {
  // Simple JSON refs; user-editable.
  // If missing, create defaults.
  const refsDir = path.join(baseDir, 'refs');
  fs.mkdirSync(refsDir, { recursive: true });
  const p = (name) => path.join(refsDir, name);

  const defaults = {
    sources: {
      cash: { display: 'Cash' },
      SBI: { display: 'SBI Bank A/C' },
      HDFC: { display: 'HDFC Bank A/C' },
      mk: { display: 'Mobikwik Wallet' },
      pp: { display: 'PhonePe Wallet' },
      cc: { display: 'Neu Infinity Credit Card' }
    },
    aliases: {
      Bk: { kind: 'merchant', value: 'BURGER_KING' },
      Dom: { kind: 'merchant', value: 'DOMINOS' },
      mk: { kind: 'source', value: 'mk' },
      pp: { kind: 'source', value: 'pp' },
      cc: { kind: 'source', value: 'cc' }
    },
    merchants: {
      BURGER_KING: { name: 'Burger King' },
      DOMINOS: { name: 'Domino\'s' }
    },
    mappings: {},
    locations: {
      BENGALURU: { name: 'Bengaluru', default: true }
    },
    tags: {
      subscription: { name: 'Subscription' }
    }
  };

  function readOrInit(file, fallback) {
    const fp = p(file);
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, JSON.stringify(fallback, null, 2) + '\n', 'utf8');
      return fallback;
    }
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch {
      return fallback;
    }
  }

  const sources = readOrInit('sources.json', defaults.sources);
  const aliases = readOrInit('aliases.json', defaults.aliases);
  const merchants = readOrInit('merchants.json', defaults.merchants);
  const mappings = readOrInit('mappings.json', defaults.mappings);
  const locations = readOrInit('locations.json', defaults.locations);
  const tags = readOrInit('tags.json', defaults.tags);

  return { refsDir, sources, aliases, merchants, mappings, locations, tags };
}

function inferMerchantCode(desc, refs) {
  // Strategy:
  // 1) If description starts with a merchant alias (e.g., "Bk"), use it.
  // 2) If description contains a known merchant name (case-insensitive), match that.
  // 3) Otherwise empty.
  const trimmed = desc.trim();
  const firstWord = trimmed.split(/\s+/)[0];
  if (refs.aliases?.[firstWord]?.kind === 'merchant') {
    return refs.aliases[firstWord].value;
  }

  const hay = trimmed.toLowerCase();
  for (const [code, m] of Object.entries(refs.merchants || {})) {
    const name = (m && m.name) ? String(m.name).toLowerCase() : '';
    if (!name) continue;
    // word boundary-ish match to avoid weird partials
    if (hay.includes(name)) return code;
  }

  return '';
}

function applyMerchantMappings(row, refs) {
  // Support BOTH:
  // - merchants.json having `default: {category, subcategory, tags}`
  // - legacy mappings.json keyed by merchant_code

  const fromMerch = row.merchant_code && refs.merchants?.[row.merchant_code]?.default;
  const fromLegacy = row.merchant_code && refs.mappings?.[row.merchant_code];
  const m = fromMerch || fromLegacy;
  if (!m) return row;

  if (!row.category && m.category) row.category = m.category;
  if (!row.subcategory && m.subcategory) row.subcategory = m.subcategory;

  // tags can be array or string
  if ((!row.tags || row.tags === '') && m.tags) {
    if (Array.isArray(m.tags)) row.tags = m.tags.join(',');
    else row.tags = String(m.tags);
  }

  return row;
}

function parseAmountPrefix(line) {
  const m = line.match(/^\s*([\d,]+)\s*\/\-\s*(.*)$/);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  return { amount, rest: m[2].trim() };
}

function extractParen(rest) {
  // If ends with (...) grab it.
  const m = rest.match(/^(.*)\(([^)]*)\)\s*$/);
  if (!m) return { body: rest.trim(), paren: '' };
  return { body: m[1].trim(), paren: m[2].trim() };
}

function parseSourceFromParen(paren, refs) {
  if (!paren) return null;
  const head = paren.split(',')[0].trim();
  if (!head) return null;

  // direct match
  if (refs.sources[head]) return head;

  // alias dictionary (preferred): e.g., "mk" -> {kind:"source", value:"mk"}
  const alias = refs.aliases && refs.aliases[head];
  if (alias && (alias.kind === 'source' || alias.kind === 'account')) {
    // accept legacy kind=account (treat as source)
    const v = alias.value;
    // if value is a source code
    if (refs.sources[v]) return v;
    // if value is a display name, try to reverse-map it
    const match = Object.entries(refs.sources).find(([code, obj]) => (obj.display || '').toLowerCase() === String(v).toLowerCase());
    if (match) return match[0];
  }

  // allow case-insensitive match for sources like sbi
  const k = Object.keys(refs.sources).find(s => s.toLowerCase() === head.toLowerCase());
  return k || null;
}

function detectTransfer(body, refs) {
  // Example: "SBI to Mobikwik Wallet"
  const m = body.match(/^([A-Za-z]{2,5})\s+to\s+(.+)$/i);
  if (!m) return null;
  const srcToken = m[1];
  const src = Object.keys(refs.sources).find(s => s.toLowerCase() === srcToken.toLowerCase());
  if (!src) return null;
  return { source: src, destText: m[2].trim() };
}

function parseSplit(paren, refs) {
  // e.g. "30 mk + 200 SBI" (inside parens)
  if (!paren || !paren.includes('+')) return null;
  const parts = paren.split('+').map(s => s.trim()).filter(Boolean);
  const legs = [];
  for (const p of parts) {
    const m = p.match(/^([\d,]+)\s*([A-Za-z]{2,6})$/);
    if (!m) return null;
    const amt = Number(m[1].replace(/,/g, ''));
    const srcToken = m[2];
    const src = Object.keys(refs.sources).find(s => s.toLowerCase() === srcToken.toLowerCase());
    if (!src) return null;
    legs.push({ amount: amt, source: src });
  }
  if (!legs.length) return null;
  return legs;
}

function parseAdjustmentsFromNotes(notes) {
  // returns [{kind, amount}]
  const out = [];
  // got 12 cashback
  let m;
  m = notes.match(/\bgot\s+(\d+)\s+cashback\b/i);
  if (m) out.push({ kind: 'cashback', amount: Number(m[1]) });
  m = notes.match(/\bgot\s+(\d+)\s+refunded\b/i);
  if (m) out.push({ kind: 'refund', amount: Number(m[1]) });
  return out.filter(x => Number.isFinite(x.amount) && x.amount > 0);
}

function parseHisabText(text, refs) {
  // Returns {date, rows, errors}
  // Normalize input: users may send everything in one Telegram message line.
  // Strategy: after stripping "/hisab", insert newlines before "Day (" headers and before amount prefixes "123/-".
  const normalized = text
    .replace(/^\/hisab\s*/i, '')
    .replace(/\s+(?=Day\s*\()/gi, '\n')
    .replace(/\s+(?=[0-9][0-9,]*\s*\/\-)/g, '\n');

  const lines = normalized
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  let currentDate = null;
  let currentLocation = 'BENGALURU';
  const rows = [];
  const errors = [];

  const resolveLocationKey = (rawLoc) => {
    if (!rawLoc) return null;
    const t = String(rawLoc).trim();
    if (!t) return null;
    const key = t.toUpperCase().replace(/\s+/g, '_');
    if (refs.locations && refs.locations[key]) return key;
    // try match by name
    if (refs.locations) {
      const hit = Object.entries(refs.locations).find(([k,v]) => String(v.name||'').toLowerCase() === t.toLowerCase());
      if (hit) return hit[0];
    }
    return null;
  };

  for (const line of lines) {
    const day = parseDayHeader(line);
    if (day) {
      currentDate = day.dt;
      const lk = resolveLocationKey(day.loc);
      if (lk) currentLocation = lk;
      continue;
    }

    const amountPrefix = parseAmountPrefix(line);
    if (!amountPrefix) {
      errors.push({ line, error: 'Missing amount prefix like 100/-' });
      continue;
    }

    const { amount, rest } = amountPrefix;
    if (!currentDate) {
      // assume today IST
      currentDate = DateTime.now().setZone(IST).startOf('day');
    }

    // Split detection: if paren looks like "30 mk + 200 SBI"
    const { body, paren } = extractParen(rest);
    const splitLegs = parseSplit(paren, refs);

    const base = {
      txn_id: nanoid(),
      group_id: '',
      date: currentDate.toISODate(),
      type: 'EXPENSE',
      amount,
      source: 'cash',
      location: currentLocation || 'BENGALURU',
      merchant_code: '',
      category: '',
      subcategory: '',
      tags: '',
      beneficiary: '',
      reimb_status: '',
      counterparty: '',
      linked_txn_id: '',
      notes: '',
      raw_text: line,
      parse_status: 'ok',
      parse_error: ''
    };

    // Determine type: INCOME (simple heuristic)
    // Example: "3,000/- Received from Rishika (mk)"
    if (/\breceived\s+from\b/i.test(body)) {
      base.type = 'INCOME';
    }

    // Determine type: transfer
    const transfer = detectTransfer(body, refs);
    if (transfer) {
      base.type = 'TRANSFER';
      base.source = transfer.source;
      base.notes = `to ${transfer.destText}`;
      rows.push(base);
      continue;
    }

    // Determine source + notes + optional location + splitwise/shares
    let source = parseSourceFromParen(paren, refs) || 'cash';
    let notes = paren ? paren : '';

    // Parse comma-separated tokens inside parens.
    const tokens = paren ? paren.split(',').map(s => s.trim()).filter(Boolean) : [];

    // Location override: either loc:KEY or plain city token
    for (const t of tokens) {
      const mLoc = t.match(/^loc\s*:\s*([A-Za-z_]+)$/i);
      const raw = mLoc ? mLoc[1] : t;
      const key = raw.toUpperCase().replace(/\s+/g, '_');
      if (refs.locations && refs.locations[key]) {
        base.location = key;
        break;
      }
      // match by name
      if (refs.locations) {
        const hit = Object.entries(refs.locations).find(([k,v]) => String(v.name||'').toLowerCase() === raw.toLowerCase());
        if (hit) { base.location = hit[0]; break; }
      }
    }

    // Splitwise shares: sw:Name amount (allow multiple)
    const sw = [];
    for (const t of tokens) {
      const m = t.match(/^sw\s*:\s*([^\s]+)\s+(\d[\d,]*)$/i);
      if (m) sw.push({ who: m[1], amount: Number(m[2].replace(/,/g,'')) });
    }
    const swTotal = sw.reduce((s,x)=>s+(Number(x.amount)||0),0);

    // Splitwise shorthand: sw-Name (means: entire txn is on Name; treat as expense but tag + counterparty)
    // Example: (mk, sw-Rishika)
    for (const t of tokens) {
      const m = t.match(/^sw\s*[-:]\s*(.+)$/i);
      if (m && m[1]) {
        base.counterparty = String(m[1]).trim();
        base.tags = (base.tags ? base.tags + ',' : '') + 'splitwise,for_someone_else';
      }
    }

    // money movement: "40 wallet to cash" / "40 cash to mk" / "40 mk to SBI"
    let movement = null;
    for (const t of tokens) {
      const m = t.match(/^(\d[\d,]*)\s+([A-Za-z]+)\s+to\s+([A-Za-z]+)$/i);
      if (m) {
        const amt = Number(m[1].replace(/,/g,''));
        const fromRaw = m[2];
        const toRaw = m[3];
        movement = { amt, fromRaw, toRaw };
        break;
      }
    }

    // If split legs, ignore main amount and expand legs
    if (splitLegs) {
      const groupId = nanoid();
      for (const leg of splitLegs) {
        const r = { ...base };
        r.txn_id = nanoid();
        r.group_id = groupId;
        r.amount = leg.amount;
        r.source = leg.source;
        // per your requirement: merchant/category can differ per leg.
        // For v1, we keep them blank and let you edit later or rely on mappings.
        r.notes = body; // keep body as note; leg-specific details already captured
        r.raw_text = line;
        rows.push(applyMerchantMappings(r, refs));
      }
      continue;
    }

    base.source = source;
    base.notes = notes;

    // Merchant code inference from body
    base.merchant_code = inferMerchantCode(body, refs);

    // If merchant not inferred, keep body in notes
    if (!base.merchant_code) {
      base.notes = (body + (base.notes ? ` | ${base.notes}` : '')).trim();
    }

    // Multi-basket split lines inside parens: "fruits 246" etc.
    const itemSplits = [];
    for (const t of tokens) {
      // skip known token types
      if (/^sw\s*:/i.test(t)) continue;
      if (/\bto\b/i.test(t) && /^\d/.test(t)) continue;
      if (refs.sources && refs.sources[t]) continue;
      if (/^(cash|wallet|mk|pp|cc|sbi|hdfc)$/i.test(t)) continue;
      if (/^other\b/i.test(t)) continue;

      const m = t.match(/^(.+?)\s+(\d[\d,]*)$/);
      if (m) itemSplits.push({ label: m[1].trim(), amount: Number(m[2].replace(/,/g,'')) });
    }

    // other-for marker: "other" or "other for Rishika"
    for (const t of tokens) {
      const m = t.match(/^other(?:\s+for\s+(.+))?$/i);
      if (m) {
        base.tags = (base.tags ? base.tags + ',' : '') + 'for_someone_else';
        if (m[1]) base.beneficiary = m[1].trim();
      }
    }

    // If splitwise shares exist, split into expense + SPLITWISE rows
    if (swTotal > 0 && swTotal < base.amount) {
      const groupId = nanoid();
      const myAmt = base.amount - swTotal;

      const myRow = { ...base, txn_id: nanoid(), group_id: groupId, amount: myAmt };
      applyMerchantMappings(myRow, refs);
      rows.push(myRow);

      for (const s of sw) {
        const swRow = { ...base };
        swRow.txn_id = nanoid();
        swRow.group_id = groupId;
        swRow.type = 'SPLITWISE';
        swRow.amount = s.amount;
        swRow.counterparty = s.who;
        swRow.tags = (swRow.tags ? swRow.tags + ',' : '') + 'splitwise';
        swRow.notes = `splitwise share for ${s.who}`;
        applyMerchantMappings(swRow, refs);
        rows.push(swRow);
      }

      // Movement annotation => transfer row
      if (movement && movement.amt > 0) {
        const tr = { ...base };
        tr.txn_id = nanoid();
        tr.group_id = groupId;
        tr.type = 'TRANSFER';
        tr.amount = movement.amt;
        tr.notes = `${movement.fromRaw} -> ${movement.toRaw}`;
        tr.tags = (tr.tags ? tr.tags + ',' : '') + 'cashflow';
        rows.push(tr);
      }

      continue;
    }

    // If item splits exist, replace the base row with split rows (same merchant/source)
    if (itemSplits.length) {
      const groupId = nanoid();
      for (const it of itemSplits) {
        const r = { ...base };
        r.txn_id = nanoid();
        r.group_id = groupId;
        r.amount = it.amount;
        // put item label into notes; categorizer will set subcategory from keywords
        r.notes = it.label;
        applyMerchantMappings(r, refs);
        rows.push(r);
      }

      // movement annotation => transfer row
      if (movement && movement.amt > 0) {
        const tr = { ...base };
        tr.txn_id = nanoid();
        tr.group_id = groupId;
        tr.type = 'TRANSFER';
        tr.amount = movement.amt;
        tr.notes = `${movement.fromRaw} -> ${movement.toRaw}`;
        tr.tags = (tr.tags ? tr.tags + ',' : '') + 'cashflow';
        rows.push(tr);
      }

      // Auto adjustments from original notes
      const adjustments = parseAdjustmentsFromNotes(base.notes);
      for (const adj of adjustments) {
        rows.push({
          ...base,
          txn_id: nanoid(),
          group_id: groupId,
          type: 'ADJUSTMENT',
          amount: adj.amount,
          linked_txn_id: base.txn_id,
          notes: `${adj.kind} (auto)`
        });
      }

      continue;
    }

    // Default: single row
    applyMerchantMappings(base, refs);
    rows.push(base);

    // Movement annotation => transfer row
    if (movement && movement.amt > 0) {
      const groupId = base.group_id || nanoid();
      base.group_id = groupId;
      const tr = { ...base };
      tr.txn_id = nanoid();
      tr.type = 'TRANSFER';
      tr.amount = movement.amt;
      tr.notes = `${movement.fromRaw} -> ${movement.toRaw}`;
      tr.tags = (tr.tags ? tr.tags + ',' : '') + 'cashflow';
      rows.push(tr);
    }

    // Auto-create ADJUSTMENT(s)
    const adjustments = parseAdjustmentsFromNotes(base.notes);
    for (const adj of adjustments) {
      rows.push({
        ...base,
        txn_id: nanoid(),
        group_id: base.group_id,
        type: 'ADJUSTMENT',
        amount: adj.amount,
        linked_txn_id: base.txn_id,
        notes: `${adj.kind} (auto)`
      });
    }
  }

  return { date: currentDate ? currentDate.toISODate() : null, rows, errors };
}

function ensureWorkbook(filePath, headers) {
  if (fs.existsSync(filePath)) {
    const wb = XLSX.readFile(filePath);
    return wb;
  }
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
  return wb;
}

function appendRowsToWorkbook(wb, rows, headers) {
  const ws = wb.Sheets['Transactions'] || wb.Sheets[wb.SheetNames[0]];
  const existing = XLSX.utils.sheet_to_json(ws, { header: headers, range: 1, defval: '' });
  const combined = existing.concat(rows.map(r => {
    const o = {};
    for (const h of headers) o[h] = r[h] ?? '';
    return o;
  }));
  const newWs = XLSX.utils.json_to_sheet(combined, { header: headers });
  wb.Sheets['Transactions'] = newWs;
  if (!wb.SheetNames.includes('Transactions')) {
    wb.SheetNames.unshift('Transactions');
  }
}

function computeDashboard(rows) {
  const expense = rows.filter(r => r.type === 'EXPENSE');
  const byCat = new Map();
  const byMerchant = new Map();
  let total = 0;
  for (const r of expense) {
    total += Number(r.amount) || 0;
    const cat = r.category || '(uncategorized)';
    byCat.set(cat, (byCat.get(cat) || 0) + (Number(r.amount) || 0));
    const merch = r.merchant_code || '(unknown)';
    byMerchant.set(merch, (byMerchant.get(merch) || 0) + (Number(r.amount) || 0));
  }
  const topMerchant = [...byMerchant.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  const catSeries = [...byCat.entries()].sort((a,b)=>b[1]-a[1]);
  return { total, catSeries, topMerchant, count: expense.length };
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function writeDashboardHTML(outPath, title, dash) {
  const catLabels = dash.catSeries.map(x => x[0]);
  const catData = dash.catSeries.map(x => x[1]);
  const merchLabels = dash.topMerchant.map(x => x[0]);
  const merchData = dash.topMerchant.map(x => x[1]);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 20px; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 16px; max-width: 1100px; }
    .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; }
    h1 { margin: 0 0 8px 0; }
    .muted { color: #6b7280; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #eee; }
  </style>
</head>
<body>
  <h1>${htmlEscape(title)}</h1>
  <div class="muted">Generated: ${htmlEscape(DateTime.now().toUTC().toISO())} (UTC)</div>

  <div class="grid">
    <div class="card">
      <div><b>Total expense:</b> ₹${dash.total.toLocaleString('en-IN')}</div>
      <div><b>Expense transactions:</b> ${dash.count}</div>
    </div>

    <div class="card">
      <h2>By category</h2>
      <canvas id="catChart"></canvas>
    </div>

    <div class="card">
      <h2>Top merchants</h2>
      <canvas id="merchChart"></canvas>
      <h3 style="margin-top:16px">Top merchants table</h3>
      <table>
        <thead><tr><th>Merchant</th><th>Amount</th></tr></thead>
        <tbody>
          ${dash.topMerchant.map(([m, a]) => `<tr><td>${htmlEscape(m)}</td><td>₹${Number(a).toLocaleString('en-IN')}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    const catLabels = ${JSON.stringify(catLabels)};
    const catData = ${JSON.stringify(catData)};
    const merchLabels = ${JSON.stringify(merchLabels)};
    const merchData = ${JSON.stringify(merchData)};

    new Chart(document.getElementById('catChart'), {
      type: 'pie',
      data: { labels: catLabels, datasets: [{ data: catData }] },
      options: { responsive: true }
    });

    new Chart(document.getElementById('merchChart'), {
      type: 'bar',
      data: { labels: merchLabels, datasets: [{ label: '₹', data: merchData }] },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(outPath, html, 'utf8');
}

function usage() {
  console.log(`Usage:
  hk import --text-file <path> [--base-dir ~/HisabKitab]
  hk import --text <string> [--base-dir ~/HisabKitab]

Notes:
- Accepts blocks that optionally start with /hisab.
- Creates ~/HisabKitab/refs/*.json if missing.
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) return usage();

  const cmd = args[0];
  const getArg = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return null;
    return args[i + 1] ?? null;
  };

  const baseDir = expandHome(getArg('--base-dir') || '~/HisabKitab');
  fs.mkdirSync(baseDir, { recursive: true });

  if (cmd === 'import') {
    const textFile = getArg('--text-file');
    const textArg = getArg('--text');
    let text = '';
    if (textFile) text = fs.readFileSync(expandHome(textFile), 'utf8');
    else if (textArg) text = textArg;
    else text = fs.readFileSync(0, 'utf8');

    const refs = loadRefs(baseDir);
    const parsed = parseHisabText(text, refs);

    // Determine week file based on parsed date (or today IST)
    // Group rows by week-of-month so a single /hisab message spanning multiple days
    // ends up in the correct weekly workbooks.
    const headers = [
      'txn_id','group_id','date','type','amount','source','location','merchant_code','category','subcategory','tags',
      'beneficiary','reimb_status','counterparty','linked_txn_id','notes','raw_text','parse_status','parse_error'
    ];

    const byWeek = new Map();
    for (const r of parsed.rows) {
      const dt = DateTime.fromISO(r.date, { zone: IST });
      const wom = weekOfMonth(dt, 1);
      const weekName = `Week${wom}`;
      const key = `${dt.toFormat('yyyy-LL')}-${weekName}`;
      if (!byWeek.has(key)) byWeek.set(key, []);
      byWeek.get(key).push(r);
    }

    const outputs = [];
    for (const [key, rows] of byWeek.entries()) {
      const excelName = `HK_${key}.xlsx`;
      const htmlName = `HK_${key}_dashboard.html`;
      const excelPath = path.join(baseDir, excelName);
      const htmlPath = path.join(baseDir, htmlName);

      const wb = ensureWorkbook(excelPath, headers);
      appendRowsToWorkbook(wb, rows, headers);
      XLSX.writeFile(wb, excelPath);

      const wb2 = XLSX.readFile(excelPath);
      const ws2 = wb2.Sheets['Transactions'] || wb2.Sheets[wb2.SheetNames[0]];
      const allRows = XLSX.utils.sheet_to_json(ws2, { defval: '' });
      const dash = computeDashboard(allRows);
      writeDashboardHTML(htmlPath, `Hisab Kitab — ${key}`, dash);

      outputs.push({ excelPath, htmlPath, imported: rows.length });
    }

    const result = {
      ok: true,
      outputs,
      imported: parsed.rows.length,
      errors: parsed.errors
    };

    process.stdout.write(JSON.stringify(result, null, 2));
    process.stdout.write('\n');
    return;
  }

  usage();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
