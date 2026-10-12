#!/usr/bin/env python3
"""Add a GitHub repository link to Antilogicalism's existing search footer.

Dry run by default. Use --apply after reviewing the report.
"""
from pathlib import Path
from datetime import datetime
import argparse
import re
import shutil

ROOT_DEFAULT = Path(r'D:\Downloads\antilogicalism')
LINK = '<p id="github-repository-footer-link"><a href="https://github.com/jsynon/antilogicalism" target="_blank" rel="noopener noreferrer">GitHub Repository</a></p>'
WIDGET_RE = re.compile(r'<aside\b[^>]*\bid=["\']antilogicalism-search-widget["\'][^>]*>.*?</aside\s*>', re.I | re.S)
LIBRARY_RE = re.compile(r'(<p\b[^>]*\bid=["\']library-search-footer-link["\'][^>]*>.*?</p\s*>)', re.I | re.S)
EXCLUDED_DIRS = {'.git', 'node_modules', '__pycache__', '_publication-staging', '_post-preview', 'backups'}

def update(text):
    matches = list(WIDGET_RE.finditer(text))
    if not matches:
        return text, 'no-widget'
    if len(matches) != 1:
        return text, 'ambiguous-widget'
    match = matches[0]
    block = match.group(0)
    if 'github-repository-footer-link' in block or re.search(r'>\s*GitHub Repository\s*</a>', block, re.I):
        return text, 'already-present'
    libraries = list(LIBRARY_RE.finditer(block))
    if len(libraries) != 1:
        return text, 'missing-or-ambiguous-library-link'
    library = libraries[0]
    newline = '\r\n' if '\r\n' in text else '\n'
    replacement = block[:library.end()] + newline + LINK + block[library.end():]
    return text[:match.start()] + replacement + text[match.end():], 'change'

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, default=ROOT_DEFAULT)
    p.add_argument('--apply', action='store_true', help='Back up and modify matching HTML files')
    args = p.parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        p.error(f'Site directory not found: {root}')
    changes, counts, warnings = [], {}, []
    for path in root.rglob('*.html'):
        if any(part in EXCLUDED_DIRS or part.startswith('.git') for part in path.relative_to(root).parts[:-1]):
            continue
        raw = path.read_bytes()
        try:
            content = raw.decode('utf-8')
        except UnicodeDecodeError:
            warnings.append((path, 'non-UTF-8 HTML'))
            continue
        new_content, status = update(content)
        counts[status] = counts.get(status, 0) + 1
        if status == 'change':
            changes.append((path, raw, new_content.encode('utf-8')))
        elif status in ('ambiguous-widget', 'missing-or-ambiguous-library-link'):
            warnings.append((path, status))
    print(f'Mode: {"APPLY" if args.apply else "DRY RUN — no files changed"}')
    print(f'Site: {root}')
    for key in ('change', 'already-present', 'no-widget', 'ambiguous-widget', 'missing-or-ambiguous-library-link'):
        print(f'{key}: {counts.get(key, 0)}')
    print('Examples to update:')
    for path, _, _ in changes[:12]:
        print('  ', path.relative_to(root))
    if warnings:
        print(f'Warnings ({len(warnings)}):')
        for path, reason in warnings[:20]:
            print('  ', path.relative_to(root), reason)
    if args.apply and changes:
        backup = root.parent / ('antilogicalism-github-footer-backup-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
        print(f'Backup directory: {backup}')
        for path, original, updated in changes:
            relative = path.relative_to(root)
            dest = backup / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(original)
            path.write_bytes(updated)
        print(f'Updated {len(changes)} HTML files. Original versions saved in backup.')
    elif not args.apply:
        print('To apply after reviewing, rerun with --apply')

if __name__ == '__main__':
    main()
