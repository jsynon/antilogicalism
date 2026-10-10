from pathlib import Path
import re

# ============================================================
# Configuration
# ============================================================

SITE_DIR = Path(r"D:\Downloads\antilogicalism")

OLD_DOMAINS = (
    "https://antilogicalism.test",
    "http://antilogicalism.test",
)

GITHUB_PREFIX = "/antilogicalism"

# Text files that are safe/useful to process
TEXT_EXTENSIONS = {
    ".html",
    ".htm",
    ".css",
    ".js",
    ".json",
    ".xml",
    ".txt",
    ".svg",
    ".webmanifest",
}


# ============================================================
# URL fixing
# ============================================================

def fix_content(text):
    original = text

    # --------------------------------------------------------
    # 1. Replace absolute .test URLs
    #
    # https://antilogicalism.test/foo
    # becomes
    # /antilogicalism/foo
    # --------------------------------------------------------

    for domain in OLD_DOMAINS:
        text = text.replace(domain, GITHUB_PREFIX)

    # --------------------------------------------------------
    # 2. Fix root-relative WordPress paths
    #
    # /wp-content/...
    # /wp-includes/...
    #
    # become
    #
    # /antilogicalism/wp-content/...
    # /antilogicalism/wp-includes/...
    #
    # Only process paths that are actually root-relative.
    # --------------------------------------------------------

    text = re.sub(
        r'(?P<quote>["\'(])/(?P<path>wp-content/|wp-includes/)',
        r'\g<quote>/antilogicalism/\g<path>',
        text,
    )

    # --------------------------------------------------------
    # 3. Fix common root-relative assets
    # --------------------------------------------------------

    text = re.sub(
        r'(?P<quote>["\'(])/(?P<path>favicon\.|robots\.txt|sitemap\.xml)',
        r'\g<quote>/antilogicalism/\g<path>',
        text,
        flags=re.IGNORECASE,
    )

    return text, text != original


# ============================================================
# Main
# ============================================================

def main():
    if not SITE_DIR.exists():
        print(f"ERROR: Site directory does not exist:")
        print(SITE_DIR)
        return

    print("=" * 70)
    print("Antilogicalism GitHub Pages URL Fixer")
    print("=" * 70)
    print()
    print(f"Site: {SITE_DIR}")
    print()

    files_scanned = 0
    files_changed = 0
    replacements = 0

    for path in SITE_DIR.rglob("*"):

        if not path.is_file():
            continue

        if path.suffix.lower() not in TEXT_EXTENSIONS:
            continue

        files_scanned += 1

        try:
            text = path.read_text(
                encoding="utf-8",
                errors="replace",
            )
        except Exception as e:
            print(f"Could not read: {path}")
            print(f"  {e}")
            continue

        fixed, changed = fix_content(text)

        if not changed:
            continue

        # Count approximate replacements
        replacements += (
            text.count("https://antilogicalism.test")
            + text.count("http://antilogicalism.test")
            + len(re.findall(r'["\'(]/wp-content/', text))
            + len(re.findall(r'["\'(]/wp-includes/', text))
        )

        try:
            path.write_text(
                fixed,
                encoding="utf-8",
            )
        except Exception as e:
            print(f"Could not write: {path}")
            print(f"  {e}")
            continue

        files_changed += 1

        print(f"Fixed: {path.relative_to(SITE_DIR)}")

    print()
    print("=" * 70)
    print("DONE")
    print("=" * 70)
    print(f"Files scanned : {files_scanned}")
    print(f"Files changed : {files_changed}")
    print(f"Replacements  : {replacements}")
    print()


if __name__ == "__main__":
    main()