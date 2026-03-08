import path from 'node:path';
import { requireAuth } from '../auth/session.js';
import { readJson } from '../storage/jsonStore.js';
function monthRangeToMs(fromYm, toYm) {
    const [fy, fm] = fromYm.split('-').map(Number);
    const [ty, tm] = toYm.split('-').map(Number);
    if (!fy || !fm || !ty || !tm)
        return null;
    const start = Date.UTC(fy, fm - 1, 1, 0, 0, 0, 0);
    const endExclusive = Date.UTC(ty, tm, 1, 0, 0, 0, 0);
    return { start, endExclusive };
}
export async function registerMailRoutes(app, opts) {
    app.get('/api/v1/mail/stats', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const q = req.query;
        const from = String(q.from || '');
        const to = String(q.to || '');
        const range = from && to ? monthRangeToMs(from, to) : null;
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
        return reply.send({
            ok: true,
            from: from || null,
            to: to || null,
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
}
//# sourceMappingURL=mail.js.map