#!/usr/bin/env python3
"""Read-only structural crawl of Antilogicalism's generated HTML.

Audits links as written in the HTML source, not JavaScript-rendered links.
Runs locally against a repository checkout; never alters site pages.
"""
from __future__ import annotations

from collections import Counter, defaultdict, deque
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote, urlunsplit
import json
import posixpath
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "/antilogicalism/"
ORIGIN = "https://jsynon.github.io"
OLD_HOSTS = {"antilogicalism.com", "www.antilogicalism.com"}
EXCLUDED = {".git", "node_modules", ".venv"}
ARTICLE = re.compile(r"^20\d{2}/\d{2}/\d{2}/[^/]+/index\.html$")
NAV = ["index.html", "index/index.html", "primary-sources/index.html",
       "my-writings/index.html", "links/index.html",
       "digital-library/index.html", "reading-companion/index.html"]
class Reader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.canonicals = []
        self.noindex = False
    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == "a" and data.get("href"):
            self.links.append(data["href"])
        elif tag == "link" and "canonical" in (data.get("rel") or "").lower().split():
            self.canonicals.append(data.get("href", ""))
        elif tag == "meta" and data.get("name", "").lower() in ("robots", "googlebot"):
            if re.search(r"\bnoindex\b", data.get("content", ""), re.I):
                self.noindex = True

def as_local(href, source):
    """Return (kind, target) for an <a href>. target is repository-relative."""
    raw = href.strip()
    if not raw or raw.startswith("#"):
        return "fragment", None
    try:
        sp = urlsplit(raw)
    except ValueError:
        return "invalid", raw
    if sp.scheme and sp.scheme.lower() not in ("http", "https"):
        return "other_scheme", None
    if sp.netloc:
        host = (sp.hostname or "").lower()
        if host in OLD_HOSTS:
            return "old_domain", href
        if host != "jsynon.github.io":
            return "external", None
        urlpath = sp.path
    else:
        urlpath = sp.path
    # External protocol-relative URL or URLs to other paths on shared host.
    if urlpath.startswith("/"):
        if urlpath == "/antilogicalism":
            rel = ""
        elif urlpath.startswith(PREFIX):
            rel = urlpath[len(PREFIX):]
        else:
            return "outside_project", href
    else:
        # Resolve relative to current document's URL directory.
        urlpath = unquote(urlpath)
        rel = posixpath.join(posixpath.dirname(source), urlpath) if urlpath else source
        if urlpath and source.endswith("index.html"):
            # Browser's current URL is /folder/, not /folder/index.html.
            base = posixpath.dirname(source)
            rel = posixpath.join(base, urlpath)
    rel = unquote(rel)
    rel = posixpath.normpath(rel)
    if rel in (".", ""):
        rel = "index.html"
    if rel.startswith("../") or rel == "..":
        return "outside_project", href
    ext = posixpath.splitext(rel)[1].lower()
    if rel.endswith("/") or not ext:
        rel = rel.rstrip("/") + "/index.html" if rel != "index.html" else rel
    return "local", rel

def canonical_target(url):
    sp = urlsplit(url)
    if sp.scheme != "https" or sp.netloc != "jsynon.github.io":
        return None
    return as_local(url, "index.html")[1]

def read_sitemap(name):
    path = ROOT / name
    if not path.exists():
        return set()
    tree = ET.parse(path)
    out = set()
    for element in tree.getroot().iter():
        if element.tag.endswith("}loc") or element.tag == "loc":
            kind, target = as_local(element.text or "", "index.html")
            if kind == "local":
                out.add(target)
    return out

def main():
    html_paths = sorted(
        x for x in ROOT.rglob("*.html")
        if not any(c in EXCLUDED for c in x.relative_to(ROOT).parts)
    )
    html = {x.relative_to(ROOT).as_posix() for x in html_paths}
    reader = {}
    parse_errors = []
    for path in html_paths:
        rel = path.relative_to(ROOT).as_posix()
        p = Reader()
        try:
            p.feed(path.read_text(encoding="utf-8", errors="replace"))
            p.close()
        except Exception as exc:
            parse_errors.append([rel, str(exc)])
        reader[rel] = p
    graph = {}
    broken = defaultdict(set)
    external_old = defaultdict(set)
    outside_project = defaultdict(set)
    inbound = Counter()
    other_assets = 0
    refs = 0
    for source, page in reader.items():
        targets = set()
        for raw in page.links:
            kind, path = as_local(raw, source)
            if kind == "local":
                refs += 1
                if path in html:
                    targets.add(path)
                elif (ROOT / path).is_file():
                    other_assets += 1
                else:
                    broken[path].add(source)
            elif kind == "old_domain":
                external_old[path].add(source)
            elif kind == "outside_project":
                outside_project[path].add(source)
        graph[source] = targets
        for dest in targets:
            inbound[dest] += 1

    distances = {}
    queue = deque(["index.html"])
    distances["index.html"] = 0
    while queue:
        node = queue.popleft()
        for target in graph.get(node, []):
            if target not in distances:
                distances[target] = distances[node] + 1
                queue.append(target)

    articles = set(filter(ARTICLE.match, html))
    canonically_indexable = {
        path for path, page in reader.items()
        if not page.noindex and len(page.canonicals) == 1
        and canonical_target(page.canonicals[0]) == path
    }
    blog_links = graph.get("index/index.html", set())
    nav_links = {}
    for page in NAV:
        nav_links[page] = {
            "exists": page in html,
            "reachable_from_home": page in distances,
            "click_depth": distances.get(page),
            "unique_html_page_targets": len(graph.get(page, set())),
            "direct_article_links": len(graph.get(page, set()) & articles),
        }
    unreachable = html - set(distances)
    unlinked = {p for p in html if inbound[p] == 0 and p != "index.html"}
    indexable_articles = articles & canonically_indexable
    main_sitemap = read_sitemap("sitemap.xml")
    article_sitemap = read_sitemap("sitemap-articles.xml")

    def ranked(d, n=20):
        return [{"target": k, "source_count": len(v), "source_examples": sorted(v)[:3]}
                for k, v in sorted(d.items(), key=lambda z: (-len(z[1]), z[0]))[:n]]
    def depths(pages):
        return dict(sorted(Counter(str(distances[p]) if p in distances else "unreachable"
                       for p in pages).items(), key=lambda a: a[0]))
    report = {
        "source_branch": "audit-internal-link-crawlability-2026-11-09",
        "scope": "static <a href> elements and HTML file existence in site checkout; not browser JS execution",
        "html_pages": len(html),
        "internal_anchor_instances": refs,
        "link_graph_edges": sum(map(len, graph.values())),
        "reachable_from_home": len(distances),
        "unreachable_count": len(unreachable),
        "unlinked_count": len(unlinked),
        "crawl_depth_html_pages": depths(html),
        "canonically_indexable_html_pages": len(canonically_indexable),
        "canonically_indexable_depth": depths(canonically_indexable),
        "articles": {
            "all_dated_articles": len(articles),
            "indexable_self_canonical": len(indexable_articles),
            "direct_links_from_blog": len(articles & blog_links),
            "indexable_articles_direct_from_blog": len(indexable_articles & blog_links),
            "articles_reachable_home": len(articles & set(distances)),
            "articles_unreachable_home": sorted(articles - set(distances))[:40],
            "articles_missing_blog_direct_link": sorted(articles - blog_links)[:40],
            "article_depths": depths(articles),
            "article_min_inbound_link_count": min([inbound[x] for x in articles], default=None),
            "article_no_inbound_links": sorted(x for x in articles if inbound[x] == 0)[:40],
        },
        "main_navigation": nav_links,
        "sitemaps": {
            "main_urls": len(main_sitemap),
            "article_urls": len(article_sitemap),
            "indexable_articles_in_main": len(indexable_articles & main_sitemap),
            "indexable_articles_in_article_sitemap": len(indexable_articles & article_sitemap),
            "indexable_articles_missing_main": sorted(indexable_articles - main_sitemap)[:20],
            "indexable_articles_missing_article_sitemap": sorted(indexable_articles - article_sitemap)[:20],
        },
        "broken_internal_targets_count": len(broken),
        "broken_internal_source_target_pairs": sum(len(x) for x in broken.values()),
        "broken_internal_top": ranked(broken, 100),
        "broken_internal_category_counts": dict(Counter(("legacy_media" if k.startswith("wp-content/uploads/") else "archive_index" if re.search(r"^20\d{2}(?:/\d{2})?(?:/\d{2})?/index\.html$", k) else "other_internal") for k in broken)),
        "old_domain_target_count": len(external_old),
        "old_domain_links_top": ranked(external_old, 12),
        "outside_project_target_count": len(outside_project),
        "outside_project_links_top": ranked(outside_project, 12),
        "internal_nonhtml_file_links": other_assets,
        "unlinked_examples": sorted(unlinked)[:35],
        "unreachable_examples": sorted(unreachable)[:140],
        "unreachable_canonically_indexable_count": len(unreachable & canonically_indexable),
        "unreachable_canonically_indexable_examples": sorted(unreachable & canonically_indexable)[:130],
        "non_self_canonical_articles": sorted(articles - canonically_indexable),
        "parse_errors": parse_errors[:20],
    }
    out = ROOT / "internal-link-audit-results.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("=== CRAWLABILITY AUDIT START ===")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print("=== CRAWLABILITY AUDIT END ===")

if __name__ == "__main__":
    main()
