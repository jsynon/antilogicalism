
#!/usr/bin/env python3
"""Build a static search index for the Antilogicalism archive."""

from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote
import json
import re


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "search-index.json"
BASE_PATH = "/antilogicalism/"

WORD_RE = re.compile(r"[a-z0-9]+(?:['’][a-z0-9]+)?", re.IGNORECASE)

STOP_WORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am",
    "an", "and", "any", "are", "as", "at", "be", "because", "been",
    "before", "being", "below", "between", "both", "but", "by", "can",
    "could", "did", "do", "does", "doing", "down", "during", "each",
    "few", "for", "from", "further", "had", "has", "have", "having",
    "he", "her", "here", "hers", "herself", "him", "himself", "his",
    "how", "i", "if", "in", "into", "is", "it", "its", "itself",
    "just", "me", "more", "most", "my", "myself", "no", "nor", "not",
    "of", "off", "on", "once", "only", "or", "other", "our", "ours",
    "ourselves", "out", "over", "own", "same", "she", "should", "so",
    "some", "such", "than", "that", "the", "their", "theirs", "them",
    "themselves", "then", "there", "these", "they", "this", "those",
    "through", "to", "too", "under", "until", "up", "very", "was",
    "we", "were", "what", "when", "where", "which", "while", "who",
    "whom", "why", "will", "with", "would", "you", "your", "yours",
    "yourself", "yourselves",
}

SKIP_TAGS = {"script", "style", "noscript", "svg", "form"}
SKIP_CLASSES = {
    "sharedaddy",
    "robots-nocontent",
    "sd-sharing",
    "comments-area",
}


def normalize_text(value):
    """Collapse repeated whitespace into single spaces."""
    return " ".join(value.split())


def tokenize(text):
    """Return searchable words, excluding common stop words."""
    return [
        word.lower()
        for word in WORD_RE.findall(text)
        if word.lower() not in STOP_WORDS and len(word) > 1
    ]


def make_url(path):
    """Convert a local index.html path into its public archive URL."""
    relative_parts = path.relative_to(ROOT).parts[:-1]

    if not relative_parts:
        return BASE_PATH

    encoded_path = "/".join(quote(part) for part in relative_parts)
    return f"{BASE_PATH}{encoded_path}/"


def make_excerpt(body, limit=220):
    """Create a short, readable result excerpt."""
    body = normalize_text(body)

    if len(body) <= limit:
        return body

    excerpt = body[:limit].rsplit(" ", 1)[0].rstrip(" ,;:-")
    return excerpt + "…"


class ArticleParser(HTMLParser):
    """
    Extract article structure and text from a WordPress HTML page.

    A page is eligible for indexing only if it contains exactly one
    article, one entry-title, and one entry-content area. This excludes
    multi-post archive listings that would otherwise merge their titles.
    """

    VOID_TAGS = {
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)

        self.article_count = 0
        self.title_count = 0
        self.content_count = 0

        self.titles = []
        self.contents = []

        self.current_title = None
        self.title_depth = 0

        self.current_content = None
        self.content_depth = 0

        self.skip_stack = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set((attrs.get("class") or "").split())

        # Count article containers, including archive listing articles.
        if tag == "article":
            self.article_count += 1

        # If we're already skipping a subtree, track nested elements.
        if self.skip_stack:
            if tag not in self.VOID_TAGS:
                self.skip_stack.append(tag)
            self.stack.append(tag)
            return

        # Ignore scripts, styles, forms, sharing widgets, and comments.
        if (
            tag in SKIP_TAGS
            or classes.intersection(SKIP_CLASSES)
        ):
            self.skip_stack.append(tag)
            self.stack.append(tag)
            return

        # Begin capturing a title block.
        if (
            "entry-title" in classes
            and tag in {"h1", "h2", "h3"}
        ):
            self.title_count += 1
            self.current_title = []
            self.title_depth = 1

        elif self.current_title is not None and tag not in self.VOID_TAGS:
            self.title_depth += 1

        # Begin capturing the main article content.
        if "entry-content" in classes:
            self.content_count += 1
            self.current_content = []
            self.content_depth = 1

        elif self.current_content is not None and tag not in self.VOID_TAGS:
            self.content_depth += 1

        # Add spacing around block elements to avoid joining words.
        if (
            self.current_content is not None
            and tag in {
                "p", "br", "li", "h1", "h2", "h3", "h4",
                "h5", "h6", "blockquote", "div", "section",
            }
        ):
            self.current_content.append(" ")

        self.stack.append(tag)

    def handle_endtag(self, tag):
        # Close a skipped subtree without parsing its text.
        if self.skip_stack:
            if tag in self.skip_stack:
                while self.skip_stack:
                    popped = self.skip_stack.pop()
                    if popped == tag:
                        break

            if self.stack:
                self.stack.pop()
            return

        # Close title/content capture using the actual HTML nesting.
        if self.current_title is not None:
            if tag not in self.VOID_TAGS:
                self.title_depth -= 1

            if self.title_depth <= 0:
                title = normalize_text(" ".join(self.current_title))
                self.titles.append(title)
                self.current_title = None
                self.title_depth = 0

        if self.current_content is not None:
            if tag not in self.VOID_TAGS:
                self.content_depth -= 1

            if self.content_depth <= 0:
                content = normalize_text(" ".join(self.current_content))
                self.contents.append(content)
                self.current_content = None
                self.content_depth = 0

        if (
            self.current_content is not None
            and tag in {
                "p", "br", "li", "h1", "h2", "h3", "h4",
                "h5", "h6", "blockquote", "div", "section",
            }
        ):
            self.current_content.append(" ")

        if self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if self.skip_stack:
            return

        text = normalize_text(data)
        if not text:
            return

        if self.current_title is not None:
            self.current_title.append(text)

        if self.current_content is not None:
            self.current_content.append(text)

    def get_result(self):
        """Return title/body if the page has one unambiguous article."""
        if self.article_count != 1:
            return None

        if self.title_count != 1 or len(self.titles) != 1:
            return None

        if self.content_count != 1 or len(self.contents) != 1:
            return None

        title = self.titles[0]
        body = self.contents[0]

        if not title or len(body) < 40:
            return None

        return title, body


def is_excluded_path(path):
    """Exclude generated assets and common WordPress archive paths."""
    parts = path.relative_to(ROOT).parts[:-1]
    lowered = [part.lower() for part in parts]

    if any(part in {".git", "node_modules"} for part in lowered):
        return True

    if any(
        part in {"category", "tag", "author", "page"}
        for part in lowered
    ):
        return True

    if any(
        part.startswith(("cropped-", "featured-image-", "btn_donate"))
        for part in lowered
    ):
        return True

    # Exclude date archive landing pages such as /2016/05/05/.
    # Individual posts below that date have an additional slug segment.
    if (
        len(parts) in {1, 2, 3}
        and parts
        and re.fullmatch(r"\d{4}", parts[0])
    ):
        if all(re.fullmatch(r"\d{1,2}", part) for part in parts[1:]):
            return True

    return False


def main():
    files = sorted(ROOT.rglob("index.html"))

    documents = []
    postings = defaultdict(dict)

    excluded = 0
    invalid_structure = 0
    too_short = 0

    for path in files:
        if is_excluded_path(path):
            excluded += 1
            continue

        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            print(f"Could not read {path}: {exc}")
            excluded += 1
            continue

        # Keep the same theme/footer checks used by the existing indexer.
        if not all(marker in raw for marker in (
            "jetpack-search-filters-9",
            'id="rss-3"',
            'id="rss-11"',
        )):
            excluded += 1
            continue

        parser = ArticleParser()

        try:
            parser.feed(raw)
            parser.close()
        except Exception as exc:
            print(f"Could not parse {path}: {exc}")
            invalid_structure += 1
            continue

        result = parser.get_result()

        if result is None:
            # Multi-article archive pages and ambiguous layouts land here.
            invalid_structure += 1
            continue

        title, body = result

        if not title or len(body) < 40:
            too_short += 1
            continue

        doc_id = len(documents)

        documents.append({
            "title": title,
            "url": make_url(path),
            "excerpt": make_excerpt(body),
        })

        title_counts = Counter(tokenize(title))
        body_counts = Counter(tokenize(body))

        for term in title_counts.keys() | body_counts.keys():
            postings[term][doc_id] = [
                title_counts.get(term, 0),
                min(body_counts.get(term, 0), 12),
            ]

    terms = {
        term: [
            [doc_id, counts[0], counts[1]]
            for doc_id, counts in sorted(entries.items())
        ]
        for term, entries in postings.items()
    }

    index = {
        "version": 1,
        "basePath": BASE_PATH,
        "documents": documents,
        "terms": terms,
    }

    OUTPUT.write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    size_mb = OUTPUT.stat().st_size / (1024 * 1024)

    print(f"HTML files found: {len(files)}")
    print(f"Pages indexed: {len(documents)}")
    print(f"Pages excluded by path/theme checks: {excluded}")
    print(f"Pages skipped due to ambiguous article structure: {invalid_structure}")
    print(f"Pages too short or missing a title: {too_short}")
    print(f"Unique search terms: {len(terms):,}")
    print(f"Index size: {size_mb:.2f} MB")
    print(f"Created: {OUTPUT}")


if __name__ == "__main__":
    main()
