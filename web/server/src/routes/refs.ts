import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../auth/session.js';
import { readJson, writeJson } from '../storage/jsonStore.js';

export type MerchantRef = {
  name: string;
  archived?: boolean;
  possibleCategories?: string[];
  // keep compatibility with existing file shape
  default?: {
    category?: string;
    subcategory?: string;
    tags?: string[];
  };
};

function refsPath(baseDir: string, name: string) {
  return path.join(baseDir, 'refs', name);
}

function monthRangeToMs(fromYm: string, toYm: string) {
  // from/to are inclusive months in YYYY-MM
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return null;
  const start = Date.UTC(fy, fm - 1, 1, 0, 0, 0, 0);
  const endExclusive = Date.UTC(ty, tm, 1, 0, 0, 0, 0); // next month
  return { start, endExclusive };
}

type CategoryRef = { name: string; archived?: boolean };

type SubcategoryRef = { name: string; category: string; archived?: boolean };

export async function registerRefsRoutes(app: FastifyInstance, opts: { baseDir: string }) {
  // Merchants
  app.get('/api/v1/refs/merchants', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const fp = refsPath(opts.baseDir, 'merchants.json');
    const merchants = readJson<Record<string, MerchantRef>>(fp, {});
    const list = Object.entries(merchants)
      .map(([code, m]) => ({ code, ...m }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return reply.send({ ok: true, merchants: list });
  });

  app.put('/api/v1/refs/merchants/:code', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { code } = req.params as any;
    const c = String(code || '').trim();
    if (!c) return reply.code(400).send({ ok: false, error: 'missing_code' });

    const body = (req.body || {}) as any;
    const patch: Partial<MerchantRef> = {};
    if (body.name !== undefined) patch.name = String(body.name || '').trim();
    if (body.archived !== undefined) patch.archived = !!body.archived;

    // default mappings
    if (body.default !== undefined && body.default && typeof body.default === 'object') {
      const d: any = body.default;
      patch.default = {
        category: d.category !== undefined ? String(d.category || '') : undefined,
        subcategory: d.subcategory !== undefined ? String(d.subcategory || '') : undefined,
        tags: Array.isArray(d.tags) ? d.tags.map(String) : undefined
      };
    } else {
      // allow flat keys too
      const hasFlat = body.defaultCategory !== undefined || body.defaultSubcategory !== undefined || body.defaultTags !== undefined;
      if (hasFlat) {
        patch.default = {
          category: body.defaultCategory !== undefined ? String(body.defaultCategory || '') : undefined,
          subcategory: body.defaultSubcategory !== undefined ? String(body.defaultSubcategory || '') : undefined,
          tags: Array.isArray(body.defaultTags) ? body.defaultTags.map(String) : undefined
        };
      }
    }

    const fp = refsPath(opts.baseDir, 'merchants.json');
    const merchants = readJson<Record<string, MerchantRef>>(fp, {});
    const cur = merchants[c] || ({ name: c } as MerchantRef);

    const next: MerchantRef = { ...cur, ...patch };
    // merge default object instead of clobbering
    if (patch.default) {
      next.default = { ...(cur.default || {}), ...(patch.default || {}) };
    }

    merchants[c] = next;
    writeJson(fp, merchants);
    return reply.send({ ok: true, code: c, merchant: merchants[c] });
  });

  app.post('/api/v1/refs/merchants/:code/archive', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { code } = req.params as any;
    const c = String(code || '').trim();
    if (!c) return reply.code(400).send({ ok: false, error: 'missing_code' });
    const fp = refsPath(opts.baseDir, 'merchants.json');
    const merchants = readJson<Record<string, MerchantRef>>(fp, {});
    if (!merchants[c]) return reply.code(404).send({ ok: false, error: 'not_found' });
    merchants[c].archived = true;
    writeJson(fp, merchants);
    return reply.send({ ok: true });
  });

  // Categories
  app.get('/api/v1/refs/categories', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const fp = refsPath(opts.baseDir, 'categories.json');
    const categories = readJson<Record<string, CategoryRef>>(fp, {});
    const list = Object.entries(categories)
      .map(([code, c]) => ({ code, ...c }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return reply.send({ ok: true, categories: list });
  });

  app.put('/api/v1/refs/categories/:code', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { code } = req.params as any;
    const c = String(code || '').trim();
    if (!c) return reply.code(400).send({ ok: false, error: 'missing_code' });

    const body = (req.body || {}) as any;
    const patch: Partial<CategoryRef> = {};
    if (body.name !== undefined) patch.name = String(body.name || '').trim();
    if (body.archived !== undefined) patch.archived = !!body.archived;

    const fp = refsPath(opts.baseDir, 'categories.json');
    const cats = readJson<Record<string, CategoryRef>>(fp, {});
    const cur = cats[c] || { name: c };
    cats[c] = { ...cur, ...patch };
    writeJson(fp, cats);
    return reply.send({ ok: true, code: c, category: cats[c] });
  });

  app.post('/api/v1/refs/categories/:code/archive', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { code } = req.params as any;
    const c = String(code || '').trim();
    if (!c) return reply.code(400).send({ ok: false, error: 'missing_code' });
    const fp = refsPath(opts.baseDir, 'categories.json');
    const cats = readJson<Record<string, CategoryRef>>(fp, {});
    if (!cats[c]) return reply.code(404).send({ ok: false, error: 'not_found' });
    cats[c].archived = true;
    writeJson(fp, cats);
    return reply.send({ ok: true });
  });

  // Subcategories
  app.get('/api/v1/refs/subcategories', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const fp = refsPath(opts.baseDir, 'subcategories.json');
    const subs = readJson<Record<string, SubcategoryRef>>(fp, {});
    const list = Object.entries(subs)
      .map(([code, s]) => ({ code, ...s }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return reply.send({ ok: true, subcategories: list });
  });

  app.put('/api/v1/refs/subcategories/:code', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { code } = req.params as any;
    const c = String(code || '').trim();
    if (!c) return reply.code(400).send({ ok: false, error: 'missing_code' });

    const body = (req.body || {}) as any;
    const patch: Partial<SubcategoryRef> = {};
    if (body.name !== undefined) patch.name = String(body.name || '').trim();
    if (body.category !== undefined) patch.category = String(body.category || '').trim();
    if (body.archived !== undefined) patch.archived = !!body.archived;

    const fp = refsPath(opts.baseDir, 'subcategories.json');
    const subs = readJson<Record<string, SubcategoryRef>>(fp, {});
    const cur = subs[c] || { name: c, category: patch.category || '' };
    subs[c] = { ...cur, ...patch } as any;
    if (!subs[c].category) subs[c].category = '';
    writeJson(fp, subs);
    return reply.send({ ok: true, code: c, subcategory: subs[c] });
  });

  app.post('/api/v1/refs/subcategories/:code/archive', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { code } = req.params as any;
    const c = String(code || '').trim();
    if (!c) return reply.code(400).send({ ok: false, error: 'missing_code' });
    const fp = refsPath(opts.baseDir, 'subcategories.json');
    const subs = readJson<Record<string, SubcategoryRef>>(fp, {});
    if (!subs[c]) return reply.code(404).send({ ok: false, error: 'not_found' });
    subs[c].archived = true;
    writeJson(fp, subs);
    return reply.send({ ok: true });
  });

  // Email rules view-only
  app.get('/api/v1/refs/email_rules', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const merchants = readJson<any>(refsPath(opts.baseDir, 'email_merchants.json'), {});
    const payments = readJson<any>(refsPath(opts.baseDir, 'email_payments.json'), {});
    return reply.send({ ok: true, merchants, payments });
  });

  // Merchant email coverage (derived from HisabKitab labeled parsed outputs)
  app.get('/api/v1/refs/merchants/coverage', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const q = req.query as any;
    const from = String(q.from || '');
    const to = String(q.to || '');

    const range = from && to ? monthRangeToMs(from, to) : null;

    const ordersFp = path.join(opts.baseDir, 'orders_parsed.json');
    const orders = readJson<any>(ordersFp, null);
    const list: any[] = Array.isArray(orders?.orders) ? orders.orders : [];

    const counts: Record<string, { count: number; lastMs: number }> = {};
    for (const o of list) {
      const m = String(o?.merchant || '').trim();
      if (!m) continue;
      const ms = Number(o?.internalDateMs || 0);
      if (range) {
        if (!ms) continue;
        if (ms < range.start || ms >= range.endExclusive) continue;
      }
      if (!counts[m]) counts[m] = { count: 0, lastMs: 0 };
      counts[m].count++;
      if (ms && ms > counts[m].lastMs) counts[m].lastMs = ms;
    }

    const merchants = readJson<Record<string, MerchantRef>>(refsPath(opts.baseDir, 'merchants.json'), {});
    const ruleMerchants = readJson<any>(refsPath(opts.baseDir, 'email_merchants.json'), {});

    const out = Object.keys(merchants).sort().map((code) => {
      const seen = counts[code];
      const lastEmailAt = seen?.lastMs ? new Date(seen.lastMs).toISOString() : null;
      const emailSeenCount = seen?.count || 0;
      const ruleConfigured = !!(ruleMerchants && (ruleMerchants[code] || ruleMerchants[String(code).toLowerCase()]));
      const emailSupport = emailSeenCount > 0 ? 'YES' : 'NO';
      return {
        code,
        emailSupport,
        emailSeenCount,
        lastEmailAt,
        parsersUsed: [],
        ruleConfigured,
      };
    });

    return reply.send({ ok: true, from: from || null, to: to || null, coverage: out });
  });
}
