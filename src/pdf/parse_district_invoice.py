#!/usr/bin/env python3
"""Parse District/TicketNew movie booking invoice PDF via pdfplumber."""

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
    # "13th Jan, 2026"
    s = re.sub(r'\b(\d+)(st|nd|rd|th)\b', r'\1', s, flags=re.I)
    for fmt in ['%d %b, %Y', '%d %B, %Y', '%d-%m-%Y', '%d/%m/%Y']:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except Exception:
            pass
    return None


def main():
    if len(sys.argv) < 2:
        print('Usage: parse_district_invoice.py <pdfPath>', file=sys.stderr)
        sys.exit(2)

    pdf_path = sys.argv[1]
    with pdfplumber.open(pdf_path) as pdf:
        text = '\n'.join([(p.extract_text() or '') for p in pdf.pages])

    text = text.strip()
    if 'ticketnew' not in text.lower() and 'orbgen' not in text.lower() and 'tax invoice' not in text.lower():
        print(json.dumps({ 'ok': False, 'reason': 'not_district' }))
        return

    order_id = find_first([
        r'\bOrder\s*ID\s*[:#]?\s*([0-9]+)'
    ], text)

    invoice_no = find_first([
        r'\bInvoice\s*Number\s*[:#]?\s*([A-Z0-9]+)'
    ], text)

    invoice_date = to_iso_date(find_first([
        r'\bInvoice\s*Date\s*[:#]?\s*([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},\s+[0-9]{4})',
        r'\bInvoice\s*Date\s*[:#]?\s*([0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{4})'
    ], text))

    total = norm_money(find_first([
        r'\bGrand\s*Total\s*₹?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)'
    ], text))

    booking = norm_money(find_first([
        r'\bBooking\s*Charge\s+\d+\s+\d+\s+₹?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)',
        r'\bBooking\s*Charge\s+\d+\s+₹?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)'
    ], text))

    igst = norm_money(find_first([
        r'\bIntegrated\s+Goods\s+and\s+Service\s+Tax\s+@\s*[0-9.]+%\s*₹?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)'
    ], text))

    items = []
    if booking is not None:
        items.append({ 'name': 'Booking charge', 'qty': 1, 'amount': round(booking, 2) })
    if igst is not None and igst != 0:
        items.append({ 'name': 'IGST', 'qty': 1, 'amount': round(igst, 2) })

    print(json.dumps({
        'ok': True,
        'order_id': order_id,
        'invoice_no': invoice_no,
        'invoice_date': invoice_date,
        'total': None if total is None else round(total, 2),
        'items': items,
        'text_len': len(text)
    }))


if __name__ == '__main__':
    main()
