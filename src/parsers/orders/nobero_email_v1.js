// Nobero Shopify order confirmation wrapper

const SHOPIFY = require('./shopify_order_email_v1');

module.exports = {
  id: 'NOBERO_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const events = SHOPIFY.parse({ ...ctx, cfg: { ...(ctx.cfg||{}), merchantCode: 'NOBERO' } }) || [];
    for(const e of events) e.merchant = 'NOBERO';
    return events;
  }
};
