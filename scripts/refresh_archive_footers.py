
#!/usr/bin/env python3
"""Refresh Arts & Letters Daily footer widgets and remove old site credits.

Default behavior is a dry run. Pass --apply to write changes.
Every changed HTML file is backed up before writing.
"""

from pathlib import Path
from datetime import datetime
from html import escape
import argparse
import re
import sys

from build_static_feeds import FEEDS, load_items

ROOT = Path(__file__).resolve().parents[1]
BACKUP_ROOT = ROOT.parent / "antilogicalism-footer-polish-backup"

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


def first_column_pattern():
    return (
        r'<div\b(?=[^>]*\bid="first")[^>]*>.*?'
        r'(?=<!-- #first \.widget-area -->)'
    )


def render_native_widget(feed, items):
    """Render a native WordPress RSS widget matching Quanta's structure."""
    name = escape(feed["name"])
    home = escape(feed["home"], quote=True)
    feed_url = escape(feed["url"], quote=True)

    output = [
        '<aside id="rss-3" class="widget widget_rss">',
        '<h1 class="widget-title">'
        f'<a class="rsswidget rss-widget-feed" href="{feed_url}">'
        '<img class="rss-widget-icon" style="border:0" '
        'width="14" height="14" '
        'src="/antilogicalism/wp-includes/images/rss.png" '
        f'alt="RSS feed: {name}" loading="lazy"></a> '
        f'<a class="rsswidget rss-widget-title" href="{home}">'
        f'{name}</a></h1>',
        "<ul>",
    ]

    for item in items:
        title = escape(item["title"])
        link = item.get("link", "")

        if link.startswith(("https://", "http://")):
            safe_link = escape(link, quote=True)
            output.append(
                f'<li><a class="rsswidget" href="{safe_link}">'
                f'{title}</a></li>'
            )
        else:
            output.append(
                f'<li><span class="rsswidget">{title}</span></li>'
            )

    output.extend(["</ul>", "</aside>"])
    return "".join(output)


def refresh_widget(html, new_widget):
    """Replace only the Arts & Letters Daily widget."""
    old_widget_match = find_one(
        widget_pattern(FEED_WIDGET_ID),
        html,
        "Arts & Letters Daily widget",
    )
    old_widget = old_widget_match.group(0)

    updated = (
        html[:old_widget_match.start()]
        + new_widget
        + html[old_widget_match.end():]
    )

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

    original_first = find_one(
        first_column_pattern(), html, "original search column"
    ).group(0)
    updated_first = find_one(
        first_column_pattern(), updated, "updated search column"
    ).group(0)

    if original_first != updated_first:
        raise RuntimeError("Search column changed unexpectedly.")

    return updated


def remove_old_site_credits(html):
    """Remove only the old WordPress/Book Lite attribution block."""
    pattern = (
        r'<div\b'
        r'(?=[^>]*\bclass=["\'][^"\']*\bsite-info\b[^"\']*["\'])'
        r'[^>]*>.*?<!--\s*\.site-info\s*-->'
    )
    matches = list(re.finditer(pattern, html, re.I | re.S))

    credit_matches = [
        match for match in matches
        if (
            "Proudly powered by WordPress" in match.group(0)
            and (
                "wpshoppe.com" in match.group(0)
                or "Book Lite" in match.group(0)
            )
        )
    ]

    if len(credit_matches) > 1:
        raise RuntimeError(
            f"Found {len(credit_matches)} old site-credit blocks."
        )

    if not credit_matches:
        return html, False

    match = credit_matches[0]
    updated = html[:match.start()] + html[match.end():]

    if (
        "Proudly powered by WordPress" in updated
        or "wpshoppe.com" in updated
    ):
        raise RuntimeError("Old site credits remain after removal.")

    return updated, True


def main():
    parser = argparse.ArgumentParser(
        description="Polish Antilogicalism footer feeds and credits."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes after creating backups. Default is dry run.",
    )
    args = parser.parse_args()

    feed = next(
        (item for item in FEEDS if item["id"] == FEED_ID),
        None,
    )
    if feed is None:
        raise RuntimeError(f"Feed configuration not found: {FEED_ID}")

    try:
        items = load_items(feed)
    except Exception as exc:
        print(f"Feed retrieval failed: {type(exc).__name__}: {exc}")
        print("No files were changed.")
        sys.exit(1)

    if not items:
        print("The feed returned no items. No files were changed.")
        sys.exit(1)

    new_widget = render_native_widget(feed, items)

    files = sorted(ROOT.rglob("*.html"))
    prepared = []
    failures = []
    feed_updates = 0
    credit_removals = 0
    unchanged = 0

    for path in files:
        if ".git" in path.parts or "node_modules" in path.parts:
            continue

        try:
            original = path.read_text(
                encoding="utf-8-sig",
                errors="replace",
            )
            updated = original
            feed_changed = False
            credits_changed = False

            # Update the RSS widget only on pages containing the full footer.
            if all(marker in updated for marker in (
                f'id="{FEED_WIDGET_ID}"',
                f'id="{QUANTA_WIDGET_ID}"',
                f'id="{SEARCH_WIDGET_ID}"',
                'id="first"',
            )):
                before = updated
                updated = refresh_widget(updated, new_widget)
                feed_changed = updated != before

            updated, credits_changed = remove_old_site_credits(updated)

            # Verify the new native widget structure if this page was updated.
            if feed_changed:
                widget = find_one(
                    widget_pattern(FEED_WIDGET_ID),
                    updated,
                    "updated Arts & Letters Daily widget",
                ).group(0)

                if (
                    'class="widget widget_rss"' not in widget
                    or 'class="rsswidget"' not in widget
                    or "<ul>" not in widget
                ):
                    raise RuntimeError(
                        "New native RSS widget structure failed validation."
                    )

            if credits_changed and (
                "Proudly powered by WordPress" in updated
                or "wpshoppe.com" in updated
            ):
                raise RuntimeError("Old site attribution remains.")

            if updated == original:
                unchanged += 1
            else:
                prepared.append((path, original, updated))

            if feed_changed:
                feed_updates += 1
            if credits_changed:
                credit_removals += 1

        except Exception as exc:
            failures.append((path, str(exc)))

    print("Antilogicalism footer polish")
    print("Mode:", "APPLY" if args.apply else "DRY RUN")
    print("HTML files scanned:", len(files))
    print("Pages with feed updates:", feed_updates)
    print("Files with credit removals:", credit_removals)
    print("Files ready to change:", len(prepared))
    print("Already unchanged:", unchanged)
    print("Validation errors:", len(failures))
    print("Feed items fetched:", len(items))

    if failures:
        for path, error in failures[:30]:
            print(f"  {path.relative_to(ROOT)}: {error}")
        if len(failures) > 30:
            print(f"  ... and {len(failures) - 30} more")
        print("No files were written.")
        sys.exit(1)

    if not args.apply:
        print("Dry run complete. No files were changed.")
        return

    backup_dir = (
        BACKUP_ROOT / datetime.now().strftime("%Y%m%d-%H%M%S")
    )
    backups = []

    # Back up every changed file before writing any file.
    for path, original, updated in prepared:
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

    print("Files updated:", len(written))
    print("Backup location:", backup_dir)
    print("Native Arts & Letters Daily widget generated.")
    print("Quanta and search widget preservation validated.")


if __name__ == "__main__":
    main()
