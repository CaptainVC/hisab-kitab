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
         color:var(--text); font:15px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;}
    header{padding:18px 18px 10px; border-bottom:1px solid var(--border); position:sticky; top:0; backdrop-filter: blur(10px);
           background:rgba(11,16,32,.65); z-index:10;}
    h1{margin:0 0 6px 0; font-size:18px; letter-spacing:.2px;}
    .muted{color:rgba(220,226,240,.72)}
    .wrap{max-width:1200px; margin:0 auto; padding:16px;}
    .panel{background:linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01)); border:1px solid var(--border); border-radius:14px; padding:12px;}
    .filters{display:grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap:10px;}
    .filters .panel{padding:10px}

    .summary{display:grid; grid-template-columns: 1.2fr 1fr .8fr; gap:12px; align-items:start;}
    .insRow{display:grid; grid-template-columns: 1.2fr .8fr 1fr; gap:12px; align-items:start;}
    .charts{display:grid; grid-template-columns: 1.3fr .7fr; gap:12px; align-items:start;}
    label{display:block; font-size:12px; color:var(--muted); margin-bottom:6px}
    input, select{width:100%; background:rgba(255,255,255,.03); border:1px solid var(--border); color:var(--text);
                  border-radius:10px; padding:8px; outline:none;}
    #catInsightSel{width:auto; padding:6px 10px; border-radius:999px; font-size:13px}
    input::placeholder{color:rgba(154,164,178,.75)}
    select[multiple]{height:120px; padding:6px}
    select[multiple] option{padding:6px; border-radius:8px}
    select[multiple] option:checked{background:rgba(124,92,255,.25)}
    .btnrow{display:flex; gap:8px; flex-wrap:wrap}
    button{background:rgba(124,92,255,.18); border:1px solid rgba(124,92,255,.35); color:var(--text);
           border-radius:10px; padding:8px 10px; cursor:pointer;}
    button.secondary{background:rgba(255,255,255,.04); border:1px solid var(--border)}
    button.danger{background:rgba(239,68,68,.12); border-color:rgba(239,68,68,.35)}

    .kpis{display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px; margin-top:10px;}
    .kpi{padding:10px; border:1px solid rgba(255,255,255,.07); border-radius:12px; background:rgba(255,255,255,.02)}
    .kpi .v{font-size:18px; font-weight:750}
    .kpi .t{font-size:12px; color:rgba(220,226,240,.72)}

    .charts .panel{min-height:220px}
    canvas{max-width:100%}
    #cCat{max-height:240px}
    #cDaily{max-height:260px}

    .srcRow{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; border:1px solid rgba(255,255,255,.08); border-radius:12px; background:rgba(255,255,255,.02)}
    .srcRow .name{font-weight:650; color:#fff}
    .srcRow .amt{font-weight:750}

    table{width:100%; border-collapse:collapse; font-size:14px;}
    th, td{padding:10px 8px; border-bottom:1px solid rgba(255,255,255,.06);}
    th{color:rgba(230,234,242,.78); font-weight:650; text-align:left; position:sticky; top:0; background:rgba(17,26,46,.9)}
    /* Transactions table: JS will size it to match the right sidebar height */
    .grid{align-items:start;}
    .tablewrap{overflow:auto; border-radius:12px; border:1px solid var(--border)}
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
      <input id="typeSearch" placeholder="Search…" />
      <div class="muted" id="typeCount" style="margin:6px 0 6px">Selected: 0</div>
      <select id="typeSel" multiple></select>
    </div>
    <div class="panel">
      <label>Category</label>
      <input id="catSearch" placeholder="Search…" />
      <div class="muted" id="catCount" style="margin:6px 0 6px">Selected: 0</div>
      <select id="catSel" multiple></select>
    </div>
    <div class="panel">
      <label>Merchant</label>
      <input id="merchSearch" placeholder="Search…" />
      <div class="muted" id="merchCount" style="margin:6px 0 6px">Selected: 0</div>
      <select id="merchSel" multiple></select>
    </div>
    <div class="panel">
      <label>Source</label>
      <input id="sourceSearch" placeholder="Search…" />
      <div class="muted" id="sourceCount" style="margin:6px 0 6px">Selected: 0</div>
      <select id="sourceSel" multiple></select>
    </div>
    <div class="panel">
      <label>Tags</label>
      <input id="tagSearch" placeholder="Search…" />
      <div class="muted" id="tagCount" style="margin:6px 0 6px">Selected: 0</div>
      <select id="tagSel" multiple></select>
    </div>
  </div>

  <!-- Summary row: KPIs + Sources + Needs review -->
  <div class="summary" style="margin-top:12px">
    <div class="panel">
      <div style="font-weight:650; margin-bottom:6px">Summary</div>
      <div class="muted" style="margin-bottom:10px">Expense · Income · Net (based on selected Types)</div>
      <div class="kpis">
        <div class="kpi"><div class="t">Expense</div><div class="v" id="kExpense">—</div></div>
        <div class="kpi"><div class="t">Income</div><div class="v" id="kIncome">—</div></div>
        <div class="kpi"><div class="t">Net</div><div class="v" id="kNet">—</div></div>
        <div class="kpi"><div class="t">Needs review</div><div class="v" id="kUncat">—</div></div>
      </div>
    </div>

    <div class="panel">
      <div style="font-weight:650; margin-bottom:6px">Sources</div>
      <div id="sourceCard" style="margin-top:10px; display:flex; flex-direction:column; gap:8px"></div>
    </div>

    <div class="panel">
      <div style="font-weight:650; margin-bottom:6px">Needs review</div>
      <div class="muted" id="uncatList">—</div>
    </div>
  </div>

  <!-- Insights row -->
  <div class="insRow" style="margin-top:12px">
    <div class="panel">
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:8px">
        <div style="font-weight:650">Insights</div>
        <div class="pill" id="insightPill">—</div>
      </div>
      <div id="insights" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px"></div>
    </div>

    <div class="panel">
      <div style="font-weight:650; margin-bottom:6px">Patterns</div>
      <div class="muted" id="patternInsights">—</div>
    </div>

    <div class="panel" id="foodPanel">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px">
        <div style="display:flex; align-items:center; gap:10px">
          <div style="font-weight:650">Subcategory insights</div>
          <select id="catInsightSel" style="max-width:220px"></select>
        </div>
        <div class="pill" id="foodPill">—</div>
      </div>
      <div id="foodInsights" style="display:flex; flex-direction:column; gap:10px"></div>
    </div>
  </div>

  <!-- Charts row -->
  <div class="charts" style="margin-top:12px">
    <div class="panel"><div class="muted" id="tDaily">Daily spend</div><canvas id="cDaily"></canvas></div>
    <div class="panel"><div class="muted" id="tCat">By category</div><canvas id="cCat"></canvas></div>
  </div>

  <!-- Transactions -->
  <div class="panel" style="margin-top:12px">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px">
      <div>
        <div style="font-weight:650">Transactions</div>
        <div class="muted" id="rowCount">No data loaded</div>
      </div>
      <div id="healthPill" class="pill bad">No data</div>
    </div>
    <div class="tablewrap" style="height:520px">
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
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
// Dark theme for Chart.js
Chart.defaults.color = '#ffffff';
Chart.defaults.borderColor = 'rgba(255,255,255,.08)';
Chart.defaults.font.family = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
Chart.defaults.plugins.legend.labels.color = '#ffffff';
Chart.defaults.plugins.legend.labels.boxWidth = 14;
Chart.defaults.plugins.legend.labels.boxHeight = 10;
Chart.defaults.plugins.legend.labels.padding = 14;
Chart.defaults.plugins.legend.labels.font = { size: 13, weight: '600' };

// Default tooltip formatting: show INR for numeric values
// (Be defensive: if the callback throws, Chart.js can suppress tooltips.)
Chart.defaults.plugins.tooltip = {
  ...(Chart.defaults.plugins.tooltip || {}),
  enabled: true,
  callbacks: {
    ...(Chart.defaults.plugins.tooltip?.callbacks || {}),
    label: (ctx) => {
      try {
        const prefix = ctx.label ? (ctx.label + ': ') : (ctx.dataset?.label ? (ctx.dataset.label + ': ') : '');
        // formattedValue is always present and already formatted by Chart.js
        const fv = ctx.formattedValue;
        const num = Number(String(fv).replace(/[^0-9.-]/g,''));
        if (Number.isFinite(num)) return prefix + fmtINR(num);
        // fall back
        return prefix + String(fv ?? '');
      } catch (e) {
        return String(ctx.formattedValue ?? '');
      }
    }
  }
};

let DATA = null;
let charts = {};
let ALL_OPTS = { type: [], category: [], merchant: [], source: [], tag: [] };

function showLoadError(err){
  const hint = document.getElementById('loadHint');
  if (!hint) return;
  hint.style.display = 'block';
  hint.innerHTML = '<b>Dashboard error:</b> ' + String(err).replace(/</g,'&lt;');
}

window.addEventListener('error', (e) => {
  if (e && e.message) showLoadError(e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  showLoadError(e?.reason || 'Unhandled promise rejection');
});

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

function setOnlySelected(sel, value){
  let has=false;
  for(const o of sel.options){
    const on = (o.value === value);
    o.selected = on;
    if(on) has=true;
  }
  return has;
}

function toggleSelected(sel, value){
  for(const o of sel.options){
    if(o.value === value){ o.selected = !o.selected; return true; }
  }
  return false;
}

function clearSelected(sel){
  for(const o of sel.options) o.selected=false;
}

function updateCounts(){
  const map=[['typeSel','typeCount'],['catSel','catCount'],['merchSel','merchCount'],['sourceSel','sourceCount'],['tagSel','tagCount']];
  for(const [sid,cid] of map){
    const s=document.getElementById(sid);
    const c=document.getElementById(cid);
    if(!s||!c) continue;
    c.textContent = 'Selected: ' + readMulti(s).length;
  }
}

function refreshFilteredOptions(){
  const typeQ=(document.getElementById('typeSearch')?.value||'').toLowerCase();
  const catQ=(document.getElementById('catSearch')?.value||'').toLowerCase();
  const merchQ=(document.getElementById('merchSearch')?.value||'').toLowerCase();
  const sourceQ=(document.getElementById('sourceSearch')?.value||'').toLowerCase();
  const tagQ=(document.getElementById('tagSearch')?.value||'').toLowerCase();

  const prettyCode = (s) => String(s||'')
    .replace(/_/g,' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());

  const lmType = Object.fromEntries((ALL_OPTS.type||[]).map(x=>[x, prettyCode(x)]));
  const lmCat = Object.fromEntries((ALL_OPTS.category||[]).map(x=>[x, DATA?.refs?.categories?.[x]?.name || prettyCode(x)]));
  const lmMerch = Object.fromEntries((ALL_OPTS.merchant||[]).map(x=>[x, DATA?.refs?.merchants?.[x]?.name || prettyCode(x)]));
  const lmSource = Object.fromEntries((ALL_OPTS.source||[]).map(x=>[x, DATA?.refs?.sources?.[x]?.display || prettyCode(x)]));
  const lmTag = Object.fromEntries((ALL_OPTS.tag||[]).map(x=>[x, prettyCode(x)]));

  setOptions(document.getElementById('typeSel'), ALL_OPTS.type.filter(x=>String(lmType[x]||x).toLowerCase().includes(typeQ) || String(x).toLowerCase().includes(typeQ)), lmType);
  setOptions(document.getElementById('catSel'), ALL_OPTS.category.filter(x=>String(lmCat[x]||x).toLowerCase().includes(catQ) || String(x).toLowerCase().includes(catQ)), lmCat);
  setOptions(document.getElementById('merchSel'), ALL_OPTS.merchant.filter(x=>String(lmMerch[x]||x).toLowerCase().includes(merchQ) || String(x).toLowerCase().includes(merchQ)), lmMerch);
  setOptions(document.getElementById('sourceSel'), ALL_OPTS.source.filter(x=>String(lmSource[x]||x).toLowerCase().includes(sourceQ) || String(x).toLowerCase().includes(sourceQ)), lmSource);
  setOptions(document.getElementById('tagSel'), ALL_OPTS.tag.filter(x=>String(lmTag[x]||x).toLowerCase().includes(tagQ) || String(x).toLowerCase().includes(tagQ)), lmTag);
  updateCounts();
}

function applyFilters(rows){
  const from=document.getElementById('dateFrom').value;
  const to=document.getElementById('dateTo').value;
  const types=new Set(readMulti(document.getElementById('typeSel')));
  const cats=new Set(readMulti(document.getElementById('catSel')));
  const merch=new Set(readMulti(document.getElementById('merchSel')));
  const sources=new Set(readMulti(document.getElementById('sourceSel')));
  const tags=new Set(readMulti(document.getElementById('tagSel')));

  return rows.filter(r=>{
    if(from && r.date < from) return false;
    if(to && r.date > to) return false;
    if(types.size && !types.has(r.type)) return false;
    if(cats.size && !cats.has(r.category)) return false;
    if(merch.size && !merch.has(r.merchant_code)) return false;
    if(sources.size && !sources.has(r.source)) return false;
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

function syncTableHeight(){
  // Layout now uses fixed heights; nothing to sync.
}

function render(rows){
  // Base filter: everything except Type (so Summary + Needs review do NOT change when you toggle types)
  const from=document.getElementById('dateFrom').value;
  const to=document.getElementById('dateTo').value;
  const cats=new Set(readMulti(document.getElementById('catSel')));
  const merch=new Set(readMulti(document.getElementById('merchSel')));
  const sources=new Set(readMulti(document.getElementById('sourceSel')));
  const tags=new Set(readMulti(document.getElementById('tagSel')));

  const baseFiltered = rows.filter(r=>{
    if(from && r.date < from) return false;
    if(to && r.date > to) return false;
    if(cats.size && !cats.has(r.category)) return false;
    if(merch.size && !merch.has(r.merchant_code)) return false;
    if(sources.size && !sources.has(r.source)) return false;
    if(tags.size){
      const rt = r._tags || [];
      let ok=false;
      for(const t of rt) if(tags.has(t)) { ok=true; break; }
      if(!ok) return false;
    }
    return true;
  });

  // Types filter affects charts/insights/table.
  // If user selects nothing, default to EXPENSE (and reflect in UI).
  const typeSelEl = document.getElementById('typeSel');
  let selectedTypes = readMulti(typeSelEl);
  if (!selectedTypes.length) {
    selectedTypes = ['EXPENSE'];
    for (const o of typeSelEl.options) o.selected = (o.value === 'EXPENSE');
  }

  const focusRows = baseFiltered.filter(r => selectedTypes.includes(r.type));

  // Summary always from baseFiltered (ALL types)
  const summaryRows = baseFiltered;

  const summaryExpense = summaryRows.filter(r=>r.type==='EXPENSE');
  const summaryIncome = summaryRows.filter(r=>r.type==='INCOME');
  const expTotal = summaryExpense.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const incTotal = summaryIncome.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const net = incTotal - expTotal;

  document.getElementById('kExpense').textContent = fmtINR(expTotal);
  document.getElementById('kIncome').textContent = fmtINR(incTotal);
  document.getElementById('kNet').textContent = (net>=0?fmtINR(net):('-'+fmtINR(Math.abs(net))));

  // Needs review: only EXPENSE rows need category/subcategory
  const uncat = summaryRows.filter(r => r.type==='EXPENSE' && (!r.category || !r.subcategory));
  document.getElementById('kUncat').textContent = String(uncat.length);

  // For insights/charts that are expense-specific, keep using the focusRows subset.
  const expense = focusRows.filter(r=>r.type==='EXPENSE');
  const income = focusRows.filter(r=>r.type==='INCOME');

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
  const topSub = groupSum(expense, r=>r.subcategory||'(uncategorized)')[0];
  const topSrc = groupSum(expense, r=>r.source||'(unknown)')[0];

  const daySpend = groupSum(expense, r=>r.date).sort((a,b)=>b[1]-a[1]);
  const topDay = daySpend[0];
  const avgDaily = daySpend.length ? (daySpend.reduce((s,x)=>s+x[1],0) / daySpend.length) : 0;

  // biggest single expense row
  const biggest = expense.slice().sort((a,b)=>(Number(b.amount)||0)-(Number(a.amount)||0))[0] || null;

  // avg txn size
  const avgTxn = expense.length ? (expTotal / expense.length) : 0;

  // category share
  const catSeriesAll = groupSum(expense, r=>r.category||'(uncategorized)');
  const top3Cats = catSeriesAll.slice(0,3);

  const nameCat = (code) => (DATA?.refs?.categories?.[code]?.name) || code;
  const nameSub = (code) => (DATA?.refs?.subcategories?.[code]?.name) || code;
  const nameMerch = (code) => (DATA?.refs?.merchants?.[code]?.name) || code;
  const nameSrc = (code) => (DATA?.refs?.sources?.[code]?.display) || code;

  const insightBlocks = [];
  const addBlock = (title, value, sub) => {
    insightBlocks.push(
      '<div>'+
        '<div class="muted" style="font-size:12px">'+title+'</div>'+
        '<div style="font-weight:700; font-size:14px">'+value+'</div>'+
        (sub ? '<div class="muted" style="margin-top:2px">'+sub+'</div>' : '')+
      '</div>'
    );
  };

  if(topCat) addBlock('Top category', nameCat(topCat[0]), fmtINR(topCat[1]));
  if(topSub) addBlock('Top subcategory', nameSub(topSub[0]), fmtINR(topSub[1]));
  if(topMerch) addBlock('Top merchant', nameMerch(topMerch[0]), fmtINR(topMerch[1]));
  if(topSrc) addBlock('Top payment source', nameSrc(topSrc[0]), fmtINR(topSrc[1]));
  if(topDay) addBlock('Highest spend day', topDay[0], fmtINR(topDay[1]));
  if(daySpend.length) addBlock('Avg daily expense', fmtINR(avgDaily), 'across '+daySpend.length+' days');
  if(expense.length) addBlock('Avg expense per txn', fmtINR(avgTxn), expense.length+' expense txns');
  if(biggest) addBlock('Biggest expense', fmtINR(biggest.amount), (biggest.raw_text || '').slice(0,80));

  if(top3Cats.length){
    const s = top3Cats.map(([c,a])=>{
      const pct = expTotal ? Math.round((a/expTotal)*100) : 0;
      return nameCat(c) + ' ' + pct + '%';
    }).join(' · ');
    addBlock('Top 3 category mix', s, 'share of expense');
  }

  // Subcategory insights panel (category dropdown)
  const catInsightSel = document.getElementById('catInsightSel');
  const selectedCats = readMulti(document.getElementById('catSel'));
  // Hierarchy: Category filter → dropdown.
  // If exactly one category is selected in filter, force dropdown to it.
  if (catInsightSel && selectedCats.length === 1) {
    catInsightSel.value = selectedCats[0];
  }

  const catFocus = catInsightSel ? String(catInsightSel.value || '') : 'FOOD_DINING';

  const catRows = expense.filter(r=>r.category===catFocus);
  const catEl = document.getElementById('foodInsights');
  const catPill = document.getElementById('foodPill');

  if (catEl) {
    if (!catRows.length) {
      catEl.innerHTML = '<div class="muted">—</div>';
      if (catPill) catPill.textContent = '—';
    } else {
      const catTotal = catRows.reduce((s,r)=>s+(Number(r.amount)||0),0);
      const bySub = groupSum(catRows, r=>r.subcategory||'(uncategorized)');
      const topSub = bySub[0];

      const catMerch = groupSum(catRows, r=>r.merchant_code||'(unknown)').slice(0,5);
      const catDays = groupSum(catRows, r=>r.date).sort((a,b)=>b[1]-a[1]);
      const topDay2 = catDays[0];

      const pct = (a, base) => base ? Math.round((a/base)*100) : 0;

      const blocks = [];
      const add = (t, v, s) => {
        blocks.push(
          '<div>'+
            '<div class="muted" style="font-size:12px">'+t+'</div>'+
            '<div style="font-weight:750">'+v+'</div>'+
            (s ? '<div class="muted" style="margin-top:2px">'+s+'</div>' : '')+
          '</div>'
        );
      };

      const catName = nameCat(catFocus);
      add('Total ('+catName+')', fmtINR(catTotal), catRows.length + ' txns');
      if (topSub) add('Top subcategory', nameSub(topSub[0]), fmtINR(topSub[1]));

      const topSubs = bySub.slice(0,6).map(([sc,a])=>{
        return '• <b>' + nameSub(sc) + '</b> — ' + fmtINR(a) + ' (' + pct(a, catTotal) + '%)';
      }).join('<br/>');
      add('Top subcategories', topSubs, '');

      const topMerchHtml = catMerch.map(([m,a])=>{
        return '• <b>' + nameMerch(m) + '</b> — ' + fmtINR(a);
      }).join('<br/>');
      add('Top merchants', topMerchHtml, '');

      if (topDay2) add('Highest day', topDay2[0], fmtINR(topDay2[1]));

      catEl.innerHTML = blocks.join('');
      if (catPill) catPill.textContent = fmtINR(catTotal);
    }
  }

  const insightsEl = document.getElementById('insights');
  insightsEl.innerHTML = insightBlocks.length ? insightBlocks.join('') : '<div class="muted">—</div>';

  const insightPill = document.getElementById('insightPill');
  if(insightPill) insightPill.textContent = expense.length ? (expense.length + ' exp') : '—';

  // Patterns panel (simple, high-signal)
  const patEl = document.getElementById('patternInsights');
  if (patEl) {
    const mostCommonTag = (() => {
      const m = new Map();
      for (const r of focusRows) {
        for (const t of (r._tags || [])) m.set(t, (m.get(t)||0)+1);
      }
      return [...m.entries()].sort((a,b)=>b[1]-a[1])[0] || null;
    })();

    const biggest5 = focusRows
      .filter(r=>r.type==='EXPENSE')
      .slice()
      .sort((a,b)=>(Number(b.amount)||0)-(Number(a.amount)||0))
      .slice(0,5)
      .map(r=>'• <b>'+fmtINR(r.amount)+'</b> — '+(r.raw_text||'').slice(0,70))
      .join('<br/>');

    const lines = [];
    if (mostCommonTag) lines.push('<div><span class="muted">Most common tag:</span> <b>' + String(mostCommonTag[0]).replace(/_/g,' ') + '</b> (' + mostCommonTag[1] + ')</div>');
    if (biggest5) lines.push('<div style="margin-top:8px" class="muted">Top 5 expenses</div><div>'+biggest5+'</div>');
    patEl.innerHTML = lines.join('') || '<div class="muted">—</div>';
  }

  // Needs review: show by amount + click to jump/filter
  const uncatTop = uncat
    .slice()
    .sort((a,b)=>(Number(b.amount)||0)-(Number(a.amount)||0))
    .slice(0,8);

  const uncatEl = document.getElementById('uncatList');
  if (uncatEl) {
    uncatEl.innerHTML = uncatTop.map((r, i) => {
      const key = encodeURIComponent([r.date,r.type,r.amount,r.source,r.raw_text].join('|'));
      return '<div class="uncRow" data-key="'+key+'" style="margin:6px 0; cursor:pointer">'
        + '• <b>' + fmtINR(r.amount) + '</b> — ' + (r.raw_text || '')
        + '</div>';
    }).join('') || '—';

    // bind click handlers
    for (const el of Array.from(uncatEl.querySelectorAll('.uncRow'))) {
      el.addEventListener('click', () => {
        const k = decodeURIComponent(el.getAttribute('data-key') || '');
        const parts = k.split('|');
        const [d, ty, amt, src, raw] = parts;

        // set date to that day
        const df = document.getElementById('dateFrom');
        const dt = document.getElementById('dateTo');
        if (df && dt && d) { df.value = d; dt.value = d; }

        // ensure type includes this row type
        const ts = document.getElementById('typeSel');
        if (ts && ty) {
          let has=false;
          for (const o of ts.options) if (o.selected && o.value === ty) has=true;
          if (!has) {
            for (const o of ts.options) {
              if (o.value === ty) o.selected = true;
            }
          }
        }

        updateCounts();
        render(rows);

        const table = document.querySelector('.tablewrap');
        if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  // Table
  const tbody=document.getElementById('txBody');
  tbody.innerHTML='';
  for(const r of filtered.slice().sort((a,b)=>a.date.localeCompare(b.date))){
    const tr=document.createElement('tr');
    tr.innerHTML =
      '<td>' + r.date + '</td>'+
      '<td>' + r.type + '</td>'+
      '<td>' + fmtINR(r.amount) + '</td>'+
      '<td>' + (r.merchant_name||r.merchant_code||'') + '</td>'+
      '<td>' + (r.category_name||r.category||'') + '</td>'+
      '<td>' + (r.subcategory_name||r.subcategory||'') + '</td>'+
      '<td>' + (r.source_name||r.source||'') + '</td>'+
      '<td>' + (r.location_name||r.location||'') + '</td>'+
      '<td>' + ((r._tags||[]).join(', ')) + '</td>'+
      '<td class="muted">' + ((r.raw_text||'').slice(0,80)) + '</td>';
    tbody.appendChild(tr);
  }

  // After we update DOM content, re-sync table height to match sidebar
  syncTableHeight();

  // Charts
  // update chart titles based on selected types
  const typeLabel = (selectedTypes.length === (ALL_OPTS.type||[]).length) ? 'ALL TYPES' : selectedTypes.join(' + ');
  const tDaily = document.getElementById('tDaily');
  const tCat = document.getElementById('tCat');
  const tMerch = document.getElementById('tMerch');
  if (tDaily) tDaily.textContent = 'Daily spend (' + typeLabel + ')';
  if (tCat) tCat.textContent = 'By category (' + typeLabel + ')';
  if (tMerch) tMerch.textContent = 'Top merchants (' + typeLabel + ')';

  // Daily spend line (click a point to jump to that day's transactions)
  const daily = groupSum(focusRows, r=>r.date).sort((a,b)=>a[0].localeCompare(b[0]));
  destroyChart('daily');
  charts.daily = new Chart(document.getElementById('cDaily'), {
    type: 'line',
    data: { labels: daily.map(x=>x[0]), datasets: [{ label: 'Expense', data: daily.map(x=>x[1]), tension: .3, borderColor: '#7c5cff', backgroundColor: 'rgba(124,92,255,.2)', fill: true, pointRadius: 4, pointHoverRadius: 7 }] },
    options: {
      plugins:{ legend:{ display:false } },
      scales:{ x:{ grid:{ display:false } }, y:{ grid:{ color:'rgba(255,255,255,.06)' } } },
      onClick: (evt, elements) => {
        if(!elements || !elements.length) return;
        const idx = elements[0].index;
        const day = daily[idx]?.[0];
        if(!day) return;

        const df = document.getElementById('dateFrom');
        const dt = document.getElementById('dateTo');
        const shift = !!(evt?.native?.shiftKey);

        // Default behavior: set range to exactly that day.
        // If already locked to that day, click again clears back to full range.
        const alreadyLocked = (df.value === day && dt.value === day);
        if(alreadyLocked && !shift){
          const dates = uniq(rows.map(r=>r.date)).sort();
          if(dates.length){ df.value = dates[0]; dt.value = dates[dates.length-1]; }
        } else {
          df.value = day;
          dt.value = day;
        }

        updateCounts();
        render(rows);

        // scroll to transactions table
        const table = document.querySelector('.tablewrap');
        if(table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  // Category pie (click a sector to filter Category)
  const cat = groupSum(focusRows, r=>r.category||'(uncategorized)').slice(0,10);
  const catLabel = (code) => (DATA?.refs?.categories?.[code]?.name) || code;
  destroyChart('cat');
  charts.cat = new Chart(document.getElementById('cCat'), {
    type: 'doughnut',
    data: { labels: cat.map(x=>catLabel(x[0])), datasets: [{ data: cat.map(x=>x[1]) }] },
    options: {
      plugins:{
        legend:{
          position:'right',
          labels:{
            // show totals beside legend label
            generateLabels: (chart) => {
              const ds = chart.data.datasets?.[0];
              const data = (ds?.data || []).map(Number);
              const total = data.reduce((s,x)=>s+(Number(x)||0),0);
              return chart.data.labels.map((lbl, i) => {
                const v = Number(data[i]||0);
                const pct = total ? Math.round((v/total)*100) : 0;
                const fill = ds?.backgroundColor?.[i] || ds?.backgroundColor;
                return {
                  text: (String(lbl) + ' — ' + fmtINR(v) + ' (' + pct + '%)'),
                  fillStyle: fill,
                  strokeStyle: fill,
                  lineWidth: 0,
                  hidden: !chart.getDataVisibility(i),
                  index: i
                };
              });
            }
          }
        }
      },
      cutout:'60%',
      onClick: (evt, elements) => {
        if(!elements || !elements.length) return;
        const idx = elements[0].index;
        const label = cat[idx]?.[0];
        if(!label) return;

        const sel = document.getElementById('catSel');
        const shift = !!(evt?.native?.shiftKey);
        if(shift){
          toggleSelected(sel, label);
        } else {
          const already = readMulti(sel);
          if(already.length===1 && already[0]===label) clearSelected(sel);
          else setOnlySelected(sel, label);
        }
        updateCounts();
        render(rows);
      }
    }
  });

  // Merch bar (click a bar to filter Merchant)
  const merch = groupSum(focusRows, r=>r.merchant_code||'(unknown)').slice(0,10);
  destroyChart('merch');
  charts.merch = new Chart(document.getElementById('cMerch'), {
    type: 'bar',
    data: { labels: merch.map(x=>x[0]), datasets: [{ data: merch.map(x=>x[1]), backgroundColor:'rgba(34,197,94,.25)', borderColor:'rgba(34,197,94,.6)', borderWidth:1 }] },
    options: {
      plugins:{ legend:{ display:false } },
      scales:{ x:{ grid:{ display:false } }, y:{ grid:{ color:'rgba(255,255,255,.06)' } } },
      onClick: (evt, elements) => {
        if(!elements || !elements.length) return;
        const idx = elements[0].index;
        const label = merch[idx]?.[0];
        if(label==null) return;
        const sel = document.getElementById('merchSel');
        const shift = !!(evt?.native?.shiftKey);
        if(shift) toggleSelected(sel, label);
        else {
          const already = readMulti(sel);
          if(already.length===1 && already[0]===label) clearSelected(sel);
          else setOnlySelected(sel, label);
        }
        updateCounts();
        render(rows);
      }
    }
  });

  // Source summary card (instead of pie)
  const srcSeries = groupSum(focusRows, r=>r.source||'(unknown)').slice(0,10);
  const srcLabel = (code) => (DATA?.refs?.sources?.[code]?.display) || code;
  const srcTotal = srcSeries.reduce((s,x)=>s+(Number(x[1])||0),0);
  const srcEl = document.getElementById('sourceCard');
  if (srcEl) {
    srcEl.innerHTML = srcSeries.map(([code, amt]) => {
      const pct = srcTotal ? Math.round((Number(amt)/srcTotal)*100) : 0;
      return '<div class="srcRow">'
        + '<div class="name">' + srcLabel(code) + '</div>'
        + '<div class="muted" style="margin-left:auto">' + pct + '%</div>'
        + '<div class="amt">' + fmtINR(amt) + '</div>'
        + '</div>';
    }).join('');
  }
}

function setupFilters(rows){
  const types = uniq(rows.map(r=>r.type));
  const cats = uniq(rows.map(r=>r.category));
  const merch = uniq(rows.map(r=>r.merchant_code));
  const sources = uniq(rows.map(r=>r.source));
  const tagList = uniq(rows.flatMap(r=>r._tags||[]));

  ALL_OPTS = { type: types, category: cats, merchant: merch, source: sources, tag: tagList };
  refreshFilteredOptions();

  // Default: EXPENSE selected
  const typeSel = document.getElementById('typeSel');
  if (typeSel) {
    for (const o of typeSel.options) o.selected = (o.value === 'EXPENSE');
  }

  // Populate category dropdown for subcategory insights
  const catInsightSel = document.getElementById('catInsightSel');
  if (catInsightSel) {
    const pretty = (code) => (DATA?.refs?.categories?.[code]?.name) || String(code||'');
    catInsightSel.innerHTML = '';
    for (const c of (ALL_OPTS.category || [])) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = pretty(c);
      catInsightSel.appendChild(opt);
    }
    // default: FOOD_DINING if present else first
    const hasFood = (ALL_OPTS.category || []).includes('FOOD_DINING');
    catInsightSel.value = hasFood ? 'FOOD_DINING' : (ALL_OPTS.category?.[0] || '');
  }

  updateCounts();

  // default date range
  const dates = uniq(rows.map(r=>r.date)).sort();
  if(dates.length){
    document.getElementById('dateFrom').value = dates[0];
    document.getElementById('dateTo').value = dates[dates.length-1];
  }
}

function enableClickMultiSelect(sel, onChange){
  // Native multi-select requires Ctrl/⌘; this makes plain click toggle selection.
  // Works well for our dashboard filters.
  sel.addEventListener('mousedown', (e) => {
    if(e.target && e.target.tagName === 'OPTION'){
      e.preventDefault();
      const opt = e.target;
      opt.selected = !opt.selected;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  sel.addEventListener('keydown', (e)=>{
    // keep native keyboard behavior
    if(e.key === 'Enter') onChange();
  });
}

function wireEvents(rows){
  const ids=['dateFrom','dateTo','typeSel','catSel','merchSel','sourceSel','tagSel'];
  for(const id of ids){
    document.getElementById(id).addEventListener('change', ()=>{ updateCounts(); render(rows); });
  }

  // subcategory insights category dropdown
  const catInsightSel = document.getElementById('catInsightSel');
  if (catInsightSel) catInsightSel.addEventListener('change', ()=>render(rows));

  // Improve multi-select UX (no Ctrl required)
  for (const id of ['typeSel','catSel','merchSel','sourceSel','tagSel']){
    const sel=document.getElementById(id);
    if(sel) enableClickMultiSelect(sel, ()=>{ updateCounts(); render(rows); });
  }

  const sids=['typeSearch','catSearch','merchSearch','sourceSearch','tagSearch'];
  for(const id of sids){
    const el=document.getElementById(id);
    if(!el) continue;
    el.addEventListener('input', ()=>{ refreshFilteredOptions(); render(rows); });
  }

  document.getElementById('resetBtn').addEventListener('click', ()=>{
    for(const id of ['typeSel','catSel','merchSel','sourceSel','tagSel']){
      const s=document.getElementById(id);
      clearSelected(s);
    }
    // re-select EXPENSE by default
    const typeSel = document.getElementById('typeSel');
    if (typeSel) {
      for (const o of typeSel.options) o.selected = (o.value === 'EXPENSE');
    }
    for(const id of ['typeSearch','catSearch','merchSearch','sourceSearch','tagSearch']){
      const el=document.getElementById(id);
      if(el) el.value='';
    }
    refreshFilteredOptions();

    const dates = uniq(rows.map(r=>r.date)).sort();
    if(dates.length){
      document.getElementById('dateFrom').value = dates[0];
      document.getElementById('dateTo').value = dates[dates.length-1];
    }
    updateCounts();
    render(rows);
  });
}

async function tryFetch(){
  try{
    const res = await fetch('${outDataJsonName}', { cache:'no-store' });
    if(!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    if (!data || !Array.isArray(data.rows)) throw new Error('Invalid JSON: expected {rows:[...]}');
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

// (removed Try auto-load button)

document.getElementById('fileInput').addEventListener('change', async (ev)=>{
  try {
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    const txt = await f.text();
    const data = JSON.parse(txt);
    if (!data || !Array.isArray(data.rows)) throw new Error('Invalid JSON: expected {rows:[...]}');

    DATA = data;
    document.getElementById('loadHint').style.display='none';
    setupFilters(DATA.rows);
    wireEvents(DATA.rows);
    render(DATA.rows);
  } catch (e) {
    console.error(e);
    showLoadError(e && e.message ? e.message : e);
  }
});

// keep table height aligned to sidebar
window.addEventListener('resize', ()=>{ /* no-op */ });

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
