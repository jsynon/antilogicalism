
#!/usr/bin/env python3
"""Refresh only the Arts & Letters Daily widget in archive footers.

Default behavior is a dry run. Pass --apply to write changes.
"""

from pathlib import Path
import argparse
import re
import sys

from build_static_feeds import FEEDS, render_feed

ROOT = Path(__file__).resolve().parents[1]
BACKUP_ROOT = ROOT.parent / "antilogicalism-feed-refresh-backup"

FEED_ID = "rssf95b51da4c"
FEED_WIDGET_ID = "rss-3"
QUANTA_WIDGET_ID = "rss-11"
SEARCH_WIDGET_ID = "antilogicalism-search-widget"


def find_one(pattern, text, description):
    matches = list(re.finditer(pattern, text, re.I | re.S))
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected exactly one {description}; found {len(matches)}."
        )
    return matches[0]


def widget_pattern(widget_id):
    return (
        r"<aside\b(?=[^>]*\bid=[\"']"
        + re.escape(widget_id)
        + r"[\"'])[^>]*>.*?</aside>"
    )


def refresh_widget(html, rendered_feed):
    """Replace the static feed block inside rss-3 only."""
    widget = find_one(
        widget_pattern(FEED_WIDGET_ID),
        html,
        "Arts & Letters Daily widget",
    )
    old_widget = widget.group(0)

    feed_block_pattern = (
        r"<div\b"
        r"(?=[^>]*\bclass=[\"'][^\"']*\bstatic-rss-feed\b[^\"']*[\"'])"
        r"[^>]*>.*?</div>"
    )
    feed_block = find_one(
        feed_block_pattern,
        old_widget,
        "static Arts & Letters Daily content block",
    )

    new_widget = (
        old_widget[:feed_block.start()]
        + rendered_feed
        + old_widget[feed_block.end():]
    )

    updated = html[:widget.start()] + new_widget + html[widget.end():]

    # Confirm the search and Quanta widgets are present exactly once.
    for widget_id in (SEARCH_WIDGET_ID, QUANTA_WIDGET_ID):
        count = len(re.findall(
            rf'\bid=["\']{re.escape(widget_id)}["\']',
            updated,
            re.I,
        ))
        if count != 1:
            raise RuntimeError(
                f'Expected one id="{widget_id}"; found {count}.'
            )

    # Ensure Quanta and the search column were not changed.
    original_quanta = find_one(
        widget_pattern(QUANTA_WIDGET_ID),
        html,
        "original Quanta widget",
    ).group(0)
    updated_quanta = find_one(
        widget_pattern(QUANTA_WIDGET_ID),
        updated,
        "updated Quanta widget",
    ).group(0)

    if original_quanta != updated_quanta:
        raise RuntimeError("Quanta widget changed unexpectedly.")

    first_column_pattern = (
        r'<div\b(?=[^>]*\bid="first")[^>]*>.*?'
        r'(?=<!-- #first \.widget-area -->)'
    )
    original_first = find_one(
        first_column_pattern, html, "original search column"
    ).group(0)
    updated_first = find_one(
        first_column_pattern, updated, "updated search column"
    ).group(0)

    if original_first != updated_first:
        raise RuntimeError("Search column changed unexpectedly.")

    return updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes; otherwise perform a dry run.",
    )
    args = parser.parse_args()

    feed = next((item for item in FEEDS if item["id"] == FEED_ID), None)
    if feed is None:
        raise RuntimeError(f"Feed configuration not found: {FEED_ID}")

    # Fetch/render once, then reuse the same result across all archive pages.
    rendered_feed = render_feed(feed, {})
    feed_unavailable = "static-rss-unavailable" in rendered_feed

    files = sorted(ROOT.rglob("index.html"))
    targets = []
    failures = []
    unchanged = 0

    for path in files:
        if ".git" in path.parts or "node_modules" in path.parts:
            continue

        try:
            original = path.read_text(encoding="utf-8-sig", errors="replace")

            if not all(marker in original for marker in (
                'id="first"',
                f'id="{FEED_WIDGET_ID}"',
                f'id="{QUANTA_WIDGET_ID}"',
                f'id="{SEARCH_WIDGET_ID}"',
            )):
                continue

            updated = refresh_widget(original, rendered_feed)

            if updated == original:
                unchanged += 1
            else:
                targets.append((path, original, updated))

        except Exception as exc:
            failures.append((path, str(exc)))

    print("Antilogicalism archive feed refresh")
    print("Mode:", "APPLY" if args.apply else "DRY RUN")
    print("HTML files scanned:", len(files))
    print("Pages ready to update:", len(targets))
    print("Already unchanged:", unchanged)
    print("Validation errors:", len(failures))
    print("Feed result:", "fallback displayed" if feed_unavailable
          else "live feed fetched")

    if failures:
        for path, error in failures[:30]:
            print(f"  {path.relative_to(ROOT)}: {error}")
        if len(failures) > 30:
            print(f"  ... and {len(failures) - 30} more")
        sys.exit(1)

    if feed_unavailable:
        print(
            "Feed retrieval failed. No files will be written; "
            "check the feed before retrying."
        )
        sys.exit(1)

    if not args.apply:
        print("Dry run complete. No files were changed.")
        return

    # Back up all target pages before writing any of them.
    from datetime import datetime

    backup_dir = BACKUP_ROOT / datetime.now().strftime("%Y%m%d-%H%M%S")
    backups = []

    for path, original, updated in targets:
        backup_path = backup_dir / path.relative_to(ROOT)
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        backup_path.write_text(original, encoding="utf-8")
        backups.append((path, backup_path, updated))

    written = []

    try:
        for path, backup_path, updated in backups:
            path.write_text(updated, encoding="utf-8")
            written.append((path, backup_path))
    except Exception:
        print("A write failed. Restoring pages written in this run.")
        for path, backup_path in reversed(written):
            path.write_text(
                backup_path.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
        raise

    print("Pages updated:", len(written))
    print("Backup location:", backup_dir)
    print("Search column and Quanta widget verified unchanged.")


if __name__ == "__main__":
    main()
