// redBus PDF invoice parser wrapper around python implementation.

const path = require('path');
const { spawnSync } = require('child_process');

module.exports = {
  id: 'REDBUS_PDF_V1',
  kind: 'order',

  parse(ctx) {
    const py = process.env.HK_PDF_PY || path.join(process.env.HOME, 'clawd', '.venv-pdf', 'bin', 'python');
    const script = path.join(process.env.HOME, 'clawd', 'hisab-kitab', 'src', 'pdf', 'parse_redbus_invoice.py');

    const r = spawnSync(py, [script, ctx.pdfPath], { encoding: 'utf8' });
    if (r.status !== 0) {
      return [{
        merchant: 'REDBUS',
        parse_status: 'error',
        parse_error: r.stderr || 'python failed',
        pdfPath: ctx.pdfPath,
        messageId: ctx.msg?.messageId
      }];
    }

    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch {
      return [{ merchant: 'REDBUS', parse_status: 'error', parse_error: 'invalid json from python', pdfPath: ctx.pdfPath, messageId: ctx.msg?.messageId }];
    }

    if (!parsed || parsed.ok === false) return [];

    const total = parsed.total;
    const items = parsed.items || [];
    if (total == null && !items.length) return [];

    return [{
      merchant: 'REDBUS',
      parse_status: 'ok',
      messageId: ctx.msg?.messageId,
      internalDateMs: ctx.msg?.internalDateMs,
      order_id: parsed.invoice_no || null,
      invoice_number: parsed.invoice_no || null,
      invoice_date: parsed.invoice_date || null,
      total,
      items,
      pdfPath: ctx.pdfPath
    }];
  }
};
