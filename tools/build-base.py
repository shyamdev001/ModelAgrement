"""
One-time build step (run on a PC with LibreOffice + PyMuPDF, NOT on the server).

Turns tools/template.docx into:
  assets/base.pdf     - the 4-page agreement with the variable bits blanked out
  assets/layout.json  - where the server must write name / address / date / signature

Re-run this only when the agreement wording or layout changes:
    python tools/build-base.py "C:/path/to/soffice.exe"
"""
import json, os, shutil, subprocess, sys, tempfile, zipfile
import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOFFICE = sys.argv[1] if len(sys.argv) > 1 else 'soffice'

NAME_LONG = 'QNAMEQ QNAMEQ QNAMEQ QNAMEQ QNAMEQ'   # long enough to make the "Between" paragraph two lines
NAME, VILLAGE, DATE = 'QNAMEQ', 'QVILLQ', 'QDATEQ'
DATE_LONG = '88 (Day) 88 (Month) 8888 (Year)'

work = tempfile.mkdtemp(prefix='ma-base-')
try:
    # 1. Fill the template's placeholders with recognisable dummy text.
    src = os.path.join(work, 'src')
    with zipfile.ZipFile(os.path.join(ROOT, 'tools', 'template.docx')) as z:
        z.extractall(src)
    doc_xml = os.path.join(src, 'word', 'document.xml')
    xml = open(doc_xml, encoding='utf-8').read()
    assert xml.count('{{CUSTOMER_NAME}}') == 2 and xml.count('{{VILLAGE}}') == 2
    xml = xml.replace('{{CUSTOMER_NAME}}', NAME_LONG, 1).replace('{{CUSTOMER_NAME}}', NAME, 1)
    xml = xml.replace('{{VILLAGE}}', VILLAGE)
    xml = xml.replace('{{AGREEMENT_DATE}}', DATE_LONG).replace('{{AGREEMENT_DATE_SHORT}}', DATE)
    xml = xml.replace('{{%CUSTOMER_SIGNATURE}}', '')
    assert '{{' not in xml
    open(doc_xml, 'w', encoding='utf-8').write(xml)
    filled = os.path.join(work, 'filled.docx')
    with zipfile.ZipFile(filled, 'w', zipfile.ZIP_DEFLATED) as z:
        for r, _, files in os.walk(src):
            for n in files:
                z.write(os.path.join(r, n), os.path.relpath(os.path.join(r, n), src))

    # 2. Word -> PDF.
    subprocess.run([SOFFICE, '--headless', '--convert-to', 'pdf', '--outdir', work, filled], check=True, timeout=180)
    pdf = fitz.open(os.path.join(work, 'filled.pdf'))
    assert len(pdf) == 4, f'expected 4 pages, got {len(pdf)}'

    def chars(page):
        for block in page.get_text('rawdict')['blocks']:
            for line in block.get('lines', []):
                for span in line['spans']:
                    for ch in span['chars']:
                        yield ch, span, line

    def find(page, text):
        """Origin (x, baseline y), font size and bbox of each occurrence of `text` on a single line."""
        hits = []
        for block in page.get_text('rawdict')['blocks']:
            for line in block.get('lines', []):
                seq = [(ch, span) for span in line['spans'] for ch in span['chars']]
                joined = ''.join(c['c'] for c, _ in seq)
                start = joined.find(text)
                while start != -1:
                    part = seq[start:start + len(text)]
                    rect = fitz.Rect(part[0][0]['bbox'])
                    for c, _ in part:
                        rect |= fitz.Rect(c['bbox'])
                    hits.append({'x': part[0][0]['origin'][0], 'y': part[0][0]['origin'][1], 'size': part[0][1]['size'], 'rect': rect})
                    start = joined.find(text, start + 1)
        return hits

    layout = {'pageHeight': pdf[0].rect.height, 'pageWidth': pdf[0].rect.width}
    p1, p4 = pdf[0], pdf[3]

    # 3a. Page 1 date: the digits are fixed-width, so each one is redrawn exactly where its dummy "8" sat.
    date_hit = find(p1, '88 (Day)')
    assert len(date_hit) == 1
    line_y = date_hit[0]['y']
    digits = [ch for ch, span, _ in chars(p1) if ch['c'] == '8' and abs(ch['origin'][1] - line_y) < 1]
    assert len(digits) == 8, len(digits)
    layout['p1DateDigits'] = [{'x': d['origin'][0], 'y': d['origin'][1]} for d in digits]
    layout['p1DateSize'] = date_hit[0]['size']
    for d in digits:
        p1.add_redact_annot(fitz.Rect(d['bbox']))

    # 3b. Page 1 "Between" paragraph: blank the whole thing; the server re-wraps it for the real name.
    para_lines, para_rect = [], None
    for block in p1.get_text('rawdict')['blocks']:
        lines = block.get('lines', [])
        text = ''.join(ch['c'] for l in lines for s in l['spans'] for ch in s['chars'])
        if NAME in text:
            for l in lines:
                first = l['spans'][0]
                para_lines.append({'x': first['chars'][0]['origin'][0], 'y': first['chars'][0]['origin'][1]})
                r = fitz.Rect(l['bbox'])
                para_rect = r if para_rect is None else para_rect | r
                size = max(s['size'] for s in l['spans'])
    assert len(para_lines) == 2, para_lines
    # Right edge of the text area = right edge of the widest justified line on the page.
    right = max(fitz.Rect(l['bbox']).x1 for b in p1.get_text('dict')['blocks'] for l in b.get('lines', []))
    layout['p1Party'] = {'x': para_lines[0]['x'], 'lineYs': [l['y'] for l in para_lines], 'size': size, 'maxWidth': right - para_lines[0]['x']}
    p1.add_redact_annot(para_rect)

    # 3c. Page 4 signature block.
    def one(page, text, count=1):
        hits = find(page, text)
        assert len(hits) == count, (text, len(hits))
        for h in hits:
            page.add_redact_annot(h['rect'])
        return [{'x': h['x'], 'y': h['y'], 'size': h['size']} for h in hits]

    layout['p4Name'] = one(p4, NAME)[0]
    layout['p4Village'] = one(p4, VILLAGE)[0]
    dates = sorted(one(p4, DATE, 2), key=lambda d: d['x'])
    layout['p4CustomerDate'], layout['p4VendorDate'] = dates
    sign = find(p4, 'Sign:')
    assert len(sign) == 1
    layout['p4Sign'] = {'x': sign[0]['rect'].x1 + 6, 'baseline': sign[0]['y'], 'maxWidth': 150, 'maxHeight': 30}

    for page in (p1, p4):
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

    os.makedirs(os.path.join(ROOT, 'assets'), exist_ok=True)
    pdf.save(os.path.join(ROOT, 'assets', 'base.pdf'), garbage=4, deflate=True)
    json.dump(layout, open(os.path.join(ROOT, 'assets', 'layout.json'), 'w'), indent=2)
    print('fonts used:', sorted({f[3] for p in pdf for f in p.get_fonts()}))
    print(json.dumps(layout, indent=1))
finally:
    shutil.rmtree(work, ignore_errors=True)
