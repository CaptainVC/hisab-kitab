import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import { loadRange, saveRange } from '../app/range';

type Merchant = { code: string; name: string; archived?: boolean; default?: { category?: string; subcategory?: string; tags?: string[] } };

type Category = { code: string; name: string; archived?: boolean };

type Subcategory = { code: string; name: string; category: string; archived?: boolean };

type MerchantsResp = { ok: true; merchants: Merchant[] };

type CategoriesResp = { ok: true; categories: Category[] };

type SubcategoriesResp = { ok: true; subcategories: Subcategory[] };

type CoverageRow = {
  code: string;
  emailSupport: 'YES' | 'NO' | 'UNKNOWN' | 'SEEN_BUT_UNSUPPORTED';
  emailSeenCount: number;
  lastEmailAt: string | null;
  ruleConfigured: boolean;
};

type CoverageResp = { ok: true; coverage: CoverageRow[] };

type EmailRulesResp = { ok: true; merchants: any; payments: any };

type Tab = 'merchants' | 'categories' | 'subcategories' | 'email_rules';

function TabBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`px-3 py-2 rounded-md text-sm ${active ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export default function RefsPage() {
  const def = useMemo(() => loadRange(), []);
  const [tab, setTab] = useState<Tab>('merchants');

  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [coverage, setCoverage] = useState<Record<string, CoverageRow>>({});
  const [merchantQuery, setMerchantQuery] = useState('');
  const [showArchivedMerchants, setShowArchivedMerchants] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  const [emailRules, setEmailRules] = useState<EmailRulesResp | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // merchant edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editCode, setEditCode] = useState<string>('');
  const [editName, setEditName] = useState<string>('');
  const [editCategory, setEditCategory] = useState<string>('');
  const [editSubcategory, setEditSubcategory] = useState<string>('');
  const [editTagsCsv, setEditTagsCsv] = useState<string>('');

  async function loadMerchants() {
    const m = await apiGet<MerchantsResp>('/api/v1/refs/merchants');
    const c = await apiGet<CoverageResp>(`/api/v1/refs/merchants/coverage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    setMerchants(m.merchants);
    const map: Record<string, CoverageRow> = {};
    for (const row of c.coverage) map[row.code] = row;
    setCoverage(map);
  }

  async function loadCategories() {
    const r = await apiGet<CategoriesResp>('/api/v1/refs/categories');
    setCategories(r.categories);
  }

  async function loadSubcategories() {
    const r = await apiGet<SubcategoriesResp>('/api/v1/refs/subcategories');
    setSubcategories(r.subcategories);
  }

  async function loadEmailRules() {
    const r = await apiGet<EmailRulesResp>('/api/v1/refs/email_rules');
    setEmailRules(r);
  }

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      if (tab === 'merchants') await loadMerchants();
      if (tab === 'categories') await loadCategories();
      if (tab === 'subcategories') await loadSubcategories();
      if (tab === 'email_rules') await loadEmailRules();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  function openEditMerchant(code: string) {
    // Ensure category/subcategory lists are present so the dropdowns have options.
    if (categories.length === 0) loadCategories().catch(() => {});
    if (subcategories.length === 0) loadSubcategories().catch(() => {});

    const cur = merchants.find(x => x.code === code);
    setEditCode(code);
    setEditName(cur?.name || code);
    setEditCategory(cur?.default?.category || '');
    setEditSubcategory(cur?.default?.subcategory || '');
    setEditTagsCsv((cur?.default?.tags || []).join(','));
    setEditOpen(true);
  }

  async function saveEditMerchant() {
    if (!editCode) return;
    await apiPost(`/api/v1/refs/merchants/${encodeURIComponent(editCode)}`, {
      name: editName,
      default: {
        category: editCategory,
        subcategory: editSubcategory,
        tags: editTagsCsv.trim() ? editTagsCsv.split(',').map(s => s.trim()).filter(Boolean) : []
      }
    });
    setEditOpen(false);
    await refresh();
  }

  async function archiveMerchant(code: string) {
    if (!confirm(`Archive merchant ${code}?`)) return;
    await apiPost(`/api/v1/refs/merchants/${encodeURIComponent(code)}/archive`, {});
    await refresh();
  }

  async function renameCategory(code: string) {
    const cur = categories.find(x => x.code === code);
    const name = prompt(`Rename ${code} to:`, cur?.name || code);
    if (name === null) return;
    await apiPost(`/api/v1/refs/categories/${encodeURIComponent(code)}`, { name });
    await refresh();
  }

  async function archiveCategory(code: string) {
    if (!confirm(`Archive category ${code}?`)) return;
    await apiPost(`/api/v1/refs/categories/${encodeURIComponent(code)}/archive`, {});
    await refresh();
  }

  async function renameSubcategory(code: string) {
    const cur = subcategories.find(x => x.code === code);
    const name = prompt(`Rename ${code} to:`, cur?.name || code);
    if (name === null) return;
    await apiPost(`/api/v1/refs/subcategories/${encodeURIComponent(code)}`, { name });
    await refresh();
  }

  async function changeSubcategoryCategory(code: string) {
    const cur = subcategories.find(x => x.code === code);
    const cat = prompt(`Set category code for ${code}:`, cur?.category || '');
    if (cat === null) return;
    await apiPost(`/api/v1/refs/subcategories/${encodeURIComponent(code)}`, { category: cat });
    await refresh();
  }

  async function archiveSubcategory(code: string) {
    if (!confirm(`Archive subcategory ${code}?`)) return;
    await apiPost(`/api/v1/refs/subcategories/${encodeURIComponent(code)}/archive`, {});
    await refresh();
  }

  useEffect(() => {
    refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Refs</h1>
          <p className="text-zinc-400 mt-1">Edit/Archive only. Email rules are view-only in v1.</p>
        </div>
        <div className="flex items-center gap-2">
          <TabBtn active={tab === 'merchants'} label="Merchants" onClick={() => setTab('merchants')} />
          <TabBtn active={tab === 'categories'} label="Categories" onClick={() => setTab('categories')} />
          <TabBtn active={tab === 'subcategories'} label="Subcategories" onClick={() => setTab('subcategories')} />
          <TabBtn active={tab === 'email_rules'} label="Email rules" onClick={() => setTab('email_rules')} />
        </div>
      </div>

      {tab === 'merchants' ? (
        <div className="mt-4 flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-xs text-zinc-400">Search merchants</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 w-64" value={merchantQuery} onChange={e => setMerchantQuery(e.target.value)} placeholder="code or name" />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300 mb-1">
            <input type="checkbox" checked={showArchivedMerchants} onChange={e => setShowArchivedMerchants(e.target.checked)} />
            Show archived
          </label>
          <div className="flex-1" />
          <div>
            <label className="text-xs text-zinc-400">Coverage from</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={from} onChange={e => { const v = e.target.value; setFrom(v); saveRange({ from: v, to }); }} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">to</label>
            <input className="block mt-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={to} onChange={e => { const v = e.target.value; setTo(v); saveRange({ from, to: v }); }} />
          </div>
          <button className="px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50" disabled={busy} onClick={() => refresh().catch(() => {})}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <button className="px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium disabled:opacity-50" disabled={busy} onClick={() => refresh().catch(() => {})}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      )}

      {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

      {tab === 'merchants' ? (
        <div className="mt-6 border border-zinc-800 rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-300">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Default</th>
                <th className="text-left px-3 py-2">Email support</th>
                <th className="text-right px-3 py-2">Emails seen</th>
                <th className="text-left px-3 py-2">Last email</th>
                <th className="text-left px-3 py-2">Rule</th>
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {merchants
                .filter((m) => (showArchivedMerchants ? true : !m.archived))
                .filter((m) => {
                  const q = merchantQuery.trim().toLowerCase();
                  if (!q) return true;
                  return String(m.code).toLowerCase().includes(q) || String(m.name || '').toLowerCase().includes(q);
                })
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((m) => {
                  const c = coverage[m.code];
                  return (
                    <tr key={m.code} className={`border-t border-zinc-800 ${m.archived ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2 font-mono text-xs">{m.code}</td>
                      <td className="px-3 py-2">{m.name}</td>
                      <td className="px-3 py-2 text-xs text-zinc-400">
                        {m.default?.category || '—'}{m.default?.subcategory ? ` / ${m.default.subcategory}` : ''}
                        {m.default?.tags?.length ? (
                          <div className="mt-1 text-[11px] text-zinc-500">tags: {m.default.tags.join(', ')}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{c?.emailSupport || '—'}</td>
                      <td className="px-3 py-2 text-right">{c ? c.emailSeenCount : '—'}</td>
                      <td className="px-3 py-2 text-xs text-zinc-400">{c?.lastEmailAt ? new Date(c.lastEmailAt).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2">{c ? (c.ruleConfigured ? 'configured' : '—') : '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => openEditMerchant(m.code)}>Edit</button>
                          {!m.archived ? (
                            <button className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => archiveMerchant(m.code).catch(() => {})}>Archive</button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'categories' ? (
        <div className="mt-6 border border-zinc-800 rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-300">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.filter(c => !c.archived).map((c) => (
                <tr key={c.code} className="border-t border-zinc-800">
                  <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => renameCategory(c.code).catch(() => {})}>Edit</button>
                      <button className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => archiveCategory(c.code).catch(() => {})}>Archive</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'subcategories' ? (
        <div className="mt-6 border border-zinc-800 rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-300">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subcategories.filter(s => !s.archived).map((s) => (
                <tr key={s.code} className="border-t border-zinc-800">
                  <td className="px-3 py-2 font-mono text-xs">{s.code}</td>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.category}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => renameSubcategory(s.code).catch(() => {})}>Edit name</button>
                      <button className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => changeSubcategoryCategory(s.code).catch(() => {})}>Set category</button>
                      <button className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => archiveSubcategory(s.code).catch(() => {})}>Archive</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'email_rules' ? (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-zinc-800 rounded-lg p-3">
            <div className="text-sm font-semibold">email_merchants.json (view-only)</div>
            <pre className="mt-2 text-xs overflow-auto max-h-[420px] whitespace-pre-wrap text-zinc-300">{emailRules ? JSON.stringify(emailRules.merchants, null, 2) : '(load to view)'}</pre>
          </div>
          <div className="border border-zinc-800 rounded-lg p-3">
            <div className="text-sm font-semibold">email_payments.json (view-only)</div>
            <pre className="mt-2 text-xs overflow-auto max-h-[420px] whitespace-pre-wrap text-zinc-300">{emailRules ? JSON.stringify(emailRules.payments, null, 2) : '(load to view)'}</pre>
          </div>
        </div>
      ) : null}

      {/* Merchant edit modal */}
      {editOpen ? (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditOpen(false)}>
          <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-lg p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-zinc-400">Edit merchant</div>
                <div className="font-mono text-sm">{editCode}</div>
              </div>
              <button className="text-zinc-400 hover:text-white" onClick={() => setEditOpen(false)}>✕</button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <div>
                <label className="text-xs text-zinc-400">Name</label>
                <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400">Default category</label>
                  <select className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                    <option value="">(none)</option>
                    {categories.filter(c => !c.archived).map(c => (
                      <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Default subcategory</label>
                  <select className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={editSubcategory} onChange={(e) => setEditSubcategory(e.target.value)}>
                    <option value="">(none)</option>
                    {subcategories.filter(s => !s.archived && (!editCategory || s.category === editCategory)).map(s => (
                      <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-400">Default tags (CSV)</label>
                <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800" value={editTagsCsv} onChange={(e) => setEditTagsCsv(e.target.value)} placeholder="food,online_order" />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => setEditOpen(false)}>Cancel</button>
              <button className="px-3 py-2 rounded bg-zinc-100 text-zinc-950 font-medium" onClick={() => saveEditMerchant().catch(() => {})}>Save</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
