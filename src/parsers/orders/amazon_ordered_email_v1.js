// Amazon "Ordered:" email parser (very best-effort; v1)

module.exports = {
  id: 'AMAZON_ORDERED_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    // ctx: { msg, text }
    const { msg, text } = ctx;
    const subject = msg.subject || '';

    const items = [];
    const m = subject.match(/Ordered:\s*"([^"]+)"/i);
    if(m) items.push({ name: m[1].trim() });

    // total: try regex
    let total = null;
    const blob = `${subject}\n${text||''}`;
    const mt = blob.match(/(Order Total|Total)\s*[-:]?\s*₹\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if(mt) total = Number(mt[2].replace(/,/g,''));

    return [{
      merchant: 'AMAZON',
      parse_status: 'ok',
      messageId: msg.messageId,
      internalDateMs: msg.internalDateMs,
      order_id: (blob.match(/Order\s*#\s*([0-9]{3}-[0-9]{7}-[0-9]{7})/i) || [])[1] || null,
      invoice_number: null,
      invoice_date: null,
      total,
      items,
      raw: (text||'').slice(0, 1500)
    }];
  }
};
