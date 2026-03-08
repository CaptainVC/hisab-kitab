// HDFC InstaAlerts payment email parser (v1)

function applyRegex(text, regexStr, groupIndex = 1) {
  if (!regexStr) return null;
  const re = new RegExp(regexStr, 'i');
  const m = re.exec(text);
  return m ? (m[groupIndex] ?? null) : null;
}

function normalizeAmt(s) {
  if (!s) return null;
  const v = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

module.exports = {
  id: 'HDFC_INSTA_ALERTS_V1',
  kind: 'payment',

  parse(ctx) {
    // ctx: { messageId, threadId, internalDateMs, from, subject, text }
    // cfg: per-source config
    const { msg, text, cfg } = ctx;

    const subject = msg.subject || '';
    const blob = `${subject}\n${text || ''}`;

    let direction = '';
    // Some HDFC alerts put debit/credit only in the body (e.g. RuPay CC UPI txn subjects).
    const hay = String(blob).toLowerCase();
    const debit = cfg?.parse?.direction?.debitSubjectContains || [];
    const credit = cfg?.parse?.direction?.creditSubjectContains || [];
    if (debit.some(x => hay.includes(String(x).toLowerCase()))) direction = 'DEBIT';
    if (credit.some(x => hay.includes(String(x).toLowerCase()))) direction = 'CREDIT';

    const amtStr = applyRegex(blob, cfg?.parse?.amount?.regex, 1);
    const amount = normalizeAmt(amtStr);

    // cardLast4 regex may have multiple groups; take the first non-empty
    let last4 = applyRegex(blob, cfg?.parse?.cardLast4?.regex, 1);
    if (!last4) last4 = applyRegex(blob, cfg?.parse?.cardLast4?.regex, 2);

    return [{
      source: 'HDFC_INSTA_ALERT',
      messageId: msg.messageId,
      threadId: msg.threadId,
      internalDateMs: msg.internalDateMs,
      from: msg.from,
      subject: msg.subject,
      direction,
      amount,
      instrument: last4 ? `HDFC_CC_${last4}` : 'HDFC_CC',
      merchantHint: null,
      txnId: null,
      counterparty: null,
      raw: (text || '').slice(0, 2000),
      parse_status: amount ? 'ok' : 'partial'
    }];
  }
};
