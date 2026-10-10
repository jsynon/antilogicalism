# Antilogicalism — Static Archive

A static archive of Antilogicalism, preserving the site's writing, philosophy, and primary-source library without requiring an active WordPress installation.

**Live website:** https://jsynon.github.io/antilogicalism/

## Overview

Antilogicalism originally ran on WordPress. When the hosting plan was allowed to expire, the goal was to preserve the existing website and make it accessible without continuing to pay for WordPress hosting.

The site was exported as static HTML, CSS, JavaScript, and other assets, then published through GitHub Pages. Because the original site contained a large collection of PDF documents, those files were separated from the website and moved to Google Drive. The HTML links were then updated to point to the documents in their new location.

The result is a static website hosted on GitHub Pages, with its PDF library hosted separately on Google Drive.

## Architecture

The archive uses two services for two different purposes:

- **GitHub Pages:** Serves the website, including its HTML pages, stylesheets, JavaScript, images, navigation, and other static assets.
- **Google Drive:** Stores the PDF library and serves documents through their shared links.

The original WordPress database and PHP application are not needed to serve the published static archive.

This separation keeps the website repository smaller while preserving access to the document collection. It also means the website and the PDFs have separate hosting and availability dependencies.

## How the Site Was Created

### 1. Restore the original WordPress installation

A backup of the WordPress site was restored locally using Laragon, creating a working development site at:

`https://antilogicalism.test/`

This provided a local copy of the original site from which to generate the archive.

### 2. Export the website

Simply Static was used to crawl the local WordPress site and generate a static export.

The resulting archive was approximately 9 GB, largely because it included the site's PDF collection.

### 3. Separate the PDF library

The PDFs were removed from the static export, reducing the website to approximately 700 MB.

The PDF files were moved to Google Drive while retaining their original year/month directory structure, corresponding to WordPress's `wp-content/uploads/YYYY/MM/` organization.

Keeping this structure made it possible to match the original document paths to the files in their new location.

### 4. Repair the static website paths

The original export contained URLs pointing to the local `.test` domain and WordPress paths that did not work correctly on GitHub Pages.

A Python script, `fix_site.py`, was used to rewrite those URLs and account for GitHub Pages serving this repository under the `/antilogicalism/` project path.

This repaired the site's styling, navigation, images, scripts, and other internal resources.

### 5. Reconnect the PDF links

Removing the PDFs left existing HTML links pointing to their old WordPress upload locations. Manually repairing thousands of links would have been impractical.

Instead, the PDF library was inventoried and the links were updated programmatically.

#### Build a PDF inventory

Google Apps Script generated a CSV inventory containing 703 PDF files. Each row records:

- The original relative file path
- The filename
- The Google Drive file ID
- The Google Drive sharing URL

The inventory acts as a lookup table between the old WordPress paths and the new document URLs.

#### Match and replace links

A PowerShell script scanned the exported HTML files and searched their `href` and `src` attributes for links to PDFs in the old upload directories.

For each PDF link, the script extracted the original relative path, normalized the path for consistent matching, and looked it up in the CSV inventory.

When a match was found, the old URL was replaced with the corresponding Google Drive sharing URL.

#### Run a dry run first

The script initially ran in dry-run mode. It generated a CSV report showing the original URL, the matched destination when available, and the status of each link without modifying the HTML files.

The dry run examined 1,529 HTML files and found:

- 6,016 PDF links that matched the inventory
- 358 links that did not match, corresponding to 15 distinct PDF paths

The unmatched links were left untouched. Some may refer to ebooks that had previously been removed for copyright reasons, so they were not automatically restored or redirected.

#### Apply the changes safely

After reviewing the dry-run report, the script was run in apply mode. Before modifying a file, it created a backup of the original HTML file.

The completed replacement run modified 161 HTML files, updated all 6,016 matched links, and left the 358 unmatched links unchanged.

The repaired site was then committed and pushed to GitHub using GitHub Desktop. The published website and its Google Drive PDF links were tested successfully.

## How the Pieces Fit Together

The publishing and document-access flow looks like this:

```text
Original WordPress Backup
          |
          v
     Laragon
          |
          v
    Simply Static
          |
          v
  Static HTML Export
          |
          +-------------------------+
          |                         |
          v                         v
  Website Assets              PDF Library
          |                         |
          v                         v
     GitHub Pages              Google Drive
          |                         |
          +-----------+-------------+
                      |
                      v
             Working Archive
```

The important distinction is that GitHub Pages does not host or serve the PDF files themselves. It serves pages containing links to documents hosted by Google Drive.

## Repository Structure

The repository contains the static export of the website, including its pages, images, stylesheets, scripts, and other supporting assets.

It also contains `fix_site.py`, which was used to repair URLs and paths for GitHub Pages.

The PDF library is maintained separately in Google Drive rather than being included in the website repository. The inventory CSV and the PowerShell migration utilities were used during the repair process and are not necessarily part of the published site.

## How to Use the Website

Simply visit the [live Antilogicalism archive](https://jsynon.github.io/antilogicalism/).

Browse the pages as you would any other website. When a page links to a PDF, the link opens the corresponding document through Google Drive.

PDF access depends on the document remaining available in Drive and its sharing permissions allowing public access. A broken PDF link may therefore indicate a missing file, a changed sharing permission, or a stale link in the archived HTML.

No local WordPress installation is required to browse the published archive.

## How to Update and Publish the Site

The published website is a static snapshot, not a live WordPress installation. Changes made to the former WordPress site do not automatically appear here.

To update the archive:

1. Open the local repository in GitHub Desktop.
2. Make the desired changes to the static files in the working copy.
3. Preview and test the affected pages locally.
4. Review the changes in GitHub Desktop.
5. Commit the changes with a descriptive commit message.
6. Push the commit to GitHub.
7. Wait for GitHub Pages to publish the updated site, then verify the live result.

For changes to HTML, CSS, JavaScript, or images, edit the relevant static files directly when appropriate.

For new PDF documents, upload the files to Google Drive, ensure their sharing permissions permit public access, and update the relevant links in the HTML. If maintaining the original WordPress upload structure, preserve the year/month organization and record the document's path and sharing URL in the PDF inventory.

Avoid moving or deleting documents in Google Drive without checking for references to them in the archived pages.

### Repairing PDF Links in the Future

The original migration used a PowerShell utility to automate PDF link repair. Its working inputs were:

- The local website directory
- The PDF inventory CSV
- A replacement report
- A backup directory for modified HTML files

If the repair process is needed again, start with a dry run. Review the unmatched links and confirm the proposed destinations before enabling changes. Preserve the backup step, and test the repaired pages before publishing.

The original migration utilities were developed for this particular archive and local directory layout; they should be reviewed and adapted before being reused in another environment.

## Maintenance and Limitations

A few things are worth keeping in mind:

- **Static snapshot:** The repository does not provide the editing features, database, or server-side functionality of WordPress.
- **Separate document hosting:** The PDF library depends on Google Drive, its sharing settings, and the continued availability of the files.
- **Unmatched legacy links:** Some old PDF references remain unresolved because their corresponding files were not found in the inventory. These links should be reviewed individually rather than automatically redirected.
- **Repository size:** The PDF collection was excluded from the static export to keep the repository substantially smaller.
- **Backups:** Keep the original WordPress backup and migration backups where practical. The original backup is the recovery source for content that cannot be reconstructed from the static export alone.

## Future Possibilities

The current repository preserves the exported website as a static snapshot. A future improvement could replace the Simply Static export workflow with a custom Python generator that builds the archive directly from the WordPress backup.

That could make future rebuilds more reproducible, reduce manual path repair, and provide a more systematic way to maintain the document library.

For now, the static archive provides a practical way to preserve Antilogicalism's published content without maintaining the original WordPress hosting environment.

## Recent Maintenance: Footer and RSS Feed Automation

The static archive now includes a maintenance workflow for restoring and updating RSS feed content without requiring WordPress or server-side PHP.

### Footer restoration

The original WordPress export included footer widgets and search functionality that depended on WordPress plugins and widgets. Those elements needed to be repaired for the static archive.

The footer repair restored a working search interface and replaced the broken RSS widget with generated static HTML. Existing feed content, including Quanta, was preserved where appropriate. The repair also removed obsolete WordPress and Book Lite theme credits.

The changes were applied across 1,532 HTML files. Feed content was refreshed in 1,511 files, with five articles rendered in the relevant feed widget. Automated validation completed with zero reported errors.

The search interface uses local assets:

- `assets/search.css`
- `assets/search.js`

These assets provide the search widget's styling and client-side behavior without depending on the former WordPress search implementation.

### Static RSS feed generation

RSS feeds cannot be fetched directly by ordinary browser-side JavaScript from every publisher because of cross-origin restrictions, and some feeds may not be accessible reliably from the browser. The archive therefore uses a build-time process to retrieve feed items and render them into static HTML.

The main generator is:

` scripts/build_static_feeds.py `

The generator retrieves feed data, renders article entries into HTML, and supports fallback behavior when a feed cannot be retrieved. Network requests use a timeout and retry mechanism to make updates more resilient to temporary failures.

The generated HTML is published with the rest of the static website. Visitors can read the rendered feed content without requiring the original WordPress RSS widgets.

### Selected Feeds page

The Selected Feeds page has been converted to use a template-driven static feed system.

The principal files are:

- `links/selected-feeds/index.template.html` — the template used to preserve the page's layout and structure.
- `links/selected-feeds/index.html` — the generated HTML served by GitHub Pages.
- `scripts/build_static_feeds.py` — the script responsible for retrieving and rendering feed content.

The conversion preserves the existing feed selection and page layout while replacing the former WordPress-dependent feed rendering with generated HTML. The page retains its selected sources, including Arts & Letters Daily and Quanta, along with the other feeds in the collection.

### Automated updates with GitHub Actions

A GitHub Actions workflow periodically refreshes the generated feed content. The workflow can also be triggered manually.

When the workflow runs, it retrieves the latest available feed items, regenerates the relevant HTML, and commits and pushes changes when the generated output differs from the existing version.

This makes routine RSS updates automatic rather than requiring manual edits to the published HTML.

The template is the source for maintaining the page's structure; the generated HTML is the published output. When changing the page's layout or feed configuration, update the appropriate source files and regenerate the output rather than treating the generated page as the sole source of truth.

### Extending the approach to other links pages

Other pages in the Links section contain additional RSS feeds and may benefit from the same static-generation approach.

When converting another page:

1. Preserve its existing layout, headings, feed order, and relevant links.
2. Keep an original or template copy before modifying the page.
3. Identify the original feed URLs and any display settings that need to be retained.
4. Generate the static feed content and review the resulting HTML.
5. Validate the page locally before replacing the published version.
6. Extend the automation to cover the additional page and its feeds where appropriate.

The Selected Feeds implementation provides a starting point for future conversions, but each page should be reviewed individually rather than assuming every WordPress RSS widget has identical settings or requirements.
