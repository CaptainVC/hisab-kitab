// Blinkit PDF order parser wrapper around python implementation.

const path = require('path');
const { spawnSync } = require('child_process');

module.exports = {
  id: 'BLINKIT_PDF_V1',
  kind: 'order',

  parse(ctx) {
    const py = process.env.HK_PDF_PY || path.join(process.env.HOME, 'clawd', '.venv-pdf', 'bin', 'python');
    const script = path.join(process.env.HOME, 'clawd', 'hisab-kitab', 'src', 'pdf', 'parse_blinkit_invoice.py');

    const r = spawnSync(py, [script, ctx.pdfPath], { encoding: 'utf8' });
    if (r.status !== 0) {
      return [{
        merchant: 'BLINKIT',
        parse_status: 'error',
        parse_error: r.stderr || 'python failed',
        pdfPath: ctx.pdfPath,
        messageId: ctx.msg?.messageId
      }];
    }

    const parsed = JSON.parse(r.stdout);
    return [{
      merchant: 'BLINKIT',
      parse_status: 'ok',
      messageId: ctx.msg?.messageId,
      internalDateMs: ctx.msg?.internalDateMs,
      order_id: parsed.order_id,
      invoice_number: parsed.invoice_number,
      invoice_date: parsed.invoice_date,
      total: parsed.overall_total ?? parsed.grand_total,
      invoices: parsed.invoices || [],
      pdfPath: ctx.pdfPath
    }];
  }
};
