// Generic Shopify "Thank you for your purchase" order email parser (v1)
// Works for merchants like Nobero, BeMinimalist, Naturaltein, Misfits etc.
//
// Extracts:
// - order_id (supports "Order #123" and "Order ABC123")
// - total ("Total ₹ 1,999.00" or "Total ₹1999.00")
// - item lines from "Order summary" section
//
// Avoids including product codes/HSN/SKU in item names.

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
  // Remove HSN/SKU codes if present
  name = name.replace(/\b(?:HSN|SAC|SKU)\b\s*[:#-]?\s*\d+/ig, '').trim();
  // Remove coupon-like fragments often placed inline
  name = name.replace(/\s+\([^)]+\)\s*$/,'').trim();
  return name;
}

function parseOrderId(blob){
  const s = String(blob);
  let m = s.match(/\bOrder\s*#\s*([A-Za-z0-9-]+)\b/i);
  if(m) return m[1];
  m = s.match(/\bOrder\s+([A-Za-z0-9-]{6,})\b/i);
  if(m) return m[1];
  return null;
}

function parseTotal(blob){
  const m = String(blob).match(/\bTotal\s*:?\s*₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  return m ? parseMoney(m[1]) : null;
}

function parseItems(blob){
  const out = [];
  const s = String(blob);

  const idx = s.toLowerCase().indexOf('order summary');
  let tail = idx === -1 ? s : s.slice(idx);

  // stop before totals section if possible
  const stop = tail.match(/\b(?:Subtotal|Customer information|Billing address|Shipping address)\b/i);
  if(stop && stop.index != null) tail = tail.slice(0, stop.index);

  // Pattern A (most common): "Product Name × 1 ₹ 1,999.00"
  const reTimes = /(.{3,180}?)\s*(?:×|x)\s*(\d+)\s*₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/ig;
  let m;
  while((m = reTimes.exec(tail))){
    const name = cleanName(m[1]);
    const qty = Number(m[2] || 1);
    const amt = parseMoney(m[3]);
    if(!name || !Number.isFinite(qty) || !Number.isFinite(amt)) continue;
    const low = name.toLowerCase();
    if(low.includes('order summary')) continue;
    out.push({ name: name.slice(0,180), qty, amount: Math.round(amt*100)/100 });
  }

  // Pattern B (Naturaltein/Misfits style):
  // "Product Quantity Price <NAME ...> 1 ₹ 2,390.00"
  if(!out.length && /\bProduct\s+Quantity\s+Price\b/i.test(tail)){
    const rePQ = /\bProduct\s+Quantity\s+Price\b([\s\S]*)$/i;
    const mm = rePQ.exec(tail);
    const body = mm ? mm[1] : tail;

    // greedy but bounded name until qty+₹price
    const reLine = /([A-Za-z0-9][A-Za-z0-9\s:&,'()\-\.\/|]{6,220}?)\s+(\d+)\s+₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
    let m2;
    while((m2 = reLine.exec(body))){
      const name = cleanName(m2[1]);
      const qty = Number(m2[2] || 1);
      const amt = parseMoney(m2[3]);
      if(!name || !Number.isFinite(qty) || !Number.isFinite(amt)) continue;
      // filter headers / section labels
      const low = name.toLowerCase();
      if(['product','quantity','price'].includes(low)) continue;
      out.push({ name: name.slice(0,180), qty, amount: Math.round(amt*100)/100 });
      if(out.length >= 40) break;
    }
  }

  return out;
}

module.exports = {
  id: 'SHOPIFY_ORDER_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const { msg } = ctx;
    const blob = normText(`${msg.subject || ''} ${ctx.text || ''} ${ctx.html || ''}`);

    const order_id = parseOrderId(blob);
    const invoice_date = toISOFromMs(msg.internalDateMs);
    const total = parseTotal(blob);
    const items = parseItems(blob);

    return [{
      merchant: ctx.cfg?.merchantCode || null, // will be overwritten by wrapper or cfg
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
