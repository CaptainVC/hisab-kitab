import fs from 'node:fs';
import path from 'node:path';
function getArg(args, name) {
    const i = args.indexOf(name);
    if (i === -1)
        return null;
    return args[i + 1] ?? null;
}
async function main() {
    const args = process.argv.slice(2);
    const baseDir = String(getArg(args, '--base-dir') || '');
    const rowsFile = String(getArg(args, '--rows-file') || '');
    if (!baseDir)
        throw new Error('missing_base_dir');
    if (!rowsFile)
        throw new Error('missing_rows_file');
    const rows = JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
    if (!Array.isArray(rows))
        throw new Error('bad_rows');
    const headers = [
        'txn_id', 'group_id', 'date', 'type', 'amount', 'source', 'location', 'merchant_code', 'category', 'subcategory', 'tags',
        'beneficiary', 'reimb_status', 'counterparty', 'linked_txn_id', 'notes', 'raw_text', 'parse_status', 'parse_error',
        'messageId'
    ];
    // Ensure fields exist for stable sheets
    for (const r of rows) {
        if (r.txn_id === undefined)
            r.txn_id = '';
        if (r.messageId === undefined)
            r.messageId = '';
        if (r.tags === undefined)
            r.tags = '';
        if (Array.isArray(r._tags) && !r.tags)
            r.tags = r._tags.join(',');
    }
    // Load storeAppend from repo source.
    // This script runs as ESM (tsc output), so use dynamic import.
    const { pathToFileURL } = await import('node:url');
    const modPath = path.join(process.cwd(), 'src', 'excel', 'workbook_store.js');
    const mod = await import(pathToFileURL(modPath).href);
    const storeAppend = mod.storeAppend || mod?.default?.storeAppend;
    const ensureWorkbook = mod.ensureWorkbook || mod?.default?.ensureWorkbook;
    const readSheetRows = mod.readSheetRows || mod?.default?.readSheetRows;
    if (typeof storeAppend !== 'function')
        throw new Error('storeAppend_missing');
    // Fill missing txn_id values before append so rows are editable.
    // txn_id format: hisab_YYYY-MM-DD_00000 (sequence per date).
    const maxByDate = new Map();
    const pad5 = (n) => String(n).padStart(5, '0');
    function parseSeq(id) {
        const m = String(id || '').match(/_(\d{5})$/);
        if (!m)
            return null;
        const n = Number(m[1]);
        return Number.isFinite(n) ? n : null;
    }
    // Pre-scan existing sheets for dates we are about to insert.
    const dates = Array.from(new Set(rows.map((r) => String(r.date || '')).filter(Boolean)));
    for (const d of dates) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
            continue;
        if (maxByDate.has(d))
            continue;
        try {
            // Compute workbook + sheet names (same convention as workbook_store.js)
            const yy = Number(d.slice(0, 4));
            const mm = Number(d.slice(5, 7));
            const q = Math.floor((mm - 1) / 3) + 1;
            const wbName = `HK_${yy}_Q${q}.xlsx`;
            const mon = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
            const sheetName = `${mon}-${yy}`;
            const wbPath = path.join(baseDir, wbName);
            const wb = typeof ensureWorkbook === 'function' ? ensureWorkbook(wbPath) : null;
            const existing = wb && typeof readSheetRows === 'function' ? readSheetRows(wb, sheetName) : [];
            let max = -1;
            for (const r of existing || []) {
                const id = String(r.txn_id || '').trim();
                if (!id)
                    continue;
                if (!id.startsWith(`hisab_${d}_`))
                    continue;
                const seq = parseSeq(id);
                if (seq === null)
                    continue;
                if (seq > max)
                    max = seq;
            }
            maxByDate.set(d, max);
        }
        catch {
            maxByDate.set(d, -1);
        }
    }
    for (const r of rows) {
        const d = String(r.date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
            continue;
        const cur = String(r.txn_id || '').trim();
        if (cur)
            continue;
        const next = (maxByDate.get(d) ?? -1) + 1;
        maxByDate.set(d, next);
        r.txn_id = `hisab_${d}_${pad5(next)}`;
    }
    const outputs = storeAppend({ baseDir, headers, rows });
    process.stdout.write(JSON.stringify({ ok: true, outputs, imported: rows.length }, null, 2));
    process.stdout.write('\n');
}
main().catch((err) => {
    process.stderr.write(String(err?.stack || err?.message || err) + '\n');
    process.exit(1);
});
//# sourceMappingURL=staging_commit_rows.js.map