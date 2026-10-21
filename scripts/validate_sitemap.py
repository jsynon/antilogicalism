#!/usr/bin/env python3
"""Validate the published sitemap against the static HTML site.

Run from anywhere: python scripts/validate_sitemap.py

This is read-only. It does not rewrite the sitemap or any web page. It checks
for malformed XML, duplicate URLs, wrong-host URLs, missing HTML targets, and
accidentally published staging/backup URLs. Encoded Unicode URL paths are
decoded before comparing to filenames.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlsplit
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
SITEMAP = ROOT / "sitemap.xml"
HOST = "jsynon.github.io"
PREFIX = "/antilogicalism/"
NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def audit() -> int:
    try:
        root = ET.parse(SITEMAP).getroot()
    except (OSError, ET.ParseError) as error:
        print(f"ERROR: Cannot read sitemap.xml: {error}", file=sys.stderr)
        return 1

    locations = [(element.text or "").strip()
                 for element in root.findall("sm:url/sm:loc", NS)]
    if not locations:
        print("ERROR: Sitemap contains no <loc> entries.", file=sys.stderr)
        return 1

    failures: list[str] = []
    counts = Counter(locations)
    for url, count in counts.items():
        if count != 1:
            failures.append(f"Duplicate sitemap URL ({count} times): {url}")

    categories = Counter()
    for location in locations:
        parsed = urlsplit(location)
        if parsed.scheme != "https" or parsed.netloc != HOST:
            failures.append(f"Unexpected scheme or host: {location}")
            continue
        if not parsed.path.startswith(PREFIX):
            failures.append(f"URL outside published project path: {location}")
            continue
        if parsed.query or parsed.fragment:
            failures.append(f"Sitemap URL has a query or fragment: {location}")
            continue
        local = unquote(parsed.path[len(PREFIX):])
        if (not local or local.endswith("/")):
            local += "index.html"
        pieces = Path(local).parts
        if ".." in pieces or any(part.startswith(".") for part in pieces):
            failures.append(f"Unsafe file path: {location}")
            continue
        if (local.startswith("_publication-staging/")
                or ".before-" in local
                or ".footer-test" in local
                or local.endswith(".bak")):
            failures.append(f"Development/backup URL in sitemap: {location}")
            continue
        if not (ROOT / local).is_file():
            failures.append(f"Missing published HTML target: {location}")
        categories[local.split("/", 1)[0]] += 1

    print(f"Sitemap URL count: {len(locations)}")
    print("Largest URL groups:",
          ", ".join(f"{name}={count}" for name, count in categories.most_common(8)))
    if failures:
        for failure in failures:
            print("ERROR:", failure, file=sys.stderr)
        print(f"{len(failures)} sitemap issues found.", file=sys.stderr)
        return 1
    print("PASS: All listed URLs map to repository files; no duplicates or staging entries.")
    return 0


if __name__ == "__main__":
    sys.exit(audit())
