#!/usr/bin/env node
/* Build interactive dark dashboard + data.json from all HK_*.xlsx in a base dir.
 * Usage: node build_dashboard.js <baseDir> <outDataJson> <outHtml>
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

function listWeeklyExcels(baseDir) {
  // Prefer the most-processed file for each week.
  // Order preference: .ai.xlsx > .rebuild.xlsx > plain .xlsx (latest mtime wins within same kind)
  const entries = fs.readdirSync(baseDir);

  const weekRe = /^(HK_\d{4}-\d{2}-Week\d+)(?:\.(ai|rebuild))?\.xlsx$/i;
  const candidates = [];
  for (const f of entries) {
    const m = f.match(weekRe);
    if (!m) continue;
    const weekKey = m[1];
    const kind = (m[2] || 'plain').toLowerCase();
    const full = path.join(baseDir, f);
    const st = fs.statSync(full);
    candidates.push({ weekKey, kind, full, mtimeMs: st.mtimeMs });
  }

  const kindRank = { ai: 3, rebuild: 2, plain: 1 };
  const best = new Map();
  for (const c of candidates) {
    const cur = best.get(c.weekKey);
    if (!cur) { best.set(c.weekKey, c); continue; }
    const r1 = kindRank[c.kind] || 0;
    const r2 = kindRank[cur.kind] || 0;
    if (r1 > r2) { best.set(c.weekKey, c); continue; }
    if (r1 === r2 && c.mtimeMs > cur.mtimeMs) { best.set(c.weekKey, c); }
  }

  return [...best.values()]
    .sort((a,b)=>a.weekKey.localeCompare(b.weekKey))
    .map(x=>x.full);
}

function loadRefs(baseDir) {
  const refsDir = path.join(baseDir, 'refs');
  const categories = readJson(path.join(refsDir, 'categories.json'), {});
  const subcategories = readJson(path.join(refsDir, 'subcategories.json'), {});
  const merchants = readJson(path.join(refsDir, 'merchants.json'), {});
  const sources = readJson(path.join(refsDir, 'sources.json'), {});
  const tags = readJson(path.join(refsDir, 'tags.json'), {});
  const locations = readJson(path.join(refsDir, 'locations.json'), {});
  return { categories, subcategories, merchants, sources, tags, locations };
}

function normalizeRow(r) {
  const out = { ...r };
  // normalize keys and types
  out.amount = Number(out.amount || 0);
  out.date = String(out.date || '');
  out.type = String(out.type || '').toUpperCase();
  out.source = String(out.source || '');
  out.location = String(out.location || '');
  out.category = String(out.category || '');
  out.subcategory = String(out.subcategory || '');
  out.merchant_code = String(out.merchant_code || '');
  out.tags = String(out.tags || '');
  out._tags = out.tags.split(',').map(s => s.trim()).filter(Boolean);
  return out;
}

function loadTransactionsFromExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['Transactions'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows.map(normalizeRow);
}

function enrichRows(rows, refs) {
  for (const r of rows) {
    r.category_name = refs.categories?.[r.category]?.name || r.category || '';
    r.subcategory_name = refs.subcategories?.[r.subcategory]?.name || r.subcategory || '';
    r.merchant_name = refs.merchants?.[r.merchant_code]?.name || r.merchant_code || '';
    r.source_name = refs.sources?.[r.source]?.display || r.source || '';
    r.location_name = refs.locations?.[r.location]?.name || r.location || '';
  }
  return rows;
}

function buildData(baseDir) {
  const refs = loadRefs(baseDir);
  const files = listWeeklyExcels(baseDir);
  const all = [];
  for (const f of files) {
    const rows = loadTransactionsFromExcel(f);
    for (const r of rows) r._file = path.basename(f);
    all.push(...rows);
  }
  enrichRows(all, refs);
  return {
    generatedAt: new Date().toISOString(),
    baseDir,
    files: files.map(f => path.basename(f)),
    refs: {
      categories: refs.categories,
      subcategories: refs.subcategories,
      merchants: Object.fromEntries(Object.entries(refs.merchants).map(([k, v]) => [k, { name: v.name || k } ])),
      sources: refs.sources,
      tags: refs.tags,
      locations: refs.locations
    },
    rows: all
  };
}

function writeDashboardHTML(outHtmlPath, outDataJsonName) {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hisab Kitab Dashboard</title>
  <style>
    :root{
      --bg:#0b1020; --panel:#111a2e; --panel2:#0f1730; --text:#e6eaf2; --muted:#9aa4b2;
      --border:rgba(255,255,255,.08); --accent:#7c5cff; --accent2:#22c55e; --danger:#ef4444;
    }
    *{box-sizing:border-box}
    body{margin:0;background:radial-gradient(1200px 600px at 10% 0%, rgba(124,92,255,.25), transparent 60%),
                 radial-gradient(1200px 600px at 90% 20%, rgba(34,197,94,.18), transparent 55%),
                 var(--bg);
         color:var(--text); font:14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;}
    header{padding:18px 18px 10px; border-bottom:1px solid var(--border); position:sticky; top:0; backdrop-filter: blur(10px);
           background:rgba(11,16,32,.65); z-index:10;}
    h1{margin:0 0 6px 0; font-size:18px; letter-spacing:.2px;}
    .muted{color:var(--muted)}
    .wrap{max-width:1200px; margin:0 auto; padding:16px;}
    .grid{display:grid; grid-template-columns: 1.4fr .6fr; gap:12px; align-items:start;}
    .panel{background:linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01)); border:1px solid var(--border); border-radius:14px; padding:12px;}
    .filters{display:grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap:10px;}
    .filters .panel{padding:10px}
    label{display:block; font-size:12px; color:var(--muted); margin-bottom:6px}
    input, select{width:100%; background:rgba(255,255,255,.03); border:1px solid var(--border); color:var(--text);
                  border-radius:10px; padding:8px; outline:none;}
    select[multiple]{height:96px}
    .btnrow{display:flex; gap:8px; flex-wrap:wrap}
    button{background:rgba(124,92,255,.18); border:1px solid rgba(124,92,255,.35); color:var(--text);
           border-radius:10px; padding:8px 10px; cursor:pointer;}
    button.secondary{background:rgba(255,255,255,.04); border:1px solid var(--border)}
    button.danger{background:rgba(239,68,68,.12); border-color:rgba(239,68,68,.35)}

    .kpis{display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:10px; margin-top:12px;}
    .kpi{padding:12px}
    .kpi .v{font-size:18px; font-weight:700}
    .kpi .t{font-size:12px; color:var(--muted)}

    .charts{display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:12px;}
    .charts .panel{min-height:260px}
    canvas{max-width:100%}

    table{width:100%; border-collapse:collapse; font-size:13px;}
    th, td{padding:10px 8px; border-bottom:1px solid rgba(255,255,255,.06);}
    th{color:var(--muted); font-weight:600; text-align:left; position:sticky; top:0; background:rgba(17,26,46,.9)}
    .tablewrap{max-height:380px; overflow:auto; border-radius:12px; border:1px solid var(--border)}
    .pill{display:inline-flex; align-items:center; gap:6px; padding:3px 8px; border-radius:999px; border:1px solid var(--border); color:var(--muted); font-size:12px}
    .pill.ok{border-color:rgba(34,197,94,.35); color:#bff0d2}
    .pill.bad{border-color:rgba(239,68,68,.35); color:#fecaca}
    .rightcol{display:flex; flex-direction:column; gap:12px}

    .hint{padding:10px; border-radius:12px; border:1px dashed rgba(255,255,255,.18); color:var(--muted)}
    a{color:#b7abff}
  </style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>Hisab Kitab — Dashboard</h1>
    <div class="muted">Dark interactive dashboard. Data source: <code>${outDataJsonName}</code></div>
  </div>
</header>

<div class="wrap">
  <div class="panel hint" id="loadHint">
    If the dashboard shows “No data loaded”, click <b>Load data.json</b> and select <code>${outDataJsonName}</code>.
    (Some browsers block loading JSON via <code>file://</code>. This avoids that.)
  </div>

  <div class="filters" style="margin-top:12px">
    <div class="panel">
      <label>Load data.json</label>
      <input id="fileInput" type="file" accept="application/json" />
      <div class="btnrow" style="margin-top:8px">
        <button id="tryFetchBtn" class="secondary">Try auto-load</button>
        <button id="resetBtn" class="danger">Reset filters</button>
      </div>
    </div>
    <div class="panel">
      <label>Date from</label>
      <input id="dateFrom" type="date" />
      <label style="margin-top:10px">Date to</label>
      <input id="dateTo" type="date" />
    </div>
    <div class="panel">
      <label>Type</label>
      <select id="typeSel" multiple></select>
    </div>
    <div class="panel">
      <label>Category</label>
      <select id="catSel" multiple></select>
    </div>
    <div class="panel">
      <label>Merchant</label>
      <select id="merchSel" multiple></select>
    </div>
    <div class="panel">
      <label>Tags</label>
      <select id="tagSel" multiple></select>
    </div>
  </div>

  <div class="kpis">
    <div class="panel kpi"><div class="t">Expense</div><div class="v" id="kExpense">—</div></div>
    <div class="panel kpi"><div class="t">Income</div><div class="v" id="kIncome">—</div></div>
    <div class="panel kpi"><div class="t">Net (Income - Expense)</div><div class="v" id="kNet">—</div></div>
    <div class="panel kpi"><div class="t">Uncategorized</div><div class="v" id="kUncat">—</div></div>
  </div>

  <div class="charts">
    <div class="panel"><div class="muted">Daily spend (Expense)</div><canvas id="cDaily"></canvas></div>
    <div class="panel"><div class="muted">By category (Expense)</div><canvas id="cCat"></canvas></div>
    <div class="panel"><div class="muted">Top merchants (Expense)</div><canvas id="cMerch"></canvas></div>
    <div class="panel"><div class="muted">By source (Expense)</div><canvas id="cSource"></canvas></div>
  </div>

  <div class="grid" style="margin-top:12px">
    <div class="panel">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px">
        <div>
          <div style="font-weight:650">Transactions</div>
          <div class="muted" id="rowCount">No data loaded</div>
        </div>
        <div id="healthPill" class="pill bad">No data</div>
      </div>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Type</th><th>Amount</th><th>Merchant</th><th>Category</th><th>Subcategory</th><th>Source</th><th>Location</th><th>Tags</th><th>Raw</th>
            </tr>
          </thead>
          <tbody id="txBody"></tbody>
        </table>
      </div>
    </div>
    <div class="rightcol">
      <div class="panel">
        <div style="font-weight:650; margin-bottom:6px">Quick insights</div>
        <div class="muted" id="insights">—</div>
      </div>
      <div class="panel">
        <div style="font-weight:650; margin-bottom:6px">Uncategorized (top)</div>
        <div class="muted" id="uncatList">—</div>
      </div>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
// Dark theme for Chart.js
Chart.defaults.color = '#e6eaf2';
Chart.defaults.borderColor = 'rgba(255,255,255,.08)';
Chart.defaults.font.family = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';

let DATA = null;
let charts = {};

function fmtINR(n){
  try { return '₹' + (Number(n)||0).toLocaleString('en-IN'); } catch { return '₹' + n; }
}

function uniq(arr){ return [...new Set(arr.filter(x=>x!=='' && x!=null))].sort(); }

function readMulti(sel){
  return Array.from(sel.selectedOptions).map(o=>o.value);
}

function setOptions(sel, values, labelMap){
  const cur = new Set(readMulti(sel));
  sel.innerHTML='';
  for(const v of values){
    const opt=document.createElement('option');
    opt.value=v;
    opt.textContent=labelMap && labelMap[v] ? labelMap[v] : v;
    if(cur.has(v)) opt.selected=true;
    sel.appendChild(opt);
  }
}

function applyFilters(rows){
  const from=document.getElementById('dateFrom').value;
  const to=document.getElementById('dateTo').value;
  const types=new Set(readMulti(document.getElementById('typeSel')));
  const cats=new Set(readMulti(document.getElementById('catSel')));
  const merch=new Set(readMulti(document.getElementById('merchSel')));
  const tags=new Set(readMulti(document.getElementById('tagSel')));

  return rows.filter(r=>{
    if(from && r.date < from) return false;
    if(to && r.date > to) return false;
    if(types.size && !types.has(r.type)) return false;
    if(cats.size && !cats.has(r.category)) return false;
    if(merch.size && !merch.has(r.merchant_code)) return false;
    if(tags.size){
      const rt = r._tags || [];
      let ok=false;
      for(const t of rt) if(tags.has(t)) { ok=true; break; }
      if(!ok) return false;
    }
    return true;
  });
}

function groupSum(rows, keyFn){
  const m=new Map();
  for(const r of rows){
    const k=keyFn(r);
    m.set(k,(m.get(k)||0)+(Number(r.amount)||0));
  }
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
}

function destroyChart(name){ if(charts[name]){ charts[name].destroy(); delete charts[name]; } }

function render(rows){
  const filtered = applyFilters(rows);

  const expense = filtered.filter(r=>r.type==='EXPENSE');
  const income = filtered.filter(r=>r.type==='INCOME');
  const expTotal = expense.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const incTotal = income.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const net = incTotal - expTotal;

  document.getElementById('kExpense').textContent = fmtINR(expTotal);
  document.getElementById('kIncome').textContent = fmtINR(incTotal);
  document.getElementById('kNet').textContent = (net>=0?fmtINR(net):('-'+fmtINR(Math.abs(net))));

  const uncat = filtered.filter(r=>r.type==='EXPENSE' && (!r.category || !r.subcategory));
  document.getElementById('kUncat').textContent = String(uncat.length);

  document.getElementById('rowCount').textContent = (
    filtered.length + ' rows (Expense ' + expense.length + ', Income ' + income.length + ')'
  );
  const hp = document.getElementById('healthPill');
  if(!DATA){ hp.textContent='No data'; hp.className='pill bad'; }
  else if(uncat.length===0){ hp.textContent='All categorized'; hp.className='pill ok'; }
  else { hp.textContent=(uncat.length + ' needs review'); hp.className='pill bad'; }

  // Insights text
  const topCat = groupSum(expense, r=>r.category||'(uncategorized)')[0];
  const topMerch = groupSum(expense, r=>r.merchant_code||'(unknown)')[0];
  const days = groupSum(expense, r=>r.date);
  const topDay = days[0];
  const insights = [];
  if(topCat) insights.push('Top category: <b>' + topCat[0] + '</b> (' + fmtINR(topCat[1]) + ')');
  if(topMerch) insights.push('Top merchant: <b>' + topMerch[0] + '</b> (' + fmtINR(topMerch[1]) + ')');
  if(topDay) insights.push('Highest spend day: <b>' + topDay[0] + '</b> (' + fmtINR(topDay[1]) + ')');
  document.getElementById('insights').innerHTML = insights.length?insights.join('<br/>'):'—';

  document.getElementById('uncatList').innerHTML = uncat.slice(0,8)
    .map(r=>'<div style="margin:6px 0">• ' + (r.raw_text || '') + '</div>')
    .join('') || '—';

  // Table
  const tbody=document.getElementById('txBody');
  tbody.innerHTML='';
  for(const r of filtered.slice().sort((a,b)=>a.date.localeCompare(b.date))){
    const tr=document.createElement('tr');
    tr.innerHTML =
      '<td>' + r.date + '</td>'+
      '<td>' + r.type + '</td>'+
      '<td>' + fmtINR(r.amount) + '</td>'+
      '<td>' + (r.merchant_code||'') + '</td>'+
      '<td>' + (r.category||'') + '</td>'+
      '<td>' + (r.subcategory||'') + '</td>'+
      '<td>' + (r.source||'') + '</td>'+
      '<td>' + (r.location||'') + '</td>'+
      '<td>' + ((r._tags||[]).join(', ')) + '</td>'+
      '<td class="muted">' + ((r.raw_text||'').slice(0,80)) + '</td>';
    tbody.appendChild(tr);
  }

  // Charts
  // Daily spend line
  const daily = groupSum(expense, r=>r.date).sort((a,b)=>a[0].localeCompare(b[0]));
  destroyChart('daily');
  charts.daily = new Chart(document.getElementById('cDaily'), {
    type: 'line',
    data: { labels: daily.map(x=>x[0]), datasets: [{ label: 'Expense', data: daily.map(x=>x[1]), tension: .3, borderColor: '#7c5cff', backgroundColor: 'rgba(124,92,255,.2)', fill: true }] },
    options: { plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ display:false } }, y:{ grid:{ color:'rgba(255,255,255,.06)' } } } }
  });

  // Category pie
  const cat = groupSum(expense, r=>r.category||'(uncategorized)').slice(0,10);
  destroyChart('cat');
  charts.cat = new Chart(document.getElementById('cCat'), {
    type: 'doughnut',
    data: { labels: cat.map(x=>x[0]), datasets: [{ data: cat.map(x=>x[1]) }] },
    options: { plugins:{ legend:{ position:'bottom' } }, cutout:'60%' }
  });

  // Merch bar
  const merch = groupSum(expense, r=>r.merchant_code||'(unknown)').slice(0,10);
  destroyChart('merch');
  charts.merch = new Chart(document.getElementById('cMerch'), {
    type: 'bar',
    data: { labels: merch.map(x=>x[0]), datasets: [{ data: merch.map(x=>x[1]), backgroundColor:'rgba(34,197,94,.25)', borderColor:'rgba(34,197,94,.6)', borderWidth:1 }] },
    options: { plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ display:false } }, y:{ grid:{ color:'rgba(255,255,255,.06)' } } } }
  });

  // Source
  const src = groupSum(expense, r=>r.source||'(unknown)').slice(0,10);
  destroyChart('src');
  charts.src = new Chart(document.getElementById('cSource'), {
    type: 'pie',
    data: { labels: src.map(x=>x[0]), datasets: [{ data: src.map(x=>x[1]) }] },
    options: { plugins:{ legend:{ position:'bottom' } } }
  });
}

function setupFilters(rows){
  const types = uniq(rows.map(r=>r.type));
  const cats = uniq(rows.map(r=>r.category));
  const merch = uniq(rows.map(r=>r.merchant_code));
  const tagList = uniq(rows.flatMap(r=>r._tags||[]));

  setOptions(document.getElementById('typeSel'), types);
  setOptions(document.getElementById('catSel'), cats);
  setOptions(document.getElementById('merchSel'), merch);
  setOptions(document.getElementById('tagSel'), tagList);

  // default date range
  const dates = uniq(rows.map(r=>r.date)).sort();
  if(dates.length){
    document.getElementById('dateFrom').value = dates[0];
    document.getElementById('dateTo').value = dates[dates.length-1];
  }
}

function wireEvents(rows){
  const ids=['dateFrom','dateTo','typeSel','catSel','merchSel','tagSel'];
  for(const id of ids){
    document.getElementById(id).addEventListener('change', ()=>render(rows));
  }
  document.getElementById('resetBtn').addEventListener('click', ()=>{
    for(const id of ['typeSel','catSel','merchSel','tagSel']){
      const s=document.getElementById(id);
      for(const o of s.options) o.selected=false;
    }
    const dates = uniq(rows.map(r=>r.date)).sort();
    if(dates.length){
      document.getElementById('dateFrom').value = dates[0];
      document.getElementById('dateTo').value = dates[dates.length-1];
    }
    render(rows);
  });
}

async function tryFetch(){
  try{
    const res = await fetch('${outDataJsonName}', { cache:'no-store' });
    if(!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    DATA = data;
    document.getElementById('loadHint').style.display='none';
    setupFilters(DATA.rows);
    wireEvents(DATA.rows);
    render(DATA.rows);
  }catch(e){
    // leave hint
    console.log('Auto-load failed:', e);
  }
}

document.getElementById('tryFetchBtn').addEventListener('click', tryFetch);

document.getElementById('fileInput').addEventListener('change', async (ev)=>{
  const f = ev.target.files && ev.target.files[0];
  if(!f) return;
  const txt = await f.text();
  const data = JSON.parse(txt);
  DATA = data;
  document.getElementById('loadHint').style.display='none';
  setupFilters(DATA.rows);
  wireEvents(DATA.rows);
  render(DATA.rows);
});

// attempt auto-load once
tryFetch();
</script>
</body>
</html>`;

  fs.writeFileSync(outHtmlPath, html, 'utf8');
}

function main() {
  const baseDir = expandHome(process.argv[2] || '~/HisabKitab');
  const outJson = process.argv[3] || 'hisab_data.json';
  const outHtml = process.argv[4] || 'hisab_dashboard.html';

  const data = buildData(baseDir);
  fs.writeFileSync(path.join(baseDir, outJson), JSON.stringify(data, null, 2) + '\n', 'utf8');
  writeDashboardHTML(path.join(baseDir, outHtml), outJson);

  process.stdout.write(JSON.stringify({ ok:true, baseDir, outJson, outHtml, rows: data.rows.length, files: data.files.length }, null, 2) + '\n');
}

main();
