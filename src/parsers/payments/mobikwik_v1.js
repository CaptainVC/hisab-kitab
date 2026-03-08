// MobiKwik payment email parser (v1)

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
  id: 'MOBIKWIK_V1',
  kind: 'payment',

  parse(ctx) {
    const { msg, text, cfg } = ctx;
    const subject = msg.subject || '';
    const blob = `${subject}\n${text || ''}`;

    const amtRegex = cfg?.parse?.amount?.regex;
    // config regex may capture amount in group 2
    const amtStr = applyRegex(blob, amtRegex, 2) || applyRegex(blob, amtRegex, 1);
    const amount = normalizeAmt(amtStr);

    const tl = blob.toLowerCase();
    let direction = '';
    const debitC = cfg?.parse?.direction?.debitBodyContains || [];
    const creditC = cfg?.parse?.direction?.creditBodyContains || [];
    if (debitC.some(x => tl.includes(String(x).toLowerCase()))) direction = 'DEBIT';
    if (creditC.some(x => tl.includes(String(x).toLowerCase()))) direction = 'CREDIT';

    const txnId = applyRegex(blob, cfg?.parse?.txnId?.regex, 1);
    const counterparty = applyRegex(blob, cfg?.parse?.counterparty?.regex, 1);

    return [{
      source: 'MOBIKWIK',
      messageId: msg.messageId,
      threadId: msg.threadId,
      internalDateMs: msg.internalDateMs,
      from: msg.from,
      subject: msg.subject,
      direction,
      amount,
      instrument: 'MOBIKWIK',
      merchantHint: null,
      txnId: txnId || null,
      counterparty: counterparty || null,
      raw: (text || '').slice(0, 2000),
      parse_status: amount ? 'ok' : 'partial'
    }];
  }
};
