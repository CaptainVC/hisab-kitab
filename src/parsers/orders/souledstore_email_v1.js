// The Souled Store order confirmation parser (v1)
// Extracts item totals and grand total from the email body.

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
    .replace(/&\#8377;|&#8377;/g, '₹')
    .replace(/&\#37;|&#37;/g, '%')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(s){
  if(s == null) return null;
  const m = String(s).match(/([0-9][0-9,]*)(?:\.(\d{1,2}))?/);
  if(!m) return null;
  return Number((m[1] + (m[2] ? '.' + m[2] : '')).replace(/,/g, ''));
}

function cleanName(s){
  let name = normText(s);

  // The stripped HTML often includes prefix text like:
  // "Estimated Delivery by ... . <ITEM NAME>"
  name = name.replace(/^.*Estimated\s+Delivery[^.]*\.\s*/i, '');
  name = name.replace(/^.*ORDER\s+SUMMARY\s*:\s*/i, '');
  name = name.replace(/^Order\s*Date\s*:\s*[^.]*\.\s*/i, '');

  // If some prefix still leaked in with periods, keep only the last sentence fragment.
  if (name.includes('.')) {
    name = name.split('.').slice(-1)[0].trim();
  }

  // remove HSN/SKU noise if it ever appears
  name = name.replace(/\b(?:HSN|SAC|SKU)\b\s*[:#-]?\s*\d+/ig, '').trim();
  return name;
}

module.exports = {
  id: 'SOULEDSTORE_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const { msg } = ctx;
    const blob = normText(`${msg.subject || ''} ${ctx.text || ''} ${ctx.html || ''}`);

    const order_id_m = blob.match(/\bOrder\s*ID\s*:\s*(\d{6,})\b/i);
    const order_id = order_id_m ? order_id_m[1] : null;

    // Order Date: 05 Oct 2025
    let invoice_date = null;
    const od = blob.match(/\bOrder\s*Date\s*:\s*(\d{2}\s+[A-Za-z]{3,9}\s+\d{4})\b/i);
    if(od){
      const dt = DateTime.fromFormat(od[1], 'dd LLL yyyy', { zone: IST });
      invoice_date = dt.isValid ? dt.toISODate() : null;
      if(!invoice_date){
        const dt2 = DateTime.fromFormat(od[1], 'dd LLLL yyyy', { zone: IST });
        invoice_date = dt2.isValid ? dt2.toISODate() : null;
      }
    }
    if(!invoice_date) invoice_date = toISOFromMs(msg.internalDateMs);

    // Grand Total: ₹14188.00
    let total = null;
    const gt = blob.match(/\bGrand\s*Total\s*:\s*₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
    if(gt) total = parseMoney(gt[1]);

    // Items: "<name> Size: XL | Qty: 1 ... Total ₹ 1399.00"
    const items = [];
    const re = /([A-Za-z0-9][A-Za-z0-9\s:&,'()\-\.]{3,160}?)\s+(?:Size:\s*[^|]+\|\s*)?Qty:\s*(\d+)\s+Price\s+₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+GST\s+[0-9.]+%\s+₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s+Total\s+₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/ig;
    let m;
    while((m = re.exec(blob))){
      const name = cleanName(m[1]);
      const qty = Number(m[2] || 1);
      const itemTotal = parseMoney(m[5]);
      if(!name || !Number.isFinite(itemTotal)) continue;
      items.push({ name: name.slice(0,180), qty, amount: Math.round(itemTotal*100)/100 });
    }

    // If total missing, compute from items
    if(total == null && items.length){
      total = Math.round(items.reduce((s,x)=>s+(Number(x.amount)||0),0)*100)/100;
    }

    return [{
      merchant: 'SOULEDSTORE',
      parse_status: (total != null || items.length) ? 'ok' : 'error',
      parse_error: (total != null || items.length) ? '' : 'no_items_or_total_found',
      messageId: msg.messageId,
      threadId: msg.threadId,
      internalDateMs: msg.internalDateMs,
      order_id,
      invoice_number: null,
      invoice_date,
      total,
      items,
      raw: (ctx.text || '').slice(0, 1500)
    }];
  }
};
