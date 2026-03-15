import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function getArg(args: string[], name: string) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

function listQuarterlyFiles(baseDir: string) {
  const files = fs.readdirSync(baseDir).filter((f) => /^HK_\d{4}_Q[1-4]\.xlsx$/i.test(f));
  return files.map((f) => path.join(baseDir, f));
}

function parseTagsCsv(tags: any) {
  return String(tags || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniq(xs: string[]) {
  return Array.from(new Set(xs));
}

async function main() {
  const args = process.argv.slice(2);
  const baseDir = String(getArg(args, '--base-dir') || '');
  const txnId = String(getArg(args, '--txn-id') || '');
  const splitsFile = String(getArg(args, '--splits-file') || '');

  if (!baseDir) throw new Error('missing_base_dir');
  if (!txnId) throw new Error('missing_txn_id');
  if (!splitsFile) throw new Error('missing_splits_file');

  const splits = JSON.parse(fs.readFileSync(splitsFile, 'utf8')) as any[];
  if (!Array.isArray(splits) || !splits.length) throw new Error('bad_splits');

  const XLSX = require('xlsx');

  const files = listQuarterlyFiles(baseDir);
  let found: any = null;
  let original: any = null;

  // 1) Find & patch original transaction in-place (add superseded tag)
  for (const fp of files) {
    const wb = XLSX.readFile(fp);
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) continue;
      const sample = rows[0] || {};
      const kTxnId = Object.prototype.hasOwnProperty.call(sample, 'txn_id') ? 'txn_id' : 'Transaction ID';

      let changed = false;
      for (const r of rows) {
        if (String(r[kTxnId] || '') !== txnId) continue;
        original = r;

        const curTags = uniq(parseTagsCsv(r.tags));
        const nextTags = uniq(curTags.concat(['superseded', 'split_parent']));
        r.tags = nextTags.join(',');

        const curNotes = String(r.notes || '');
        r.notes = (curNotes ? (curNotes + ' | ') : '') + `split into ${splits.length} lines`;
        r.parse_status = 'split_parent';

        changed = true;
        found = { workbook: fp, sheet: sheetName };
        break;
      }

      if (changed) {
        const headers = Object.keys(rows[0] || {});
        const newWs = XLSX.utils.json_to_sheet(rows, { header: headers });
        wb.Sheets[sheetName] = newWs;
        XLSX.writeFile(wb, fp);
      }

      if (found) break;
    }
    if (found) break;
  }

  if (!found || !original) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'txn_not_found' }, null, 2));
    process.stdout.write('\n');
    process.exit(2);
  }

  // 2) Append child rows
  const headers = [
    'txn_id','group_id','date','type','amount','source','location','merchant_code','category','subcategory','tags',
    'beneficiary','reimb_status','counterparty','linked_txn_id','notes','raw_text','parse_status','parse_error',
    'messageId'
  ];

  const group_id = `split_${txnId}`;
  const baseDate = String(original.date || '');
  const baseType = String(original.type || 'EXPENSE');
  const baseSource = String(original.source || '');
  const baseLocation = String(original.location || '');

  const childRows = splits.map((s, idx) => {
    const amount = Number(s.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('bad_split_amount');
    return {
      txn_id: `${txnId}_s${idx + 1}_${Date.now()}`,
      group_id,
      date: baseDate,
      type: String(s.type || baseType || 'EXPENSE'),
      amount,
      source: String(s.source || baseSource || ''),
      location: String(s.location || baseLocation || ''),
      merchant_code: String(s.merchant_code || original.merchant_code || ''),
      category: String(s.category || original.category || ''),
      subcategory: String(s.subcategory || original.subcategory || ''),
      tags: String(s.tags || 'split_child'),
      beneficiary: String(s.beneficiary || ''),
      reimb_status: String(s.reimb_status || ''),
      counterparty: String(s.counterparty || ''),
      linked_txn_id: txnId,
      notes: String(s.notes || ''),
      raw_text: String(s.raw_text || ''),
      parse_status: 'split_child',
      parse_error: '',
      messageId: ''
    };
  });

  const { storeAppend } = require(path.join(process.cwd(), 'src', 'excel', 'workbook_store'));
  const outputs = storeAppend({ baseDir, headers, rows: childRows });

  process.stdout.write(JSON.stringify({ ok: true, txn_id: txnId, foundIn: found, patchedOriginal: true, children: childRows.length, outputs }, null, 2));
  process.stdout.write('\n');
}

main().catch((err) => {
  process.stderr.write(String((err as any)?.stack || (err as any)?.message || err) + '\n');
  process.exit(1);
});
