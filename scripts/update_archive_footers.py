
#!/usr/bin/env python3
"""Safely update Antilogicalism archive footers.

Default behavior is a dry run. Pass --apply to write changes.
Every modified HTML file is backed up before it is changed.
"""

from pathlib import Path
import argparse
import re
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
TEST_PAGE = ROOT / "index.footer-test.html"

# Backup is outside the website directory.
BACKUP_ROOT = ROOT.parent / "antilogicalism-footer-backup-20261010"

SEARCH_CSS = '<link rel="stylesheet" href="/antilogicalism/assets/search.css">'
SEARCH_JS = '<script src="/antilogicalism/assets/search.js" defer></script>'


def require_one(pattern, text, description, flags=re.I | re.S):
    """Require exactly one matching HTML region."""
    matches = list(re.finditer(pattern, text, flags))

    if len(matches) != 1:
        raise RuntimeError(
            f"Expected exactly one {description}; found {len(matches)}."
        )

    return matches[0]


def first_column_pattern():
    return (
        r'<div\b(?=[^>]*\bid="first")[^>]*>.*?'
        r'(?=<!-- #first \.widget-area -->)'
    )


def extract_test_templates():
    """Extract the tested search column, feed widget, and styles."""
    if not TEST_PAGE.exists():
        raise FileNotFoundError(f"Test page not found: {TEST_PAGE}")

    html = TEST_PAGE.read_text(encoding="utf-8-sig")

    first_match = require_one(
        first_column_pattern(),
        html,
        "first-column template in test page",
    )
    first_template = first_match.group(0)

    feed_match = require_one(
        r'<aside\b(?=[^>]*\bid="rss-3")[^>]*>.*?</aside>',
        html,
        "Arts & Letters Daily widget in test page",
    )
    feed_template = feed_match.group(0)

    style_matches = list(re.finditer(
        r'<style\b(?=[^>]*\bid="static-rss-feed-styles")[^>]*>.*?</style>',
        html,
        re.I | re.S,
    ))

    if len(style_matches) != 1:
        raise RuntimeError(
            "Expected exactly one static RSS style block in test page."
        )

    style_template = style_matches[0].group(0)

    if "antilogicalism-search-widget" not in first_template:
        raise RuntimeError("Test first column is missing the search widget.")

    if "data-antilogicalism-search" not in first_template:
        raise RuntimeError("Test search form marker is missing.")

    if "Arts &amp; Letters Daily" not in feed_template:
        raise RuntimeError("Test feed is not Arts & Letters Daily.")

    if "static-rss-feed" not in feed_template:
        raise RuntimeError("Static feed markup is missing.")

    if "https://api.quantamagazine.org/feed/" not in html:
        raise RuntimeError("Quanta feed URL is missing from the test page.")

    if "assets/search.css" not in html or "assets/search.js" not in html:
        raise RuntimeError("Search CSS or JavaScript is missing from test page.")

    return first_template, feed_template, style_template


def update_html(html, first_template, feed_template, style_template):
    """Replace target footer widgets and add missing asset references."""
    changes = []

    # Replace the first footer column, preserving the column marker.
    first_match = require_one(
        first_column_pattern(),
        html,
        "first footer column",
    )

    html = (
        html[:first_match.start()]
        + first_template
        + html[first_match.end():]
    )
    changes.append("search/contact/social footer column")

    # Replace only the Arts & Letters Daily widget.
    feed_match = require_one(
        r'<aside\b(?=[^>]*\bid="rss-3")[^>]*>.*?</aside>',
        html,
        "rss-3 feed widget",
    )

    html = (
        html[:feed_match.start()]
        + feed_template
        + html[feed_match.end():]
    )
    changes.append("Arts & Letters Daily feed")

    # Add feed styles once, if they are missing.
    if 'id="static-rss-feed-styles"' not in html:
        head_close = re.search(r"</head\s*>", html, re.I)

        if not head_close:
            raise RuntimeError("Could not find closing </head> tag.")

        html = (
            html[:head_close.start()]
            + style_template
            + "\n"
            + html[head_close.start():]
        )
        changes.append("static RSS styles")

    # Add search CSS if not already referenced.
    if "assets/search.css" not in html:
        head_close = re.search(r"</head\s*>", html, re.I)

        if not head_close:
            raise RuntimeError("Could not find closing </head> tag.")

        html = (
            html[:head_close.start()]
            + SEARCH_CSS
            + "\n"
            + html[head_close.start():]
        )
        changes.append("search stylesheet")

    # Add search JavaScript if not already referenced.
    if "assets/search.js" not in html:
        body_close = re.search(r"</body\s*>", html, re.I)

        if body_close:
            html = (
                html[:body_close.start()]
                + SEARCH_JS
                + "\n"
                + html[body_close.start():]
            )
        else:
            head_close = re.search(r"</head\s*>", html, re.I)

            if not head_close:
                raise RuntimeError(
                    "Could not find </body> or </head> for search script."
                )

            html = (
                html[:head_close.start()]
                + SEARCH_JS
                + "\n"
                + html[head_close.start():]
            )

        changes.append("search JavaScript")

    return html, changes


def validate_updated_html(html, original_html):
    """Validate the new footer and ensure Quanta is unchanged."""
    required = [
        'id="first"',
        'id="antilogicalism-search-widget"',
        "data-antilogicalism-search",
        'id="rss-3"',
        "Arts &amp; Letters Daily",
        'id="rss-11"',
        "https://api.quantamagazine.org/feed/",
        "assets/search.css",
        "assets/search.js",
    ]

    for item in required:
        if item not in html:
            raise RuntimeError(f"Updated page is missing: {item}")

    for widget_id in (
        "antilogicalism-search-widget",
        "rss-3",
        "rss-11",
        "static-rss-feed-styles",
    ):
        count = len(re.findall(
            rf'\bid="{re.escape(widget_id)}"',
            html,
            re.I,
        ))
        if count != 1:
            raise RuntimeError(
                f'Expected one id="{widget_id}"; found {count}.'
            )

    # Inspect only the footer column that was replaced. Do not reject
    # email/social links that legitimately occur in article content.
    first_match = require_one(
        first_column_pattern(),
        html,
        "updated first footer column",
    )
    first_column = first_match.group(0)

    if "jetpack-search-filters-9" in first_column:
        raise RuntimeError("Old Jetpack search remains in the footer.")

    if "mailto:admin@antilogicalism.com" in first_column:
        raise RuntimeError("Old footer contact email remains.")

    if "jetpack-social-widget-list" in first_column:
        raise RuntimeError("Old footer social icons remain.")

    # Preserve the original Quanta widget exactly.
    original_quanta = require_one(
        r'<aside\b(?=[^>]*\bid="rss-11")[^>]*>.*?</aside>',
        original_html,
        "original Quanta widget",
    ).group(0)

    updated_quanta = require_one(
        r'<aside\b(?=[^>]*\bid="rss-11")[^>]*>.*?</aside>',
        html,
        "updated Quanta widget",
    ).group(0)

    if original_quanta != updated_quanta:
        raise RuntimeError("Quanta widget was unexpectedly changed.")


def main():
    arg_parser = argparse.ArgumentParser(
        description="Safely update Antilogicalism archive footers."
    )
    arg_parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the changes after creating backups. Default is dry run.",
    )
    args = arg_parser.parse_args()

    first_template, feed_template, style_template = extract_test_templates()

    files = sorted(ROOT.rglob("index.html"))
    targets = []

    # Find pages that have all three expected footer widget markers.
    for path in files:
        if ".git" in path.parts or "node_modules" in path.parts:
            continue

        try:
            raw = path.read_text(
                encoding="utf-8-sig",
                errors="replace",
            )
        except OSError as exc:
            print(f"Could not read {path}: {exc}")
            continue

        if (
            'id="first"' in raw
            and 'id="rss-3"' in raw
            and 'id="rss-11"' in raw
        ):
            targets.append((path, raw))

    if not targets:
        raise RuntimeError("No eligible archive pages were found.")

    prepared = []
    unchanged = 0
    failed = []

    for path, original in targets:
        try:
            updated, changes = update_html(
                original,
                first_template,
                feed_template,
                style_template,
            )

            validate_updated_html(updated, original)

            if updated == original:
                unchanged += 1
            else:
                prepared.append((path, original, updated, changes))

        except Exception as exc:
            failed.append((path, str(exc)))

    print("Antilogicalism footer updater")
    print("Mode:", "APPLY" if args.apply else "DRY RUN")
    print("HTML files found:", len(files))
    print("Eligible footer pages:", len(targets))
    print("Pages ready to change:", len(prepared))
    print("Already unchanged:", unchanged)
    print("Pages with validation errors:", len(failed))

    if failed:
        print("\nValidation errors:")
        for path, error in failed[:30]:
            print(f"  {path.relative_to(ROOT)}: {error}")

        if len(failed) > 30:
            print(f"  ... and {len(failed) - 30} more")

        if args.apply:
            print("\nNo files were changed because validation failed.")

        sys.exit(1)

    if not args.apply:
        print("\nDry run complete. No files were changed.")
        print("Review this report before running with --apply.")
        return

    # Create backups for every page before writing any updated page.
    backups = []

    for path, original, updated, changes in prepared:
        relative = path.relative_to(ROOT)
        backup_path = BACKUP_ROOT / relative
        backup_path.parent.mkdir(parents=True, exist_ok=True)

        shutil.copy2(path, backup_path)
        backups.append((path, backup_path, updated))

    # Write the pages only after all backups have been created.
    written = []

    try:
        for path, backup_path, updated in backups:
            path.write_text(updated, encoding="utf-8")
            written.append((path, backup_path))

    except Exception:
        print("\nA write failed. Attempting to restore written pages.")

        for path, backup_path in reversed(written):
            shutil.copy2(backup_path, path)

        print("Restoration attempted for pages written in this run.")
        raise

    print("\nUpdate complete.")
    print("Pages updated:", len(written))
    print("Backup location:", BACKUP_ROOT)
    print("Quanta widget preserved on every updated page.")
    print("Content outside the targeted widgets was retained.")


if __name__ == "__main__":
    main()
