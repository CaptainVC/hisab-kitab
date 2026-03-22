import path from 'node:path';
import { requireAuth } from '../auth/session.js';
import { readJson } from '../storage/jsonStore.js';
import { parseRangeToMs } from '../utils/range.js';
export async function registerMailRoutes(app, opts) {
    // Stats view
    app.get('/api/v1/mail/stats', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const q = req.query;
        const from = String(q.from || '');
        const to = String(q.to || '');
        const range = from && to ? parseRangeToMs(from, to) : null;
        const ordersFp = path.join(opts.baseDir, 'orders_parsed.json');
        const paymentsFp = path.join(opts.baseDir, 'payments_parsed.json');
        const ordersJ = readJson(ordersFp, null);
        const paymentsJ = readJson(paymentsFp, null);
        const orders = Array.isArray(ordersJ?.orders) ? ordersJ.orders : [];
        const payments = Array.isArray(paymentsJ?.payments) ? paymentsJ.payments : [];
        const filterByRange = (x) => {
            const ms = Number(x?.internalDateMs || 0);
            if (!range)
                return true;
            if (!ms)
                return false;
            return ms >= range.start && ms < range.endExclusive;
        };
        const o2 = orders.filter(filterByRange);
        const p2 = payments.filter(filterByRange);
        const byMerchant = {};
        for (const o of o2) {
            const m = String(o?.merchant || '').trim() || 'UNKNOWN';
            byMerchant[m] = (byMerchant[m] || 0) + 1;
        }
        const byPaymentSource = {};
        for (const p of p2) {
            const s = String(p?.source || '').trim() || 'UNKNOWN';
            byPaymentSource[s] = (byPaymentSource[s] || 0) + 1;
        }
        const recentPayments = p2
            .slice()
            .sort((a, b) => Number(b.internalDateMs || 0) - Number(a.internalDateMs || 0))
            .slice(0, 25)
            .map((p) => ({
            internalDateMs: p.internalDateMs,
            source: p.source,
            subject: p.subject,
            amount: p.amount,
            direction: p.direction,
            instrument: p.instrument,
            rawSnippet: String(p.raw || '').slice(0, 160)
        }));
        const oldestOrderMs = o2.reduce((min, o) => {
            const ms = Number(o?.internalDateMs || 0);
            if (!ms)
                return min;
            if (min === null)
                return ms;
            return ms < min ? ms : min;
        }, null);
        const oldestPaymentMs = p2.reduce((min, p) => {
            const ms = Number(p?.internalDateMs || 0);
            if (!ms)
                return min;
            if (min === null)
                return ms;
            return ms < min ? ms : min;
        }, null);
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
    function readMailStore() {
        const fp = path.join(opts.baseDir, 'staging', 'mail_orders.json');
        const j = readJson(fp, { schemaVersion: 1, orders: [] });
        const orders = Array.isArray(j?.orders) ? j.orders : [];
        return { fp, orders };
    }
    // Merchant list + basic stats (for UI dropdown)
    app.get('/api/v1/mail/merchants', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { orders } = readMailStore();
        const by = {};
        for (const o of orders) {
            const mc = String(o?.merchant_code || '').trim().toUpperCase() || 'UNKNOWN';
            const d = String(o?.date || '').slice(0, 10);
            if (!by[mc])
                by[mc] = { count: 0, oldest: null, newest: null, withItems: 0 };
            by[mc].count++;
            if (d) {
                if (!by[mc].oldest || d < by[mc].oldest)
                    by[mc].oldest = d;
                if (!by[mc].newest || d > by[mc].newest)
                    by[mc].newest = d;
            }
            const items = Array.isArray(o?.items) ? o.items : [];
            if (items.length)
                by[mc].withItems++;
        }
        const merchants = Object.entries(by)
            .map(([merchant_code, v]) => ({ merchant_code, count: v.count, oldestDate: v.oldest, newestDate: v.newest, withItems: v.withItems }))
            .sort((a, b) => a.merchant_code.localeCompare(b.merchant_code));
        return reply.send({ ok: true, merchants });
    });
    // Run reconcile report on demand (job)
    app.post('/api/v1/mail/reconcile/run', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const body = (req.body || {});
        const merchant_code = String(body.merchant_code || '').trim().toUpperCase();
        const from = String(body.from || '').trim();
        const to = String(body.to || '').trim();
        const bufferDays = Number(body.bufferDays ?? 3);
        const tol = Number(body.tol ?? 10);
        const includeRawMention = body.includeRawMention === undefined ? true : !!body.includeRawMention;
        const enableSplitSuggestions = body.enableSplitSuggestions === undefined ? false : !!body.enableSplitSuggestions;
        if (!merchant_code)
            return reply.code(400).send({ ok: false, error: 'missing_merchant_code' });
        if (!from || !to)
            return reply.code(400).send({ ok: false, error: 'missing_range' });
        const reportId = `reconcile_${merchant_code}_${from}_${to}_${Date.now()}`.replace(/[^A-Z0-9_\-]/gi, '_');
        const script = path.join(opts.repoDir, 'web', 'server', 'dist', 'scripts', 'mail_reconcile.js');
        const args = [
            script,
            '--base-dir', opts.baseDir,
            '--merchant-code', merchant_code,
            '--from', from,
            '--to', to,
            '--buffer-days', String(bufferDays),
            '--tol', String(tol),
            '--include-raw-mention', includeRawMention ? '1' : '0',
            '--enable-split-suggestions', enableSplitSuggestions ? '1' : '0',
            '--report-id', reportId
        ];
        try {
            const job = await opts.runner.startJob('mailReconcile', { merchant_code, from, to, bufferDays, tol, includeRawMention, enableSplitSuggestions, reportId }, process.execPath, args, { cwd: opts.repoDir });
            return reply.send({ ok: true, jobId: job.jobId, reportId });
        }
        catch (e) {
            if (String(e?.message || e) === 'job_already_running')
                return reply.code(409).send({ ok: false, error: 'job_already_running' });
            return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
        }
    });
    // Fetch a reconcile report by id
    app.get('/api/v1/mail/reconcile/report/:reportId', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const { reportId } = req.params;
        const id = String(reportId || '').trim();
        if (!id)
            return reply.code(400).send({ ok: false, error: 'missing_report_id' });
        const fp = path.join(opts.baseDir, 'cache', 'reconcile', `${id}.json`);
        const j = readJson(fp, null);
        if (!j)
            return reply.code(404).send({ ok: false, error: 'not_found', file: fp });
        return reply.send(j);
    });
    // Latest crossref report for range (if exists)
    app.get('/api/v1/mail/crossrefReport', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const q = req.query;
        const from = String(q.from || '');
        const to = String(q.to || '');
        if (!from || !to)
            return reply.code(400).send({ ok: false, error: 'missing_range' });
        const fp = path.join(opts.baseDir, 'cache', `mail_crossref_${from}_${to}.json`);
        const j = readJson(fp, null);
        if (!j)
            return reply.code(404).send({ ok: false, error: 'not_found', file: fp });
        return reply.send({ ok: true, file: fp, report: j });
    });
    // Manual-Hisab match report (mail orders -> cleansed manual Hisab dataset)
    app.get('/api/v1/mail/manualMatchReport', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const q = req.query;
        const period = String(q.period || '').trim(); // e.g. 2025_Q2
        if (!period)
            return reply.code(400).send({ ok: false, error: 'missing_period' });
        const fp = path.join(opts.baseDir, 'cache', `mail_to_hisab_manual_${period}.json`);
        const j = readJson(fp, null);
        if (!j)
            return reply.code(404).send({ ok: false, error: 'not_found', file: fp });
        return reply.send({ ok: true, file: fp, report: j });
    });
    // List manual-match rows (derived from the report file)
    app.get('/api/v1/mail/manualMatchRows', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const q = req.query;
        const period = String(q.period || '').trim();
        const status = String(q.status || 'matched'); // matched|none|ambiguous
        if (!period)
            return reply.code(400).send({ ok: false, error: 'missing_period' });
        const fp = path.join(opts.baseDir, 'cache', `mail_to_hisab_manual_${period}.json`);
        const j = readJson(fp, null);
        if (!j)
            return reply.code(404).send({ ok: false, error: 'not_found', file: fp });
        if (status === 'matched') {
            const rows = (Array.isArray(j.matches) ? j.matches : []).map((x) => ({
                mail: x.mail,
                hisab: x.match?.hisab || null,
                dayDelta: x.match?.dayDelta ?? null,
                amtDelta: x.match?.amtDelta ?? null
            }));
            return reply.send({ ok: true, file: fp, period, status, rows });
        }
        if (status === 'ambiguous') {
            const rows = Array.isArray(j.examples?.ambiguous) ? j.examples.ambiguous : [];
            return reply.send({ ok: true, file: fp, period, status, rows });
        }
        if (status === 'none') {
            const rows = (Array.isArray(j.examples?.none) ? j.examples.none : []).map((x) => x.mail).filter(Boolean);
            return reply.send({ ok: true, file: fp, period, status, rows });
        }
        return reply.code(400).send({ ok: false, error: 'bad_status' });
    });
    // List mail orders from store (filterable by status and range)
    app.get('/api/v1/mail/crossrefOrders', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const q = req.query;
        const from = String(q.from || '');
        const to = String(q.to || '');
        const status = String(q.status || ''); // unmatched|matched|ignored|""(all)
        if (!from || !to)
            return reply.code(400).send({ ok: false, error: 'missing_range' });
        const { fp, orders } = readMailStore();
        const r = parseRangeToMs(from, to);
        if (!r)
            return reply.code(400).send({ ok: false, error: 'bad_range' });
        const start = new Date(r.start).toISOString().slice(0, 10);
        const endExclusive = new Date(r.endExclusive).toISOString().slice(0, 10);
        const filtered = orders
            .filter((o) => {
            const d = String(o?.date || '');
            if (!d)
                return false;
            if (!(d >= start && d < endExclusive))
                return false;
            if (status && String(o?.status || '') !== status)
                return false;
            return true;
        })
            .sort((a, b) => (String(b.date || '').localeCompare(String(a.date || '')) || String(a.messageId || '').localeCompare(String(b.messageId || ''))));
        return reply.send({ ok: true, storeFile: fp, from, to, status: status || null, orders: filtered });
    });
    // Match-report (dry run) for cross-referencing mail orders to Hisab overall entries.
    app.post('/api/v1/mail/matchReport', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const body = (req.body || {});
        const from = String(body.from || '');
        const to = String(body.to || '');
        const bufferDays = Number(body.bufferDays ?? 2);
        if (!from || !to)
            return reply.code(400).send({ ok: false, error: 'missing_range' });
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
        }
        catch (e) {
            if (String(e?.message || e) === 'job_already_running')
                return reply.code(409).send({ ok: false, error: 'job_already_running' });
            return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
        }
    });
    // Cross-reference unmatched mail orders to Hisab overall entries (no Excel edits).
    app.post('/api/v1/mail/crossref', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const body = (req.body || {});
        const from = String(body.from || '');
        const to = String(body.to || '');
        const bufferDays = Number(body.bufferDays ?? 2);
        if (!from || !to)
            return reply.code(400).send({ ok: false, error: 'missing_range' });
        const script = path.join(opts.repoDir, 'web', 'server', 'dist', 'scripts', 'mail_crossref.js');
        const args = [
            script,
            '--base-dir', opts.baseDir,
            '--from', from,
            '--to', to,
            '--buffer-days', String(bufferDays),
            '--tol', '2'
        ];
        try {
            const job = await opts.runner.startJob('mailCrossref', { from, to, bufferDays }, process.execPath, args, { cwd: opts.repoDir });
            return reply.send({ ok: true, jobId: job.jobId });
        }
        catch (e) {
            if (String(e?.message || e) === 'job_already_running')
                return reply.code(409).send({ ok: false, error: 'job_already_running' });
            return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
        }
    });
    // Ingest mail-derived orders into Excel (item-level) with best-effort categorization.
    app.post('/api/v1/mail/ingestOrders', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const body = (req.body || {});
        const from = String(body.from || '');
        const to = String(body.to || '');
        const bufferDays = Number(body.bufferDays ?? 2);
        if (!from || !to)
            return reply.code(400).send({ ok: false, error: 'missing_range' });
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
        }
        catch (e) {
            if (String(e?.message || e) === 'job_already_running')
                return reply.code(409).send({ ok: false, error: 'job_already_running' });
            return reply.code(500).send({ ok: false, error: 'start_failed', detail: String(e?.message || e) });
        }
    });
}
//# sourceMappingURL=mail.js.map