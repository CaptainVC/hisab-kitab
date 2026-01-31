// Parser registry.
// Parsers are small modules that implement:
//   { id, kind: 'payment'|'order', parse(ctx) }
// ctx varies by kind but generally includes message metadata + extracted content.

const HDFC_INSTA_ALERTS_V1 = require('./payments/hdfc_insta_alerts_v1');
const MOBIKWIK_V1 = require('./payments/mobikwik_v1');

const ZEPTO_PDF_V1 = require('./orders/zepto_pdf_v1');
const BLINKIT_PDF_V1 = require('./orders/blinkit_pdf_v1');

const AMAZON_ORDERED_EMAIL_V1 = require('./orders/amazon_ordered_email_v1');
const SWIGGY_EMAIL_V1 = require('./orders/swiggy_email_v1');
const ZOMATO_EMAIL_V1 = require('./orders/zomato_email_v1');

const all = [
  HDFC_INSTA_ALERTS_V1,
  MOBIKWIK_V1,
  ZEPTO_PDF_V1,
  BLINKIT_PDF_V1,
  AMAZON_ORDERED_EMAIL_V1,
  SWIGGY_EMAIL_V1,
  ZOMATO_EMAIL_V1,
];

const byId = new Map(all.map(p => [p.id, p]));

function getParser(id) {
  const p = byId.get(id);
  if (!p) throw new Error(`Unknown parser id: ${id}`);
  return p;
}

function listParsers() {
  return all.map(p => ({ id: p.id, kind: p.kind }));
}

module.exports = { getParser, listParsers };
