#!/usr/bin/env python3
"""Build annotated Bookshelf browse data from the archived category pages."""

from __future__ import annotations

import argparse
import html
import json
import re
import unicodedata
from html.parser import HTMLParser
from pathlib import Path


CATEGORIES = {
    "church-fathers": "The Early Church Fathers",
    "harvard-classics": "The Harvard Classics",
    "historical": "Historical",
    "literature": "Literature",
    "political-cultural": "Political & Cultural",
    "psychology": "Psychology",
    "religious": "Religious",
    "sacred-books-of-the-east": "Sacred Books of the East",
    "science": "Science",
}
DRIVE_RE = re.compile(r"https://drive\.google\.com/file/d/([^/?#]+)(?:/[^\s\"']*)?", re.I)
DRIVE_LINK_RE = re.compile(
    r"<a\b[^>]*href=[\"'](https://drive\.google\.com/file/d/[^\"']+)[\"'][^>]*>([\s\S]*?)</a>",
    re.I,
)
ALLOWED_TAGS = {"a", "b", "br", "cite", "em", "i", "q", "small", "strong", "sub", "sup"}

PAGE_CSS = r"""#bookshelf-browse-page{font-size:17px;line-height:1.65;color:#2b2c2d}
#bookshelf-browse-page *{box-sizing:border-box}
#bookshelf-browse-page a{color:#234d68;text-decoration:none}
#bookshelf-browse-page a:hover{color:#14374e;text-decoration:underline}
#bookshelf-browse-page a:focus-visible,#bookshelf-browse-page button:focus-visible,#bookshelf-browse-page select:focus-visible{outline:3px solid #b77a24;outline-offset:3px}
#bookshelf-browse-page .bookshelf-category-intro{margin:0 0 26px;font-size:18px;line-height:1.7}
#bookshelf-browse-page .bookshelf-category-intro:empty{display:none}
#bookshelf-browse-page #bookshelf-browse{padding-top:25px;border-top:2px solid #ddd9d0}
#bookshelf-browse-page #bookshelf-browse h2{margin:0 0 8px;padding:0;text-align:left;font-size:27px;line-height:1.3;font-style:normal;font-weight:600;color:#292f32}
#bookshelf-browse-page .bookshelf-browse-note{margin:0 0 20px;font-size:16px}
#bookshelf-browse-page .bookshelf-controls{display:grid;grid-template-columns:1.3fr .7fr;gap:12px;margin:0 0 22px;padding:16px;background:#f7f5ef;border:1px solid #e1ddd3;border-radius:5px}
#bookshelf-browse-page .bookshelf-controls label{display:flex;flex-direction:column;gap:6px;font-size:15px;font-weight:700;color:#42484a}
#bookshelf-browse-page .bookshelf-controls select{width:100%;min-height:44px;padding:8px 11px;border:1px solid #cfcac0;border-radius:4px;background:#fff;color:#262a2c;font:inherit;font-size:16px}
#bookshelf-browse-page .bookshelf-results{display:grid;gap:14px}
#bookshelf-browse-page .bookshelf-result{padding:19px 20px;border:1px solid #e1ddd4;border-radius:5px;background:#fff}
#bookshelf-browse-page .bookshelf-result h3{margin:0 0 10px;font-size:23px;line-height:1.3;font-style:normal;text-align:left;font-weight:600;color:#263d4a}
#bookshelf-browse-page .bookshelf-work-group+.bookshelf-work-group{margin-top:16px;padding-top:14px;border-top:1px solid #e6e2d9}
#bookshelf-browse-page .bookshelf-book-links{list-style:none!important;margin:0!important;padding:0!important}
#bookshelf-browse-page .bookshelf-book-links li{margin:0!important;padding:0!important}
#bookshelf-browse-page .bookshelf-book-links a{display:block;padding:7px 0;font-size:17px;line-height:1.45;font-weight:600}
#bookshelf-browse-page .bookshelf-descriptions{margin-top:5px}
#bookshelf-browse-page .bookshelf-descriptions p{margin:0 0 10px;font-size:16px;line-height:1.7}
#bookshelf-browse-page .bookshelf-descriptions p:last-child{margin-bottom:0}
#bookshelf-browse-page .bookshelf-byline,#bookshelf-browse-page .bookshelf-series{margin:0 0 6px;font-size:15px;color:#555}
#bookshelf-browse-page .bookshelf-series{font-style:italic}
#bookshelf-browse-page .bookshelf-pagination{display:flex;align-items:center;justify-content:center;gap:16px;margin:20px 0 0}
#bookshelf-browse-page .bookshelf-pagination button{min-width:92px;padding:9px 14px;border:1px solid #cfcac0;border-radius:4px;background:#f7f5ef;color:#2d3c45;font:inherit;font-size:15px;font-weight:600;cursor:pointer}
#bookshelf-browse-page .bookshelf-pagination button:hover:not(:disabled){background:#ece9e1}
#bookshelf-browse-page .bookshelf-pagination button:disabled{opacity:.45;cursor:default}
#bookshelf-browse-page .bookshelf-page-label{font-size:14px;color:#555}
#bookshelf-browse-page .bookshelf-empty{padding:18px;border:1px solid #e1ddd4;border-radius:5px;background:#faf9f6}
#bookshelf-browse-page .bookshelf-extras{margin-top:30px;padding-top:22px;border-top:1px solid #ddd9d0}
#bookshelf-browse-page .bookshelf-extras h2{margin:0 0 14px;font-size:22px}
#bookshelf-browse-page .bookshelf-resource{padding:14px 0;border-bottom:1px solid #e6e2d9}
#bookshelf-browse-page .bookshelf-resource h3{font-size:18px}
#bookshelf-browse-page .bookshelf-extra-notes p{font-size:15px;line-height:1.65}
@media(max-width:650px){#bookshelf-browse-page .bookshelf-controls{grid-template-columns:1fr}#bookshelf-browse-page .bookshelf-pagination{gap:8px;flex-wrap:wrap}}"""


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
        if tag in ALLOWED_TAGS and tag not in {"br"}:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        self.parts.append(html.escape(data, quote=False))


def safe(fragment: str) -> str:
    parser = SafeInlineHTML()
    parser.feed(fragment)
    return "".join(parser.parts)


def plain(fragment: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]*>", " ", fragment)).split())


def norm(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    return "".join(c for c in value if not unicodedata.combining(c)).casefold()


def surname(author: str) -> str:
    if not author or author == "Anonymous":
        return ""
    words = author.replace("&", " ").split()
    return words[-1].strip(".,;:") if words else author


def infer_author(title: str, descriptions: list[str]) -> str:
    match = re.search(r"\bby\s+(.+)$", title, re.I)
    if match:
        return match.group(1).strip(" .–—")
    for text in descriptions:
        match = re.match(r"([A-Z][^.!?]{2,90}?)\s+(?:\([^)]{2,40}\)\s*)?(?:was|is|wrote|served|became)\b", plain(text))
        if match:
            candidate = match.group(1).strip(" ,;:")
            if not candidate.lower().startswith(("the ", "in ", "this ", "a ")):
                return candidate
    return "Anonymous"


def drive_id(url: str) -> str:
    match = DRIVE_RE.search(url)
    return match.group(1) if match else ""


def linked_titles(fragment: str) -> list[dict]:
    candidates: list[tuple[int, dict]] = []
    anchor_re = r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)</a>"
    for match in re.finditer(anchor_re, fragment, re.I):
        url, title_markup = match.group(1), match.group(2)
        title = plain(title_markup)
        if title and drive_id(url):
            candidates.append((match.start(), {"title": title, "url": url, "driveId": drive_id(url)}))
    for paragraph in re.finditer(r"<p\b[^>]*>[\s\S]*?</p>", fragment, re.I):
        anchors = list(re.finditer(anchor_re, paragraph.group(0), re.I))
        if len(anchors) != 1:
            continue
        anchor = anchors[0]
        url, title_markup = anchor.group(1), anchor.group(2)
        title = plain(title_markup)
        if not title or drive_id(url) or plain(paragraph.group(0)) != title:
            continue
        if not url.startswith(("https://", "http://", "/antilogicalism/")):
            continue
        candidates.append((paragraph.start() + anchor.start(), {"title": title, "url": url, "driveId": ""}))
    candidates.sort(key=lambda pair: pair[0])
    return [item for _, item in candidates]


def is_standalone_link_paragraph(paragraph: str) -> bool:
    anchors = list(re.finditer(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)</a>", paragraph, re.I))
    return len(anchors) == 1 and plain(paragraph) == plain(anchors[0].group(2))


def entry_content(source: str) -> str:
    start = source.find('<div class="entry-content">')
    if start < 0:
        raise ValueError("Could not find .entry-content")
    ends = [pos for pos in (source.find('<div class="sharedaddy', start), source.find("</div><!-- .entry-content -->", start)) if pos >= 0]
    return source[start : min(ends) if ends else len(source)]


def page_intro(body: str) -> str:
    first_link = re.search(r"<a\b[^>]*href=[\"']https://drive\.google\.com/file/d/", body, re.I)
    if not first_link:
        return ""
    before = body[: first_link.start()]
    paragraphs = re.findall(r"<p\b[^>]*>([\s\S]*?)</p>", before, re.I)
    meaningful = [safe(p) for p in paragraphs if plain(p) and not re.search(r"<img\b", p, re.I)]
    return "".join(f"<p>{p}</p>" for p in meaningful[:3])


def descriptions_in(fragment: str, skip_before: int = 0) -> list[str]:
    descriptions: list[str] = []
    for match in re.finditer(r"<p\b[^>]*>([\s\S]*?)</p>", fragment, re.I):
        if match.start() < skip_before:
            continue
        paragraph = match.group(1)
        if is_standalone_link_paragraph(paragraph) or not plain(paragraph):
            continue
        descriptions.append(safe(paragraph))
    # Some collection pages use lists to enumerate the contents of a volume.
    for match in re.finditer(r"<ul\b[^>]*>([\s\S]*?)</ul>", fragment, re.I):
        if match.start() < skip_before or re.search(r"<a\b[^>]*href=[\"']https://drive\.google\.com/file/d/", match.group(1), re.I):
            continue
        items = [plain(item) for item in re.findall(r"<li\b[^>]*>([\s\S]*?)</li>", match.group(1), re.I)]
        items = [item for item in items if item]
        if items:
            descriptions.append("Contents: " + "; ".join(items))
    return descriptions


def source_section(fragment: str) -> str:
    headings = re.findall(r"<h[2-6]\b[^>]*>([\s\S]*?)</h[2-6]>", fragment, re.I)
    headings = [plain(h) for h in headings if plain(h) and not DRIVE_LINK_RE.search(h)]
    return headings[-1] if headings else ""


def extract_hr_groups(body: str, global_first_link: int) -> list[tuple[list[dict], list[str], str]]:
    blocks = re.split(r"<hr\b[^>]*>", body, flags=re.I)
    groups: list[tuple[list[dict], list[str], str]] = []
    offset = 0
    for block in blocks:
        books = linked_titles(block)
        if books:
            skip = max(0, global_first_link - offset)
            descriptions = descriptions_in(block, skip_before=skip if offset <= global_first_link else 0)
            groups.append((books, descriptions, source_section(block)))
        offset += len(block) + 4
    return groups


def extract_paragraph_groups(body: str) -> list[tuple[list[dict], list[str], str]]:
    """Handle the Church Fathers page, which groups entries by linked paragraphs."""
    tokens = list(re.finditer(r"<h[2-6]\b[^>]*>[\s\S]*?</h[2-6]>|<p\b[^>]*>[\s\S]*?</p>", body, re.I))
    groups: list[tuple[list[dict], list[str], str]] = []
    current: tuple[list[dict], list[str], str] | None = None
    active_section = ""
    for match in tokens:
        paragraph = match.group(0)
        if re.match(r"<h[2-6]\b", paragraph, re.I):
            if not DRIVE_LINK_RE.search(paragraph):
                active_section = plain(paragraph)
            continue
        links = DRIVE_LINK_RE.findall(paragraph)
        if links:
            if current:
                groups.append(current)
            books = []
            for url, title_markup in links:
                title = plain(title_markup)
                if title and drive_id(url):
                    books.append({"title": title, "url": url, "driveId": drive_id(url)})
            current = (books, [], active_section) if books else None
        elif current and plain(paragraph) and not is_standalone_link_paragraph(paragraph):
            current[1].append(safe(re.sub(r"^<p\b[^>]*>|</p>$", "", paragraph, flags=re.I)))
    if current:
        groups.append(current)
    return groups


def read_metadata(catalog: Path | None) -> dict[str, dict]:
    if not catalog or not catalog.exists():
        return {}
    records = {}
    for book in json.loads(catalog.read_text(encoding="utf-8")).get("books", []):
        match = DRIVE_RE.search(book.get("url", ""))
        if match:
            records[match.group(1)] = book
    return records


def build_one(root: Path, slug: str, label: str, metadata: dict[str, dict]) -> dict:
    source = root / "primary-sources" / slug / "_source-pages" / "index.html"
    if not source.exists():
        source = root / "primary-sources" / slug / "index.html"
    if not source.exists():
        raise FileNotFoundError(source)
    body = entry_content(source.read_text(encoding="utf-8"))
    intro = page_intro(body)
    first = re.search(r"<a\b[^>]*href=[\"']https://drive\.google\.com/file/d/", body, re.I)
    first_offset = first.start() if first else len(body)
    if re.search(r"<hr\b", body, re.I):
        blocks = extract_hr_groups(body, first_offset)
    else:
        blocks = extract_paragraph_groups(body)

    entries = []
    resources = []
    for order, (books, descriptions, section) in enumerate(blocks):
        for book in books:
            info = metadata.get(book["driveId"], {})
            book["author"] = info.get("author") or ""
            book["sortSurname"] = info.get("sortSurname") or ""
            book["authorGroup"] = info.get("authorGroup") or ""
            book["collection"] = info.get("collection") or ""
            book["collectionOrder"] = info.get("collectionOrder", 999)
            book["collectionVolume"] = info.get("collectionVolume")
        authors = list(dict.fromkeys(book["author"] for book in books if book["author"]))
        author = " & ".join(authors) if authors else infer_author(books[0]["title"], descriptions)
        if not authors:
            for book in books:
                book["author"] = author
                book["sortSurname"] = surname(author)
                book["authorGroup"] = "anonymous" if author == "Anonymous" else "author"
        internal_books = [book for book in books if book["driveId"] or book["url"].startswith("/antilogicalism/")]
        external_resources = [book for book in books if book not in internal_books]
        for book in external_resources:
            resources.append({"title": book["title"], "url": book["url"], "section": section, "descriptions": descriptions})
        if not internal_books:
            continue
        books = internal_books
        sort_name = next((book["sortSurname"] for book in books if book["sortSurname"]), surname(author))
        collection_title = next((book["collection"] for book in books if book["collection"]), "")
        if slug in {"harvard-classics", "sacred-books-of-the-east"}:
            collection_title = label
        if not collection_title and any(re.search(r"\b(?:complete works|collected (?:works|papers)|selected works)\b", b["title"], re.I) for b in books):
            collection_title = books[0]["title"]
        is_anonymous = author == "Anonymous" or any(book["authorGroup"] == "anonymous" for book in books)
        is_collection = bool(collection_title) or any(book["authorGroup"] == "collective" for book in books)
        kind = "collection" if is_collection else ("anonymous" if is_anonymous else "author")
        entries.append({
            "id": f"{slug}-{order + 1}",
            "sourceOrder": order,
            "kind": kind,
            "author": author,
            "sortSurname": sort_name,
            "collectionTitle": collection_title,
            "section": section,
            "books": books,
            "descriptions": descriptions,
        })
    title_match = re.search(r'<h1[^>]*class=["\']entry-title["\'][^>]*>([\s\S]*?)</h1>', source.read_text(encoding="utf-8"), re.I)
    page_title = plain(title_match.group(1)) if title_match else f"Primary Sources – {label}"
    notes = []
    for paragraph in re.findall(r"<p\b[^>]*>([\s\S]*?)</p>", body, re.I):
        if plain(paragraph).casefold().startswith("note:"):
            notes.append(safe(paragraph))
    recorded_links = {(book["title"], book["url"]) for entry in entries for book in entry["books"]}
    recorded_links.update((resource["title"], resource["url"]) for resource in resources)
    for paragraph in re.findall(r"<p\b[^>]*>[\s\S]*?</p>", body, re.I):
        if not is_standalone_link_paragraph(paragraph):
            continue
        anchor = re.search(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)</a>", paragraph, re.I)
        if not anchor:
            continue
        url, title = anchor.group(1), plain(anchor.group(2))
        if drive_id(url) or (title, url) in recorded_links:
            continue
        resources.append({"title": title, "url": url, "section": "", "descriptions": []})
        recorded_links.add((title, url))
    return {"title": label, "pageTitle": page_title, "introHtml": intro, "entries": entries, "resources": resources, "notes": notes}


def build(root: Path, catalog: Path | None, categories: dict[str, str] = CATEGORIES) -> dict[str, dict]:
    metadata = read_metadata(catalog)
    return {slug: build_one(root, slug, label, metadata) for slug, label in categories.items()}


def render_page(root: Path, slug: str, data: dict) -> None:
    folder = root / "primary-sources" / slug
    source_path = folder / "_source-pages" / "index.html"
    source = source_path.read_text(encoding="utf-8")
    start = source.find('<div class="entry-content">')
    share = source.find('<div class="sharedaddy', start)
    if start < 0:
        raise ValueError(f"Could not locate .entry-content in {source_path}")
    if share < 0:
        share = source.find("</div><!-- .entry-content -->", start)
    if share < 0:
        raise ValueError(f"Could not locate the end of .entry-content in {source_path}")
    label = html.escape(data["title"])
    markup = f'''<div class="entry-content">
<div id="bookshelf-browse-page">
  <div class="bookshelf-category-intro" aria-label="About this collection"></div>
  <section id="bookshelf-browse" aria-labelledby="bookshelf-browse-heading">
    <h2 id="bookshelf-browse-heading">Browse {label}</h2>
    <p class="bookshelf-browse-note">Browse the annotated books by author, anonymous title, or collection. Each title keeps its description and PDF link.</p>
    <div class="bookshelf-controls">
      <label for="bookshelf-browse-mode">Browse by
        <select id="bookshelf-browse-mode">
          <option value="author">Author, A–Z</option>
          <option value="anonymous">Anonymous title</option>
          <option value="collection">Collections</option>
        </select>
      </label>
      <label class="bookshelf-initial-field" for="bookshelf-author-initial">Author initial
        <select id="bookshelf-author-initial"><option value="all">All authors</option></select>
      </label>
    </div>
    <div class="bookshelf-results" aria-live="polite" aria-busy="true"><p>Loading the collection…</p></div>
    <nav class="bookshelf-pagination" aria-label="Browse pages">
      <button class="bookshelf-previous" type="button" disabled>Previous</button>
      <span class="bookshelf-page-label">Loading…</span>
      <button class="bookshelf-next" type="button" disabled>Next</button>
    </nav>
  </section>
  <section class="bookshelf-extras" hidden aria-label="Additional resources and notes">
    <h2>Additional resources and notes</h2>
    <div class="bookshelf-extra-resources"></div>
    <div class="bookshelf-extra-notes"></div>
  </section>
</div>
'''
    page = source[:start] + markup + source[share:]
    style_tag = f'<style id="bookshelf-browse-styles">\n{PAGE_CSS}\n</style>\n'
    page = page.replace("</head>", style_tag + "</head>", 1)
    script_tag = '<script src="/antilogicalism/primary-sources/bookshelf-browse.js" defer></script>\n'
    page = page.replace("</body>", script_tag + "</body>", 1)
    (folder / "index.html").write_text(page, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="Website root")
    parser.add_argument("--catalog", type=Path, help="Library metadata JSON")
    args = parser.parse_args()
    root = args.root.resolve()
    for slug, data in build(root, args.catalog).items():
        out = root / "primary-sources" / slug / "bookshelf-browse-data.json"
        out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        render_page(root, slug, data)
        pdfs = sum(bool(book["driveId"]) for entry in data["entries"] for book in entry["books"])
        print(f"Wrote {out} ({len(data['entries'])} entries, {pdfs} PDF links, {len(data['resources'])} related resources)")


if __name__ == "__main__":
    main()
