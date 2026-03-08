#!/usr/bin/env python3
"""Parse EatClub invoice PDFs (EatClub Brands Private Limited) via pdfplumber.

Extracts:
- tracking_id
- invoice_no
- ordered_at (date)
- invoice_total
- items (Description, Qty, Amount)

Avoids including SAC/HSN codes in item names.
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
    for fmt in ['%d-%m-%Y', '%d/%m/%Y', '%d-%m-%Y %H:%M:%S']:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except Exception:
            pass
    return None


def clean_name(s):
    s = re.sub(r'\s+', ' ', str(s or '')).strip()
    # remove any HSN/SAC-like remnants if they appear
    s = re.sub(r'\b(?:HSN|SAC)\s*/?\s*(?:HSN|SAC)?\b\s*[:#-]?\s*\d+', '', s, flags=re.I).strip()
    return s


def main():
    if len(sys.argv) < 2:
        print('Usage: parse_eatclub_invoice.py <pdfPath>', file=sys.stderr)
        sys.exit(2)

    pdf_path = sys.argv[1]
    with pdfplumber.open(pdf_path) as pdf:
        text = '\n'.join([(p.extract_text() or '') for p in pdf.pages])

    text = text.strip()
    if 'eatclub' not in text.lower() and 'eatclub brands' not in text.lower() and 'mojopizza' not in text.lower():
        print(json.dumps({ 'ok': False, 'reason': 'not_eatclub' }))
        return

    tracking_id = find_first([r'\bTracking\s*ID\s*:\s*([A-Z0-9]+)'], text)
    invoice_no = find_first([r'\bInvoice\s*No\.?\s*:\s*([^\n]+)'], text)

    ordered_at_raw = find_first([r'\bOrdered\s*At\s*:\s*([0-9]{2}-[0-9]{2}-[0-9]{4})'], text)
    invoice_date = to_iso_date(ordered_at_raw)

    total = norm_money(find_first([r'\bInvoice\s*Total\s*:\s*([0-9][0-9.,]+)'], text))

    items = []
    # Parse lines under Product Details table
    # Example:
    # Golden Corn Pizza [Regular 7"] - 2 Pc 195.0 390.0
    in_table = False
    for line in text.splitlines():
        ln = re.sub(r'\s+', ' ', line).strip()
        if not ln:
            continue
        if re.search(r'^Product\s+Details$', ln, flags=re.I):
            in_table = True
            continue
        if in_table and re.search(r'^Sub\s*Total\s*:', ln, flags=re.I):
            break
        if not in_table:
            continue
        # skip header row
        if re.search(r'^Description\s+Qty\s+Rate\s+Amount$', ln, flags=re.I):
            continue

        m = re.match(r'^(.*?)\s+-\s+(\d+)\s+Pc\s+([0-9]+(?:\.[0-9]{1,2})?)\s+([0-9]+(?:\.[0-9]{1,2})?)$', ln, flags=re.I)
        if not m:
            continue
        name = clean_name(m.group(1))
        qty = int(m.group(2))
        amt = norm_money(m.group(4))
        if not name or amt is None:
            continue
        items.append({ 'name': name[:180], 'qty': qty, 'amount': round(amt, 2) })

    print(json.dumps({
        'ok': True,
        'tracking_id': tracking_id,
        'invoice_no': invoice_no,
        'invoice_date': invoice_date,
        'total': None if total is None else round(total, 2),
        'items': items,
        'text_len': len(text)
    }))


if __name__ == '__main__':
    main()
