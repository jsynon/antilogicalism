# Antilogicalism

**An independent digital archive of philosophy, literature, history, religion, and the humanities.**

[Visit the Website](https://jsynon.github.io/antilogicalism/) | [Explore the Bookshelf](https://jsynon.github.io/antilogicalism/primary-sources/) | [Library Search](https://jsynon.github.io/antilogicalism/digital-library/) | [Reading Companion Repository](https://github.com/jsynon/book-chatbot) | [Library Data](https://github.com/jsynon/antilogicalism-library-data)

## About

Founded in 2016, Antilogicalism began as a personal exploration of philosophy, literature, religion, and the history of ideas. Over the years, it developed into an extensive collection of articles, primary sources, historical texts, and educational resources. Today, the project is being restored and expanded as an independent digital humanities archive, combining its original content with new tools for searching, organizing, and discovering intellectual works.

The underlying purpose is to make the history of human thought more accessible. Although the internet contains an extraordinary wealth of philosophical and historical material, much of it remains scattered across institutional repositories, aging websites, and difficult-to-navigate collections. Antilogicalism seeks to bring these resources into a more coherent environment where readers can explore competing perspectives, discover connections between ideas, and engage directly with primary sources. It is not intended to prescribe a particular worldview, but to encourage independent inquiry and sustained intellectual curiosity.

## Restoration and Development

The original Antilogicalism website was built on WordPress. Its restoration involved recovering the original database, reconstructing the site locally using Laragon, Apache, and MySQL, and converting its contents into a static archive hosted on GitHub Pages. This preserved the original Book Lite theme, navigation, articles, and historical structure while removing the need for a continuously running WordPress installation.

The restoration also provided an opportunity to expand the website beyond its original capabilities. The archive now incorporates dedicated blog search, a consolidated Bookshelf for browsing historical works, a full-text digital library, and contextual recommendations connecting articles to relevant books. Selected resource pages also use automated RSS updates to maintain links to contemporary publications. These additions are designed to complement the original website rather than replace its character.

## The Digital Library

One of the project's central developments is a searchable library of digitized works spanning philosophy, literature, religion, history, and related disciplines. Unlike a conventional catalog, the library allows readers to search within the actual contents of books and locate relevant passages at the page level.

The search infrastructure is built using Python-based document processing and optical character recognition (OCR). Extracted text is normalized, organized by collection and volume, and transformed into compressed, partitioned inverted indexes. These indexes can be queried through JavaScript in the browser, allowing the library to provide full-text search without a dedicated backend search server. Supported search methods include exact phrases, all-word matches, and any-word matches, alongside collection and book filters.

OCR accuracy remains an important area of development. Historical documents frequently contain damaged print, unusual typography, and recognition errors that can make passages difficult or impossible to retrieve. The project therefore includes tools for identifying corrupted text, evaluating repairs, and rebuilding affected index partitions. The resulting datasets are maintained separately in the [Antilogicalism Library Data](https://github.com/jsynon/antilogicalism-library-data) repository.

## The Reading Companion

The Reading Companion is a live chatbot on the Antilogicalism website, hosted with Cloudflare. It lets readers ask questions across all 642 books in the digital library. Its pipeline retrieves relevant passages, selects supporting evidence, and composes concise answers with citations that link back to the source text. The [Reading Companion repository](https://github.com/jsynon/book-chatbot) contains the application and its ongoing development.

Answer quality continues to be evaluated and improved. The cited passages let readers inspect the original wording and draw their own conclusions, keeping the tool focused on supporting direct engagement with primary sources.

## Search, Discovery, and Organization

Antilogicalism approaches discovery through several complementary systems. The Bookshelf, presented as *A History of Ideas*, organizes works by collection, subject, and author for exploratory browsing. The digital library provides page-level full-text search, while the original article archive uses a separate precomputed search index with ranked results and pagination.

The project also connects blog articles to relevant books using author references, article tags, bibliographic information, and contextual relationships. These recommendations are evaluated for relevance rather than generated through superficial keyword matching. The intention is to help readers move naturally between contemporary commentary and the historical works that inform it.

## Technical Overview

| Component | Technology |
|---|---|
| Hosting and version control | GitHub Pages, Git |
| Frontend | HTML, CSS, JavaScript |
| Original platform | WordPress, Book Lite theme |
| Local restoration | Laragon, Apache, MySQL |
| Data processing | Python |
| Search infrastructure | JSON and compressed inverted indexes |
| Document processing | OCR extraction and repair |
| Automation | GitHub Actions, Python, RSS |

The architecture emphasizes static hosting, precomputed data, and browser-based functionality. Computationally intensive tasks such as document indexing and OCR repair are performed during development, while the published website serves the resulting files directly. This approach reduces hosting costs, simplifies maintenance, and helps ensure that the archive can remain accessible without depending on commercial infrastructure or proprietary services.

## Ongoing Development

Antilogicalism remains a work in progress. Current priorities include improving OCR accuracy, expanding contextual relationships between articles and books, refining search and navigation, and preserving additional historical resources. Future exploration may also include semantic search and language-model-assisted discovery, provided these technologies support rather than replace direct engagement with original texts.

The project is guided by the belief that philosophy is not merely a collection of established answers, but an ongoing conversation across generations, cultures, and intellectual traditions. Antilogicalism exists to help preserve that conversation and make it easier to enter. Its purpose is ultimately **not to tell readers what to think, but to make it easier for them to encounter what others have thought—and to think for themselves.**

---

**Established:** 2016  
**Developed and curated by:** Joshua Synon
