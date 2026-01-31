// Zomato email parser (v1, best-effort)

function normAmt(s){
  if(!s) return null;
  const v = Number(String(s).replace(/,/g,''));
  return Number.isFinite(v) ? v : null;
}

module.exports = {
  id: 'ZOMATO_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const { msg, text } = ctx;
    const blob = `${msg.subject||''}\n${text||''}`;

    const orderId = (blob.match(/ORDER ID:\s*([0-9]+)/i) || [])[1] || null;
    const total = normAmt((blob.match(/Total paid\s*[-:]?\s*₹\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) || [])[1]);

    return [{
      merchant: 'ZOMATO',
      parse_status: 'ok',
      messageId: msg.messageId,
      internalDateMs: msg.internalDateMs,
      order_id: orderId,
      total,
      items: [],
      raw: (text||'').slice(0, 1500)
    }];
  }
};
