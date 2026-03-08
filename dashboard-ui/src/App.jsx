import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell,
  BarChart, Bar
} from 'recharts'

const TABS = [
  { key: 'home', label: 'Home' },
  { key: 'entries', label: 'Hisab Entries' },
  { key: 'email', label: 'Email Data' },
  { key: 'flags', label: 'Flagged' },
  { key: 'categories', label: 'Categories' },
]

const COLORS = ['#7c3aed', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444', '#a855f7', '#84cc16']

function Card({ title, value, sub }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm border border-white/5">
      <div className="text-xs uppercase tracking-wide text-muted">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub ? <div className="text-xs text-muted mt-1">{sub}</div> : null}
    </div>
  )
}

function Badge({ children, tone='muted' }){
  const toneClass = {
    muted: 'bg-white/5 text-muted',
    green: 'bg-emerald-500/15 text-emerald-300',
    red: 'bg-red-500/15 text-red-300',
    violet: 'bg-violet-500/15 text-violet-300'
  }[tone]
  return <span className={`px-2 py-0.5 text-xs rounded-full ${toneClass}`}>{children}</span>
}

function Table({ columns, rows, onCellClick }) {
  return (
    <div className="overflow-auto rounded-2xl border border-white/5">
      <table className="min-w-full text-sm">
        <thead className="bg-white/5 text-muted sticky top-0">
          <tr>
            {columns.map(c => (
              <th key={c.key} className="text-left px-3 py-2 font-medium">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5 hover:bg-white/5">
              {columns.map(c => (
                <td
                  key={c.key}
                  className={`px-3 py-2 ${onCellClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onCellClick?.(c.key, r)}
                >
                  {r[c.key] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function downloadCsv(filename, rows, columns){
  const header = columns.map(c=>c.label).join(',');
  const body = rows.map(r => columns.map(c => {
    const v = r[c.key] ?? '';
    return '"' + String(v).replace(/"/g,'""') + '"';
  }).join(',')).join('\n');
  const csv = header + '\n' + body;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function copyCsv(rows, columns){
  const header = columns.map(c=>c.label).join(',');
  const body = rows.map(r => columns.map(c => {
    const v = r[c.key] ?? '';
    return '"' + String(v).replace(/"/g,'""') + '"';
  }).join(',')).join('\n');
  const csv = header + '\n' + body;
  navigator.clipboard?.writeText(csv)
}

function maxDate(entries){
  return entries.reduce((m,e) => (e.date && e.date > m ? e.date : m), '')
}

export default function App() {
  const [tab, setTab] = useState('home')
  const [summary, setSummary] = useState(null)
  const [entries, setEntries] = useState([])
  const [email, setEmail] = useState([])
  const [flags, setFlags] = useState(null)

  const [qEntries, setQEntries] = useState('')
  const [qEmail, setQEmail] = useState('')
  const [flagType, setFlagType] = useState('all')
  const [range, setRange] = useState('all') // all | week | month
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [selectedMerchant, setSelectedMerchant] = useState('')
  const [includeIncome, setIncludeIncome] = useState(true)
  const [presets, setPresets] = useState([])
  const [showPresetMgr, setShowPresetMgr] = useState(false)

  useEffect(() => {
    document.documentElement.classList.add('dark')
    fetch('/dashboard_data/summary.json').then(r => r.json()).then(setSummary).catch(() => {})
    fetch('/dashboard_data/entries.json').then(r => r.json()).then(d => setEntries(d.entries || [])).catch(() => {})
    fetch('/dashboard_data/email.json').then(r => r.json()).then(d => setEmail(d.email || [])).catch(() => {})
    fetch('/dashboard_data/flags.json').then(r => r.json()).then(setFlags).catch(() => {})
  }, [])

  // Saved filters & presets
  useEffect(() => {
    const saved = localStorage.getItem('hk_filters')
    if (saved) {
      try {
        const s = JSON.parse(saved)
        if (s.range) setRange(s.range)
        if (s.customFrom) setCustomFrom(s.customFrom)
        if (s.customTo) setCustomTo(s.customTo)
        if (s.qEntries) setQEntries(s.qEntries)
        if (s.qEmail) setQEmail(s.qEmail)
        if (s.flagType) setFlagType(s.flagType)
        if (typeof s.includeIncome === 'boolean') setIncludeIncome(s.includeIncome)
      } catch {}
    }
    const p = localStorage.getItem('hk_presets')
    if (p) {
      try { setPresets(JSON.parse(p)) } catch {}
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('hk_filters', JSON.stringify({ range, customFrom, customTo, qEntries, qEmail, flagType, includeIncome }))
  }, [range, customFrom, customTo, qEntries, qEmail, flagType, includeIncome])

  const savePreset = () => {
    const name = prompt('Preset name?')
    if (!name) return
    const preset = { name, range, customFrom, customTo, qEntries, qEmail, flagType, includeIncome }
    const next = [...presets.filter(p => p.name !== name), preset]
    setPresets(next)
    localStorage.setItem('hk_presets', JSON.stringify(next))
  }

  const applyPreset = (name) => {
    const p = presets.find(x => x.name === name)
    if (!p) return
    setRange(p.range || 'all')
    setCustomFrom(p.customFrom || '')
    setCustomTo(p.customTo || '')
    setQEntries(p.qEntries || '')
    setQEmail(p.qEmail || '')
    setFlagType(p.flagType || 'all')
    setIncludeIncome(typeof p.includeIncome === 'boolean' ? p.includeIncome : true)
  }

  const deletePreset = (name) => {
    const next = presets.filter(p => p.name !== name)
    setPresets(next)
    localStorage.setItem('hk_presets', JSON.stringify(next))
  }

  const renamePreset = (oldName) => {
    const newName = prompt('New name?', oldName)
    if (!newName) return
    const next = presets.map(p => p.name === oldName ? { ...p, name: newName } : p)
    setPresets(next)
    localStorage.setItem('hk_presets', JSON.stringify(next))
  }

  const movePreset = (name, dir) => {
    const idx = presets.findIndex(p => p.name === name)
    const j = idx + dir
    if (idx < 0 || j < 0 || j >= presets.length) return
    const next = [...presets]
    const tmp = next[idx]
    next[idx] = next[j]
    next[j] = tmp
    setPresets(next)
    localStorage.setItem('hk_presets', JSON.stringify(next))
  }

  const entriesColumns = [
    { key: 'date', label: 'Date' },
    { key: 'type', label: 'Type' },
    { key: 'amount', label: 'Amount' },
    { key: 'merchant', label: 'Merchant' },
    { key: 'category', label: 'Category' },
    { key: 'subcategory', label: 'Subcategory' },
    { key: 'source', label: 'Source' },
  ]

  const emailColumns = [
    { key: 'date', label: 'Date' },
    { key: 'amount', label: 'Amount' },
    { key: 'merchant', label: 'Merchant' },
    { key: 'source', label: 'Source' },
    { key: 'direction', label: 'Direction' },
  ]

  const latest = maxDate(entries)
  const minDate = useMemo(() => {
    if (!latest || range === 'all') return ''
    const dt = new Date(latest + 'T00:00:00')
    const days = range === 'week' ? 7 : 30
    dt.setDate(dt.getDate() - (days - 1))
    return dt.toISOString().slice(0,10)
  }, [latest, range])

  const rangedEntries = useMemo(() => {
    if (customFrom || customTo) {
      const from = customFrom || '0000-01-01'
      const to = customTo || '9999-12-31'
      return entries.filter(e => e.date >= from && e.date <= to)
    }
    if (!minDate) return entries
    return entries.filter(e => e.date >= minDate && e.date <= latest)
  }, [entries, minDate, latest, customFrom, customTo])

  const visibleEntries = useMemo(() => {
    if (includeIncome) return rangedEntries
    return rangedEntries.filter(e => String(e.type||'').toUpperCase() !== 'INCOME')
  }, [rangedEntries, includeIncome])

  const flagRows = useMemo(() => {
    if (!flags) return []
    const rows = []
    for (const [k, items] of Object.entries(flags || {})) {
      for (const it of (items || [])) rows.push({ type: k, ...it })
    }
    return rows
  }, [flags])

  const filteredEntries = useMemo(() => {
    const q = qEntries.trim().toLowerCase()
    const base = visibleEntries
    if (!q) return base
    return base.filter(e =>
      String(e.date||'').includes(q) ||
      String(e.merchant||'').toLowerCase().includes(q) ||
      String(e.category||'').toLowerCase().includes(q) ||
      String(e.subcategory||'').toLowerCase().includes(q)
    )
  }, [visibleEntries, qEntries])

  const filteredEmail = useMemo(() => {
    const q = qEmail.trim().toLowerCase()
    if (!q) return email
    return email.filter(e =>
      String(e.date||'').includes(q) ||
      String(e.merchant||'').toLowerCase().includes(q) ||
      String(e.source||'').toLowerCase().includes(q)
    )
  }, [email, qEmail])

  const filteredFlags = useMemo(() => {
    if (flagType === 'all') return flagRows
    return flagRows.filter(f => f.type === flagType)
  }, [flagRows, flagType])

  const trendData = useMemo(() => {
    const byDate = new Map()
    for (const e of visibleEntries) {
      const d = e.date
      const amt = Number(e.amount||0)
      if (!byDate.has(d)) byDate.set(d, { date: d, spend: 0, income: 0 })
      const row = byDate.get(d)
      if (String(e.type||'').toUpperCase() === 'INCOME') row.income += amt
      else row.spend += amt
    }
    return Array.from(byDate.values()).sort((a,b)=>a.date.localeCompare(b.date))
  }, [visibleEntries])

  const categoryData = useMemo(() => {
    const byCat = new Map()
    for (const e of visibleEntries) {
      if (String(e.type||'').toUpperCase() === 'INCOME') continue
      const c = e.category || 'UNSPECIFIED'
      byCat.set(c, (byCat.get(c)||0) + Number(e.amount||0))
    }
    return Array.from(byCat.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a,b)=>b.value-a.value)
      .slice(0, 6)
  }, [visibleEntries])

  const topMerchants = useMemo(() => {
    const byMerch = new Map()
    for (const e of visibleEntries) {
      if (String(e.type||'').toUpperCase() === 'INCOME') continue
      const m = e.merchant || 'UNKNOWN'
      byMerch.set(m, (byMerch.get(m)||0) + Number(e.amount||0))
    }
    return Array.from(byMerch.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a,b)=>b.value-a.value)
      .slice(0, 8)
  }, [visibleEntries])

  const merchantTxns = useMemo(() => {
    if (!selectedMerchant) return []
    return visibleEntries.filter(e => e.merchant === selectedMerchant)
  }, [visibleEntries, selectedMerchant])

  const merchantTrend = useMemo(() => {
    const byDate = new Map()
    for (const e of merchantTxns) {
      const d = e.date
      const amt = Number(e.amount||0)
      byDate.set(d, (byDate.get(d)||0) + amt)
    }
    return Array.from(byDate.entries()).map(([date, amount]) => ({ date, amount }))
      .sort((a,b)=>a.date.localeCompare(b.date))
  }, [merchantTxns])

  const categoryTable = useMemo(() => {
    const byCat = new Map()
    for (const e of visibleEntries) {
      if (String(e.type||'').toUpperCase() === 'INCOME') continue
      const key = `${e.category||'UNSPECIFIED'}|${e.subcategory||'UNSPECIFIED'}`
      byCat.set(key, (byCat.get(key)||0) + Number(e.amount||0))
    }
    return Array.from(byCat.entries())
      .map(([key, value]) => {
        const [category, subcategory] = key.split('|')
        return { category, subcategory, amount: Math.round(value) }
      })
      .sort((a,b)=>b.amount-a.amount)
  }, [visibleEntries])

  const PresetChips = () => (
    presets.length > 0 ? (
      <div className="flex flex-wrap gap-2">
        {presets.map(p => (
          <button key={p.name} onClick={()=>applyPreset(p.name)} className="px-3 py-1.5 rounded-full text-xs bg-white/10 hover:bg-white/15">{p.name}</button>
        ))}
      </div>
    ) : null
  )

  const PresetManager = () => (
    showPresetMgr ? (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-card border border-white/10 rounded-2xl p-6 w-[520px] max-w-[90vw]">
          <div className="flex items-center justify-between mb-4">
            <div className="text-lg font-semibold">Preset Manager</div>
            <button onClick={() => setShowPresetMgr(false)} className="text-sm text-muted">Close</button>
          </div>
          <div className="space-y-2">
            {presets.map((p, idx) => (
              <div key={p.name} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                <div className="text-sm">{p.name}</div>
                <div className="flex items-center gap-2 text-xs">
                  <button onClick={() => applyPreset(p.name)} className="px-2 py-1 bg-white/10 rounded">Apply</button>
                  <button onClick={() => renamePreset(p.name)} className="px-2 py-1 bg-white/10 rounded">Rename</button>
                  <button onClick={() => movePreset(p.name, -1)} className="px-2 py-1 bg-white/10 rounded">↑</button>
                  <button onClick={() => movePreset(p.name, 1)} className="px-2 py-1 bg-white/10 rounded">↓</button>
                  <button onClick={() => deletePreset(p.name)} className="px-2 py-1 bg-red-500/20 text-red-200 rounded">Delete</button>
                </div>
              </div>
            ))}
            {presets.length === 0 && <div className="text-sm text-muted">No presets yet.</div>}
          </div>
        </div>
      </div>
    ) : null
  )

  return (
    <div className="min-h-screen bg-bg text-white flex">
      <PresetManager />
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 flex-col border-r border-white/5 bg-card/30 px-4 py-6">
        <div className="text-xs text-muted">HisabKitab</div>
        <div className="text-lg font-semibold mb-6">Dashboard</div>
        <nav className="space-y-2">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${tab === t.key ? 'bg-accent text-white' : 'bg-white/5 text-muted hover:bg-white/10'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-6 text-xs text-muted">Private • Local</div>
      </aside>

      <div className="flex-1">
        <header className="sticky top-0 z-10 backdrop-blur bg-bg/90 px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <div className="text-xs text-muted">HisabKitab</div>
            <div className="text-xl font-semibold">Finance Dashboard</div>
          </div>
          <div className="flex gap-2 md:hidden">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-sm ${tab === t.key ? 'bg-accent text-white' : 'bg-white/5 text-muted hover:bg-white/10'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs">
            <Badge tone="violet">Range</Badge>
            <select
              value={range}
              onChange={(e)=>setRange(e.target.value)}
              className="rounded-lg bg-white/5 border border-white/10 px-2 py-1"
            >
              <option value="all">All</option>
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
            </select>
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} className="rounded-lg bg-white/5 border border-white/10 px-2 py-1" />
              <span className="text-muted">to</span>
              <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)} className="rounded-lg bg-white/5 border border-white/10 px-2 py-1" />
              <button onClick={() => { setCustomFrom(''); setCustomTo(''); }} className="px-2 py-1 rounded-lg bg-white/10">Clear</button>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={includeIncome} onChange={e=>setIncludeIncome(e.target.checked)} />
              Include Income
            </label>
            <div className="flex items-center gap-2">
              <button onClick={savePreset} className="px-2 py-1 rounded-lg bg-white/10">Save preset</button>
              <button onClick={() => setShowPresetMgr(true)} className="px-2 py-1 rounded-lg bg-white/10">Manage</button>
            </div>
          </div>
        </header>

        <main className="px-6 py-6 space-y-6">
          {tab === 'home' && (
            <>
              <div className="flex items-center gap-2 md:hidden">
                <Badge tone="violet">Range</Badge>
                <select
                  value={range}
                  onChange={(e)=>setRange(e.target.value)}
                  className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-xs"
                >
                  <option value="all">All</option>
                  <option value="week">Last 7 days</option>
                  <option value="month">Last 30 days</option>
                </select>
              </div>

              <PresetChips />

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card title="Total Spend" value={summary?.totalSpend ?? '—'} />
                <Card title="Total Income" value={summary?.totalIncome ?? '—'} />
                <Card title="Net" value={summary?.net ?? '—'} />
                <Card title="Flags" value={summary?.flagCount ?? '—'} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 rounded-2xl bg-card p-4 border border-white/5">
                  <div className="text-sm text-muted mb-2">Daily Spend vs Income</div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData}>
                        <XAxis dataKey="date" hide />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="spend" stroke="#ef4444" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="income" stroke="#22c55e" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-2xl bg-card p-4 border border-white/5">
                  <div className="text-sm text-muted mb-2">Top Categories</div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={categoryData} dataKey="value" nameKey="name" outerRadius={80}>
                          {categoryData.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {categoryData.map((c) => (
                      <Badge key={c.name} tone="violet">{c.name}: {Math.round(c.value)}</Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl bg-card p-4 border border-white/5">
                  <div className="text-sm text-muted mb-2">Top Merchants (Chart)</div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topMerchants} layout="vertical">
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" width={140} />
                        <Tooltip />
                        <Bar dataKey="value" fill="#7c3aed" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-2xl bg-card p-4 border border-white/5">
                  <div className="text-sm text-muted mb-2">Top Merchants</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {topMerchants.map(m => (
                      <button
                        key={m.name}
                        onClick={() => setSelectedMerchant(m.name)}
                        className={`text-left rounded-xl px-3 py-2 ${selectedMerchant===m.name ? 'bg-white/10' : 'bg-white/5 hover:bg-white/10'}`}
                      >
                        <div className="text-xs text-muted">{m.name}</div>
                        <div className="text-sm font-semibold mt-1">₹ {Math.round(m.value)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {selectedMerchant && (
                <div className="rounded-2xl bg-card p-4 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted">Merchant Detail</div>
                    <button onClick={() => setSelectedMerchant('')} className="text-xs text-muted">Clear</button>
                  </div>
                  <div className="text-lg font-semibold mt-1">{selectedMerchant}</div>
                  <div className="h-48 mt-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={merchantTrend}>
                        <XAxis dataKey="date" hide />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="amount" stroke="#06b6d4" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3">
                    <Table columns={entriesColumns} rows={merchantTxns.slice(0, 200)} />
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'entries' && (
            <div className="space-y-3">
              <PresetChips />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <input
                  value={qEntries}
                  onChange={(e)=>setQEntries(e.target.value)}
                  placeholder="Search by date, merchant, category..."
                  className="w-full md:w-96 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => copyCsv(filteredEntries, entriesColumns)}
                    className="px-3 py-2 text-sm rounded-lg bg-white/10 hover:bg-white/15"
                  >
                    Copy Filtered
                  </button>
                  <button
                    onClick={() => downloadCsv('hisab_entries.csv', filteredEntries, entriesColumns)}
                    className="px-3 py-2 text-sm rounded-lg bg-white/10 hover:bg-white/15"
                  >
                    Export CSV
                  </button>
                </div>
              </div>
              <Table
                columns={entriesColumns}
                rows={filteredEntries.slice(0, 300)}
                onCellClick={(key, row) => {
                  if (key === 'merchant') setSelectedMerchant(row.merchant)
                }}
              />
            </div>
          )}

          {tab === 'email' && (
            <div className="space-y-3">
              <PresetChips />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <input
                  value={qEmail}
                  onChange={(e)=>setQEmail(e.target.value)}
                  placeholder="Search by date, merchant, source..."
                  className="w-full md:w-96 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                />
                <button
                  onClick={() => downloadCsv('email_data.csv', filteredEmail, emailColumns)}
                  className="px-3 py-2 text-sm rounded-lg bg-white/10 hover:bg-white/15"
                >
                  Export CSV
                </button>
              </div>
              <Table columns={emailColumns} rows={filteredEmail.slice(0, 300)} />
            </div>
          )}

          {tab === 'flags' && (
            <div className="space-y-3">
              <PresetChips />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <select
                  value={flagType}
                  onChange={(e)=>setFlagType(e.target.value)}
                  className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm"
                >
                  <option value="all">All flag types</option>
                  {Object.keys(flags||{}).map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
                <button
                  onClick={() => downloadCsv('flags.csv', filteredFlags, [
                    { key: 'type', label: 'Type' },
                    { key: 'date', label: 'Date' },
                    { key: 'amount', label: 'Amount' },
                    { key: 'merchant', label: 'Merchant' },
                    { key: 'raw', label: 'Raw' },
                    { key: 'reason', label: 'Reason' },
                  ])}
                  className="px-3 py-2 text-sm rounded-lg bg-white/10 hover:bg-white/15"
                >
                  Export CSV
                </button>
              </div>
              <Table columns={[
                { key: 'type', label: 'Type' },
                { key: 'date', label: 'Date' },
                { key: 'amount', label: 'Amount' },
                { key: 'merchant', label: 'Merchant' },
                { key: 'raw', label: 'Raw' },
                { key: 'reason', label: 'Reason' },
              ]} rows={filteredFlags.slice(0, 300)} />
            </div>
          )}

          {tab === 'categories' && (
            <div className="space-y-4">
              <PresetChips />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <Badge tone="violet">Category Drill‑down</Badge>
                <button
                  onClick={() => downloadCsv('categories.csv', categoryTable, [
                    { key: 'category', label: 'Category' },
                    { key: 'subcategory', label: 'Subcategory' },
                    { key: 'amount', label: 'Amount' },
                  ])}
                  className="px-3 py-2 text-sm rounded-lg bg-white/10 hover:bg-white/15"
                >
                  Export CSV
                </button>
              </div>
              <div className="rounded-2xl bg-card p-4 border border-white/5">
                <div className="text-sm text-muted mb-2">Category Drill‑down Chart</div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryTable.slice(0, 12)}>
                      <XAxis dataKey="subcategory" hide />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="amount" fill="#06b6d4" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <Table columns={[
                { key: 'category', label: 'Category' },
                { key: 'subcategory', label: 'Subcategory' },
                { key: 'amount', label: 'Amount' },
              ]} rows={categoryTable} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
