// Shiprocket delivery notification email parser (v1)
// Shipping-only: does NOT contribute to expense totals. We keep totals in meta only.

const { DateTime } = require('luxon');
const IST = 'Asia/Kolkata';

function toISOFromMs(ms){
  if(!ms) return null;
  const dt = DateTime.fromMillis(Number(ms), { zone: IST });
  return dt.isValid ? dt.toISODate() : null;
}

function normText(s){
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/&\#8377;|&#8377;/g,'₹')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(s){
  if(s == null) return null;
  const m = String(s).match(/([0-9][0-9,]*)(?:\.(\d{1,2}))?/);
  if(!m) return null;
  return Number((m[1] + (m[2] ? '.' + m[2] : '')).replace(/,/g,''));
}

module.exports = {
  id: 'SHIPROCKET_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const { msg } = ctx;
    const blob = normText(`${msg.subject || ''} ${ctx.text || ''} ${ctx.html || ''}`);

    // The Gmail snippet is often truncated before AWB/courier/order-id.
    // If it looks like a snippet (short + no AWB), force a full fetch by returning non-useful events.
    if (blob.length < 700 && !/\bAWB\b/i.test(blob) && !/\bOrder\s*ID\b/i.test(blob)) {
      return [{
        merchant: 'SHIPROCKET',
        parse_status: 'error',
        parse_error: 'snippet_only_need_full',
        messageId: msg.messageId,
        threadId: msg.threadId,
        internalDateMs: msg.internalDateMs,
        order_id: null,
        invoice_number: null,
        invoice_date: toISOFromMs(msg.internalDateMs),
        total: null,
        items: [],
        meta: {},
        raw: (ctx.text || '').slice(0, 400)
      }];
    }

    // Subject example: "Vyom Chopra, your Amul order has been delivered!"
    const sm = blob.match(/\byour\s+(.+?)\s+order\s+has\s+been\s+(delivered|shipped|out\s+for\s+delivery)\b/i);
    const shipped_merchant = sm ? sm[1].trim() : null;
    const status = sm ? sm[2].toLowerCase().replace(/\s+/g,' ') : null;

    // Body fields
    const orderId = (blob.match(/\bOrder\s*ID\s*:?\s*#?\s*([A-Za-z0-9-]{6,})\b/i) || [])[1] || null;
    const courier = (blob.match(/\bCourier\s*:?\s*([A-Za-z0-9 ._-]{2,40})\s+AWB\b/i) || [])[1]?.trim() || null;
    const awb = (blob.match(/\bAWB\s*No\.?\s*:?\s*([0-9]{6,})\b/i) || [])[1] || null;

    const shipTotal = (() => {
      const m = blob.match(/\bTotal\s*Amount\s*₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
      return m ? parseMoney(m[1]) : null;
    })();

    // Shipping-only => keep items empty and total null.
    // We still emit parse_status ok so the record exists for delivery tracing.
    return [{
      merchant: 'SHIPROCKET',
      parse_status: (shipped_merchant || orderId || awb) ? 'ok' : 'error',
      parse_error: (shipped_merchant || orderId || awb) ? '' : 'no_ship_fields_found',
      messageId: msg.messageId,
      threadId: msg.threadId,
      internalDateMs: msg.internalDateMs,
      order_id: null,
      invoice_number: null,
      invoice_date: toISOFromMs(msg.internalDateMs),
      total: null,
      items: [],
      meta: { shipped_merchant, shipment_status: status, courier, awb, ship_total_amount: shipTotal, shiprocket_order_id: orderId },
      raw: (ctx.text || '').slice(0, 1500)
    }];
  }
};
