// Uber trip receipt email parser (v1)
// Extracts total fare and basic trip metadata from email HTML/text.

const { DateTime } = require('luxon');
const IST = 'Asia/Kolkata';

function toISOFromMs(ms){
  if(!ms) return null;
  const dt = DateTime.fromMillis(Number(ms), { zone: IST });
  return dt.isValid ? dt.toISODate() : null;
}

function normText(s){
  return String(s || '')
    .replace(/\u00a0/g,' ')
    .replace(/&\#8377;|&#8377;/g,'₹')
    .replace(/\s+/g,' ')
    .trim();
}

function parseMoney(s){
  if(s == null) return null;
  const m = String(s).match(/([0-9][0-9,]*)(?:\.(\d{1,2}))?/);
  if(!m) return null;
  return Number((m[1] + (m[2] ? '.' + m[2] : '')).replace(/,/g,''));
}

module.exports = {
  id: 'UBER_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const { msg } = ctx;
    const blob = normText(`${msg.subject || ''} ${ctx.text || ''} ${ctx.html || ''}`);

    // Total ₹279.37
    const m = blob.match(/\bTotal\s*₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
    const total = m ? parseMoney(m[1]) : null;

    // payment mode (Cash/UPI/Card) is under "Payments"
    let payment_mode = null;
    const pm = blob.match(/\bPayments\s+([A-Za-z ]{2,20})\s+₹\s*[0-9]/i);
    if(pm) payment_mode = pm[1].trim();

    const invoice_date = toISOFromMs(msg.internalDateMs);

    const items = total != null ? [{ name: 'Uber trip', qty: 1, amount: Math.round(total*100)/100 }] : [];

    return [{
      merchant: 'UBER',
      parse_status: total != null ? 'ok' : 'error',
      parse_error: total != null ? '' : 'total_not_found',
      messageId: msg.messageId,
      threadId: msg.threadId,
      internalDateMs: msg.internalDateMs,
      order_id: null,
      invoice_number: null,
      invoice_date,
      total,
      items,
      meta: { payment_mode },
      raw: (ctx.text || '').slice(0, 1200)
    }];
  }
};
