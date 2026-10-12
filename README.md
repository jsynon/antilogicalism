# Antilogicalism

Antilogicalism is a restored archive of essays, philosophical writing, and reading resources. The original site ran on WordPress; the current public site is a static archive hosted with GitHub Pages.

**Website:** [jsynon.github.io/antilogicalism](https://jsynon.github.io/antilogicalism/)

## What’s here

- **The archive:** essays, older blog posts, and philosophy and primary-source pages, preserved as static HTML.
- **Site search:** search tools are included in the static site. The blog archive also offers browsing by date and category.
- **Digital Library Search:** the [library search page](https://jsynon.github.io/antilogicalism/digital-library/) searches 642 book titles. Its large text-search dataset is maintained separately in the `antilogicalism-library-data` repository, keeping that dataset out of this website repository.
- **Selected Feeds:** feed entries are generated as static HTML, so they can be read without WordPress or browser-side feed access.

The site can be browsed without installing WordPress. The book PDFs are hosted separately from the site; opening a document depends on the file and its sharing settings remaining available.

## How the archive is hosted

GitHub Pages serves this repository’s HTML, styles, scripts, images, and other website assets. The former WordPress database and PHP application are not used by the published site. Book files and the searchable library data are maintained separately, so those services have their own availability and access requirements.

The site is published under the `/antilogicalism/` project path. Internal links and static assets need to keep working from that path when pages are previewed or updated.

## Repository guide

| Path | Purpose |
| --- | --- |
| `index.html` | Homepage |
| `index/` | Blog archive |
| `digital-library/` | Digital Library Search page |
| `assets/search.css`, `assets/search.js` | Static site search interface |
| `search-index.json` | Data used by the site search |
| `links/selected-feeds/` | Selected Feeds page and its template |
| `scripts/build_search_index.py` | Builds the site search index |
| `scripts/build_static_feeds.py` | Retrieves and renders feed entries as static HTML |
| `.github/workflows/refresh-feeds.yml` | Scheduled and manual Selected Feeds refresh |
| `publish.py` | Site publishing helper |

The repository also contains the static export’s many article pages, images, stylesheets, and supporting assets. The library search data repository is separate: [jsynon/antilogicalism-library-data](https://github.com/jsynon/antilogicalism-library-data).

## Preview locally

From PowerShell, start a simple local web server from the directory containing the repository folder:

```powershell
cd D:\Downloads
py -m http.server 8000
```

Then open <http://localhost:8000/antilogicalism/>. Stop the server with **Ctrl+C**. The `py` launcher serves the files; it does not change them.

## Archive housekeeping audit

A read-only audit script is included at `scripts/audit_archive.py`. It checks local links in HTML pages and reports:

- links to files that are missing from the archive;
- links to fragments (`#section`) that do not exist on the target page;
- pages with no incoming links from other HTML pages; and
- pages not reachable by following HTML links from the homepage.

Run it from PowerShell with:

```powershell
py D:\Downloads\antilogicalism\scripts\audit_archive.py D:\Downloads\antilogicalism
```

It writes CSV reports to a sibling folder named `antilogicalism-archive-audit`. Pass `--output` with another folder path to choose a different location. The script does not modify or delete website files. External websites are not checked, and a page reported as orphaned or unreachable should be reviewed before any changes; some pages may be intentionally retained or accessed through external links.

## Updating the site

This repository is a static snapshot; editing the former WordPress installation does not automatically update it.

1. Make changes in the local repository.
2. Preview affected pages locally, including their paths under `/antilogicalism/`.
3. Review the changed files in GitHub Desktop.
4. Commit with a descriptive message and push to GitHub.
5. Check the live page after GitHub Pages finishes publishing.

When changing a generated page, update its source template or generator where applicable, then rebuild and review the output. In particular, the Selected Feeds page is generated from its template and feed configuration; avoid treating the generated HTML as its only source.

### Refreshing Selected Feeds

The scheduled GitHub Actions workflow updates the generated feed content daily and can also be started manually from the repository’s Actions tab. It commits changes when refreshed content differs. Feed publishers can change or become unavailable, so review the generated page after changing feed sources or the generator.

### Updating Library Search

The search page is part of this website repository. Its book text data is maintained separately in `antilogicalism-library-data`. Keep the two repositories’ changes coordinated when updating the dataset or the page’s data-version reference. Avoid copying the large data files into this repository.

## Scope and limitations

- The archive does not include WordPress editing, accounts, comments, or other server-side features.
- External services such as Google Drive and the separate library-data repository must remain available for their linked documents and search data to work.
- The archive audit checks local HTML references only. It cannot confirm that an external website or shared document is still online or publicly accessible.
- Some legacy links may be intentionally unresolved. Review reports before editing or removing anything.
