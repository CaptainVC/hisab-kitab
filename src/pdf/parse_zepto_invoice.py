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
        pages = list(pdf.pages)
        text = '\n'.join((p.extract_text() or '') for p in pages)

    text = re.sub(r'\r\n?', '\n', text)
    lines = [ln.strip() for ln in text.split('\n')]

    invoice_number = extract_first([r'Invoice\s*No\.?\s*:\s*([A-Za-z0-9]+)'], text, flags=re.IGNORECASE)
    order_number = extract_first([r'Order\s*No\.?\s*:\s*([A-Za-z0-9]+)'], text, flags=re.IGNORECASE)
    date = extract_first([r'Date\s*:\s*([0-9]{2}-[0-9]{2}-[0-9]{4})'], text)

    # Totals section (Zepto often prints these inline on one line)
    money = r'([0-9]+(?:\.[0-9]{1,2})?)'

    item_total = fnum(extract_first([
        rf'\bItem\s+Total\b\s*{money}',
    ], text, flags=re.IGNORECASE))
    handling_fee = fnum(extract_first([
        rf'Handling\s+Fee[^\n]*?\s{money}',
    ], text, flags=re.IGNORECASE))
    invoice_value = fnum(extract_first([
        rf'\bInvoice\s+Value\b\s*{money}',
    ], text, flags=re.IGNORECASE))

    # Parse items
    items = []

    def table_extract_items():
        out = []
        settings = {
            "vertical_strategy": "lines",
            "horizontal_strategy": "lines",
            "intersection_tolerance": 5,
            "snap_tolerance": 3,
            "join_tolerance": 3,
            "edge_min_length": 20,
        }

        for page in pages:
            words = page.extract_words() or []
            header_top = None
            for w in words:
                if (w.get('text','') or '').lower() == 'sr':
                    header_top = w['top']
                    break
            if header_top is None:
                continue

            item_total_top = None
            for w in words:
                if (w.get('text','') or '').lower() == 'item':
                    for w2 in words:
                        if (w2.get('text','') or '').lower() == 'total' and abs(w2['top'] - w['top']) < 3.0 and w2['x0'] > w['x0']:
                            item_total_top = w['top']
                            break
                if item_total_top is not None:
                    break

            y0 = max(0, header_top - 10)
            y1 = min(page.height, (item_total_top + 80) if item_total_top is not None else (header_top + 520))
            cropped = page.crop((0, y0, page.width, y1))

            tbs = cropped.extract_tables(settings) or []
            if not tbs:
                continue

            tb = tbs[0]
            header = [str(c or '').strip().lower().replace('\n', ' ') for c in tb[0]]
            idx_desc = next((i for i, c in enumerate(header) if 'item' in c and 'description' in c), None)
            idx_qty = next((i for i, c in enumerate(header) if 'qty' in c), None)
            idx_hsn = next((i for i, c in enumerate(header) if 'hsn' in c), None)
            # pick the last 'total' column (tables may include multiple totals)
            idx_total = None
            for i, c in enumerate(header):
                if 'total' in c:
                    idx_total = i

            if idx_desc is None or idx_total is None:
                continue

            for row in tb[1:]:
                if not row:
                    continue
                first_raw = str(row[0] or '').strip()
                first = first_raw.lower()
                if first in ('item total', 'total', 'invoice value'):
                    continue

                desc_raw = str(row[idx_desc] or '').strip()
                if not desc_raw:
                    continue

                # Handle multi-item rows merged into a single table row (values separated by newlines)
                if '\n' in first_raw or '\n' in desc_raw:
                    def splitcell(v):
                        return [re.sub(r'\s+', ' ', s.strip()) for s in str(v or '').split('\n') if s.strip()]

                    srs = splitcell(first_raw)
                    descs = splitcell(desc_raw)
                    hsns = splitcell(row[idx_hsn]) if idx_hsn is not None and idx_hsn < len(row) else []
                    qtys = splitcell(row[idx_qty]) if idx_qty is not None and idx_qty < len(row) else []
                    totals = splitcell(row[idx_total]) if idx_total is not None and idx_total < len(row) else []

                    n = max(len(descs), len(totals), len(srs), len(hsns), len(qtys))
                    for i2 in range(n):
                        name = descs[i2] if i2 < len(descs) else ''
                        if not name:
                            continue
                        total = fnum(totals[i2]) if i2 < len(totals) else None
                        if total is None:
                            continue
                        sr = int(srs[i2]) if i2 < len(srs) and srs[i2].isdigit() else None
                        hsn = hsns[i2] if i2 < len(hsns) else None
                        qty = None
                        if i2 < len(qtys):
                            try:
                                qty = int(float(qtys[i2]))
                            except:
                                qty = None
                        out.append({
                            'sr': sr,
                            'name': name,
                            'hsn': hsn,
                            'qty': qty,
                            'rate': None,
                            'discount_pct': None,
                            'taxable': None,
                            'cgst_pct': None,
                            'sgst_pct': None,
                            'cgst_amt': None,
                            'sgst_amt': None,
                            'cess_pct': None,
                            'cess_amt': None,
                            'total': total,
                        })
                    continue

                desc = re.sub(r'\s+', ' ', desc_raw)

                total = fnum(str(row[idx_total] or '').strip())
                if total is None:
                    continue

                qty = None
                if idx_qty is not None and idx_qty < len(row):
                    q = str(row[idx_qty] or '').strip()
                    try:
                        qty = int(float(q)) if q else None
                    except:
                        qty = None

                hsn = None
                if idx_hsn is not None and idx_hsn < len(row):
                    hsn = str(row[idx_hsn] or '').strip() or None

                out.append({
                    'sr': int(first_raw) if first_raw.isdigit() else None,
                    'name': desc,
                    'hsn': hsn,
                    'qty': qty,
                    'rate': None,
                    'discount_pct': None,
                    'taxable': None,
                    'cgst_pct': None,
                    'sgst_pct': None,
                    'cgst_amt': None,
                    'sgst_amt': None,
                    'cess_pct': None,
                    'cess_amt': None,
                    'total': total,
                })

        return out

    items = table_extract_items()

    def parse_item_row_text(row_text: str):
        row_text = re.sub(r'\s+', ' ', (row_text or '').strip())
        if not row_text:
            return None
        # Normalize orphan decimals like ".0" -> "0.0"
        row_text = re.sub(r'(?<!\d)\.(\d)\b', r'0.\1', row_text)
        row_pat = (
            r'\b(?P<sr>\d+)\s+'
            r'(?P<name>.+?)\s+'
            r'(?P<hsn>\d{6,8})\s+'
            r'(?P<qty>\d+)\s+'
            r'(?P<rate>\d+(?:\.\d{1,2})?)\s+'
            r'(?P<disc>\d+(?:\.\d+)?)%\s+'
            r'(?P<taxable>\d+(?:\.\d{1,2})?)\s+'
            r'(?P<cgst_pct>\d+(?:\.\d+)?)%\s+'
            r'(?P<sgst_pct>\d+(?:\.\d+)?)%\s+'
            r'(?P<cgst_amt>\d+(?:\.\d{1,2})?)\s+'
            r'(?P<sgst_amt>\d+(?:\.\d{1,2})?)\s+'
            r'(?P<cess_pct>\d+(?:\.\d+)?)(?:%)?\s+'
            r'(?P<cess_amt>\d+(?:\.\d{1,2})?)\s+'
            r'(?P<total>\d+(?:\.\d{1,2})?)\b'
        )

        m = re.search(row_pat, row_text)
        if not m:
            return None

        def clean_name(name: str) -> str:
            name = re.sub(r'\s+', ' ', name).strip(' -')
            for _ in range(5):
                name2 = name
                name2 = re.sub(r'\b([A-Za-z]{1,2})\s+([a-z]{2,})\b', r'\1\2', name2)
                name2 = re.sub(r'\b([A-Za-z]{1,3})\s+([a-z]{1,3})\b', r'\1\2', name2)
                name2 = re.sub(r'\b([a-z]{2,4})\s+([a-z]{2,4})\b', r'\1\2', name2)
                if name2 == name:
                    break
                name = name2
            return name

        name = clean_name(m.group('name'))

        item = {
            'sr': int(m.group('sr')),
            'name': name,
            'hsn': m.group('hsn'),
            'qty': int(float(m.group('qty'))),
            'rate': fnum(m.group('rate')),
            'discount_pct': fnum(m.group('disc')),
            'taxable': fnum(m.group('taxable')),
            'cgst_pct': fnum(m.group('cgst_pct')),
            'sgst_pct': fnum(m.group('sgst_pct')),
            'cgst_amt': fnum(m.group('cgst_amt')),
            'sgst_amt': fnum(m.group('sgst_amt')),
            'cess_pct': fnum(m.group('cess_pct')),
            'cess_amt': fnum(m.group('cess_amt')),
            'total': fnum(m.group('total')),
        }

        # Heuristic repair for Zepto overlap bugs:
        # if total is clearly wrong (tiny) but taxable looks right and taxes are ~0, use taxable as total.
        try:
            if (item.get('total') is not None and item.get('total') < 5 and
                item.get('taxable') is not None and
                (item.get('cgst_amt') or 0) == 0 and (item.get('sgst_amt') or 0) == 0):
                item['total'] = item['taxable']
        except Exception:
            pass

        # Name repair (common: "Kinnaur 4" -> "Apple Kinnaur 4 pcs")
        nm = (item.get('name') or '')
        if nm.lower().startswith('kinnaur'):
            item['name'] = 'Apple ' + nm + ' pcs'

        return item

    def parse_item_row_text_all(row_text: str):
        row_text = re.sub(r'\s+', ' ', (row_text or '').strip())
        if not row_text:
            return []
        row_text = re.sub(r'(?<!\d)\.(\d)\b', r'0.\1', row_text)

        row_pat = (
            r'\b(?P<sr>\d+)\s+'
            r'(?P<name>.+?)\s+'
            r'(?P<hsn>\d{6,8})\s+'
            r'(?P<qty>\d+)\s+'
            r'(?P<rate>\d+(?:\.\d{1,2})?)\s+'
            r'(?P<disc>\d+(?:\.\d+)?)%\s+'
            r'(?P<taxable>\d+(?:\.\d{1,2})?)\s+'
            r'(?P<cgst_pct>\d+(?:\.\d+)?)%\s+'
            r'(?P<sgst_pct>\d+(?:\.\d+)?)%\s+'
            r'(?P<cgst_amt>\d+(?:\.\d{1,2})?)\s+'
            r'(?P<sgst_amt>\d+(?:\.\d{1,2})?)\s+'
            r'(?P<cess_pct>\d+(?:\.\d+)?)(?:%)?\s+'
            r'(?P<cess_amt>\d+(?:\.\d{1,2})?)\s+'
            r'(?P<total>\d+(?:\.\d{1,2})?)\b'
        )

        out = []
        for m in re.finditer(row_pat, row_text):
            name = re.sub(r'\s+', ' ', m.group('name')).strip(' -')
            for _ in range(5):
                name2 = name
                name2 = re.sub(r'\b([A-Za-z]{1,2})\s+([a-z]{2,})\b', r'\1\2', name2)
                name2 = re.sub(r'\b([A-Za-z]{1,3})\s+([a-z]{1,3})\b', r'\1\2', name2)
                name2 = re.sub(r'\b([a-z]{2,4})\s+([a-z]{2,4})\b', r'\1\2', name2)
                if name2 == name:
                    break
                name = name2
            out.append({
                'sr': int(m.group('sr')),
                'name': name,
                'hsn': m.group('hsn'),
                'qty': int(float(m.group('qty'))),
                'rate': fnum(m.group('rate')),
                'discount_pct': fnum(m.group('disc')),
                'taxable': fnum(m.group('taxable')),
                'cgst_pct': fnum(m.group('cgst_pct')),
                'sgst_pct': fnum(m.group('sgst_pct')),
                'cgst_amt': fnum(m.group('cgst_amt')),
                'sgst_amt': fnum(m.group('sgst_amt')),
                'cess_pct': fnum(m.group('cess_pct')),
                'cess_amt': fnum(m.group('cess_amt')),
                'total': fnum(m.group('total')),
            })
        return out

    def table_extract_items_text():
        out = []
        settings = {
            "vertical_strategy": "text",
            "horizontal_strategy": "text",
            "intersection_tolerance": 5,
            "snap_tolerance": 3,
            "join_tolerance": 3,
            "min_words_vertical": 2,
            "min_words_horizontal": 1,
        }
        for page in pages:
            words = page.extract_words() or []
            header_top = None
            for w in words:
                if (w.get('text','') or '').lower() == 'sr':
                    header_top = w['top']
                    break
            if header_top is None:
                continue
            y0 = max(0, header_top - 10)
            cropped = page.crop((0, y0, page.width, page.height))
            tbs = cropped.extract_tables(settings) or []
            if not tbs:
                continue
            tb = tbs[0]

            # Some Zepto PDFs have a rendering bug where an item row overlaps the table header on the next page.
            # In that case, the "header" row may actually contain a full item row (sr/hsn/qty/rate/total).
            header_cells = [re.sub(r'\s+', ' ', str(c or '').strip()) for c in tb[0]]
            header_text = ' '.join([c for c in header_cells if c])
            if header_text and re.search(r'\b\d{6,8}\b', header_text):
                for parsed in parse_item_row_text_all(header_text):
                    if parsed and parsed.get('name'):
                        out.append(parsed)

            # Skip first 2-3 header rows; parse rows that contain a SR number and an HSN code.
            for row in tb[1:]:
                cells = []
                for c in row:
                    s = re.sub(r'\s+', ' ', str(c or '').strip())
                    # Fix digit splits inside a cell (don't join across cells)
                    s = re.sub(r'(?<=\d)\s+(?=\d)', '', s)
                    s = re.sub(r'(?<!\d)\.(\d)\b', r'0.\1', s)
                    if s:
                        cells.append(s)
                # Heuristic: sometimes HSN and Qty get fused/split across two numeric cells (e.g., "040120" + "006" -> HSN 04012000, Qty 6)
                i = 0
                while i < len(cells) - 1:
                    a = cells[i]
                    b = cells[i + 1]
                    if a.isdigit() and 6 <= len(a) < 8 and b.isdigit() and 1 <= len(b) <= 3:
                        need = 8 - len(a)
                        if need > 0 and need <= len(b):
                            cells[i] = a + b[:need]
                            cells[i + 1] = b[need:]
                            if cells[i + 1] == '':
                                cells.pop(i + 1)
                                continue
                    i += 1

                row_text = ' '.join(cells)
                if not row_text:
                    continue
                if 'item total' in row_text.lower() or 'invoice value' in row_text.lower():
                    break
                # Must include HSN-like digits
                if not re.search(r'\b\d{6,8}\b', row_text):
                    continue
                parsed_many = parse_item_row_text_all(row_text)
                for parsed in parsed_many:
                    if parsed and parsed.get('name'):
                        out.append(parsed)
        return out

    # If line-strategy got some items, still run text-strategy to recover edge cases
    # (e.g., Zepto row-overlap bug where an item lands in the next page header).
    extra_items = table_extract_items_text()
    if extra_items:
        def key(it):
            return (str(it.get('hsn') or ''), str(it.get('qty') or ''), str(it.get('total') or ''), (it.get('name') or '').lower())
        seen = set(key(it) for it in items)
        for it in extra_items:
            k = key(it)
            if k in seen:
                continue
            items.append(it)
            seen.add(k)

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
