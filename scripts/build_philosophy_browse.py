#!/usr/bin/env python3
"""Build the Philosophy browse catalog from its three existing annotated pages."""

from __future__ import annotations

import argparse
import html
import json
import re
import unicodedata
from html.parser import HTMLParser
from pathlib import Path


PERIODS = [
    ("ancient-medieval", "Ancient & Medieval"),
    ("modern", "Modern Period"),
    ("20th-century-present", "~20th Century"),
]
COLLECTION_RE = re.compile(
    r"\b(?:complete works|collected (?:works|papers)|selected writings|selected works)\b",
    re.I,
)
DRIVE_RE = re.compile(
    r"https://drive\.google\.com/file/d/([^/?#]+)(?:/[^\s\"']*)?",
    re.I,
)
ALLOWED_TAGS = {"a", "b", "br", "cite", "em", "i", "q", "small", "strong", "sub", "sup"}


class SafeInlineHTML(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in ALLOWED_TAGS:
            return
        if tag == "a":
            href = dict(attrs).get("href") or ""
            if href.startswith(("https://", "http://")):
                self.parts.append(f'<a href="{html.escape(href, quote=True)}" rel="noopener noreferrer">')
            return
        self.parts.append(f"<{tag}>")

    def handle_endtag(self, tag: str) -> None:
        if tag in ALLOWED_TAGS and tag != "br":
            self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        self.parts.append(html.escape(data, quote=False))


def sanitized_fragment(fragment: str) -> str:
    parser = SafeInlineHTML()
    parser.feed(fragment)
    return "".join(parser.parts)


def plain_text(fragment: str) -> str:
    text = re.sub(r"<[^>]*>", " ", fragment)
    return " ".join(html.unescape(text).split())


def normalized_key(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in value if not unicodedata.combining(ch)).casefold()


def infer_author(titles: list[str], descriptions: list[str]) -> str:
    for title in titles:
        match = re.search(r"\bby\s+(.+)$", title, re.I)
        if match:
            return match.group(1).strip(" .–—")
        match = re.search(
            r"\b(?:complete works|collected (?:philosophical )?papers|selected writings) of\s+(.+?)(?:,\s+Volume\b|$)",
            title,
            re.I,
        )
        if match:
            return match.group(1).strip(" .–—")
    for description in descriptions:
        text = plain_text(description)
        match = re.match(r"([A-Z][^.!?]{2,90}?)\s+(?:\([^)]{2,40}\)\s*)?(?:was|is|wrote|served|became)\b", text)
        if match:
            candidate = match.group(1).strip(" ,;:")
            if candidate.lower().startswith(("the ", "in ", "this ", "a ")):
                continue
            return candidate
    return "Anonymous"


def surname(author: str) -> str:
    if author == "Anonymous":
        return ""
    bits = author.replace("&", " ").split()
    return bits[-1].strip(".,;:") if bits else author


def load_metadata(catalog_path: Path | None, existing_path: Path) -> dict[str, dict]:
    records: dict[str, dict] = {}
    if catalog_path and catalog_path.exists():
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        for book in catalog.get("books", []):
            match = re.search(r"/d/([^/]+)/", book.get("url", ""))
            if match:
                records[match.group(1)] = book
    if existing_path.exists():
        previous = json.loads(existing_path.read_text(encoding="utf-8"))
        for entry in previous.get("entries", []):
            for book in entry.get("books", []):
                if book.get("driveId"):
                    records.setdefault(book["driveId"], book)
    return records


def extract_blocks(source_html: str) -> list[tuple[list[dict], list[str]]]:
    start = source_html.find('<div class="entry-content">')
    end = source_html.find('<div class="sharedaddy', start)
    if start < 0:
        raise ValueError("Could not find .entry-content")
    body = source_html[start : end if end >= 0 else len(source_html)]
    output: list[tuple[list[dict], list[str]]] = []
    for block in re.split(r"<hr\b[^>]*>", body, flags=re.I):
        books: list[dict] = []
        descriptions: list[str] = []
        for paragraph in re.findall(r"<p\b[^>]*>([\s\S]*?)</p>", block, flags=re.I):
            found = re.findall(
                r"<a\b[^>]*href=[\"'](https://drive\.google\.com/file/d/[^\"']+)[\"'][^>]*>([\s\S]*?)</a>",
                paragraph,
                flags=re.I,
            )
            if found:
                for url, title_markup in found:
                    title = plain_text(title_markup)
                    drive_match = DRIVE_RE.search(url)
                    if title and drive_match:
                        books.append({"title": title, "url": url, "driveId": drive_match.group(1)})
            elif plain_text(paragraph):
                descriptions.append(sanitized_fragment(paragraph))
        if books:
            output.append((books, descriptions))
    return output


def build(root: Path, catalog_path: Path | None) -> dict:
    philosophy = root / "primary-sources" / "philosophy"
    output_path = philosophy / "philosophy-browse-data.json"
    metadata = load_metadata(catalog_path, output_path)
    entries: list[dict] = []
    for period, label in PERIODS:
        source = philosophy / period / "index.html"
        if not source.exists():
            raise FileNotFoundError(f"Missing source page: {source}")
        blocks = extract_blocks(source.read_text(encoding="utf-8"))
        for order, (books, descriptions) in enumerate(blocks):
            for book in books:
                info = metadata.get(book["driveId"], {})
                book["author"] = info.get("author") or ""
                book["sortSurname"] = info.get("sortSurname") or ""
                book["authorGroup"] = info.get("authorGroup") or ""
                book["collection"] = info.get("collection") or ""
            authors = list(dict.fromkeys(book["author"] for book in books if book["author"]))
            display_author = " & ".join(authors) if authors else infer_author(
                [book["title"] for book in books], descriptions
            )
            if not authors:
                for book in books:
                    book["author"] = display_author
                    book["sortSurname"] = surname(display_author)
                    book["authorGroup"] = "anonymous" if display_author == "Anonymous" else "author"
            sort_surname = next((book["sortSurname"] for book in books if book["sortSurname"]), "")
            if not sort_surname:
                sort_surname = surname(display_author)
            collective = any(
                book["authorGroup"] == "collective" or book["collection"]
                for book in books
            )
            collection_title = next(
                (book["title"] for book in books if COLLECTION_RE.search(book["title"])), ""
            )
            kind = "collection" if collective or collection_title else (
                "anonymous"
                if display_author == "Anonymous" or any(book["authorGroup"] == "anonymous" for book in books)
                else "author"
            )
            entries.append(
                {
                    "id": f"{period}-{order + 1}",
                    "period": period,
                    "periodLabel": label,
                    "sourceOrder": order,
                    "kind": kind,
                    "author": display_author,
                    "sortSurname": sort_surname,
                    "collectionTitle": collection_title,
                    "books": books,
                    "descriptions": descriptions,
                }
            )
    return {
        "title": "Philosophy",
        "periods": [{"id": key, "label": label} for key, label in PERIODS],
        "entries": entries,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="Website root")
    parser.add_argument("--catalog", type=Path, help="Optional existing author metadata catalog")
    args = parser.parse_args()
    root = args.root.resolve()
    output_path = root / "primary-sources" / "philosophy" / "philosophy-browse-data.json"
    data = build(root, args.catalog)
    output_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    total_books = sum(len(entry["books"]) for entry in data["entries"])
    print(f"Wrote {output_path} ({len(data['entries'])} entries, {total_books} linked PDFs)")


if __name__ == "__main__":
    main()
