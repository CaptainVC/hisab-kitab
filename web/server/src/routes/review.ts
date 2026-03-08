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

import type { JobRunner } from '../jobs/jobRunner.js';

export async function registerReviewRoutes(app: FastifyInstance, opts: { cacheDir: string; reviewStateFile: string; runner: JobRunner; baseDir: string; repoDir: string; stagingDir: string }) {
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

    const candidates = rows
      .map((r: any) => ({ row: r, reason: needsReview(r) }))
      .filter((x: any) => !!x.reason)
      .filter((x: any) => !st.resolvedTxnIds?.[x.row.txn_id]);

    const oldestDate = candidates.reduce((min: string | null, x: any) => {
      const d = x?.row?.date ? String(x.row.date) : '';
      if (!d) return min;
      if (!min) return d;
      return d < min ? d : min;
    }, null);

    const items = candidates
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
        origin: x.row.messageId ? 'MAIL' : 'HISAB',
        source: x.row.source || '',
        messageId: x.row.messageId || '',
        parse_status: x.row.parse_status || '',
        parse_error: x.row.parse_error || '',
        raw: x.row
      }));

    return reply.send({ ok: true, count: items.length, oldestDate, items });
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

  // Add a reimbursement (income) row linked to an existing transaction.
  // This is a lightweight way to "split" an expense when part of it was for someone else.
  app.post('/api/v1/review/reimburse', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = (req.body || {}) as any;
    const from = String(body.from || '');
    const to = String(body.to || '');
    const txn_id = String(body.txn_id || '');
    const amount = Number(body.amount || 0);
    const counterparty = body.counterparty ? String(body.counterparty) : '';
    const note = body.note ? String(body.note) : '';
    if (!from || !to) return reply.code(400).send({ ok: false, error: 'missing_range' });
    if (!txn_id) return reply.code(400).send({ ok: false, error: 'missing_txn_id' });
    if (!Number.isFinite(amount) || amount <= 0) return reply.code(400).send({ ok: false, error: 'bad_amount' });

    const fp = cachePath(opts.cacheDir, from, to);
    if (!fs.existsSync(fp)) return reply.code(404).send({ ok: false, error: 'cache_missing' });
    const data = JSON.parse(fs.readFileSync(fp, 'utf8')) as any;
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const base = rows.find((r: any) => String(r?.txn_id || '') === txn_id);
    if (!base) return reply.code(404).send({ ok: false, error: 'txn_not_found_in_cache' });

    const reimburseRow = {
      ...base,
      txn_id: `reimb_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: 'INCOME',
      amount,
      linked_txn_id: txn_id,
      counterparty,
      notes: [
        note?.trim() || null,
        counterparty ? `reimbursed by ${counterparty}` : 'reimbursed',
        `linked:${txn_id}`
      ].filter(Boolean).join(' | '),
      raw_text: base.raw_text || '',
      parse_status: 'ok',
      parse_error: '',
      // keep messageId if original came from mail? no, reimbursement is manual
      messageId: ''
    };

    fs.mkdirSync(opts.stagingDir, { recursive: true });
    const rowsFile = path.join(opts.stagingDir, `review_reimburse_${txn_id}_${Date.now()}.json`);
    fs.writeFileSync(rowsFile, JSON.stringify([reimburseRow], null, 2), 'utf8');

    const script = path.join(opts.repoDir, 'web', 'server', 'dist', 'scripts', 'staging_commit_rows.js');
    const args = [script, '--base-dir', opts.baseDir, '--rows-file', rowsFile];

    try {
      const job = await opts.runner.startJob('reviewReimburse', { txn_id, amount, counterparty, rowsFile }, process.execPath, args, { cwd: opts.repoDir });
      return reply.send({ ok: true, jobId: job.jobId });
    } catch (e: any) {
      if (String(e?.message || e) === 'job_already_running') return reply.code(409).send({ ok: false, error: 'job_already_running' });
      return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
    }
  });
}
