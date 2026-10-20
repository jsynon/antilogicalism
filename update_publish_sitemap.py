"""One-time safe updater for Antilogicalism's existing publish.py.
Adds automatic sitemap.xml updates to successful publications.
Does not alter the Book Lite layout or navigation styles.
"""
from pathlib import Path
import ast
import shutil

root = Path(__file__).resolve().parent
path = root / 'publish.py'
if not path.is_file():
    raise SystemExit('ERROR: Place this updater beside publish.py in the Antilogicalism repository.')
text = path.read_text(encoding='utf-8')
if 'def update_sitemap_for_post(' in text:
    raise SystemExit('Sitemap support is already present; no changes made.')

# Require the existing publisher structure to avoid modifying an unfamiliar revision.
checks = [
    "INDEXER = ROOT / 'scripts' / 'build_search_index.py'",
    'def nav_link(soup, direction, url, title):',
    "a.string = ('← ' + title) if direction == 'previous' else (title + ' →')",
    "old_index = ROOT / 'search-index.json'",
    "previous: previous.read_bytes(), old_index: old_index.read_bytes()}",
    "        if new_count < old_count + 1:\n            raise RuntimeError(f'Search index count did not increase: {old_count} -> {new_count}')",
]
for item in checks:
    if item not in text:
        raise SystemExit('ERROR: publish.py differs from expected current version. No files changed. Missing: ' + item[:95])

helper = '''\n\ndef update_sitemap_for_post(permalink):
    """Add the new article URL to the existing sitemap without disturbing older URLs."""
    from xml.etree import ElementTree as ET

    sitemap = ROOT / 'sitemap.xml'
    namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9'
    ET.register_namespace('', namespace)
    tree = ET.parse(sitemap)
    root = tree.getroot()
    if root.tag != f'{{{namespace}}}urlset':
        raise RuntimeError('Unexpected sitemap structure; sitemap unchanged')
    url = 'https://jsynon.github.io' + permalink
    existing = {node.text for node in root.findall(f'.//{{{namespace}}}loc')}
    if url in existing:
        print('Sitemap already includes:', url)
        return
    item = ET.SubElement(root, f'{{{namespace}}}url')
    ET.SubElement(item, f'{{{namespace}}}loc').text = url
    ET.indent(tree, space='  ')
    tree.write(sitemap, encoding='utf-8', xml_declaration=True)
    # Make sure the newly written file is still parseable and contains the URL.
    checked = ET.parse(sitemap)
    if url not in {n.text for n in checked.findall(f'.//{{{namespace}}}loc')}:
        raise RuntimeError('Sitemap validation failed')
    print('Sitemap updated:', url)
'''
needle = '\ndef sync_excerpt(article_path):'
if text.count(needle)!=1:
    raise SystemExit('ERROR: Cannot identify safe insertion point')
text = text.replace(needle, helper+needle, 1)
text = text.replace("    old_index = ROOT / 'search-index.json'\n", "    old_index = ROOT / 'search-index.json'\n    sitemap = ROOT / 'sitemap.xml'\n    if not sitemap.is_file():\n        raise FileNotFoundError('Existing sitemap.xml missing')\n",1)
text = text.replace('previous: previous.read_bytes(), old_index: old_index.read_bytes()}', 'previous: previous.read_bytes(), old_index: old_index.read_bytes(),\n                 sitemap: sitemap.read_bytes()}',1)
needle = "        if new_count < old_count + 1:\n            raise RuntimeError(f'Search index count did not increase: {old_count} -> {new_count}')"
text = text.replace(needle, needle+"\n        update_sitemap_for_post(result['permalink'])",1)
# Validate syntax before changing the current script.
ast.parse(text, filename='publish.py')
backup = root / 'publish.py.before-sitemap-update.bak'
if backup.exists():
    raise SystemExit('ERROR: Backup already exists. No files changed: ' + str(backup))
shutil.copy2(path, backup)
path.write_text(text, encoding='utf-8')
print('Updated:', path)
print('Original backed up:', backup)
print('Navigation arrows were already correct and remain unchanged.')
print('Future publications now update sitemap.xml, with backup and rollback on failure.')
print('Review publish.py in GitHub Desktop before committing; do not commit the .bak file.')
