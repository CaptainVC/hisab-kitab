// Amul shop order confirmation email parser (v1)

const { DateTime } = require('luxon');
const IST = 'Asia/Kolkata';

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

function cleanName(s){
  let name = normText(s);
  name = name.replace(/\b(?:HSN|SAC|SKU)\b\s*[:#-]?\s*\d+/ig, '').trim();
  return name;
}

module.exports = {
  id: 'AMUL_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const { msg } = ctx;
    const blob = normText(`${msg.subject || ''} ${ctx.text || ''} ${ctx.html || ''}`);

    const oid = (blob.match(/\bOrder\s*ID\s*:\s*(OID\d+)\b/i) || [])[1] || null;

    // Order Total: ₹2,851.2
    let total = null;
    const tm = blob.match(/\bOrder\s*Total\s*:\s*₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
    if(tm) total = parseMoney(tm[1]);

    // Items table seems like: "<product> ₹3,168 DISCOUNT ... 1 ₹2,851.2"
    // We'll take the first product line: starts with product name, then a ₹ amount.
    const items = [];
    const re = /([A-Za-z0-9][A-Za-z0-9\s,()\-\.\/|]{6,200}?)\s+₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+DISCOUNT\b[\s\S]*?\b(\d+)\s+₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
    const m = re.exec(blob);
    if(m){
      const name = cleanName(m[1]);
      const qty = Number(m[3] || 1);
      const amt = parseMoney(m[4]);
      if(name && Number.isFinite(amt)) items.push({ name: name.slice(0,180), qty, amount: Math.round(amt*100)/100 });
    }

    // fallback: if no item parse, just create a single line item
    if(!items.length && total != null){
      items.push({ name: 'Amul order', qty: 1, amount: Math.round(total*100)/100 });
    }

    // Parse order date
    let invoice_date = null;
    const dm = blob.match(/\bOrder\s*Date\s*:\s*([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/i);
    if(dm){
      const dt = DateTime.fromFormat(`${dm[3]} ${dm[2]} ${dm[4]}`, 'd LLL yyyy', { zone: IST });
      invoice_date = dt.isValid ? dt.toISODate() : null;
    }
    if(!invoice_date){
      const dt = DateTime.fromMillis(Number(msg.internalDateMs||0), { zone: IST });
      invoice_date = dt.isValid ? dt.toISODate() : null;
    }

    return [{
      merchant: 'AMUL',
      parse_status: (total != null || items.length) ? 'ok' : 'error',
      parse_error: (total != null || items.length) ? '' : 'no_items_or_total_found',
      messageId: msg.messageId,
      threadId: msg.threadId,
      internalDateMs: msg.internalDateMs,
      order_id: oid,
      invoice_number: null,
      invoice_date,
      total,
      items,
      raw: (ctx.text || '').slice(0, 1500)
    }];
  }
};
