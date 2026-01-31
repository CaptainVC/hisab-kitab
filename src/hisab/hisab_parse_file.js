#!/usr/bin/env node
/* Parse a daily Hisab file (YYYY-MM-DD.txt) into structured entries.
 *
 * Usage:
 *   node src/hisab/hisab_parse_file.js --base-dir ~/HisabKitab --date 2026-01-31
 *
 * Input file:
 *   ~/HisabKitab/hisab/YYYY-MM-DD.txt
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

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
    sources: readJson(path.join(refsDir, 'sources.json'), {}),
    aliases: readJson(path.join(refsDir, 'aliases.json'), {}),
    merchants: readJson(path.join(refsDir, 'merchants.json'), {})
  };
}

function parseAmountPrefix(line) {
  // Accept:
  // - 2600/- Amazon
  // - 2,600/- Amazon
  // - 2600 Amazon
  // - 2,600 Amazon
  let m = line.match(/^\s*([\d,]+)\s*\/\-\s*(.*)$/);
  if (m) {
    const amount = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(amount)) return null;
    return { amount, rest: (m[2] || '').trim() };
  }
  m = line.match(/^\s*([\d,]+)\s+(.*)$/);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  return { amount, rest: (m[2] || '').trim() };
}

function extractParen(rest) {
  const m = rest.match(/^(.*)\(([^)]*)\)\s*$/);
  if (!m) return { body: rest.trim(), paren: '' };
  return { body: m[1].trim(), paren: m[2].trim() };
}

function parseSourceFromParen(paren, refs) {
  if (!paren) return '';
  const head = paren.split(',')[0].trim();
  if (!head) return '';

  if (refs.sources?.[head]) return head;

  const alias = refs.aliases?.[head];
  if (alias && (alias.kind === 'source' || alias.kind === 'account')) {
    const v = alias.value;
    if (refs.sources?.[v]) return v;
  }

  const k = Object.keys(refs.sources || {}).find(s => s.toLowerCase() === head.toLowerCase());
  return k || '';
}

function inferMerchantCode(desc, refs) {
  const trimmed = (desc || '').trim();
  if (!trimmed) return '';
  const firstWord = trimmed.split(/\s+/)[0];
  if (refs.aliases?.[firstWord]?.kind === 'merchant') return refs.aliases[firstWord].value;

  const hay = trimmed.toLowerCase();
  for (const [code, m] of Object.entries(refs.merchants || {})) {
    const name = String(m.name || '').toLowerCase();
    if (name && hay.includes(name)) return code;
  }
  return '';
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const get = (k) => {
    const i = args.indexOf(k);
    return i === -1 ? null : (args[i + 1] ?? null);
  };
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    date: get('--date')
  };
}

function main() {
  const { baseDir, date } = parseArgs(process.argv);
  if (!date) {
    console.error('Usage: node hisab_parse_file.js --date YYYY-MM-DD [--base-dir ~/HisabKitab]');
    process.exit(2);
  }

  const refs = loadRefs(baseDir);
  const fp = path.join(baseDir, 'hisab', `${date}.txt`);
  if (!fs.existsSync(fp)) {
    console.error('Missing hisab file: ' + fp);
    process.exit(2);
  }

  const text = fs.readFileSync(fp, 'utf8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const entries = [];
  const errors = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // Allow comment lines
    if (line.startsWith('#')) continue;

    // allow explicit cash/splitwise/cod markers without amount-prefix
    // but we still encourage amount-first.
    const amountPrefix = parseAmountPrefix(line);
    if (!amountPrefix) {
      errors.push({ lineNo: idx + 1, line, error: 'Missing amount prefix like 2600/- (or "cash 120 ..." is not supported yet)' });
      continue;
    }

    const { amount, rest } = amountPrefix;
    const { body, paren } = extractParen(rest);
    const source = parseSourceFromParen(paren, refs) || '';
    const merchant_code = inferMerchantCode(body, refs);

    entries.push({
      date,
      amount,
      raw: line,
      desc: body,
      source_hint: source,
      merchant_hint: merchant_code,
      paren
    });
  }

  const out = { ok: true, date, file: fp, count: entries.length, entries, errors };

  const outPath = path.join(baseDir, 'hisab_entries', `${date}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

  process.stdout.write(JSON.stringify({ ...out, saved: outPath }, null, 2) + '\n');
}

// internal helper for other scripts (optional)
function parseFileForReconcile(fp, date, baseDir) {
  const refs = loadRefs(baseDir);
  const text = fs.readFileSync(fp, 'utf8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const entries = [];
  const errors = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.startsWith('#')) continue;
    const amountPrefix = parseAmountPrefix(line);
    if (!amountPrefix) { errors.push({ lineNo: idx + 1, line, error: 'Missing amount prefix' }); continue; }
    const { amount, rest } = amountPrefix;
    const { body, paren } = extractParen(rest);
    const source = parseSourceFromParen(paren, refs) || '';
    const merchant_code = inferMerchantCode(body, refs);
    entries.push({ date, amount, raw: line, desc: body, source_hint: source, merchant_hint: merchant_code, paren });
  }
  return { ok: true, date, file: fp, count: entries.length, entries, errors };
}

module.exports = { _parseFileForReconcile: parseFileForReconcile };

if (require.main === module) main();
