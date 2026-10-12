#!/usr/bin/env python3
"""Read-only audit of local HTML links in a static website archive."""
from __future__ import annotations

import argparse
import csv
from collections import defaultdict, deque
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urldefrag, urljoin, urlsplit

BASE_PATH = "/antilogicalism"
INTERNAL_HOSTS = {"jsynon.github.io", "antilogicalism.com", "www.antilogicalism.com", "antilogicalism.test", "localhost", "127.0.0.1"}
SKIP_DIRS = {".git", "node_modules", "_publication-staging", "archive-audit-report"}


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: set[str] = set()
        self.references: list[str] = []
        self.base_href: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value for key, value in attrs if key}
        if values.get("id"):
            self.ids.add(values["id"] or "")
        if tag.lower() == "a" and values.get("name"):
            self.ids.add(values["name"] or "")
        if tag.lower() == "base" and values.get("href") and self.base_href is None:
            self.base_href = values["href"]
        for key in ("href", "src"):
            value = values.get(key)
            if value:
                self.references.append(value.strip())


def parse_page(path: Path) -> PageParser:
    parser = PageParser()
    try:
        parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        pass
    return parser


def inside_known_host(url: str) -> bool:
    parts = urlsplit(url)
    return not parts.netloc or parts.hostname is None or parts.hostname.lower() in INTERNAL_HOSTS


def to_site_url(root: Path, page: Path, reference: str, base_href: str | None) -> str | None:
    ref = urlsplit(reference)
    if ref.scheme.lower() in {"mailto", "tel", "javascript", "data", "blob", "sms"}:
        return None
    rel_page = page.relative_to(root).as_posix()
    page_url = "https://jsynon.github.io" + BASE_PATH + "/" + rel_page
    resolved_base = urljoin(page_url, base_href) if base_href else page_url
    absolute = urljoin(resolved_base, reference)
    parts = urlsplit(absolute)
    if parts.scheme.lower() not in {"http", "https"} or not inside_known_host(absolute):
        return None
    return absolute


def local_target(root: Path, site_url: str) -> tuple[Path, str]:
    parts = urlsplit(site_url)
    url_path = unquote(parts.path)
    prefix = BASE_PATH.rstrip("/")
    if url_path == prefix:
        url_path = "/"
    elif url_path.startswith(prefix + "/"):
        url_path = url_path[len(prefix):]
    rel = url_path.lstrip("/")
    candidate = (root / rel).resolve()
    root_resolved = root.resolve()
    try:
        candidate.relative_to(root_resolved)
    except ValueError:
        return root / "__outside_archive__", parts.fragment
    if candidate.is_dir() or url_path.endswith("/") or (not candidate.exists() and not candidate.suffix):
        candidate = candidate / "index.html"
    return candidate, parts.fragment


def write_csv(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("root", nargs="?", default=".", help="website repository root (default: current directory)")
    cli.add_argument("--output", help="report directory (default: sibling <folder>-archive-audit)")
    args = cli.parse_args()

    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        cli.error(f"website root is not a directory: {root}")
    output = Path(args.output).expanduser().resolve() if args.output else root.parent / f"{root.name}-archive-audit"
    output.mkdir(parents=True, exist_ok=True)

    pages = sorted(p for p in root.rglob("*.html") if not any(part in SKIP_DIRS for part in p.relative_to(root).parts))
    parsed = {page: parse_page(page) for page in pages}
    graph: dict[Path, set[Path]] = defaultdict(set)
    inbound: dict[Path, set[Path]] = defaultdict(set)
    broken: list[dict[str, str]] = []

    for page, document in parsed.items():
        for reference in document.references:
            site_url = to_site_url(root, page, reference, document.base_href)
            if site_url is None:
                continue
            target, fragment = local_target(root, site_url)
            if not target.is_file():
                broken.append({"source_page": page.relative_to(root).as_posix(), "reference": reference,
                               "resolved_target": str(target), "fragment": fragment, "issue": "missing_file"})
                continue
            target_resolved = target.resolve()
            if target.suffix.lower() == ".html" and target_resolved in parsed:
                graph[page].add(target_resolved)
                if target_resolved != page:
                    inbound[target_resolved].add(page)
                if fragment:
                    fragment = unquote(fragment)
                    if fragment not in parsed[target_resolved].ids:
                        broken.append({"source_page": page.relative_to(root).as_posix(), "reference": reference,
                                       "resolved_target": target.relative_to(root).as_posix(), "fragment": fragment,
                                       "issue": "missing_fragment"})

    home = (root / "index.html").resolve()
    reachable: set[Path] = set()
    if home in parsed:
        queue = deque([home])
        while queue:
            page = queue.popleft()
            if page in reachable:
                continue
            reachable.add(page)
            queue.extend(graph.get(page, set()) - reachable)

    orphan_rows = [{"page": p.relative_to(root).as_posix()} for p in pages if p.resolve() != home and not inbound.get(p.resolve())]
    unreachable_rows = [{"page": p.relative_to(root).as_posix()} for p in pages if p.resolve() not in reachable]
    write_csv(output / "broken-links.csv", ["source_page", "reference", "resolved_target", "fragment", "issue"], broken)
    write_csv(output / "orphan-pages.csv", ["page"], orphan_rows)
    write_csv(output / "unreachable-pages.csv", ["page"], unreachable_rows)

    print(f"HTML pages scanned: {len(pages)}")
    print(f"Broken local file or fragment references: {len(broken)}")
    print(f"Pages with no incoming HTML links: {len(orphan_rows)}")
    print(f"Pages not reachable from index.html: {len(unreachable_rows)}")
    print(f"Reports: {output}")
    print("No website files were changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
