// MuscleBlaze order confirmation email parser (v1)

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

function cleanName(s){
  let name = normText(s);
  name = name.replace(/\b(?:HSN|SAC|SKU)\b\s*[:#-]?\s*\d+/ig, '').trim();
  return name;
}

module.exports = {
  id: 'MUSCLEBLAZE_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const { msg } = ctx;
    const blob = normText(`${msg.subject || ''} ${ctx.text || ''} ${ctx.html || ''}`);

    const oid = (blob.match(/\bOrder\s*ID\s*:\s*([A-Z0-9-]+)/i) || [])[1] || null;

    // Total: Rs. 639 / Grand Total: Rs. 639
    let total = null;
    const m = blob.match(/\bGrand\s*Total\s*:\s*Rs\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i)
          || blob.match(/\bTotal\s*:\s*Rs\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
    if(m) total = parseMoney(m[1]);

    // Items table row: "<name> <price> <qty> <total>"
    const items = [];
    const re = /([A-Za-z0-9][A-Za-z0-9\s,&()\-\.]{3,160}?)\s+(\d+(?:\.[0-9]{1,2})?)\s+(\d+)\s+(\d+(?:\.[0-9]{1,2})?)/g;
    let mm;
    while((mm = re.exec(blob))){
      const name = cleanName(mm[1]);
      const qty = Number(mm[3] || 1);
      const lineTotal = parseMoney(mm[4]);
      if(!name || !Number.isFinite(lineTotal)) continue;
      // filter obvious headers
      if(name.toLowerCase().includes('product name')) continue;
      items.push({ name: name.slice(0,180), qty, amount: Math.round(lineTotal*100)/100 });
      // In these emails there is usually just one product row; avoid runaway matches
      if(items.length >= 20) break;
    }

    if(total == null && items.length){
      total = Math.round(items.reduce((s,x)=>s+(Number(x.amount)||0),0)*100)/100;
    }

    const invoice_date = toISOFromMs(msg.internalDateMs);

    return [{
      merchant: 'MUSCLEBLAZE',
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
