#!/usr/bin/env python3
import re
import json
import sys
from pathlib import Path
import pdfplumber


def norm_money(s: str):
    if s is None:
        return None
    s = s.replace(',', '').strip()
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
        print('Usage: parse_blinkit_invoice.py <invoice.pdf>', file=sys.stderr)
        sys.exit(2)

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        raise SystemExit(f'File not found: {pdf_path}')

    with pdfplumber.open(str(pdf_path)) as pdf:
        pages = []
        full_text = ''
        for p in pdf.pages:
            t = p.extract_text() or ''
            pages.append({"page": p, "text": t})
            full_text += '\n' + t

    text = re.sub(r'\r\n?', '\n', full_text)

    order_id = extract_first([
        r'Order\s*Id\s*:?\s*(\d+)',
        r'Order\s*ID\s*:?\s*(\d+)',
    ], text, flags=re.IGNORECASE)

    invoice_number = extract_first([
        r'Invoice\s*Number\s*:?\s*([A-Z0-9]+)',
    ], text, flags=re.IGNORECASE)

    invoice_date = extract_first([
        r'\b(\d{2}-[A-Za-z]{3}-\d{4})\b',
    ], text)

    # grand total: try common patterns
    grand_total = None
    gt = extract_first([
        r'Grand\s*Total\s*:?\s*₹?\s*([0-9,]+(?:\.[0-9]{2})?)',
        r'Total\s*Amount\s*:?\s*₹?\s*([0-9,]+(?:\.[0-9]{2})?)',
    ], text, flags=re.IGNORECASE)
    if gt:
        grand_total = norm_money(gt)

    # Fallback: find last amount before "Rupees" in "Amount in Words" section
    if grand_total is None:
        m = re.search(r'(\d+\.\d{2})\s*\n\s*.*Rupees', text, flags=re.IGNORECASE)
        if m:
            grand_total = norm_money(m.group(1))
        else:
            # last-resort: scan lines for "Rupees" and pick previous money-like token
            lines = [ln.strip() for ln in text.split('\n') if ln.strip()]
            for i, ln in enumerate(lines):
                if 'rupees' in ln.lower() and i > 0:
                    for j in range(i-1, max(-1, i-10), -1):
                        if re.fullmatch(r'\d+(?:\.\d{2})?', lines[j]):
                            grand_total = norm_money(lines[j])
                            break
                if grand_total is not None:
                    break

    invoices = []

    # Blinkit-specific: these PDFs often bundle multiple invoices (multiple pages), each with its own table + Total.
    # We extract one "invoice" per page that contains the item table.
    try:
        table_settings = {
            "vertical_strategy": "lines",
            "horizontal_strategy": "lines",
            "intersection_tolerance": 5,
            "snap_tolerance": 3,
            "join_tolerance": 3,
            "edge_min_length": 20,
        }

        for pi, pg in enumerate(pages):
            page = pg["page"]
            page_text = pg["text"] or ''
            words = page.extract_words() or []

            # locate the item table header y by finding "Sr." + "no"
            header_top = None
            for w in words:
                if w.get('text','').lower() in ('sr.','sr'):
                    for w2 in words:
                        if w2.get('text','').lower() in ('no','no.') and abs(w2['top']-w['top']) < 2.5 and w2['x0'] > w['x0']:
                            header_top = min(w['top'], w2['top'])
                            break
                if header_top is not None:
                    break
            if header_top is None:
                continue

            # Find the "Total" row y (the one in left column, not the header column name)
            total_row_top = None
            totals = [w for w in words if w.get('text','').lower() == 'total']
            for w in sorted(totals, key=lambda x: x['top']):
                if w['x0'] < 100 and w['top'] > header_top + 50:
                    total_row_top = w['top']

            y0 = max(0, header_top - 8)
            y1 = min(page.height, (total_row_top + 25) if total_row_top is not None else (header_top + 260))
            cropped = page.crop((0, y0, page.width, y1))
            tbs = cropped.extract_tables(table_settings) or []
            if not tbs:
                continue

            tb = tbs[0]
            header = [str(c or '').strip().lower() for c in tb[0]]
            idx_desc = next((i for i,c in enumerate(header) if 'item' in c and 'description' in c), None)
            idx_qty  = next((i for i,c in enumerate(header) if 'qty' in c), None)
            idx_total= next((i for i,c in enumerate(header) if c == 'total' or c.endswith('total')), None)
            idx_disc = next((i for i,c in enumerate(header) if 'discount' in c), None)
            idx_mrp  = next((i for i,c in enumerate(header) if c == 'mrp' or 'mrp' in c), None)

            inv_items = []
            inv_total = None
            inv_mrp_sum = 0.0
            inv_discount_sum = 0.0

            for row in tb[1:]:
                if not row:
                    continue
                first = str(row[0] or '').strip().lower() if len(row) else ''
                if first in ('total','grand total'):
                    # capture invoice total from the Total row
                    if idx_total is not None and idx_total < len(row):
                        inv_total = norm_money(str(row[idx_total] or ''))
                    continue

                desc = (row[idx_desc] if idx_desc is not None and idx_desc < len(row) else '')
                desc = re.sub(r'\s+', ' ', str(desc or '')).strip()
                if not desc:
                    continue

                qty = None
                if idx_qty is not None and idx_qty < len(row):
                    q = str(row[idx_qty] or '').strip()
                    try:
                        qty = int(float(q)) if q else None
                    except:
                        qty = None

                total = None
                if idx_total is not None and idx_total < len(row):
                    total = norm_money(str(row[idx_total] or ''))

                mrp = None
                if idx_mrp is not None and idx_mrp < len(row):
                    mrp = norm_money(str(row[idx_mrp] or ''))
                    if mrp is not None:
                        inv_mrp_sum += mrp

                disc = None
                if idx_disc is not None and idx_disc < len(row):
                    disc = norm_money(str(row[idx_disc] or ''))
                    if disc is not None:
                        inv_discount_sum += disc

                inv_items.append({ 'name': desc, 'qty': qty, 'total': total, 'mrp': mrp, 'discount': disc })

            # page-level invoice metadata
            page_invoice_number = extract_first([r'Invoice\s*Number\s*:?\s*([A-Z0-9]+)'], page_text, flags=re.IGNORECASE)
            page_date = extract_first([r'\b(\d{2}-[A-Za-z]{3}-\d{4})\b'], page_text)

            invoices.append({
                'page_index': pi,
                'invoice_number': page_invoice_number,
                'invoice_date': page_date,
                'items': inv_items,
                'invoice_total': inv_total,
                'mrp_sum': round(inv_mrp_sum, 2),
                'discount_sum': round(inv_discount_sum, 2),
            })
    except Exception:
        pass

    # If we have per-page invoices, compute overall totals.
    overall_total = None
    if invoices:
        s = 0.0
        any_total = False
        for inv in invoices:
            if inv.get('invoice_total') is not None:
                s += float(inv['invoice_total'])
                any_total = True
        overall_total = round(s, 2) if any_total else None

    out = {
        'merchant': 'BLINKIT',
        'order_id': order_id,
        # first page invoice meta (kept for convenience)
        'invoice_number': invoice_number,
        'invoice_date': invoice_date,
        # total of the first invoice if present; overall_total sums across all invoices in the PDF
        'grand_total': grand_total,
        'overall_total': overall_total,
        'invoices': invoices
    }

    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
