"""Repair homepage sharing metadata. Preview by default; --write makes backups."""
import argparse
import html
import re
import shutil
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

BASE = 'https://jsynon.github.io/antilogicalism/'
META = re.compile(r'<meta\b[^>]*>', re.I)

class Tag(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.attrs = {}
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        self.attrs = dict(attrs)

def repair(text):
    head_match = re.search(r'<head\b[^>]*>(.*?)</head\s*>', text, re.I | re.S)
    if not head_match:
        raise ValueError('No HTML head found')
    head = head_match.group(1)
    values = {}
    for tag in META.findall(head):
        attrs = Tag(tag).attrs
        key = attrs.get('property', attrs.get('name', '')).lower()
        if key.startswith(('og:', 'twitter:')):
            if key in values:
                raise ValueError('Duplicate sharing tag: ' + key)
            values[key] = attrs.get('content', '')
    if not values.get('og:image'):
        raise ValueError('No existing og:image; stopped rather than guessing an image')
    image = urljoin(BASE, values['og:image'])
    if urlsplit(image).scheme not in ('https', 'http'):
        raise ValueError('Unsupported image URL')
    updates = {
        'og:url': BASE,
        'og:image': image,
        'twitter:card': 'summary_large_image',
        'twitter:site': '@antilogicalism',
        'twitter:title': values.get('og:title') or 'Antilogicalism',
        'twitter:description': values.get('og:description') or 'Philosophy, reflections, and a searchable digital library.',
        'twitter:image': image,
        'twitter:image:alt': values.get('og:image:alt') or 'Antilogicalism',
    }
    seen = set()
    def replace(match):
        attrs = Tag(match.group()).attrs
        key = attrs.get('property', attrs.get('name', '')).lower()
        if key == 'twitter:text:title':
            return ''
        if key not in updates:
            return match.group()
        seen.add(key)
        attr = 'property' if key.startswith('og:') else 'name'
        return '<meta ' + attr + '="' + key + '" content="' + html.escape(updates[key], quote=True) + '">'
    fixed = META.sub(replace, head)
    newline = '\r\n' if '\r\n' in text else '\n'
    missing = [replace(re.match(META, '<meta name="' + key + '">')) for key in updates if key not in seen]
    if missing:
        fixed = fixed.rstrip() + newline + newline.join(missing) + newline
    return text[:head_match.start(1)] + fixed + text[head_match.end(1):], updates

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, default=Path(r'D:\Downloads\antilogicalism'))
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    path = args.site / 'index.html'
    raw = path.read_bytes()
    text = raw.decode('utf-8')
    fixed, updates = repair(text)
    if fixed == text:
        print('Already fixed. No changes needed.')
        return
    print('Homepage:', path)
    for key, value in updates.items():
        print(key + ': ' + value)
    if not args.write:
        print('PREVIEW ONLY. No files changed. Run again with --write to apply.')
        return
    backup_dir = args.site.parent / ('antilogicalism-social-backup-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup_dir.mkdir()
    shutil.copy2(path, backup_dir / 'index.html')
    temporary = path.with_name('index.social-preview.tmp')
    temporary.write_bytes(fixed.encode('utf-8'))
    temporary.replace(path)
    print('Updated homepage sharing tags.')
    print('Backup:', backup_dir / 'index.html')

if __name__ == '__main__':
    main()
