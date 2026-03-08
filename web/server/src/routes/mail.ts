import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { requireAuth } from '../auth/session.js';
import { readJson } from '../storage/jsonStore.js';

function monthRangeToMs(fromYm: string, toYm: string) {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return null;
  const start = Date.UTC(fy, fm - 1, 1, 0, 0, 0, 0);
  const endExclusive = Date.UTC(ty, tm, 1, 0, 0, 0, 0);
  return { start, endExclusive };
}

import type { JobRunner } from '../jobs/jobRunner.js';

export async function registerMailRoutes(app: FastifyInstance, opts: { baseDir: string; repoDir: string; stagingDir: string; runner: JobRunner }) {
  // Stats view
  app.get('/api/v1/mail/stats', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const q = req.query as any;
    const from = String(q.from || '');
    const to = String(q.to || '');
    const range = from && to ? monthRangeToMs(from, to) : null;

    const ordersFp = path.join(opts.baseDir, 'orders_parsed.json');
    const paymentsFp = path.join(opts.baseDir, 'payments_parsed.json');

    const ordersJ = readJson<any>(ordersFp, null);
    const paymentsJ = readJson<any>(paymentsFp, null);

    const orders = Array.isArray(ordersJ?.orders) ? ordersJ.orders : [];
    const payments = Array.isArray(paymentsJ?.payments) ? paymentsJ.payments : [];

    const filterByRange = (x: any) => {
      const ms = Number(x?.internalDateMs || 0);
      if (!range) return true;
      if (!ms) return false;
      return ms >= range.start && ms < range.endExclusive;
    };

    const o2 = orders.filter(filterByRange);
    const p2 = payments.filter(filterByRange);

    const byMerchant: Record<string, number> = {};
    for (const o of o2) {
      const m = String(o?.merchant || '').trim() || 'UNKNOWN';
      byMerchant[m] = (byMerchant[m] || 0) + 1;
    }

    const byPaymentSource: Record<string, number> = {};
    for (const p of p2) {
      const s = String(p?.source || '').trim() || 'UNKNOWN';
      byPaymentSource[s] = (byPaymentSource[s] || 0) + 1;
    }

    const recentPayments = p2
      .slice()
      .sort((a: any, b: any) => Number(b.internalDateMs || 0) - Number(a.internalDateMs || 0))
      .slice(0, 25)
      .map((p: any) => ({
        internalDateMs: p.internalDateMs,
        source: p.source,
        subject: p.subject,
        amount: p.amount,
        direction: p.direction,
        instrument: p.instrument,
        rawSnippet: String(p.raw || '').slice(0, 160)
      }));

    const oldestOrderMs = o2.reduce((min: number | null, o: any) => {
      const ms = Number(o?.internalDateMs || 0);
      if (!ms) return min;
      if (min === null) return ms;
      return ms < min ? ms : min;
    }, null as any);

    const oldestPaymentMs = p2.reduce((min: number | null, p: any) => {
      const ms = Number(p?.internalDateMs || 0);
      if (!ms) return min;
      if (min === null) return ms;
      return ms < min ? ms : min;
    }, null as any);

    return reply.send({
      ok: true,
      from: from || null,
      to: to || null,
      oldestOrderMs,
      oldestPaymentMs,
      totals: {
        orders: o2.length,
        payments: p2.length,
        orders_total: Number(ordersJ?.count || orders.length),
        payments_total: Number(paymentsJ?.count || payments.length),
        payments_unknown_total: Number(paymentsJ?.payments ? (paymentsJ.unknown_total ?? null) : null)
      },
      byMerchant,
      byPaymentSource,
      recentPayments
    });
  });

  // Match-report (dry run) for cross-referencing mail orders to Hisab overall entries.
  app.post('/api/v1/mail/matchReport', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = (req.body || {}) as any;
    const from = String(body.from || '');
    const to = String(body.to || '');
    const bufferDays = Number(body.bufferDays ?? 2);
    if (!from || !to) return reply.code(400).send({ ok: false, error: 'missing_range' });

    const script = path.join(opts.repoDir, 'web', 'server', 'dist', 'scripts', 'mail_match_report.js');
    const args = [
      script,
      '--base-dir', opts.baseDir,
      '--from', from,
      '--to', to,
      '--buffer-days', String(bufferDays),
      '--tol', '2'
    ];

    try {
      const job = await opts.runner.startJob('mailMatchReport', { from, to, bufferDays }, process.execPath, args, { cwd: opts.repoDir });
      return reply.send({ ok: true, jobId: job.jobId });
    } catch (e: any) {
      if (String(e?.message || e) === 'job_already_running') return reply.code(409).send({ ok: false, error: 'job_already_running' });
      return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
    }
  });

  // Ingest mail-derived orders into Excel (item-level) with best-effort categorization.
  app.post('/api/v1/mail/ingestOrders', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = (req.body || {}) as any;
    const from = String(body.from || '');
    const to = String(body.to || '');
    const bufferDays = Number(body.bufferDays ?? 2);
    if (!from || !to) return reply.code(400).send({ ok: false, error: 'missing_range' });

    const script = path.join(opts.repoDir, 'web', 'server', 'dist', 'scripts', 'ingest_orders_to_excel.js');
    const args = [
      script,
      '--base-dir', opts.baseDir,
      '--from', from,
      '--to', to,
      '--buffer-days', String(bufferDays),
      '--tol', '2'
    ];

    try {
      const job = await opts.runner.startJob('mailIngestOrders', { from, to, bufferDays }, process.execPath, args, { cwd: opts.repoDir });
      return reply.send({ ok: true, jobId: job.jobId });
    } catch (e: any) {
      if (String(e?.message || e) === 'job_already_running') return reply.code(409).send({ ok: false, error: 'job_already_running' });
      return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
    }
  });
}
