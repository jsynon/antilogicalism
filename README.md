# Antilogicalism

**A digital archive of philosophy, literature, history, and the humanities.**

[Visit Antilogicalism](https://jsynon.github.io/antilogicalism/)

## About the Project

Antilogicalism is an independent digital humanities project dedicated to the preservation, organization, and accessibility of philosophical and intellectual resources.

Originally established in 2016 as a personal website devoted to philosophy, literature, and critical inquiry, Antilogicalism has evolved into something considerably larger: a digital archive combining historical writings, contemporary scholarship, curated reading collections, and searchable primary-source texts.

The project is built around a simple conviction: **the history of human thought should be accessible to anyone with the curiosity to explore it.**

Rather than presenting philosophy as a closed academic discipline or a collection of settled doctrines, Antilogicalism approaches it as an ongoing conversation—one that crosses historical periods, intellectual traditions, cultures, and disciplines.

The website is both an archive of that conversation and an invitation to participate in it.

## Why Antilogicalism Exists

The internet has made an extraordinary amount of human knowledge available, but availability is not the same as accessibility.

Important philosophical works remain scattered across institutional repositories, digitized collections, academic websites, and aging archives. Even when these materials are freely available, finding relevant passages, discovering connections between texts, and navigating large collections can be unnecessarily difficult.

Meanwhile, the contemporary internet increasingly prioritizes immediacy, engagement, and commercial value over sustained intellectual attention.

Antilogicalism represents a different approach.

Its purpose is not simply to accumulate information, but to organize resources in ways that encourage reading, reflection, comparison, and discovery.

Several principles guide the project:

- **Open access:** Philosophical and historical resources should be available without unnecessary financial or institutional barriers.
- **Preservation:** Older websites, documents, and digital collections deserve to remain accessible as technologies change.
- **Intellectual independence:** Readers should be encouraged to investigate competing perspectives rather than accept predetermined conclusions.
- **Contextual discovery:** Connections between authors, works, subjects, and historical traditions can make large collections more useful.
- **Long-term sustainability:** A digital archive should remain functional without depending entirely on expensive infrastructure, proprietary platforms, or continuously running services.

The goal is not to replace libraries, universities, or scholarly databases. It is to complement them by creating an independent point of entry into the history of ideas.

## From WordPress to a Static Archive

Antilogicalism originally operated as a WordPress website.

Over time, the site accumulated a substantial collection of articles, excerpts, reading recommendations, links, and resources. Preserving that material became an important part of the project's development.

The restoration process involved recovering the original WordPress database, reconstructing the website in a local development environment, and exporting its content into a static site suitable for hosting on GitHub Pages.

This approach preserved much of the original website's identity while eliminating its dependence on a live WordPress installation and database.

The restored site retains the Book Lite visual theme, familiar navigation, and the structure of the original archive, while incorporating new search and discovery tools.

The resulting architecture offers several advantages:

- Static HTML, CSS, and JavaScript can be served without a traditional application server.
- Git provides version history and a transparent record of changes.
- GitHub Pages provides public hosting.
- Search indexes and content data can be generated in advance.
- Automated workflows can refresh selected content without requiring a permanently running backend.
- The archive can be maintained and developed incrementally.

The decision to use static infrastructure is both practical and philosophical: it reduces the resources required to keep the archive available.

## The Digital Library

One of the project's largest developments is a searchable digital library of historical texts.

The library brings together digitized works from major collections of philosophy, literature, religion, history, and related disciplines.

Rather than functioning only as a catalog of books, it provides tools for searching within their contents.

### Full-Text Search

The library search system is built around text extracted from digitized documents using optical character recognition (OCR).

Its development has involved:

1. Extracting and processing text from source documents.
2. Normalizing text and identifying searchable content.
3. Organizing documents into collections, volumes, and individual pages.
4. Building an inverted search index for efficient retrieval.
5. Partitioning and compressing index data for browser-based delivery.
6. Connecting search results to the relevant books and source pages.
7. Identifying and correcting OCR errors that interfere with accurate retrieval.

The search interface supports different matching methods, including exact phrases, all-word matches, and any-word matches, as well as collection and book filtering.

Search results are intended to help readers move directly from a question or phrase to the relevant passage in its original textual context.

### OCR Quality and Search Accuracy

Digitization does not automatically produce reliable text.

Historical documents often contain faded print, unusual typography, damaged pages, multiple languages, and inconsistent formatting. OCR systems can misread characters, merge words, or omit passages entirely.

For that reason, the project includes ongoing work to identify and repair OCR problems, rebuild affected search indexes, and improve the reliability of results.

This is an important distinction: the library is not simply a collection of uploaded documents. It is an effort to make those documents meaningfully searchable.

## The Bookshelf and Reading Collections

Alongside full-text search, Antilogicalism provides a curated bookshelf designed for browsing and discovery.

The bookshelf organizes works by intellectual tradition, subject, collection, and author, providing a more exploratory alternative to keyword searching.

The distinction is intentional.

Search is useful when a reader already knows what they want to find. Browsing is useful when they do not.

Both are necessary for a library that aims to encourage intellectual discovery rather than merely retrieve information.

## The Article Archive

The original Antilogicalism blog remains an important part of the website.

Its articles span philosophical questions, intellectual history, literature, religion, cultural criticism, and related subjects.

The restoration process preserved the historical content and made it accessible through a dedicated search system.

Additional development has focused on connecting articles to relevant books in the digital library.

These relationships are established using contextual evidence such as:

- Authors mentioned or discussed in an article.
- Article tags and subject metadata.
- Titles and references appearing in the text.
- Thematic relationships between an article and a source work.
- Review of candidate recommendations for contextual accuracy.

The intention is to create pathways between contemporary discussion and primary-source reading.

An article about an existentialist thinker, for example, becomes an opportunity to discover the thinker’s original writings rather than remaining an isolated piece of content.

## Curated Resources and Automated Feeds

Antilogicalism also maintains collections of links to philosophical journals, educational resources, independent publications, and other sources of intellectual commentary.

Selected pages incorporate RSS feeds, allowing visitors to discover recently published material from outside the archive.

Because the website is statically hosted, these feeds are processed through automated Python scripts and GitHub Actions workflows.

The general process is straightforward:

1. Retrieve content from selected external RSS sources.
2. Parse and normalize the available entries.
3. Generate updated HTML listings.
4. Preserve the surrounding website layout.
5. Commit changes through an automated GitHub workflow.

This allows portions of the site to remain current without requiring a live content-management system.

The archive therefore combines two different timescales: the preservation of historical material and the ongoing circulation of new ideas.

## Technical Architecture

Antilogicalism uses a combination of static web technologies, Python-based data processing, and automated deployment workflows.

| Component | Technology or Approach |
|---|---|
| Website hosting | GitHub Pages |
| Version control | Git and GitHub |
| Frontend | HTML, CSS, JavaScript |
| Original platform | WordPress |
| Local restoration | Laragon, Apache, MySQL |
| Data processing | Python |
| Library indexing | Inverted full-text indexes |
| Search data | Partitioned and compressed index files |
| Document processing | OCR extraction, normalization, and repair |
| Content updates | GitHub Actions |
| External publications | RSS aggregation |
| Deployment | Static files published from GitHub |

The project favors precomputed data and client-side interaction wherever practical.

This makes it possible to provide relatively sophisticated search functionality while keeping hosting requirements low.

Some of the larger data-processing operations are performed locally before the generated indexes and supporting files are published.

### Repository Organization

The website repository contains the public-facing static archive, including its pages, assets, search interfaces, and supporting scripts.

Large library datasets and search indexes are maintained separately where appropriate to keep the website architecture manageable.

Related repositories and tools support tasks such as OCR processing, search-index construction, content restoration, and automated updates.

Together, these components form a small digital-library infrastructure rather than a conventional blog alone.

## Development Philosophy

Antilogicalism is an independently developed project built through experimentation, research, and iterative problem-solving.

Its development has involved working across several layers of technology: database restoration, static-site generation, document processing, search algorithms, frontend design, and automation.

A recurring priority is to improve functionality without sacrificing the original character of the website.

New features should feel like extensions of the archive rather than disconnected applications.

The project also emphasizes practical solutions over unnecessary complexity. A feature does not require a large software framework or commercial infrastructure simply because such tools are available.

Where possible, the preferred approach is understandable, maintainable, and reproducible.

## Ongoing Development

Antilogicalism remains an evolving project.

Areas of continued development include:

- Improving full-text search accuracy and performance.
- Repairing OCR errors in historical documents.
- Expanding relationships between articles and primary-source books.
- Refining browsing, navigation, and search interfaces.
- Improving the consistency of the website's visual design.
- Preserving additional historical resources.
- Expanding automated content updates.
- Exploring new methods of semantic discovery and contextual retrieval.

These efforts share a common purpose: making the archive easier to navigate, more reliable to search, and more valuable to readers.

## A Living Archive

Antilogicalism is not intended to be a finished encyclopedia or an authoritative statement about philosophy.

It is a continuing attempt to preserve, connect, and make accessible some of the ideas through which human beings have tried to understand themselves and their world.

Philosophy is not merely a history of answers. It is also a history of questions, disagreements, reinterpretations, and unresolved problems.

A digital archive can help keep those conversations open.

That is ultimately the purpose of Antilogicalism: **not to tell readers what to think, but to make it easier for them to encounter what others have thought—and to think for themselves.**

---

**Website:** https://jsynon.github.io/antilogicalism/

**Project established:** 2016

**Development and curation:** Joshua Synon
