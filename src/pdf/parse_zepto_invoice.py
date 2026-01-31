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
        r'(?P<hsn>\d{6,8})\s+'
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

    def is_noise_line(s: str) -> bool:
        s = (s or '').strip()
        if not s:
            return True
        # Pure numbers / amounts / percents
        if re.fullmatch(r'\d+(?:\.\d+)?%?', s):
            return True
        if re.fullmatch(r'[\+\-]?\s*\d+\.\d{2}', s):
            return True
        if re.fullmatch(r'\+\s*\d+\.\d{2}', s):
            return True
        if s.lower() in {
            'sr', 'no', 'hsn', 'qty', 'rate', 'disc.', 'taxable', 'amt.', 'cgst', 's/ut', 'gst', 'cess', 'total',
            'sr no', 'item & description', 'product rate', 'taxable amt.', 'total amt.'
        }:
            return True
        return False

    items = []

    # Find where the items section begins (skip address blocks)
    items_section_start = 0
    for i, ln in enumerate(lines):
        if re.fullmatch(r'SR', ln.strip(), flags=re.IGNORECASE):
            items_section_start = i
            break

    # Parse Mode 1 (preferred): single-line items (common in some Zepto invoice templates)
    # Parse Mode 2 (fallback): multi-line blocks (seen in Zepto Pass / membership type invoices)

    last_consumed_idx = items_section_start

    def looks_like_header_or_address(s: str) -> bool:
        s = (s or '').strip()
        if not s:
            return True
        low = s.lower()
        if 'bengaluru' in low or 'karnataka' in low or 'india' in low:
            return True
        if any(k in low for k in ['bill to', 'ship to', 'invoice', 'gstin', 'fssai', 'place of supply']):
            return True
        if any(k in low for k in ['sr item', 'hsn', 'taxable', 'cgst', 's/ut', 'cess', 'total amt', 'no description', 'product rate']):
            return True
        if ':' in s:
            return True
        return False

    def alpha_line(s: str) -> bool:
        """Likely a product-name fragment: has letters, no digits, not an address/header."""
        s = (s or '').strip()
        if not s:
            return False
        low = s.lower()
        if not re.search(r'[A-Za-z]', s):
            return False
        if re.search(r'\d', s):
            return False
        # reject common address words seen in Zepto PDFs
        addr_bad = [
            'layout', 'road', 'rd', 'compound', 'pura', 'aecs', 'munnekollal', 'bengaluru', 'karnataka', 'india',
            'pin', 'gstin', 'fssai', 'geddit', 'convenience', 'private limited', 'vyom', 'chopra'
        ]
        if any(w in low for w in addr_bad):
            return False
        # product fragments are usually not extremely long
        if len(s) > 40:
            return False
        return True

    def packish_line(s: str) -> bool:
        """Likely pack-size fragment: may include digits inside parentheses."""
        s = (s or '').strip().lower()
        if not s:
            return False
        return any(k in s for k in ['pack', 'pcs', 'pc', 'kg', 'g)', 'ml', 'l)', '(200', '(500', '('])

    # Mode 1: single-line pattern
    for idx, ln in enumerate(lines):
        if idx < items_section_start:
            continue
        m = item_re.search(ln)
        if not m:
            continue
        # Require that the captured name contains at least one letter.
        # This avoids false positives on templates where the table is split across lines.
        if not re.search(r'[A-Za-z]', m.group('name')):
            continue

        base_name = re.sub(r'\s+', ' ', m.group('name')).strip(' -')

        # Collect prefix fragments (brand/name) right above the item line
        prefix = []
        j = idx - 1
        while j >= items_section_start and len(prefix) < 4:
            t = lines[j].strip()
            if not t:
                j -= 1
                continue
            if packish_line(t):
                break
            if looks_like_header_or_address(t) or is_noise_line(t):
                j -= 1
                continue
            if alpha_line(t):
                prefix.append(t)
            j -= 1
        prefix = list(reversed(prefix))

        # Collect suffix fragments (pack size) immediately after the item line
        suffix = []
        k = idx + 1
        while k < len(lines) and len(suffix) < 3:
            t = lines[k].strip()
            if not t:
                k += 1
                continue
            if item_re.search(t):
                break
            low = t.lower()
            if 'item total' in low or 'invoice value' in low or 'handling fee' in low:
                break
            if looks_like_header_or_address(t):
                break
            if re.fullmatch(r'\+\s*\d+\.\d{2}', t) or re.fullmatch(r'\d+\.\d{2}%?', t):
                k += 1
                continue
            if packish_line(t):
                suffix.append(t)
            k += 1

        full_name = ' '.join(prefix + [base_name] + suffix)
        full_name = re.sub(r'\s+', ' ', full_name).strip(' -')

        items.append({
            'sr': int(m.group('sr')),
            'name': full_name,
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

        last_consumed_idx = max(last_consumed_idx, idx)

    # Mode 2: semi-structured lines (if Mode 1 found nothing)
    if not items:
        # Zepto Pass tends to split "Zepto Pass" into its own line.
        # We'll stitch adjacent lines and try matching across 1-2 lines.
        for idx, ln in enumerate(lines[items_section_start:]):
            if 'item total' in ln.lower() or 'invoice value' in ln.lower():
                break

            candidates = [ln]
            if idx + 1 < len(lines[items_section_start:]):
                candidates.append((ln + ' ' + lines[items_section_start:][idx+1]).strip())

            for cand in candidates:
                m = re.search(
                    r'(?P<name>.+?)\s+'
                    r'(?P<sr>\d+)\s+'
                    r'(?P<desc2>.+?)\s+'
                    r'(?P<hsn>\d{6,8})\s+'
                    r'(?P<qty>\d+)\s+'
                    r'(?P<taxable>\d+\.\d{2})\s+'
                    r'(?P<disc>\d+(?:\.\d+)?)%\s+'
                    r'(?P<taxable2>\d+\.\d{2})\s+'
                    r'(?P<cgst_pct>\d+\.\d+)%\s+'
                    r'(?P<sgst_pct>\d+\.\d+)%\s+'
                    r'(?P<cgst_amt>\d+\.\d{2})\s+'
                    r'(?P<sgst_amt>\d+\.\d{2})\s+'
                    r'(?P<cess_pct>\d+(?:\.\d+)?)%\s+'
                    r'(?P<cess_amt>\d+\.\d{2})\s+'
                    r'(?P<total>\d+\.\d{2})\b',
                    cand
                )
                if not m:
                    continue

                name = re.sub(r'\s+',' ', (m.group('name') + ' ' + m.group('desc2')).strip())

                items.append({
                    'sr': int(m.group('sr')),
                    'name': name,
                    'hsn': m.group('hsn'),
                    'qty': int(m.group('qty')),
                    'rate': None,
                    'discount_pct': fnum(m.group('disc')),
                    'taxable': fnum(m.group('taxable2')),
                    'cgst_pct': fnum(m.group('cgst_pct')),
                    'sgst_pct': fnum(m.group('sgst_pct')),
                    'cgst_amt': fnum(m.group('cgst_amt')),
                    'sgst_amt': fnum(m.group('sgst_amt')),
                    'cess_pct': fnum(m.group('cess_pct')),
                    'cess_amt': fnum(m.group('cess_amt')),
                    'total': fnum(m.group('total')),
                })
                break
            if items:
                break

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
