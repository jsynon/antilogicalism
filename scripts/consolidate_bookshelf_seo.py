#!/usr/bin/env python3
"""Make the consolidated Bookshelf the preferred search destination.

Safeguards:
- The main Bookshelf's existing paragraphs and interface are untouched. Only
  a collapsed, accessible full title index is added (or regenerated).
- Every historical category page retains its entire <body> byte-for-byte;
  changes are limited to an HTML <head> canonical link.
- Historical category URLs are removed from the production sitemap without
  deleting the pages. All unrelated sitemap entries are untouched.

Usage:
  python scripts/consolidate_bookshelf_seo.py --apply
  python scripts/consolidate_bookshelf_seo.py --check
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://jsynon.github.io/antilogicalism/primary-sources/"
BOOKSHELF = ROOT / "primary-sources"
MAIN = BOOKSHELF / "index.html"
SITEMAP = ROOT / "sitemap.xml"
AREAS = (
    ("philosophy", "Philosophy", "philosophy/philosophy-browse-data.json"),
    ("science", "Science", "science/bookshelf-browse-data.json"),
    ("psychology", "Psychology", "psychology/bookshelf-browse-data.json"),
    ("religious", "Religious", "religious/bookshelf-browse-data.json"),
    ("political-cultural", "Political & Cultural", "political-cultural/bookshelf-browse-data.json"),
    ("literature", "Literature", "literature/bookshelf-browse-data.json"),
    ("historical", "Historical", "historical/bookshelf-browse-data.json"),
)
START = '    <!-- bookshelf-static-index:start -->\n'
END = '    <!-- bookshelf-static-index:end -->\n'
FALLBACK_ANCHOR = '    <section class="master-extras" aria-label="Additional resources">'
CANONICAL = re.compile(r'<link\b[^>]*rel=["\']canonical["\'][^>]*>', re.I)
CLOSE_HEAD = re.compile(r'</head\s*>', re.I)
SITEMAP_ENTRY = re.compile(r'^[ \t]*<url>\r?\n[ \t]*<loc>([^<]+)</loc>\r?\n[ \t]*</url>\r?\n', re.M)


def read(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as fh:
        return fh.read()


def save(path: Path, content: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        fh.write(content)


def title_index() -> tuple[str, int]:
    lines = [
        '    <!-- bookshelf-static-index:start -->',
        '    <details class="master-static-index" id="book-title-index">',
        '      <summary>Complete title and author index (BOOKCOUNT books)</summary>',
        '      <p>Book titles and authors from the complete collection. Use the search and category controls above to browse and open the books.</p>',
        '      <div class="master-static-index-categories">',
    ]
    count = 0
    for key, label, file in AREAS:
        source = json.loads(read(BOOKSHELF / file))
        lines += [
            f'        <section aria-labelledby="static-books-{key}">',
            f'          <h3 id="static-books-{key}">{html.escape(label)}</h3>',
            '          <ul>',
        ]
        for entry in source["entries"]:
            for book in entry.get("books", []):
                author = book.get("author") or entry.get("author") or "Anonymous"
                lines.append(
                    f'            <li><cite>{html.escape(book["title"])}</cite> — {html.escape(author)}</li>'
                )
                count += 1
        lines.extend(['          </ul>', '        </section>'])
    lines.extend([
        '      </div>',
        '    </details>',
        '    <!-- bookshelf-static-index:end -->',
    ])
    return "\n".join(lines).replace("BOOKCOUNT", str(count)) + "\n", count


def update_main(content: str) -> tuple[str, int]:
    generated, count = title_index()
    if content.count(START) == 1 and content.count(END) == 1:
        begin = content.index(START)
        finish = content.index(END, begin) + len(END)
        return content[:begin] + generated + content[finish:], count
    if START in content or END in content:
        raise ValueError("Incomplete static index markers on main Bookshelf.")
    if content.count(FALLBACK_ANCHOR) != 1:
        raise ValueError("Main Bookshelf insertion point was not found exactly once.")
    return content.replace(FALLBACK_ANCHOR, generated + FALLBACK_ANCHOR), count


def canonicalize_legacy(content: str, filename: str) -> str:
    closing = CLOSE_HEAD.search(content)
    if not closing:
        raise ValueError(f"No </head> in {filename}")
    head, body = content[:closing.start()], content[closing.start():]
    matches = list(CANONICAL.finditer(head))
    if len(matches) > 1:
        raise ValueError(f"Duplicate canonical links in {filename}")
    element = f'<link rel="canonical" href="{BASE}">'
    if matches:
        match = matches[0]
        head = head[:match.start()] + element + head[match.end():]
    else:
        m = re.search(r'</title\s*>', head, re.I)
        if not m:
            raise ValueError(f"No HTML title in {filename}")
        head = head[:m.end()] + "\n" + element + head[m.end():]
    new_content = head + body
    if new_content[new_content.find(body):] != body:
        raise ValueError(f"Body mutated in {filename}")
    return new_content


def curate_sitemap(xml: str) -> tuple[str, int]:
    count = 0
    def replacement(m: re.Match[str]) -> str:
        nonlocal count
        url = m.group(1)
        if url.startswith(BASE) and url != BASE:
            count += 1
            return ""
        return m.group(0)
    return SITEMAP_ENTRY.sub(replacement, xml), count


def main() -> None:
    parser = argparse.ArgumentParser()
    command = parser.add_mutually_exclusive_group(required=True)
    command.add_argument("--apply", action="store_true")
    command.add_argument("--check", action="store_true")
    args = parser.parse_args()

    differences: list[tuple[Path, str]] = []
    original = read(MAIN)
    revised, count = update_main(original)
    if revised != original:
        differences.append((MAIN, revised))

    legacy = sorted(path for path in BOOKSHELF.rglob("*.html") if path != MAIN)
    for path in legacy:
        original = read(path)
        revised = canonicalize_legacy(original, str(path.relative_to(ROOT)))
        if revised != original:
            differences.append((path, revised))

    original = read(SITEMAP)
    revised, removed = curate_sitemap(original)
    if revised != original:
        differences.append((SITEMAP, revised))

    print(f"Book titles: {count}; legacy pages: {len(legacy)}; sitemap relic URLs removed: {removed}")
    print(f"Files needing changes: {len(differences)}")
    if args.check and differences:
        raise SystemExit("SEO files need regeneration: " + ", ".join(
            str(path.relative_to(ROOT)) for path, _ in differences))
    if args.apply:
        for path, content in differences:
            save(path, content)
        print("Applied safe metadata and title-index changes.")
    else:
        print("PASS: main Bookshelf and legacy canonical signals are synchronized.")


if __name__ == "__main__":
    main()
