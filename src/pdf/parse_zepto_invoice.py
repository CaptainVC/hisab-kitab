#!/usr/bin/env python3
"""Parse Zepto invoice PDFs (typically forwarded emails with PDF attachment).

Output schema (v1):
{
  merchant: 'ZEPTO',
  invoice_number, order_number, date,
  item_total, handling_fee, invoice_value,
  items: [{sr, name, hsn, qty, rate, discount_pct, taxable, cgst_pct, sgst_pct, cgst_amt, sgst_amt, cess_pct, cess_amt, total}],
}

Designed to be robust across Zepto's consistent template.
"""

import re
import json
import sys
from pathlib import Path
import pdfplumber


def fnum(s):
    if s is None:
        return None
    s = str(s).strip()
    s = s.replace(',', '')
    try:
        return float(s)
    except:
        return None


def extract_first(patterns, text, flags=0, group=1):
    for pat in patterns:
        m = re.search(pat, text, flags)
        if m:
            return m.group(group).strip()
    return None


def main():
    if len(sys.argv) < 2:
        print('Usage: parse_zepto_invoice.py <invoice.pdf>', file=sys.stderr)
        sys.exit(2)

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        raise SystemExit(f'File not found: {pdf_path}')

    with pdfplumber.open(str(pdf_path)) as pdf:
        text = '\n'.join((p.extract_text() or '') for p in pdf.pages)

    text = re.sub(r'\r\n?', '\n', text)
    lines = [ln.strip() for ln in text.split('\n')]
    # keep empty lines for some heuristics? We'll drop empties later where needed.

    invoice_number = extract_first([r'Invoice\s*No\.?\s*:\s*([A-Za-z0-9]+)'], text, flags=re.IGNORECASE)
    order_number = extract_first([r'Order\s*No\.?\s*:\s*([A-Za-z0-9]+)'], text, flags=re.IGNORECASE)
    date = extract_first([r'Date\s*:\s*([0-9]{2}-[0-9]{2}-[0-9]{4})'], text)

    # Totals section (Zepto often prints these inline on one line)
    item_total = fnum(extract_first([
        r'\bItem\s+Total\b\s*([0-9]+\.[0-9]{2})',
    ], text, flags=re.IGNORECASE))
    handling_fee = fnum(extract_first([
        r'Handling\s+Fee[^\n]*?\s([0-9]+\.[0-9]{2})',
    ], text, flags=re.IGNORECASE))
    invoice_value = fnum(extract_first([
        r'\bInvoice\s+Value\b\s*([0-9]+\.[0-9]{2})',
    ], text, flags=re.IGNORECASE))

    # Parse item lines from the extracted text (items are usually in a single line per item)
    # Example pattern tail:
    #   <HSN> <Qty> <Rate> <Disc%> <Taxable> <CGST%> <SGST%> <CGST Amt> <SGST Amt> <Cess Amt> <Total>
    item_re = re.compile(
        r'\b(?P<sr>\d+)\s+'
        r'(?P<name>.+?)\s+'
        r'(?P<hsn>\d{8})\s+'
        r'(?P<qty>\d+)\s+'
        r'(?P<rate>\d+\.\d{2})\s+'
        r'(?P<disc>\d+\.\d+)%\s+'
        r'(?P<taxable>\d+\.\d{2})\s+'
        r'(?P<cgst_pct>\d+\.\d+)%\s+'
        r'(?P<sgst_pct>\d+\.\d+)%\s+'
        r'(?P<cgst_amt>\d+\.\d{2})\s+'
        r'(?P<sgst_amt>\d+\.\d{2})\s+'
        r'(?P<cess_amt>\d+\.\d{2})\s+'
        r'(?P<total>\d+\.\d{2})\b'
    )

    items = []
    for ln in lines:
        m = item_re.search(ln)
        if not m:
            continue
        name = re.sub(r'\s+', ' ', m.group('name')).strip(' -')
        items.append({
            'sr': int(m.group('sr')),
            'name': name,
            'hsn': m.group('hsn'),
            'qty': int(m.group('qty')),
            'rate': fnum(m.group('rate')),
            'discount_pct': fnum(m.group('disc')),
            'taxable': fnum(m.group('taxable')),
            'cgst_pct': fnum(m.group('cgst_pct')),
            'sgst_pct': fnum(m.group('sgst_pct')),
            'cgst_amt': fnum(m.group('cgst_amt')),
            'sgst_amt': fnum(m.group('sgst_amt')),
            'cess_pct': None,
            'cess_amt': fnum(m.group('cess_amt')),
            'total': fnum(m.group('total')),
        })

    out = {
        'merchant': 'ZEPTO',
        'invoice_number': invoice_number,
        'order_number': order_number,
        'date': date,
        'item_total': item_total,
        'handling_fee': handling_fee,
        'invoice_value': invoice_value,
        'items': items,
    }

    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
