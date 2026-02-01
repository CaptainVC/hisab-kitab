// Naturaltein (Shopify-like) order email parser wrapper

const SHOPIFY = require('./shopify_order_email_v1');

module.exports = {
  id: 'NATURALTEIN_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const events = SHOPIFY.parse({ ...ctx, cfg: { ...(ctx.cfg||{}), merchantCode: 'NATURALTEIN' } }) || [];
    for(const e of events) e.merchant = 'NATURALTEIN';
    return events;
  }
};
