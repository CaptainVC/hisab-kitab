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
    items = []
    for line in text.splitlines():
        ln = re.sub(r'\s+', ' ', line).strip()
        if not ln:
            continue
        if re.search(r'\b(total|grand total|item total|tax|gst|delivery|packing|discount|charges)\b', ln, re.I):
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
        print('Usage: parse_swiggy_invoice.py <pdf>', file=sys.stderr)
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
    if 'swiggy' not in low and 'bundl technologies' not in low:
        print(json.dumps({'ok': False, 'reason': 'not_swiggy'}))
        return

    # Prefer the actual Swiggy order id (avoid matching Instamart order id when both appear)
    order_id = find_first([
        r'\bHandling Fees for Order\s+([0-9]+)\b',
        r'\bOrder\s*ID\s*[:#]?\s*([0-9]+)\b',
        r'\bOrder\s*No\s*[:#]?\s*([0-9]+)\b'
    ], text)

    # Note: Some PDFs are "merged" (Instamart goods invoice + Swiggy handling-fee invoice).
    # In those, we prefer the Instamart/Invoice Value as the order total (not the Swiggy handling fee total).
    total = find_first([
        r'\bInvoice\s*Value\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)',
        r'\bInvoice\s*Total\s*₹?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)',
        r'\bInvoice\s*Total\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)',
        r'\bGrand\s*Total\s*₹?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)',
        r'\bTotal\s*₹\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)'
    ], text)

    # Swiggy invoices come in multiple shapes:
    # A) Food delivery invoice (Swiggy Limited) with "Invoice Total" and a simple table
    # B) Instamart/Store invoice (seller) with "Invoice Value" and a different table

    items = []

    # Shape A (food): "<sr>. <desc> ... <amount> <discount> <net>"
    for line in text.splitlines():
        ln = re.sub(r'\s+', ' ', line).strip()
        m = re.match(r'^\s*(\d+)\.\s+(.+?)\s+\w+\s+(\d+)\s+([0-9][0-9,]*\.[0-9]{2,3})\s+([0-9][0-9,]*\.[0-9]{2,3})\s+([0-9][0-9,]*\.[0-9]{2,3})\s+([0-9][0-9,]*\.[0-9]{2,3})\s*$', ln)
        if not m:
            continue
        desc = m.group(2).strip()
        uom = m.group(3)
        qty = int(m.group(4))
        unit_price = norm_money(m.group(5))
        net = norm_money(m.group(8))  # Net Assessable Value
        if net is None:
            continue
        # Keep only sane quantities; also ignore handling-fee/service lines in food invoices.
        if qty > 100:
            continue
        if 'handling fees' in desc.lower():
            continue
        items.append({ 'name': desc[:180], 'qty': qty, 'amount': net })

    # Shape B (instamart): lines like
    # "1. Lemon (Nimbe Hannu) 1 NOS 07031010 43 19 24 ... 24"
    if not items:
        # Instamart/store invoice parsing: the description often appears on the line BEFORE the numbered row.
        # Example:
        #   Lemon (Nimbe
        #   1. 1 NOS ... 24
        lines = [re.sub(r'\s+', ' ', ln).strip() for ln in text.splitlines() if (ln or '').strip()]
        for i, ln in enumerate(lines):
            # numbered row with qty+unit+hsn...+amount(last)
            # Two variants:
            #  - description missing: "1. 1 NOS ... 24"
            #  - description present: "1. Raincoat ... 1 NOS ... 409"
            sr = None
            qty = None
            amt = None
            desc_inline = ''

            m = re.match(r'^(\d+)\.\s+(\d+)\s+(NOS|OTH|PCS|EA|KG|GM|LTR|L|ML)\s+\d+\s+.*?\s([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$', ln)
            if m:
                sr = m.group(1)
                qty = int(m.group(2))
                amt = norm_money(m.group(4))
            else:
                m = re.match(r'^(\d+)\.\s+(.+?)\s+(\d+)\s+(NOS|OTH|PCS|EA|KG|GM|LTR|L|ML)\s+\d+\s+.*?\s([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$', ln)
                if m:
                    sr = m.group(1)
                    desc_inline = m.group(2).strip()
                    qty = int(m.group(3))
                    amt = norm_money(m.group(5))

            if sr is None or qty is None or amt is None:
                continue

            # Prefer inline description; else recover from previous 1-2 lines
            desc = desc_inline
            if not desc:
                for j in [i-1, i-2]:
                    if j < 0: continue
                    prev = lines[j]
                    if re.search(r'^(subtotal|tax|invoice|date|hsn|description of goods|sr no)\b', prev, re.I):
                        continue
                    if re.match(r'^\d', prev):
                        continue
                    if len(prev) >= 3:
                        desc = prev
                        break

            # Skip Swiggy service invoice lines inside merged PDFs
            if 'handling fees for order' in ln.lower():
                continue

            name = desc if desc else f'Item {sr}'
            items.append({ 'name': name[:180], 'qty': qty, 'amount': amt })

    # If still nothing, fallback to generic heuristics
    if not items:
        items = parse_items(text)

    # Heuristic: If this PDF contains multiple invoices (Instamart goods invoice + Swiggy handling-fee invoice),
    # keep only items that belong to the chosen order_id.
    if order_id and items:
        keep = []
        for it in items:
            nm = (it.get('name') or '')
            low = nm.lower()
            if 'handling fees for order' in low:
                # keep only if it matches this order id
                if str(order_id) in low:
                    keep.append(it)
            else:
                # keep normal goods/items
                keep.append(it)
        items = keep

    print(json.dumps({
        'ok': True,
        'order_id': order_id,
        'total': norm_money(total),
        'items': items,
        'text_len': len(text)
    }))


if __name__ == '__main__':
    main()
