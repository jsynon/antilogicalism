"""Repair post navigation arrows and update the Antilogicalism sitemap.
Run from the repository with: python fix_book_chat_publishing.py
Only changes the files described below; creates .bak copies of changed files.
"""
from pathlib import Path
from xml.etree import ElementTree as ET
import re
import shutil

root = Path(__file__).resolve().parent
publisher = root / 'publish.py'
first = root / '2026/10/10/the-death-and-resurrection-of-antilogicalism/index.html'
second = root / '2026/10/20/book-chat/index.html'
sitemap = root / 'sitemap.xml'
for p in (publisher, first, second, sitemap):
    if not p.is_file():
        raise SystemExit(f'Missing required file: {p}')

changes = {}
source = publisher.read_text(encoding='utf-8')
old = "    a.string = title\n    section.append(a)"
new = "    a.string = ('← ' + title) if direction == 'previous' else (title + ' →')\n    section.append(a)"
if old in source:
    changes[publisher] = source.replace(old, new, 1)
elif new not in source:
    raise SystemExit('publish.py navigation function differs from expected; stopped safely.')

for p in (first, second):
    html = p.read_text(encoding='utf-8')
    def repl(m):
        direction, prefix, label, suffix = m.groups()
        clean = label.strip().removeprefix('← ').removesuffix(' →')
        text = ('← ' + clean) if direction == 'previous' else (clean + ' →')
        return prefix + text + suffix
    pattern = r'<div class="nav-(previous|next)">(<a\b[^>]*>)([^<]+)(</a>)'
    # Different matching group arrangement to retain direction.
    def replace_nav(m):
        direction, anchor_start, label, anchor_end = m.groups()
        clean = label.strip().removeprefix('← ').removesuffix(' →')
        return f'<div class="nav-{direction}">{anchor_start}' + (('← ' + clean) if direction == 'previous' else (clean + ' →')) + anchor_end
    updated, hits = re.subn(pattern, replace_nav, html)
    if hits < 1:
        raise SystemExit(f'Could not locate navigation links in {p}; stopped safely.')
    if updated != html:
        changes[p] = updated

ns = 'http://www.sitemaps.org/schemas/sitemap/0.9'
ET.register_namespace('', ns)
url = 'https://jsynon.github.io/antilogicalism/2026/10/20/book-chat/'
tree = ET.parse(sitemap)
xmlroot = tree.getroot()
if xmlroot.tag != f'{{{ns}}}urlset':
    raise SystemExit('Unexpected sitemap format; stopped safely.')
urls = [e.text for e in xmlroot.findall(f'{{{ns}}}url/{{{ns}}}loc')]
if url not in urls:
    el = ET.SubElement(xmlroot, f'{{{ns}}}url')
    ET.SubElement(el, f'{{{ns}}}loc').text = url
    ET.indent(tree, space='  ')
    changes[sitemap] = ET.tostring(xmlroot, encoding='unicode', xml_declaration=True) + '\n'

if not changes:
    print('Everything is already up to date.')
else:
    for path, contents in changes.items():
        backup = path.with_name(path.name + '.book-chat-fix.bak')
        if backup.exists():
            raise SystemExit(f'Existing backup would be overwritten: {backup}')
    for path, contents in changes.items():
        shutil.copy2(path, path.with_name(path.name + '.book-chat-fix.bak'))
        path.write_text(contents, encoding='utf-8')
        print('Updated:', path.relative_to(root))
    print('Done. Inspect changes in GitHub Desktop before committing. Remove .book-chat-fix.bak files from the Changes list.')
