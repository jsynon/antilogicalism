#!/usr/bin/env python3
"""Normalize SEO metadata on static Antilogicalism archive pages.

Changes are strictly limited to text before </head>. Page titles, existing
descriptions, layout, scripts, written paragraphs, and all body content stay
untouched. Run with --apply to write, --check to verify idempotence, or with
no flags to preview changes. Python standard library only.
"""
from __future__ import annotations

import argparse
import html
from pathlib import Path
import re
from urllib.parse import unquote, urljoin

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://jsynon.github.io/antilogicalism/"
EXCLUDED = {
    "index.html",
    "index/index.html",
    "primary-sources/index.html",
    "digital-library/index.html",
    "reading-companion/index.html",
    "my-writings/index.html",
    "links/index.html",
}
HEAD_CLOSE = re.compile(r"</head\s*>", re.IGNORECASE)
TITLE = re.compile(r"<title\b[^>]*>(.*?)</title\s*>", re.IGNORECASE | re.DOTALL)
TAG = re.compile(r"<(?:meta|link)\b[^>]*>", re.IGNORECASE)
ATTR = re.compile(r"""([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')""")
SPACE = re.compile(r"\s+")


def attributes(tag: str) -> dict[str, str]:
    return {m.group(1).lower(): m.group(2) if m.group(2) is not None else m.group(3)
            for m in ATTR.finditer(tag)}


def locate(head: str, tag_type: str, field: str, value: str) -> list[re.Match[str]]:
    found = []
    for m in TAG.finditer(head):
        tag = m.group()
        if not re.match(r"<" + tag_type + r"\b", tag, re.I):
            continue
        if attributes(tag).get(field, "").lower() == value.lower():
            found.append(m)
    return found


def replace_existing(head: str, tag_type: str, field: str, value: str,
                     replacement: str, *, allow_insert: bool) -> tuple[str, str]:
    matches = locate(head, tag_type, field, value)
    if len(matches) > 1:
        raise ValueError(f"Duplicate {field}={value}")
    if matches:
        m = matches[0]
        if m.group() == replacement:
            return head, "unchanged"
        return head[:m.start()] + replacement + head[m.end():], "replaced"
    if not allow_insert:
        return head, "absent"
    title = TITLE.search(head)
    if not title:
        raise ValueError("Cannot insert metadata without a title")
    return head[:title.end()] + "\n" + replacement + head[title.end():], "added"


def url_for(relative: str) -> str:
    if relative == "index.html":
        return SITE
    if relative.endswith("/index.html"):
        return SITE + relative[:-len("index.html")]
    return SITE + relative


def clean_title(head: str, relative: str) -> str:
    title = TITLE.search(head)
    if not title:
        raise ValueError("Missing HTML title")
    plain = html.unescape(re.sub(r"<[^>]+>", "", title.group(1)))
    plain = SPACE.sub(" ", plain).strip()
    # The CMS appends Antilogicalism and sometimes a pagination suffix.
    base = re.split(r"\s*\|\s*Antilogicalism\b", plain, maxsplit=1, flags=re.I)[0]
    return base or unquote(Path(relative).parent.name).replace("-", " ").title()


def describe(relative: str, title: str) -> str:
    parts = relative.split("/")
    if parts[0] == "tag" and len(parts) > 2:
        text = f"Browse Antilogicalism articles tagged {title}, with related posts and resources from the archive."
    elif parts[0] == "category" and len(parts) > 2:
        text = f"Explore Antilogicalism articles in the {title} category, part of its archive of ideas and resources."
    elif parts[0] == "author" and len(parts) > 2:
        text = f"Explore posts from the Antilogicalism archive: {title}."
    elif parts[0] == "recent-posts" or "/page/" in relative:
        text = f"Browse {title} in the Antilogicalism archive."
    elif parts[0] == "primary-sources":
        text = f"Explore {title} in the Antilogicalism Bookshelf of primary sources and historical works."
    elif re.match(r"^\d{4}/\d{2}/\d{2}/", relative):
        text = f"Read {title} in the Antilogicalism archive of essays, articles, and ideas."
    else:
        text = f"Explore {title} on Antilogicalism, a free archive of ideas and resources."
    page = re.search(r"(?:^|/)page/(\d+)/", relative)
    if page:
        text += f" Page {page.group(1)}."
    return text


def transform(original: str, relative: str) -> tuple[str, list[str]]:
    m = HEAD_CLOSE.search(original)
    if not m:
        raise ValueError("Missing </head>")
    head, tail = original[:m.start()], original[m.start():]
    if not TITLE.search(head):
        raise ValueError("Missing <title>")
    changes = []
    preferred = url_for(relative)

    can = locate(head, "link", "rel", "canonical")
    if len(can) > 1:
        raise ValueError("Multiple canonical links")
    if can:
        current = attributes(can[0].group()).get("href", "")
        resolved = urljoin(SITE, current)
        # Preserve explicit alternative canonicals, rather than forcing
        # every duplicate/alternate archive URL to self-canonicalize.
        if resolved != preferred:
            changes.append("canonical-kept-nonself")
        elif current != preferred:
            head, _ = replace_existing(head, "link", "rel", "canonical",
                                       f'<link rel="canonical" href="{html.escape(preferred, quote=True)}">',
                                       allow_insert=False)
            changes.append("canonical-absolute")
    else:
        head, _ = replace_existing(head, "link", "rel", "canonical",
                                   f'<link rel="canonical" href="{html.escape(preferred, quote=True)}">',
                                   allow_insert=True)
        changes.append("canonical-added")

    descriptions = locate(head, "meta", "name", "description")
    if len(descriptions) > 1:
        raise ValueError("Multiple descriptions")
    if not descriptions:
        description = html.escape(describe(relative, clean_title(head, relative)), quote=True)
        head, _ = replace_existing(head, "meta", "name", "description",
                                   f'<meta name="description" content="{description}">',
                                   allow_insert=True)
        changes.append("description-added")

    og = locate(head, "meta", "property", "og:url")
    if len(og) > 1:
        raise ValueError("Multiple og:url elements")
    if og:
        attrs = attributes(og[0].group())
        current = attrs.get("content", "")
        # Only rewrite an og:url if it points to this same GitHub Pages site.
        # Existing archive OG URLs sometimes point to the first archive page
        # even on pagination pages; make their page URL unambiguous.
        if current.startswith("/antilogicalism/") or current.startswith(SITE):
            if current != preferred:
                head, _ = replace_existing(head, "meta", "property", "og:url",
                                           f'<meta property="og:url" content="{html.escape(preferred, quote=True)}">',
                                           allow_insert=False)
                changes.append("og-url-absolute")
        else:
            changes.append("og-url-kept-external")

    result = head + tail
    if not result.endswith(tail) or result[result.index(tail):] != tail:
        raise ValueError("Body unexpectedly modified")
    return result, changes


def read_exact(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as f:
        return f.read()


def write_exact(path: Path, content: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        f.write(content)


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--apply", action="store_true", help="Update HTML files in place")
    group.add_argument("--check", action="store_true", help="Fail if any changes remain")
    args = parser.parse_args()
    counters: dict[str, int] = {}
    problems: list[str] = []
    scanned = changed = 0
    for path in sorted(ROOT.rglob("*.html")):
        relative = path.relative_to(ROOT).as_posix()
        if relative in EXCLUDED or Path(relative).name.startswith("google"):
            continue
        # Never change shipped HTML asset templates, if any are added later.
        if relative.startswith((".git/", "wp-content/", "node_modules/", ".github/")):
            continue
        scanned += 1
        try:
            original = read_exact(path)
            revised, operations = transform(original, relative)
            if revised == original:
                continue
            changed += 1
            for operation in operations:
                counters[operation] = counters.get(operation, 0) + 1
            if args.apply:
                write_exact(path, revised)
        except (UnicodeError, OSError, ValueError) as exc:
            problems.append(f"{relative}: {exc}")

    print(f"Scanned {scanned} HTML documents, {changed} {'changed' if args.apply else 'need changes'}.")
    for key, val in sorted(counters.items()):
        print(f"  {key}: {val}")
    for problem in problems[:50]:
        print(f"  SKIPPED {problem}")
    if problems:
        raise SystemExit(f"Stopped: {len(problems)} files require manual review.")
    if args.check and changed:
        raise SystemExit(f"Failed: {changed} files still need metadata normalization.")


if __name__ == "__main__":
    main()
