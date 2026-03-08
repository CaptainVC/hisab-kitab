#!/usr/bin/env python3
"""Parse redBus GST Tax Invoice PDF via pdfplumber.

Returns JSON:
{
  ok: true,
  invoice_no: str|null,
  invoice_date: str|null (YYYY-MM-DD),
  total: float|null,
  items: [{name, qty, amount}]
}

We avoid leaking HSN/SAC codes into items.
"""

import json
import re
import sys
from datetime import datetime

import pdfplumber


def norm_money(s):
    if s is None:
        return None
    s = str(s)
    # handle ₹ and commas
    s = s.replace('₹', '').replace(',', '').strip()
    m = re.search(r'([0-9]+(?:\.[0-9]{1,2})?)', s)
    if not m:
        return None
    try:
        return float(m.group(1))
    except Exception:
        return None


def find_first(patterns, text):
    for pat in patterns:
        m = re.search(pat, text, flags=re.I)
        if m:
            return m.group(1).strip()
    return None


def to_iso_date(s):
    if not s:
        return None
    s = s.strip()
    for fmt in ['%d/%m/%Y', '%d-%m-%Y', '%d %b %Y', '%d %B %Y']:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except Exception:
            pass
    return None


def main():
    if len(sys.argv) < 2:
        print('Usage: parse_redbus_invoice.py <pdfPath>', file=sys.stderr)
        sys.exit(2)

    pdf_path = sys.argv[1]
    with pdfplumber.open(pdf_path) as pdf:
        text = '\n'.join([(p.extract_text() or '') for p in pdf.pages])

    text = text.strip()

    # Basic sanity check
    if 'redbus' not in text.lower() and 'tax invoice' not in text.lower():
        print(json.dumps({ 'ok': False, 'reason': 'not_redbus' }))
        return

    # Invoice header typically:
    # "Invoice No. Date" then next line: "RRJ25-A001854038 13/12/2025"
    m = re.search(r'Invoice\s*No\.?\s*Date\s*\n\s*([A-Z0-9-]+)\s+([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4})', text, flags=re.I)
    invoice_no = m.group(1).strip() if m else None
    invoice_date = to_iso_date(m.group(2)) if m else None

    if invoice_no is None:
        invoice_no = find_first([
            r'\bInvoice\s*No\.?\s*[:#]?\s*([A-Z0-9-]+)'
        ], text)

    if invoice_date is None:
        invoice_date_raw = find_first([
            r'\bDate\s*[:#]?\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4})'
        ], text)
        invoice_date = to_iso_date(invoice_date_raw)

    total = norm_money(find_first([
        r'\bTotal\s*Invoice\s*Value\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)'
    ], text))

    # Items:
    # We build a simple breakdown that sums to total:
    # - Total Taxable Value
    # - CGST
    # - SGST
    taxable = norm_money(find_first([
        r'\bTotal\s*Taxable\s*Value\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)'
    ], text))
    cgst = norm_money(find_first([
        r'\bCGST\s*@\s*[0-9.]+%\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)'
    ], text))
    sgst = norm_money(find_first([
        r'\bSGST\s*@\s*[0-9.]+%\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)'
    ], text))

    items = []
    if taxable is not None:
        items.append({ 'name': 'Ticket fare (taxable)', 'qty': 1, 'amount': round(taxable, 2) })
    if cgst is not None and cgst != 0:
        items.append({ 'name': 'CGST', 'qty': 1, 'amount': round(cgst, 2) })
    if sgst is not None and sgst != 0:
        items.append({ 'name': 'SGST', 'qty': 1, 'amount': round(sgst, 2) })

    print(json.dumps({
        'ok': True,
        'invoice_no': invoice_no,
        'invoice_date': invoice_date,
        'total': None if total is None else round(total, 2),
        'items': items,
        'text_len': len(text)
    }))


if __name__ == '__main__':
    main()
