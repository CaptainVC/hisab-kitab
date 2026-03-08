#!/usr/bin/env node
/* Polling ingest pipeline (idempotent):
 * - Fetch/parse labeled Gmail receipts/orders + payments
 * - Auto-log high-confidence payments into quarterly Excel workbooks (HK_YYYY_QN.xlsx, sheet MMM-YYYY)
 * - Normalize + categorize (and optionally split_from_orders)
 * - Rebuild dashboard outputs
 *
 * Intended to run on a schedule (eg. every 5 minutes).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const XLSX = require('xlsx');
const { DateTime } = require('luxon');
const { nanoid } = require('nanoid');

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

function readJsonSafe(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
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
    label: get('--label') || 'HisabKitab',
    maxOrders: Number(get('--max-orders') || 200),
    maxPayments: Number(get('--max-payments') || 500),
    minConfidence: Number(get('--min-confidence') || 0.85),
    splitFromOrders: has('--split-from-orders'),
    rebuildDashboard: !has('--no-dashboard'),
    dashboardJson: get('--dashboard-json') || 'hisab_data.json',
    dashboardHtml: get('--dashboard-html') || 'hisab_dashboard.html',
    dryRun: has('--dry-run'),
  };
}

function loadRefs(baseDir) {
  const refsDir = path.join(baseDir, 'refs');
  const read = (f, fb) => readJsonSafe(path.join(refsDir, f), fb);
  return {
    merchants: read('merchants.json', {}),
    mappings: read('mappings.json', {}),
    locations: read('locations.json', { BENGALURU: { name: 'Bengaluru', default: true } }),
  };
}

function normalizeMerchantCode(s) {
  if (!s) return '';
  return String(s)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function defaultLocationKey(refs) {
  const entries = Object.entries(refs.locations || {});
  const def = entries.find(([_, v]) => v && v.default);
  return def ? def[0] : 'BENGALURU';
}

function applyMerchantMappings(row, refs) {
  const fromMerch = row.merchant_code && refs.merchants?.[row.merchant_code]?.default;
  const fromLegacy = row.merchant_code && refs.mappings?.[row.merchant_code];
  const m = fromMerch || fromLegacy;
  if (!m) return row;
  if (!row.category && m.category) row.category = m.category;
  if (!row.subcategory && m.subcategory) row.subcategory = m.subcategory;
  if ((!row.tags || row.tags === '') && m.tags) {
    row.tags = Array.isArray(m.tags) ? m.tags.join(',') : String(m.tags);
  }
  return row;
}

function paymentToRow(payment, refs) {
  const dt = DateTime.fromMillis(Number(payment.internalDateMs || 0), { zone: IST });
  const date = dt.isValid ? dt.toISODate() : DateTime.now().setZone(IST).toISODate();

  const merchantRaw = payment.merchant || payment.merchantHint || '';
  const merchant_code = normalizeMerchantCode(merchantRaw);

  const row = {
    txn_id: nanoid(),
    group_id: '',
    date,
    type: (String(payment.direction || '').toUpperCase() === 'CREDIT') ? 'INCOME' : 'EXPENSE',
    amount: Number(payment.amount || 0),
    source: String(payment.source || ''),
    location: '',
    merchant_code,
    category: '',
    subcategory: '',
    tags: '',
    beneficiary: '',
    reimb_status: '',
    counterparty: '',
    linked_txn_id: '',
    notes: '',
    raw_text: payment.subject || payment.raw || '',
    parse_status: payment.parse_status || 'ok',
    parse_error: '',
    messageId: String(payment.messageId || '')
  };

  // Default location
  row.location = defaultLocationKey(refs);

  // Category/subcategory via merchant defaults/mappings (then core/categorize can refine)
  applyMerchantMappings(row, refs);

  return row;
}

function shouldAutoCreate(payment, row, minConfidence) {
  const conf = Number(payment.confidence || 0);
  if (conf < minConfidence) return false;
  if (!row.messageId) return false;
  if (!row.date || !Number.isFinite(Number(row.amount)) || Number(row.amount) <= 0) return false;
  if (!row.merchant_code) return false;
  // Must have a category+subcategory after mappings or later categorizer will fill, but you wanted auto-categorize.
  // We'll allow blank here and rely on categorize.js after insert.
  return true;
}

function ensureHeaders() {
  return [
    'txn_id','group_id','date','type','amount','source','location','merchant_code','category','subcategory','tags',
    'beneficiary','reimb_status','counterparty','linked_txn_id','notes','raw_text','parse_status','parse_error',
    'messageId'
  ];
}

function existingMessageIdsForSheet(wb, sheetName) {
  const rows = readSheetRows(wb, sheetName);
  const set = new Set();
  for (const r of rows) {
    const mid = String(r.messageId || '').trim();
    if (mid) set.add(mid);
  }
  return set;
}

function appendRowsIdempotent({ baseDir, rows, dryRun }) {
  const headers = ensureHeaders();
  const touched = new Set();

  // Group by workbook+sheet
  const groups = new Map();
  for (const r of rows) {
    const dt = DateTime.fromISO(String(r.date || ''), { zone: IST });
    if (!dt.isValid) continue;
    const wbName = quarterWorkbookName(dt);
    const sheet = monthSheetName(dt);
    const key = `${wbName}::${sheet}`;
    if (!groups.has(key)) groups.set(key, { wbName, sheet, rows: [] });
    groups.get(key).rows.push(r);
  }

  const outputs = [];
  for (const g of groups.values()) {
    const fp = path.join(baseDir, g.wbName);
    const wb = ensureWorkbook(fp);
    ensureSheetWithHeaders(wb, g.sheet, headers);

    const existing = existingMessageIdsForSheet(wb, g.sheet);
    const toAdd = [];

    for (const r of g.rows) {
      const mid = String(r.messageId || '').trim();
      if (!mid) continue;
      if (existing.has(mid)) continue;
      existing.add(mid);
      toAdd.push(r);
    }

    if (!dryRun && toAdd.length) {
      appendRowsToSheet(wb, g.sheet, toAdd, headers);
      XLSX.writeFile(wb, fp);
    }

    if (toAdd.length) touched.add(fp);
    outputs.push({ workbook: fp, sheet: g.sheet, appended: toAdd.length, considered: g.rows.length });
  }

  return { outputs, touched: Array.from(touched) };
}

function runNode(scriptPath, args, opts = {}) {
  // Use execFileSync for predictable behavior and easy logging.
  return execFileSync(process.execPath, [scriptPath, ...args], {
    stdio: opts.stdio || 'inherit',
    env: { ...process.env, ...(opts.env || {}) },
  });
}

function main() {
  const cfg = parseArgs(process.argv);
  fs.mkdirSync(cfg.baseDir, { recursive: true });

  const reportsDir = path.join(cfg.baseDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const t0 = Date.now();
  const report = {
    ok: true,
    ranAt: new Date().toISOString(),
    baseDir: cfg.baseDir,
    label: cfg.label,
    dryRun: cfg.dryRun,
    minConfidence: cfg.minConfidence,
    steps: {},
    touchedWorkbooks: [],
    errors: []
  };

  try {
    // 1) Gmail: orders
    const ordersScript = path.join(__dirname, '..', 'gmail', 'gmail_parse_orders_v2_stateful.js');
    runNode(ordersScript, ['--base-dir', cfg.baseDir, '--label', cfg.label, '--max', String(cfg.maxOrders)]);
    report.steps.orders = { ok: true };
  } catch (e) {
    report.steps.orders = { ok: false, error: String(e?.message || e) };
    // Continue; orders are optional for auto-create.
  }

  try {
    // 2) Gmail: payments
    const paymentsScript = path.join(__dirname, '..', 'gmail', 'gmail_parse_payments.js');
    runNode(paymentsScript, ['--base-dir', cfg.baseDir, '--label', cfg.label, '--max', String(cfg.maxPayments)]);
    report.steps.payments = { ok: true };
  } catch (e) {
    report.steps.payments = { ok: false, error: String(e?.message || e) };
  }

  // 3) Auto-create rows from payments_parsed.json
  const refs = loadRefs(cfg.baseDir);
  const paymentsDoc = readJsonSafe(path.join(cfg.baseDir, 'payments_parsed.json'), { payments: [] });
  const payments = (paymentsDoc.payments || []).filter(p => String(p.messageId || '').trim());

  const candidateRows = [];
  let autoCreateCandidates = 0;
  for (const p of payments) {
    const row = paymentToRow(p, refs);
    if (!shouldAutoCreate(p, row, cfg.minConfidence)) continue;
    autoCreateCandidates++;
    candidateRows.push(row);
  }

  const { outputs, touched } = appendRowsIdempotent({ baseDir: cfg.baseDir, rows: candidateRows, dryRun: cfg.dryRun });
  report.steps.autoCreate = {
    ok: true,
    candidates: autoCreateCandidates,
    appendedByTarget: outputs,
  };
  report.touchedWorkbooks = touched;

  // In dry-run, do not run any mutating post-processing steps.
  if (!cfg.dryRun) {
    // 4) Post-process touched workbooks
    // (normalize + categorize; and optionally split_from_orders)
    for (const wbPath of touched) {
      try {
        if (cfg.splitFromOrders) {
          const splitScript = path.join(__dirname, '..', 'core', 'split_from_orders.js');
          runNode(splitScript, ['--file', wbPath, '--base-dir', cfg.baseDir]);
        }
        const normalizeScript = path.join(__dirname, '..', 'core', 'normalize.js');
        runNode(normalizeScript, ['--file', wbPath, '--base-dir', cfg.baseDir]);

        const categorizeScript = path.join(__dirname, '..', 'core', 'categorize.js');
        runNode(categorizeScript, ['--file', wbPath, '--base-dir', cfg.baseDir]);

      } catch (e) {
        report.errors.push({ workbook: wbPath, error: String(e?.message || e) });
      }
    }

    // 5) Build dashboard (quarterly-only scan already enforced)
    if (cfg.rebuildDashboard) {
      try {
        const dashScript = path.join(__dirname, '..', 'dashboard', 'build_dashboard.js');
        runNode(dashScript, [cfg.baseDir, cfg.dashboardJson, cfg.dashboardHtml]);
        report.steps.dashboard = { ok: true, outJson: cfg.dashboardJson, outHtml: cfg.dashboardHtml };
      } catch (e) {
        report.steps.dashboard = { ok: false, error: String(e?.message || e) };
      }
    }
  }

  report.ms = Date.now() - t0;
  const outReport = path.join(reportsDir, `poll_ingest_${DateTime.now().toFormat('yyyyLLdd_HHmmss')}.json`);
  writeJson(outReport, report);

  process.stdout.write(JSON.stringify({ ok: true, report: outReport, ...report.steps.autoCreate }, null, 2) + '\n');
}

main();
