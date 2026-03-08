import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../auth/session.js';
import { loadReviewState, saveReviewState } from '../review/reviewState.js';

function cachePath(cacheDir: string, from: string, to: string) {
  return path.join(cacheDir, `hisab_data_${from}_${to}.json`);
}

function needsReview(row: any): string | null {
  if (row.parse_status && row.parse_status !== 'ok') return 'parse_error';
  if (!row.category || !row.subcategory) return 'missing_category';
  return null;
}

export async function registerReviewRoutes(app: FastifyInstance, opts: { cacheDir: string; reviewStateFile: string }) {
  app.get('/api/v1/review/items', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const q = req.query as any;
    const from = String(q.from || '');
    const to = String(q.to || '');
    if (!from || !to) return reply.code(400).send({ ok: false, error: 'missing_range' });

    const fp = cachePath(opts.cacheDir, from, to);
    if (!fs.existsSync(fp)) return reply.code(404).send({ ok: false, error: 'cache_missing' });

    const data = JSON.parse(fs.readFileSync(fp, 'utf8')) as any;
    const rows = Array.isArray(data?.rows) ? data.rows : [];

    const st = loadReviewState(opts.reviewStateFile);

    const items = rows
      .map((r: any) => ({ row: r, reason: needsReview(r) }))
      .filter((x: any) => !!x.reason)
      .filter((x: any) => !st.resolvedTxnIds?.[x.row.txn_id])
      .slice(0, 500)
      .map((x: any) => ({
        txn_id: x.row.txn_id,
        date: x.row.date,
        amount: x.row.amount,
        type: x.row.type,
        merchant: x.row.merchant_name || x.row.merchant_code || '',
        category: x.row.category_name || x.row.category || '',
        subcategory: x.row.subcategory_name || x.row.subcategory || '',
        notes: x.row.notes,
        reason: x.reason,
        raw: x.row
      }));

    return reply.send({ ok: true, count: items.length, items });
  });

  app.post('/api/v1/review/resolve', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = (req.body || {}) as any;
    const txn_id = String(body.txn_id || '');
    const note = body.note ? String(body.note) : undefined;
    if (!txn_id) return reply.code(400).send({ ok: false, error: 'missing_txn_id' });

    const st = loadReviewState(opts.reviewStateFile);
    st.resolvedTxnIds[txn_id] = { resolvedAt: new Date().toISOString(), note };
    saveReviewState(opts.reviewStateFile, st);
    return reply.send({ ok: true });
  });
}
