// Drink Misfits (Shopify-like) order email parser wrapper

const SHOPIFY = require('./shopify_order_email_v1');

module.exports = {
  id: 'DRINKMISFITS_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const events = SHOPIFY.parse({ ...ctx, cfg: { ...(ctx.cfg||{}), merchantCode: 'DRINKMISFITS' } }) || [];
    for(const e of events) e.merchant = 'DRINKMISFITS';
    return events;
  }
};
