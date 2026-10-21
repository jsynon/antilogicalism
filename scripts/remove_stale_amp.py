#!/usr/bin/env python3
"""Remove obsolete AMP discovery links left in WordPress-exported HTML.

On this static GitHub Pages site, ?amp destinations are not AMP documents.
Removing stale <link rel="amphtml"> tags stops advertising those invalid AMP
variants to Google. The script changes only the <head> and preserves every
page body, original paragraph, CSS rule, and script exactly.

Usage:
  python scripts/remove_stale_amp.py --apply
  python scripts/remove_stale_amp.py --check
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HEAD_END = re.compile(r"</head\s*>", re.I)
LINK = re.compile(r"<link\b[^>]*>", re.I)
REL = re.compile(r"""\brel\s*=\s*['"]amphtml['"]""", re.I)
HREF = re.compile(r"""\bhref\s*=\s*['"]([^'"]+)['"]""", re.I)


def cleaned(document: str, filename: str) -> tuple[str, int]:
    match = HEAD_END.search(document)
    if not match:
        raise ValueError(f"No HTML head: {filename}")
    head, body = document[:match.start()], document[match.start():]
    removed = 0

    def replace(link: re.Match[str]) -> str:
        nonlocal removed
        tag = link.group()
        if not REL.search(tag):
            return tag
        href_match = HREF.search(tag)
        if not href_match:
            raise ValueError(f"AMP tag without href: {filename}")
        href = href_match.group(1)
        # Only remove the known invalid AMP variant links left by WordPress;
        # leave unrelated URLs or real AMP references for manual review.
        if not (href.endswith("?amp") or href.endswith("?amp=1")):
            raise ValueError(f"Unexpected AMP reference in {filename}: {href}")
        removed += 1
        return ""

    new_head = LINK.sub(replace, head)
    new_document = new_head + body
    if not new_document.endswith(body):
        raise AssertionError(f"Body changed: {filename}")
    return new_document, removed


def main() -> None:
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--apply", action="store_true")
    action.add_argument("--check", action="store_true")
    args = parser.parse_args()

    html_files = sorted(ROOT.rglob("*.html"))
    modifications = []
    n_tags = 0
    for path in html_files:
        if any(part in {".git", "node_modules", "wp-content"} for part in path.parts):
            continue
        with path.open("r", encoding="utf-8", newline="") as fh:
            old = fh.read()
        if not re.search(r"<head\b", old, re.I):
            # Google verification and other standalone text/HTML fragments.
            continue
        new, count = cleaned(old, str(path.relative_to(ROOT)))
        if old != new:
            modifications.append((path, new))
        n_tags += count
    print(f"Scanned {len(html_files)} HTML files, found {n_tags} stale AMP tags in {len(modifications)} files.")
    if args.check:
        if modifications:
            raise SystemExit("FAIL: stale AMP references remain")
        print("PASS: no old AMP declarations remain")
        return
    for path, new in modifications:
        with path.open("w", encoding="utf-8", newline="") as fh:
            fh.write(new)
    print("Removed stale AMP declarations; all page bodies preserved.")


if __name__ == "__main__":
    main()
