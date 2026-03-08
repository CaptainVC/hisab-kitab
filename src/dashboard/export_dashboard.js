#!/usr/bin/env node
/* Export dashboard JSON for UI (reads Excel + parsed mail + flags)
 * Usage: node src/dashboard/export_dashboard.js --base-dir ~/HisabKitab
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');
const { DateTime } = require('luxon');

function expandHome(p){ return p && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p; }
function readJsonSafe(fp, fb){ try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return fb; } }

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i=args.indexOf(k); return i===-1?null:(args[i+1]||null); };
  return { baseDir: expandHome(get('--base-dir')||'~/HisabKitab') };
}

function loadExcelEntries(baseDir){
  const files = fs.readdirSync(baseDir).filter(f => /^HK_\d{4}-\d{2}-Week\d+\.xlsx$/.test(f));
  const entries = [];
  for(const f of files){
    const wb = XLSX.readFile(path.join(baseDir, f));
    const ws = wb.Sheets['Transactions'] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    for(const r of rows){
      if(!r.date) continue;
      entries.push({
        date: r.date,
        type: r.type,
        amount: r.amount,
        merchant: r.merchant_code,
        category: r.category,
        subcategory: r.subcategory,
        source: r.source,
        raw: r.raw_text || ''
      });
    }
  }
  return entries;
}

function buildSummary(entries, flags){
  let totalSpend = 0, totalIncome = 0;
  for(const e of entries){
    const amt = Number(e.amount||0);
    if(String(e.type||'').toUpperCase()==='INCOME') totalIncome += amt;
    else totalSpend += amt;
  }
  const flagCount = Object.values(flags||{}).reduce((a,b)=>a+(b?.length||0),0);
  return {
    totalSpend: Math.round(totalSpend),
    totalIncome: Math.round(totalIncome),
    net: Math.round(totalIncome - totalSpend),
    flagCount
  };
}

function main(){
  const { baseDir } = parseArgs(process.argv);
  const outDir = path.join(baseDir, 'dashboard_data');
  fs.mkdirSync(outDir, { recursive: true });

  const entries = loadExcelEntries(baseDir);
  const paymentsDoc = readJsonSafe(path.join(baseDir,'payments_parsed.json'), { payments: [] });
  const email = (paymentsDoc.payments||[]).map(p => ({
    date: DateTime.fromMillis(Number(p.internalDateMs||0)).toISODate(),
    amount: p.amount,
    merchant: (p.merchant || p.merchantHint || ''),
    source: p.source,
    direction: p.direction
  }));

  const report = readJsonSafe(path.join(baseDir,'reconcile','nightly_report.json'), {});
  const flags = report.flags || {};

  const summary = buildSummary(entries, flags);

  fs.writeFileSync(path.join(outDir,'entries.json'), JSON.stringify({ entries }, null, 2));
  fs.writeFileSync(path.join(outDir,'email.json'), JSON.stringify({ email }, null, 2));
  fs.writeFileSync(path.join(outDir,'flags.json'), JSON.stringify(flags, null, 2));
  fs.writeFileSync(path.join(outDir,'summary.json'), JSON.stringify(summary, null, 2));

  console.log(JSON.stringify({ ok:true, outDir, entries: entries.length, email: email.length, flags: Object.keys(flags).length }, null, 2));
}

main();
