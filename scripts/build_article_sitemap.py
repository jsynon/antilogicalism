#!/usr/bin/env python3
"""Build a dedicated sitemap for the archive's dated article pages.

This separate sitemap lets Google Search Console report on article indexing
without mixing in tag, author, or category archives. It makes no changes to
the existing main sitemap or any HTML.

Run:
    python scripts/build_article_sitemap.py --apply
    python scripts/build_article_sitemap.py --check
"""
from __future__ import annotations

import argparse
from html import unescape
from pathlib import Path
import re
from urllib.parse import quote, unquote, urljoin

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://jsynon.github.io/antilogicalism/"
OUTPUT = ROOT / "sitemap-articles.xml"
HEAD_END = re.compile(r"</head\s*>", re.I)
HTML_TAG = re.compile(r"<(?:meta|link)\b[^>]*>", re.I)
ATTR = re.compile(r"""([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')""")


def attrs(tag: str) -> dict[str, str]:
    return {m.group(1).lower(): unescape(m.group(2) if m.group(2) is not None else m.group(3))
            for m in ATTR.finditer(tag)}


def articles() -> tuple[list[str], list[str]]:
    urls: list[str] = []
    exclusions: list[str] = []
    for path in sorted(ROOT.glob("20??/??/??/*/index.html")):
        relative = path.relative_to(ROOT).as_posix()
        if not re.fullmatch(r"20\d\d/\d\d/\d\d/[^/]+/index\.html", relative):
            continue
        with path.open("r", encoding="utf-8", newline="") as reader:
            content = reader.read()
        match = HEAD_END.search(content)
        if not match:
            exclusions.append(f"Malformed HTML head: {relative}")
            continue
        head = content[:match.start()]
        metadata = [attrs(m.group()) for m in HTML_TAG.finditer(head)]
        if any("noindex" in tag.get("content", "").lower()
               for tag in metadata if tag.get("name", "").lower() == "robots"):
            exclusions.append(f"Noindex: {relative}")
            continue

        raw_url = BASE + quote(relative.removesuffix("index.html"), safe="/-._~")
        canonical = [tag.get("href", "") for tag in metadata
                     if tag.get("rel", "").lower() == "canonical"]
        if len(canonical) > 1:
            exclusions.append(f"Multiple canonicals: {relative}")
            continue
        if canonical:
            preferred = urljoin(BASE, canonical[0])
            if unquote(preferred) != unquote(raw_url):
                exclusions.append(f"Canonical elsewhere: {relative} -> {preferred}")
                continue
        urls.append(raw_url)
    return urls, exclusions


def xml_for(urls: list[str]) -> str:
    lines = ['<?xml version="1.0" encoding="utf-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url in urls:
        lines.extend(['  <url>', f'    <loc>{url}</loc>', '  </url>'])
    lines.append('</urlset>')
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--apply", action="store_true")
    action.add_argument("--check", action="store_true")
    args = parser.parse_args()
    urls, exclusions = articles()
    new = xml_for(urls)
    print(f"Article URLs: {len(urls)}; exclusions: {len(exclusions)}")
    for item in exclusions:
        print("Skipped:", item)
    if not urls:
        raise SystemExit("No eligible articles found; refusing empty sitemap.")
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text(encoding="utf-8") != new:
            raise SystemExit("Article sitemap is out of date. Run with --apply.")
        print("PASS: Article sitemap matches the current archive.")
        return
    OUTPUT.write_text(new, encoding="utf-8", newline="\n")
    print("Generated sitemap-articles.xml; existing sitemap.xml and pages untouched.")


if __name__ == "__main__":
    main()
