// BeMinimalist Shopify order confirmation wrapper

const SHOPIFY = require('./shopify_order_email_v1');

module.exports = {
  id: 'BEMINIMALIST_EMAIL_V1',
  kind: 'order',

  parse(ctx){
    const events = SHOPIFY.parse({ ...ctx, cfg: { ...(ctx.cfg||{}), merchantCode: 'BEMINIMALIST' } }) || [];
    for(const e of events) e.merchant = 'BEMINIMALIST';
    return events;
  }
};
