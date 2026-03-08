import fs from 'node:fs';
import path from 'node:path';

function getArg(args: string[], name: string) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const baseDir = String(getArg(args, '--base-dir') || '');
  const rowsFile = String(getArg(args, '--rows-file') || '');
  if (!baseDir) throw new Error('missing_base_dir');
  if (!rowsFile) throw new Error('missing_rows_file');

  const rows = JSON.parse(fs.readFileSync(rowsFile, 'utf8')) as any[];
  if (!Array.isArray(rows)) throw new Error('bad_rows');

  const headers = [
    'txn_id','group_id','date','type','amount','source','location','merchant_code','category','subcategory','tags',
    'beneficiary','reimb_status','counterparty','linked_txn_id','notes','raw_text','parse_status','parse_error',
    'messageId'
  ];

  // Ensure fields exist for stable sheets
  for (const r of rows) {
    if (r.messageId === undefined) r.messageId = '';
    if (r.tags === undefined) r.tags = '';
    if (Array.isArray(r._tags) && !r.tags) r.tags = r._tags.join(',');
  }

  // Load storeAppend from repo source.
  // This script is run via `node` from the server, with repoDir working directory.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { storeAppend } = require(path.join(process.cwd(), 'src', 'excel', 'workbook_store'));

  const outputs = storeAppend({ baseDir, headers, rows });
  process.stdout.write(JSON.stringify({ ok: true, outputs, imported: rows.length }, null, 2));
  process.stdout.write('\n');
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err?.message || err) + '\n');
  process.exit(1);
});
