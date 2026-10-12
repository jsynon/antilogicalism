"""Add Antilogicalism social links after the GitHub link in sidebar widgets.

Dry run by default; use --apply to write changes and back up originals.
"""
import argparse
import re
from datetime import datetime
from pathlib import Path

DEFAULT_ROOT = Path(r'D:\Downloads\antilogicalism')
GITHUB = re.compile(r'(<p\s+id=["\']github-repository-footer-link["\'][^>]*>.*?</p>)', re.I | re.S)
SOCIAL = ('\n<p id="social-footer-links">'
          '<a href="https://www.facebook.com/antilogicalism" target="_blank" rel="noopener noreferrer">Facebook</a>'
          ' | '
          '<a href="https://x.com/antilogicalism" target="_blank" rel="noopener noreferrer">Twitter / X</a>'
          '</p>')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        parser.error(f'Site directory not found: {root}')
    counts = dict(change=0, already_present=0, no_github_link=0, ambiguous=0)
    edits = []
    warnings = []
    for path in sorted(root.rglob('*.html')):
        if any(part in {'.git', '_post-preview', '_publication-staging'} for part in path.relative_to(root).parts):
            continue
        content = path.read_text(encoding='utf-8')
        existing = content.count('id="social-footer-links"') + content.count("id='social-footer-links'")
        github = list(GITHUB.finditer(content))
        if existing:
            if existing == 1:
                counts['already_present'] += 1
            else:
                counts['ambiguous'] += 1
                warnings.append(str(path.relative_to(root)) + ': multiple social blocks')
            continue
        if not github:
            counts['no_github_link'] += 1
            continue
        if len(github) != 1 or 'https://github.com/jsynon/antilogicalism' not in github[0].group():
            counts['ambiguous'] += 1
            warnings.append(str(path.relative_to(root)) + ': ambiguous GitHub link')
            continue
        updated = content[:github[0].end()] + SOCIAL + content[github[0].end():]
        edits.append((path, content, updated))
        counts['change'] += 1
    print('Mode:', 'APPLY' if args.apply else 'DRY RUN — no files changed')
    print('Site:', root)
    for key, count in counts.items():
        print(f'{key.replace("_", "-")}: {count}')
    print('Examples to update:')
    for path, _, _ in edits[:12]:
        print('  ', path.relative_to(root))
    for warning in warnings[:20]:
        print('WARNING:', warning)
    if not args.apply:
        print('To apply after reviewing, rerun with --apply')
        return
    if not edits:
        print('Nothing to update.')
        return
    backup = root.parent / ('antilogicalism-social-footer-backup-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    for path, old, _ in edits:
        dest = backup / path.relative_to(root)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(old, encoding='utf-8')
    for path, _, new in edits:
        path.write_text(new, encoding='utf-8')
    print('Backup directory:', backup)
    print(f'Updated {len(edits)} HTML files.')


if __name__ == '__main__':
    main()
