// Amazon "Ordered:" / order confirmation email parser (v2)
// Goal: extract per-item prices + per-order totals from the email HTML/text.
// This is still best-effort: Amazon email formats vary.

const { DateTime } = require('luxon');
const IST = 'Asia/Kolkata';

function toISOFromMs(ms){
  if(!ms) return null;
  const dt = DateTime.fromMillis(Number(ms), { zone: IST });
  return dt.isValid ? dt.toISODate() : null;
}

function normText(s){
  return String(s || '')
    .replace(/\u00a0/g, ' ') // nbsp
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(s){
  if(s == null) return null;
  const m = String(s).match(/([0-9][0-9,]*)(?:\.(\d{1,2}))?/);
  if(!m) return null;
  return Number((m[1] + (m[2] ? '.' + m[2] : '')).replace(/,/g, ''));
}

function findOrderSegments(blob){
  // Find each "Order # <id>" and slice blob into segments.
  // Amazon emails often include bidi markers around the order id; we allow them.
  const re = /Order\s*#\s*[\u200e\u200f\u202a-\u202e\u2066-\u2069]*([0-9]{3}-[0-9]{7}-[0-9]{7})/ig;
  const matches = [];
  let m;
  while((m = re.exec(blob))){
    matches.push({ order_id: m[1], index: m.index });
  }

  if(!matches.length) return [{ order_id: null, segment: blob }];

  const out = [];
  for(let i = 0; i < matches.length; i++){
    const start = matches[i].index;
    const end = (i+1 < matches.length) ? matches[i+1].index : blob.length;
    out.push({ order_id: matches[i].order_id, segment: blob.slice(start, end) });
  }
  return out;
}

function cleanItemName(s){
  let name = normText(s);
  // Drop common prefix boilerplate if it got captured.
  if (name.toLowerCase().includes('view or edit order')) {
    name = name.split(/view or edit order/i).pop();
  }
  // Remove "Order # ..." if still present
  name = name.replace(/Order\s*#\s*[\u200e\u200f\u202a-\u202e\u2066-\u2069]*[0-9]{3}-[0-9]{7}-[0-9]{7}/ig, '');
  // Remove common delivery headings
  name = name.replace(/^(Arriving|Delivered|Out for delivery)\s+\w+\s*/i, '');
  return name.trim();
}

function parseItemsFromSegment(seg){
  // Typical pattern in Amazon emails (stripped HTML):
  // "<item name> Quantity: 1 ₹873.00"
  const out = [];

  // Capture a relatively short name fragment before Quantity.
  const re = /(.{3,140}?)\s+Quantity\s*:\s*(\d+)\s+₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/ig;
  let m;
  while((m = re.exec(seg))){
    const name = cleanItemName(m[1]);
    const qty = Number(m[2] || 1);
    const price = parseMoney(m[3]);
    if(!name || !Number.isFinite(price)) continue;
    out.push({ name, qty, amount: Math.round(price * 100) / 100 });
  }

  return out;
}

function parseTotalFromSegment(seg){
  const matches = [...String(seg).matchAll(/\bTotal\s+₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/ig)];
  if(!matches.length) return null;
  return parseMoney(matches[matches.length - 1][1]);
}

module.exports = {
  id: 'AMAZON_ORDERED_EMAIL_V2',
  kind: 'order',

  parse(ctx){
    // ctx: { msg, text, html? }
    const { msg } = ctx;
    const subject = msg.subject || '';

    // We prefer raw HTML if provided, but gmail_parse_orders_v2 currently passes stripped text.
    // Still works with stripped text because prices/qty survive.
    const blob = normText(`${subject}\n${ctx.text || ''}\n${ctx.html || ''}`);

    const segments = findOrderSegments(blob);
    const events = [];

    for(const s of segments){
      const items = parseItemsFromSegment(s.segment);
      const total = parseTotalFromSegment(s.segment);

      // invoice_date is usually not present in these emails reliably; use internalDateMs day as fallback.
      const invoice_date = toISOFromMs(msg.internalDateMs);

      events.push({
        merchant: 'AMAZON',
        parse_status: items.length || total != null ? 'ok' : 'error',
        parse_error: items.length || total != null ? '' : 'no_items_or_total_found',
        messageId: msg.messageId,
        threadId: msg.threadId,
        internalDateMs: msg.internalDateMs,
        order_id: s.order_id,
        invoice_number: null,
        invoice_date,
        total,
        items,
        raw: (ctx.text || '').slice(0, 1500)
      });
    }

    return events;
  }
};
