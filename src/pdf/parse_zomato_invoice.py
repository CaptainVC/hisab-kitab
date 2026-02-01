#!/usr/bin/env python3
import re
import json
import sys
from pathlib import Path


def norm_money(s: str):
    if s is None:
        return None
    s = str(s).replace(',', '').strip()
    try:
        return float(s)
    except Exception:
        return None


def extract_text(pdf_path: Path):
    # Use pdfplumber from the hk venv.
    import pdfplumber  # type: ignore

    full = ''
    with pdfplumber.open(str(pdf_path)) as pdf:
        for p in pdf.pages:
            t = p.extract_text() or ''
            full += '\n' + t
    return full.strip()


def find_first(patterns, text, flags=re.I, group=1):
    for pat in patterns:
        m = re.search(pat, text, flags)
        if m:
            return m.group(group).strip()
    return None


def parse_items(text: str):
    # Best-effort: capture lines ending with an amount.
    items = []
    for line in text.splitlines():
        ln = re.sub(r'\s+', ' ', line).strip()
        if not ln:
            continue
        if re.search(r'\b(total|grand total|total paid|tax|gst|delivery|packaging|discount)\b', ln, re.I):
            continue
        m = re.search(r'^(.*?)(?:\s+x\s*(\d+))?\s+₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$', ln)
        if not m:
            continue
        name = m.group(1).strip(' -:')
        if len(name) < 3:
            continue
        qty = int(m.group(2)) if m.group(2) else None
        amt = norm_money(m.group(3))
        if amt is None:
            continue
        items.append({
            'name': name[:180],
            'qty': qty,
            'amount': amt
        })
    # De-dup identical (name, amount)
    seen = set()
    out = []
    for it in items:
        k = (it['name'], it['amount'], it.get('qty'))
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
    return out


def main():
    if len(sys.argv) < 2:
        print('Usage: parse_zomato_invoice.py <pdf>', file=sys.stderr)
        sys.exit(2)

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        raise SystemExit(f'File not found: {pdf_path}')

    try:
        text = extract_text(pdf_path)
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)

    low = text.lower()
    # Zomato invoices usually contain zomato branding or "zomato" word.
    if 'zomato' not in low and 'zomato limited' not in low and 'zomato media' not in low:
        print(json.dumps({'ok': False, 'reason': 'not_zomato'}))
        return

    order_id = find_first([
        r'\bOrder\s*ID\s*[:#]?\s*([0-9]+)\b',
        r'\bORDER\s*ID\s*[:#]?\s*([0-9]+)\b'
    ], text)

    total = find_first([
        r'\bTotal\s*paid\s*₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)',
        r'\bGrand\s*Total\s*₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)',
        r'\bTotal\s*₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)'
    ], text)

    items = parse_items(text)

    print(json.dumps({
        'ok': True,
        'order_id': order_id,
        'total': norm_money(total),
        'items': items,
        'text_len': len(text)
    }))


if __name__ == '__main__':
    main()
