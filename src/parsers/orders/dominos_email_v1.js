// Dominos "Order Successful" email parser (v1)
// Extracts order id, invoice date, total, and items from the email body.

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
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(s){
  if(s == null) return null;
  const m = String(s).match(/([0-9][0-9,]*)(?:\.(\d{1,2}))?/);
  if(!m) return null;
  return Number((m[1] + (m[2] ? '.' + m[2] : '')).replace(/,/g, ''));
}

function cleanItemName(s){
  // Domino's item names are usually clean; just normalize whitespace.
  let name = normText(s);
  // Strip table headers if they got merged into the capture
  name = name.replace(/^items\s+qty\s+price\s+/i, '');
  // Remove stray currency fragments
  name = name.replace(/\bRs\.?\s*$/i, '').trim();
  // Remove HSN-like noise just in case
  name = name.replace(/\bHSN\b\s*(?:code)?\s*[:#-]?\s*\d+/ig, '').trim();
  return name;
}

function parseOrderId(blob){
  const m = String(blob).match(/\bOrder\s*No\.?\s*([A-Za-z0-9-]+)\b/i);
  return m ? m[1] : null;
}

function parseInvoiceDate(blob){
  // Pattern from stripped HTML:
  // "Order No. 62 | 08-09-2025 | 18:44:30"
  const m = String(blob).match(/\|\s*(\d{2}-\d{2}-\d{4})\s*\|/);
  if(!m) return null;
  const dt = DateTime.fromFormat(m[1], 'dd-LL-yyyy', { zone: IST });
  return dt.isValid ? dt.toISODate() : null;
}

function parseTotal(blob){
  // Prefer Grand Total
  let m = String(blob).match(/\bGrand\s*Total\s*:\s*Rs\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  if(m) return parseMoney(m[1]);

  // Fallback: Order Total
  m = String(blob).match(/\bOrder\s*Total\s*Rs\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  if(m) return parseMoney(m[1]);

  return null;
}

function parseItems(blob){
  // Look for the Items table:
  // "Items Qty Price Golden Corn 2 178.00 ..."
  const out = [];
  const s = String(blob);

  // Extract the substring starting at "Items" and ending before "Sub Total" if possible
  const startIdx = s.toLowerCase().indexOf('items');
  if(startIdx === -1) return out;

  let tail = s.slice(startIdx);
  const endM = tail.match(/\bSub\s*Total\b/i);
  if(endM && endM.index != null) tail = tail.slice(0, endM.index);

  // Pattern: <name> <qty> <price>
  // Names can include spaces, parentheses, etc.
  const re = /([A-Za-z0-9][A-Za-z0-9\s\-()&.,']{2,120}?)\s+(\d+)\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
  let m;
  while((m = re.exec(tail))){
    const name = cleanItemName(m[1]);
    const qty = Number(m[2] || 1);
    const amt = parseMoney(m[3]);
    if(!name || !Number.isFinite(qty) || !Number.isFinite(amt)) continue;

    // Heuristic: ignore header-like matches
    const low = name.toLowerCase();
    if(['items','qty','price'].includes(low)) continue;

    out.push({ name, qty, amount: Math.round(amt * 100) / 100 });
  }

  return out;
}

module.exports = {
  id: 'DOMINOS_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const { msg } = ctx;
    const blob = normText(`${msg.subject || ''} ${ctx.text || ''} ${ctx.html || ''}`);

    const order_id = parseOrderId(blob);
    const invoice_date = parseInvoiceDate(blob) || toISOFromMs(msg.internalDateMs);
    const total = parseTotal(blob);
    const items = parseItems(blob);

    return [{
      merchant: 'DOMINOS',
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
