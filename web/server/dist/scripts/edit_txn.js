import fs from 'node:fs';
import path from 'node:path';
function getArg(args, name) {
    const i = args.indexOf(name);
    if (i === -1)
        return null;
    return args[i + 1] ?? null;
}
function listQuarterlyFiles(baseDir) {
    const files = fs.readdirSync(baseDir).filter((f) => /^HK_\d{4}_Q[1-4]\.xlsx$/i.test(f));
    return files.map((f) => path.join(baseDir, f));
}
async function main() {
    const args = process.argv.slice(2);
    const baseDir = String(getArg(args, '--base-dir') || '');
    const txnId = String(getArg(args, '--txn-id') || '');
    const patchFile = String(getArg(args, '--patch-file') || '');
    if (!baseDir)
        throw new Error('missing_base_dir');
    if (!txnId)
        throw new Error('missing_txn_id');
    if (!patchFile)
        throw new Error('missing_patch_file');
    const patch = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require('xlsx');
    const files = listQuarterlyFiles(baseDir);
    let updated = 0;
    let foundIn = null;
    for (const fp of files) {
        const wb = XLSX.readFile(fp);
        for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            if (!rows.length)
                continue;
            // Support snake_case vs pretty headers
            const sample = rows[0] || {};
            const key = (a, b) => (Object.prototype.hasOwnProperty.call(sample, a) ? a : b);
            const kTxnId = key('txn_id', 'Transaction ID');
            let changed = false;
            for (const r of rows) {
                if (String(r[kTxnId] || '') !== txnId)
                    continue;
                for (const [k, v] of Object.entries(patch)) {
                    r[k] = v;
                }
                changed = true;
                updated++;
                foundIn = { workbook: fp, sheet: sheetName };
            }
            if (changed) {
                const headers = Object.keys(rows[0] || {});
                const newWs = XLSX.utils.json_to_sheet(rows, { header: headers });
                wb.Sheets[sheetName] = newWs;
                XLSX.writeFile(wb, fp);
            }
            if (updated)
                break;
        }
        if (updated)
            break;
    }
    process.stdout.write(JSON.stringify({ ok: true, txn_id: txnId, updated, foundIn }, null, 2));
    process.stdout.write('\n');
}
main().catch((err) => {
    process.stderr.write(String(err?.stack || err?.message || err) + '\n');
    process.exit(1);
});
//# sourceMappingURL=edit_txn.js.map