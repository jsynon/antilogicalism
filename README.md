# Antilogicalism — Static Archive

A static version of Antilogicalism published through GitHub Pages.

Live site:
https://jsynon.github.io/antilogicalism/

## How It Was Made

The site started with a backup of the original Antilogicalism WordPress installation.

The backup was restored locally using **Laragon**, creating a working local version at:

```text
https://antilogicalism.test/
```

**Simply Static** was then used to crawl the local WordPress site and generate a static export.

The resulting ZIP was about **9 GB**, mostly because of the site's large collection of PDFs. After extracting the archive with **7-Zip**, the PDFs were removed, reducing the site to roughly **700 MB**.

The first GitHub Pages version had broken styling because Simply Static had preserved URLs pointing to the local `.test` domain. GitHub Pages also serves this repository as a project site under:

```text
/antilogicalism/
```

A small Python script, `fix_site.py`, was created to rewrite those URLs and adjust root-relative WordPress paths so that CSS, JavaScript, images, navigation, and other resources would work correctly on GitHub Pages.

The repaired site was then published using **GitHub Desktop**.

## Result

The website now exists as a collection of static files and can be served without WordPress, PHP, or a database.

```text
WordPress backup
      ↓
    Laragon
      ↓
Simply Static
      ↓
Remove PDFs
      ↓
  fix_site.py
      ↓
 GitHub Pages
```

This repository is currently a static snapshot of Antilogicalism. A future project could replace Simply Static with a custom Python generator that builds the site directly from the WordPress backup.
