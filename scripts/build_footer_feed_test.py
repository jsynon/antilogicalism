
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
TEST_PAGE = ROOT / "index.footer-test.html"

# Import the existing feed configuration, parser, renderer, and styles.
sys.path.insert(0, str(ROOT / "scripts"))
from build_static_feeds import FEEDS, STYLE, render_feed

def main():
    if not TEST_PAGE.exists():
        raise FileNotFoundError(f"Test page not found: {TEST_PAGE}")

    feed = next(
        item for item in FEEDS
        if item["name"] == "Arts & Letters Daily"
    )

    html = TEST_PAGE.read_text(encoding="utf-8-sig")

    # Generate the real static article list using the existing feed builder.
    cache = {}
    articles_html = render_feed(feed, cache)

    widget_html = f"""
<aside id="rss-3" class="widget widget_rss static-rss-widget">
  <h1 class="widget-title">
    <a class="rsswidget rss-widget-title"
       href="{feed['home']}">Arts &amp; Letters Daily</a>
  </h1>
  {articles_html}
</aside>
""".strip()

    pattern = re.compile(
        r'<aside\b(?=[^>]*\bid="rss-3")[^>]*>.*?</aside>',
        re.I | re.S,
    )

    html, replacements = pattern.subn(
        lambda _: widget_html,
        html,
        count=1,
    )

    if replacements != 1:
        raise RuntimeError(
            f"Expected to replace one rss-3 widget; found {replacements}"
        )

    # Include the same feed styles used on the existing Selected Feeds page.
    if 'id="static-rss-feed-styles"' not in html:
        html = re.sub(
            r"</head>",
            lambda _: STYLE + "\n</head>",
            html,
            count=1,
            flags=re.I,
        )

    # Verify the test page before writing it.
    if "api.quantamagazine.org/feed" not in html:
        raise RuntimeError("Quanta feed URL missing from test page.")

    if 'id="rss-11"' not in html:
        raise RuntimeError("Quanta widget missing from test page.")

    if "Arts &amp; Letters Daily" not in html:
        raise RuntimeError("Arts & Letters Daily title missing.")

    TEST_PAGE.write_text(html, encoding="utf-8")

    print("Test page updated:", TEST_PAGE)
    print("Feed:", feed["name"])
    print("Feed URL:", feed["url"])

    if feed["id"] in cache:
        print("Articles loaded:", len(cache[feed["id"]]))
    else:
        print("The feed renderer displayed its unavailable fallback.")

    print("Quanta widget preserved: yes")
    print("Original index.html modified: no")


if __name__ == "__main__":
    main()
