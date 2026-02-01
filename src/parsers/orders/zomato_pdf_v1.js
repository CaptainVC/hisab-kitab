// Zomato PDF invoice parser wrapper around python implementation.

const path = require('path');
const { spawnSync } = require('child_process');

module.exports = {
  id: 'ZOMATO_PDF_V1',
  kind: 'order',

  parse(ctx) {
    const py = process.env.HK_PDF_PY || path.join(process.env.HOME, 'clawd', '.venv-pdf', 'bin', 'python');
    const script = path.join(process.env.HOME, 'clawd', 'hisab-kitab', 'src', 'pdf', 'parse_zomato_invoice.py');

    const r = spawnSync(py, [script, ctx.pdfPath], { encoding: 'utf8' });
    if (r.status !== 0) {
      return [{
        merchant: 'ZOMATO',
        parse_status: 'error',
        parse_error: r.stderr || 'python failed',
        pdfPath: ctx.pdfPath,
        messageId: ctx.msg?.messageId
      }];
    }

    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch (e) {
      return [{ merchant: 'ZOMATO', parse_status: 'error', parse_error: 'invalid json from python', pdfPath: ctx.pdfPath, messageId: ctx.msg?.messageId }];
    }

    // If this PDF isn't a zomato invoice, ignore it (Zomato mails may have multiple PDFs).
    if (!parsed || parsed.ok === false) return [];

    const total = parsed.total;
    const items = parsed.items || [];

    // If it has no useful signal, ignore.
    if (total == null && (!items || !items.length)) return [];

    return [{
      merchant: 'ZOMATO',
      parse_status: 'ok',
      messageId: ctx.msg?.messageId,
      internalDateMs: ctx.msg?.internalDateMs,
      order_id: parsed.order_id || null,
      invoice_number: null,
      invoice_date: null,
      total,
      items,
      pdfPath: ctx.pdfPath
    }];
  }
};
