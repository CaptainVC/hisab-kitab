import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../api/client';
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

type SyncStatusResp = { ok: true; dirty: boolean | null; status: any | null; refsDir: string };

type Tab = 'merchants' | 'categories' | 'subcategories' | 'email_rules';

function TabBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`px-3 py-2 rounded-md text-sm ${active ? 'bg-zinc-800 text-white' : 'text-[color:var(--hk-muted)] hover:bg-zinc-900'}`}
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
  const [onlyEmailNo, setOnlyEmailNo] = useState(false);
  const [onlyNeedsRule, setOnlyNeedsRule] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  const [emailRules, setEmailRules] = useState<EmailRulesResp | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResp | null>(null);
  const [overview, setOverview] = useState<{ oldestOrderMs: number | null; oldestPaymentMs: number | null } | null>(null);

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
    const o = await apiGet<any>(`/api/v1/refs/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    setOverview({ oldestOrderMs: o.oldestOrderMs ?? null, oldestPaymentMs: o.oldestPaymentMs ?? null });
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
    try {
      const s = await apiGet<SyncStatusResp>('/api/v1/refs/syncStatus');
      setSyncStatus(s);
    } catch {
      setSyncStatus(null);
    }
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
    await apiPut(`/api/v1/refs/merchants/${encodeURIComponent(editCode)}`, {
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
    await apiPut(`/api/v1/refs/categories/${encodeURIComponent(code)}`, { name });
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
    await apiPut(`/api/v1/refs/subcategories/${encodeURIComponent(code)}`, { name });
    await refresh();
  }

  async function changeSubcategoryCategory(code: string) {
    const cur = subcategories.find(x => x.code === code);
    const cat = prompt(`Set category code for ${code}:`, cur?.category || '');
    if (cat === null) return;
    await apiPut(`/api/v1/refs/subcategories/${encodeURIComponent(code)}`, { category: cat });
    await refresh();
  }

  async function archiveSubcategory(code: string) {
    if (!confirm(`Archive subcategory ${code}?`)) return;
    await apiPost(`/api/v1/refs/subcategories/${encodeURIComponent(code)}/archive`, {});
    await refresh();
  }

  const [addOpen, setAddOpen] = useState<null | 'merchant' | 'category' | 'subcategory'>(null);

  // Add merchant fields
  const [addMerchantCode, setAddMerchantCode] = useState('');
  const [addMerchantName, setAddMerchantName] = useState('');
  const [addMerchantCategory, setAddMerchantCategory] = useState('');
  const [addMerchantSubcategory, setAddMerchantSubcategory] = useState('');
  const [addMerchantTagsCsv, setAddMerchantTagsCsv] = useState('');

  // Add category fields
  const [addCategoryCode, setAddCategoryCode] = useState('');
  const [addCategoryName, setAddCategoryName] = useState('');

  // Add subcategory fields
  const [addSubCode, setAddSubCode] = useState('');
  const [addSubName, setAddSubName] = useState('');
  const [addSubCategory, setAddSubCategory] = useState('');

  function openAdd(kind: 'merchant' | 'category' | 'subcategory') {
    // ensure refs are loaded for dropdowns
    if (categories.length === 0) loadCategories().catch(() => {});
    if (subcategories.length === 0) loadSubcategories().catch(() => {});

    setErr(null);
    setAddOpen(kind);

    if (kind === 'merchant') {
      setAddMerchantCode('');
      setAddMerchantName('');
      setAddMerchantCategory('');
      setAddMerchantSubcategory('');
      setAddMerchantTagsCsv('');
    }
    if (kind === 'category') {
      setAddCategoryCode('');
      setAddCategoryName('');
    }
    if (kind === 'subcategory') {
      setAddSubCode('');
      setAddSubName('');
      setAddSubCategory('');
    }
  }

  async function submitAddMerchant() {
    const code = addMerchantCode.trim();
    const name = (addMerchantName.trim() || code).trim();
    if (!code) throw new Error('missing_code');
    await apiPut(`/api/v1/refs/merchants/${encodeURIComponent(code)}`, {
      name,
      default: {
        category: addMerchantCategory || '',
        subcategory: addMerchantSubcategory || '',
        tags: addMerchantTagsCsv.trim() ? addMerchantTagsCsv.split(',').map(s => s.trim()).filter(Boolean) : []
      }
    });
    setAddOpen(null);
    await refresh();
  }

  async function submitAddCategory() {
    const code = addCategoryCode.trim();
    const name = addCategoryName.trim() || code;
    if (!code) throw new Error('missing_code');
    await apiPut(`/api/v1/refs/categories/${encodeURIComponent(code)}`, { name });
    setAddOpen(null);
    await refresh();
  }

  async function submitAddSubcategory() {
    const code = addSubCode.trim();
    const name = addSubName.trim() || code;
    const cat = addSubCategory.trim();
    if (!code) throw new Error('missing_code');
    if (!cat) throw new Error('missing_category');
    await apiPut(`/api/v1/refs/subcategories/${encodeURIComponent(code)}`, { name, category: cat });
    setAddOpen(null);
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
          <p className="text-[color:var(--hk-muted)] mt-1">Edit/Archive only. Email rules are view-only in v1.</p>
          {tab === 'merchants' ? (
            <div className="mt-1 text-xs text-[color:var(--hk-faint)]">
              Oldest email-derived data in range: orders {overview?.oldestOrderMs ? new Date(overview.oldestOrderMs).toISOString().slice(0, 10) : '—'} • payments {overview?.oldestPaymentMs ? new Date(overview.oldestPaymentMs).toISOString().slice(0, 10) : '—'}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <TabBtn active={tab === 'merchants'} label="Merchants" onClick={() => setTab('merchants')} />
          <TabBtn active={tab === 'categories'} label="Categories" onClick={() => setTab('categories')} />
          <TabBtn active={tab === 'subcategories'} label="Subcategories" onClick={() => setTab('subcategories')} />
          <TabBtn active={tab === 'email_rules'} label="Email rules" onClick={() => setTab('email_rules')} />
        </div>
      </div>

      {tab === 'merchants' ? (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <div className="flex flex-wrap items-end gap-2">
            <button className="hk-btn-primary" onClick={() => openAdd('merchant')}>
              + Merchant
            </button>
            <div>
              <label className="text-xs text-[color:var(--hk-muted)]">Search merchants</label>
              <input className="block mt-1 hk-input w-64" value={merchantQuery} onChange={e => setMerchantQuery(e.target.value)} placeholder="code or name" />
            </div>
            <label className="flex items-center gap-2 text-sm text-[color:var(--hk-muted)] mb-1">
              <input type="checkbox" checked={showArchivedMerchants} onChange={e => setShowArchivedMerchants(e.target.checked)} />
              Show archived
            </label>
            <label className="flex items-center gap-2 text-sm text-[color:var(--hk-muted)] mb-1">
              <input type="checkbox" checked={onlyEmailNo} onChange={e => setOnlyEmailNo(e.target.checked)} />
              Email support = NO
            </label>
            <label className="flex items-center gap-2 text-sm text-[color:var(--hk-muted)] mb-1">
              <input type="checkbox" checked={onlyNeedsRule} onChange={e => setOnlyNeedsRule(e.target.checked)} />
              Needs rule
            </label>
          </div>

          <div className="flex flex-wrap items-end justify-start md:justify-end gap-2">
            <div>
              <label className="text-xs text-[color:var(--hk-muted)]">Coverage from</label>
              <input className="block mt-1 hk-input w-40" value={from} onChange={e => { const v = e.target.value; setFrom(v); saveRange({ from: v, to }); }} />
            </div>
            <div>
              <label className="text-xs text-[color:var(--hk-muted)]">to</label>
              <input className="block mt-1 hk-input w-40" value={to} onChange={e => { const v = e.target.value; setTo(v); saveRange({ from, to: v }); }} />
            </div>
            <button className="hk-btn-primary disabled:opacity-50" disabled={busy} onClick={() => refresh().catch(() => {})}>
              {busy ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
      ) : tab === 'categories' ? (
        <div className="mt-4 flex items-center gap-2">
          <button className="px-3 py-2 rounded-md hk-btn-primary" onClick={() => openAdd('category')}>
            + Category
          </button>
          <button className="px-3 py-2 hk-btn-primary disabled:opacity-50" disabled={busy} onClick={() => refresh().catch(() => {})}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      ) : tab === 'subcategories' ? (
        <div className="mt-4 flex items-center gap-2">
          <button className="px-3 py-2 rounded-md hk-btn-primary" onClick={() => openAdd('subcategory')}>
            + Subcategory
          </button>
          <button className="px-3 py-2 hk-btn-primary disabled:opacity-50" disabled={busy} onClick={() => refresh().catch(() => {})}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <button className="px-3 py-2 hk-btn-primary disabled:opacity-50" disabled={busy} onClick={() => refresh().catch(() => {})}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      )}

      {err ? <div className="mt-3 text-sm text-red-400">{err}</div> : null}

      {tab === 'merchants' ? (
        <div className="mt-6 hk-card overflow-auto">
          <table className="w-full text-sm">
            <thead className="hk-table-head">
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
                .filter((m) => {
                  const c = coverage[m.code];
                  if (onlyEmailNo) return (c?.emailSupport || '—') === 'NO';
                  return true;
                })
                .filter((m) => {
                  if (!onlyNeedsRule) return true;
                  const c = coverage[m.code];
                  // Needs rule = emails seen but not configured.
                  return (c?.emailSeenCount || 0) > 0 && !c?.ruleConfigured;
                })
                .sort((a, b) => {
                  // Sort by lastEmailAt desc, then code
                  const ca = coverage[a.code];
                  const cb = coverage[b.code];
                  const ma = ca?.lastEmailAt ? Date.parse(ca.lastEmailAt) : 0;
                  const mb = cb?.lastEmailAt ? Date.parse(cb.lastEmailAt) : 0;
                  if (mb !== ma) return mb - ma;
                  return a.code.localeCompare(b.code);
                })
                .map((m) => {
                  const c = coverage[m.code];
                  const needsRule = (c?.emailSeenCount || 0) > 0 && !c?.ruleConfigured;
                  const rowClass = needsRule ? 'bg-amber-950/20' : '';
                  return (
                    <tr key={m.code} className={`${m.archived ? 'opacity-50' : ''} ${rowClass}`}>
                      <td className="px-3 py-2 font-mono text-xs">{m.code}</td>
                      <td className="px-3 py-2">{m.name}</td>
                      <td className="px-3 py-2 text-xs text-[color:var(--hk-muted)]">
                        {m.default?.category || '—'}{m.default?.subcategory ? ` / ${m.default.subcategory}` : ''}
                        {m.default?.tags?.length ? (
                          <div className="mt-1 text-[11px] text-[color:var(--hk-faint)]">tags: {m.default.tags.join(', ')}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{c?.emailSupport || '—'}</td>
                      <td className="px-3 py-2 text-right">{c ? c.emailSeenCount : '—'}</td>
                      <td className="px-3 py-2 text-xs text-[color:var(--hk-muted)]">{c?.lastEmailAt ? new Date(c.lastEmailAt).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2">{c ? (c.ruleConfigured ? 'configured' : (needsRule ? 'NEEDED' : '—')) : '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button className="px-2 py-1 hk-btn-secondary" onClick={() => openEditMerchant(m.code)}>Edit</button>
                          {!m.archived ? (
                            <button className="px-2 py-1 hk-btn-secondary" onClick={() => archiveMerchant(m.code).catch(() => {})}>Archive</button>
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
        <div className="mt-6 hk-card overflow-auto">
          <table className="w-full text-sm">
            <thead className="hk-table-head">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.filter(c => !c.archived).map((c) => (
                <tr key={c.code} className="">
                  <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button className="px-2 py-1 hk-btn-secondary" onClick={() => renameCategory(c.code).catch(() => {})}>Edit</button>
                      <button className="px-2 py-1 hk-btn-secondary" onClick={() => archiveCategory(c.code).catch(() => {})}>Archive</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'subcategories' ? (
        <div className="mt-6 hk-card overflow-auto">
          <table className="w-full text-sm">
            <thead className="hk-table-head">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subcategories.filter(s => !s.archived).map((s) => (
                <tr key={s.code} className="">
                  <td className="px-3 py-2 font-mono text-xs">{s.code}</td>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.category}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button className="px-2 py-1 hk-btn-secondary" onClick={() => renameSubcategory(s.code).catch(() => {})}>Edit name</button>
                      <button className="px-2 py-1 hk-btn-secondary" onClick={() => changeSubcategoryCategory(s.code).catch(() => {})}>Set category</button>
                      <button className="px-2 py-1 hk-btn-secondary" onClick={() => archiveSubcategory(s.code).catch(() => {})}>Archive</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'email_rules' ? (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="hk-card p-3 lg:col-span-2">
            <div className="flex items-end justify-between gap-2 flex-wrap">
              <div>
                <div className="text-sm font-semibold">Mail merchant controls</div>
                <div className="mt-1 text-xs text-[color:var(--hk-muted)]">Toggle which merchants are parsed from the HisabKitab Gmail label (affects future parsing + mail_orders sync).</div>
                <div className="mt-2 text-xs text-[color:var(--hk-faint)]">
                  Git sync: {syncStatus?.status?.ok ? 'synced' : syncStatus?.dirty ? 'pending' : 'unknown'}
                  {syncStatus?.status?.lastCommit ? <span className="ml-2 font-mono">{String(syncStatus.status.lastCommit).slice(0, 10)}</span> : null}
                </div>
              </div>
              <button className="hk-btn-primary disabled:opacity-50" disabled={busy} onClick={() => refresh().catch(() => {})}>
                {busy ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            <div className="mt-3 border border-zinc-800 rounded overflow-auto max-h-[520px]">
              <table className="w-full text-sm">
                <thead className="hk-table-head">
                  <tr>
                    <th className="text-left px-3 py-2">Merchant</th>
                    <th className="text-left px-3 py-2">Enabled</th>
                    <th className="text-left px-3 py-2">Parser</th>
                    <th className="text-left px-3 py-2">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {emailRules ? Object.entries(emailRules.merchants || {}).sort((a, b) => a[0].localeCompare(b[0])).map(([code, r]: any) => (
                    <tr key={code} className="hover:bg-white/5">
                      <td className="px-3 py-2 font-mono text-xs">{code}</td>
                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-2 text-sm text-[color:var(--hk-muted)]">
                          <input
                            type="checkbox"
                            checked={!!r?.enabled}
                            onChange={async (e) => {
                              try {
                                setBusy(true);
                                setErr(null);
                                await apiPost(`/api/v1/refs/email_rules/merchants/${encodeURIComponent(code)}/enabled`, { enabled: e.target.checked });
                                await refresh();
                              } catch (ex: any) {
                                setErr(String(ex?.message || ex));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          />
                          {r?.enabled ? 'ON' : 'OFF'}
                        </label>
                      </td>
                      <td className="px-3 py-2 text-xs text-[color:var(--hk-muted)]">
                        <div className="font-mono">{r?.parser?.type || '—'} {r?.parser?.id ? `(${r.parser.id})` : ''}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-[color:var(--hk-muted)]">
                        <div className="truncate max-w-[520px]" title={JSON.stringify(r?.match || {})}>
                          fromContains: {(r?.match?.fromContains || []).join(', ') || '—'}; subjectContains: {(r?.match?.subjectContains || []).join(', ') || '—'}
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td className="px-3 py-4 text-center text-[color:var(--hk-faint)]" colSpan={4}>(load to view)</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="hk-card p-3">
            <div className="text-sm font-semibold">email_payments.json</div>
            <pre className="mt-2 text-xs overflow-auto max-h-[520px] whitespace-pre-wrap text-[color:var(--hk-muted)]">{emailRules ? JSON.stringify(emailRules.payments, null, 2) : '(load to view)'}</pre>
          </div>
        </div>
      ) : null}

      {/* Merchant edit modal */}
      {editOpen ? (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditOpen(false)}>
          <div className="w-full max-w-lg bg-zinc-950 hk-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-[color:var(--hk-muted)]">Edit merchant</div>
                <div className="font-mono text-sm">{editCode}</div>
              </div>
              <button className="text-[color:var(--hk-muted)] hover:text-white" onClick={() => setEditOpen(false)}>✕</button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <div>
                <label className="text-xs text-[color:var(--hk-muted)]">Name</label>
                <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[color:var(--hk-muted)]">Default category</label>
                  <input className="mt-1 w-full hk-input" list="hk-ref-cat" value={editCategory} onChange={(e) => { setEditCategory(e.target.value); setEditSubcategory(''); }} placeholder="(none)" />
                  <datalist id="hk-ref-cat">
                    {categories.filter(c => !c.archived).map(c => (
                      <option key={c.code} value={c.code} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="text-xs text-[color:var(--hk-muted)]">Default subcategory</label>
                  <input className="mt-1 w-full hk-input" list="hk-ref-sub" value={editSubcategory} onChange={(e) => setEditSubcategory(e.target.value)} placeholder="(none)" />
                  <datalist id="hk-ref-sub">
                    {subcategories.filter(s => !s.archived && (!editCategory || s.category === editCategory)).map(s => (
                      <option key={s.code} value={s.code} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="text-xs text-[color:var(--hk-muted)]">Default tags (CSV)</label>
                <input className="mt-1 w-full px-2 py-1 rounded bg-zinc-900 border [var(--hk-border)]" value={editTagsCsv} onChange={(e) => setEditTagsCsv(e.target.value)} placeholder="food,online_order" />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="hk-btn-secondary" onClick={() => setEditOpen(false)}>Cancel</button>
              <button className="hk-btn-primary" onClick={() => saveEditMerchant().catch(() => {})}>Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add refs modal */}
      {addOpen ? (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setAddOpen(null)}>
          <div className="w-full max-w-lg hk-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">
                {addOpen === 'merchant' ? 'Add merchant' : addOpen === 'category' ? 'Add category' : 'Add subcategory'}
              </div>
              <button className="text-[color:var(--hk-muted)] hover:text-white" onClick={() => setAddOpen(null)}>✕</button>
            </div>

            {addOpen === 'merchant' ? (
              <div className="mt-4 grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs text-[color:var(--hk-muted)]">Merchant code (unique)</label>
                  <input className="mt-1 w-full hk-input font-mono" value={addMerchantCode} onChange={(e) => setAddMerchantCode(e.target.value)} placeholder="SWIGGY_FOOD" />
                </div>
                <div>
                  <label className="text-xs text-[color:var(--hk-muted)]">Name</label>
                  <input className="mt-1 w-full hk-input" value={addMerchantName} onChange={(e) => setAddMerchantName(e.target.value)} placeholder="Swiggy" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[color:var(--hk-muted)]">Default category</label>
                    <input className="mt-1 w-full hk-input" list="hk-add-merchant-cat" value={addMerchantCategory} onChange={(e) => { setAddMerchantCategory(e.target.value); setAddMerchantSubcategory(''); }} placeholder="(none)" />
                    <datalist id="hk-add-merchant-cat">
                      {categories.filter(c => !c.archived).map(c => (
                        <option key={c.code} value={c.code} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-xs text-[color:var(--hk-muted)]">Default subcategory</label>
                    <input className="mt-1 w-full hk-input" list="hk-add-merchant-sub" value={addMerchantSubcategory} onChange={(e) => setAddMerchantSubcategory(e.target.value)} placeholder="(none)" />
                    <datalist id="hk-add-merchant-sub">
                      {subcategories.filter(s => !s.archived && (!addMerchantCategory || s.category === addMerchantCategory)).map(s => (
                        <option key={s.code} value={s.code} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[color:var(--hk-muted)]">Default tags (CSV)</label>
                  <input className="mt-1 w-full hk-input" value={addMerchantTagsCsv} onChange={(e) => setAddMerchantTagsCsv(e.target.value)} placeholder="food,online_order" />
                </div>
              </div>
            ) : null}

            {addOpen === 'category' ? (
              <div className="mt-4 grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs text-[color:var(--hk-muted)]">Category code</label>
                  <input className="mt-1 w-full hk-input font-mono" value={addCategoryCode} onChange={(e) => setAddCategoryCode(e.target.value)} placeholder="FOOD_DINING" />
                </div>
                <div>
                  <label className="text-xs text-[color:var(--hk-muted)]">Name</label>
                  <input className="mt-1 w-full hk-input" value={addCategoryName} onChange={(e) => setAddCategoryName(e.target.value)} placeholder="Food & Dining" />
                </div>
              </div>
            ) : null}

            {addOpen === 'subcategory' ? (
              <div className="mt-4 grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs text-[color:var(--hk-muted)]">Subcategory code</label>
                  <input className="mt-1 w-full hk-input font-mono" value={addSubCode} onChange={(e) => setAddSubCode(e.target.value)} placeholder="FOOD_ONLINE_DELIVERY" />
                </div>
                <div>
                  <label className="text-xs text-[color:var(--hk-muted)]">Name</label>
                  <input className="mt-1 w-full hk-input" value={addSubName} onChange={(e) => setAddSubName(e.target.value)} placeholder="Online delivery" />
                </div>
                <div>
                  <label className="text-xs text-[color:var(--hk-muted)]">Parent category</label>
                  <input className="mt-1 w-full hk-input" list="hk-add-sub-parent" value={addSubCategory} onChange={(e) => setAddSubCategory(e.target.value)} placeholder="(select)" />
                  <datalist id="hk-add-sub-parent">
                    {categories.filter(c => !c.archived).map(c => (
                      <option key={c.code} value={c.code} />
                    ))}
                  </datalist>
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button className="hk-btn-secondary" onClick={() => setAddOpen(null)}>Cancel</button>
              <button
                className="hk-btn-primary"
                onClick={() => {
                  if (addOpen === 'merchant') submitAddMerchant().catch((e) => setErr(String(e?.message || e)));
                  if (addOpen === 'category') submitAddCategory().catch((e) => setErr(String(e?.message || e)));
                  if (addOpen === 'subcategory') submitAddSubcategory().catch((e) => setErr(String(e?.message || e)));
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
