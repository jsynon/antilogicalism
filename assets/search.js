// Add the Reading Companion to the existing Book Lite navigation without
// rewriting 1,500+ independently exported static HTML pages.
(() => {
  const menu=document.getElementById('menu-primary');
  if(!menu || menu.querySelector('a[href="/antilogicalism/reading-companion/"]'))return;
  const item=document.createElement('li');
  item.className='menu-item menu-item-reading-companion';
  const link=document.createElement('a');
  link.href='/antilogicalism/reading-companion/';
  link.textContent='Reading Companion';
  if(location.pathname.startsWith('/antilogicalism/reading-companion/')){
    item.className+=' current-menu-item';
    link.setAttribute('aria-current','page');
  }
  item.appendChild(link);
  const after=menu.querySelector('.menu-item-library-search');
  if(after)after.insertAdjacentElement('afterend',item);
  else menu.appendChild(item);
})();


(() => {
  const forms = document.querySelectorAll("[data-antilogicalism-search]");
  if (!forms.length) return;

  const SEARCH_PAGE = "/antilogicalism/search.html";
  const BLOG_POST_URL = /^\/antilogicalism\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/;
  const PAGE_SIZE = 20;

  function tokenize(text) {
    return text.toLocaleLowerCase().match(
      /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu
    ) || [];
  }

  async function loadIndex() {
    const response = await fetch("/antilogicalism/search-index.json");

    if (!response.ok) {
      throw new Error(`Search index returned ${response.status}`);
    }

    return response.json();
  }

  function showResults(index, query, status, results) {
    const words = [...new Set(tokenize(query))];
    const scores = new Map();
    const matchedTerms = new Map();

    for (const word of words) {
      const postings = index.terms[word];
      if (!postings) continue;

      for (const [docId, titleCount, bodyCount] of postings) {
        scores.set(
          docId,
          (scores.get(docId) || 0) + titleCount * 10 + bodyCount
        );

        matchedTerms.set(
          docId,
          (matchedTerms.get(docId) || 0) + 1
        );
      }
    }

    const ranked = [...scores.entries()]
      .map(([docId, score]) => ({
        document: index.documents[docId],
        score,
        matched: matchedTerms.get(docId) || 0
      }))
      .filter((item) => item.document && BLOG_POST_URL.test(item.document.url))
      .sort((a, b) =>
        b.matched - a.matched || b.score - a.score
      );

    results.replaceChildren();
    let pagination = results.nextElementSibling;

    if (!pagination || !pagination.matches("[data-search-pagination]")) {
      pagination = document.createElement("nav");
      pagination.className = "antilogicalism-search-pagination";
      pagination.dataset.searchPagination = "";
      pagination.setAttribute("aria-label", "Search result pages");

      const previous = document.createElement("button");
      previous.type = "button";
      previous.textContent = "Previous 20";
      previous.dataset.searchPrevious = "";

      const pageLabel = document.createElement("span");
      pageLabel.dataset.searchPageLabel = "";
      pageLabel.setAttribute("aria-live", "polite");

      const next = document.createElement("button");
      next.type = "button";
      next.textContent = "Next 20";
      next.dataset.searchNext = "";

      pagination.append(previous, pageLabel, next);
      results.insertAdjacentElement("afterend", pagination);
    }

    const previousButton = pagination.querySelector("[data-search-previous]");
    const nextButton = pagination.querySelector("[data-search-next]");
    const pageLabel = pagination.querySelector("[data-search-page-label]");

    if (!ranked.length) {
      pagination.hidden = true;
      status.textContent =
        `No results found for “${query}”. Try different words.`;
      return;
    }

    const totalPages = Math.ceil(ranked.length / PAGE_SIZE);
    const params = new URLSearchParams(window.location.search);
    let currentPage = Number.parseInt(params.get("page") || "1", 10);

    if (!Number.isFinite(currentPage) || currentPage < 1) currentPage = 1;
    currentPage = Math.min(currentPage, totalPages);

    function renderPage(shouldScroll = false) {
      const start = (currentPage - 1) * PAGE_SIZE;
      const pageResults = ranked.slice(start, start + PAGE_SIZE);
      results.replaceChildren();

      for (const item of pageResults) {
        const li = document.createElement("li");
        const link = document.createElement("a");
        const excerpt = document.createElement("p");

        link.href = item.document.url;
        link.textContent = item.document.title || "Untitled post";
        excerpt.textContent = item.document.excerpt || "";

        li.append(link);

        if (excerpt.textContent) {
          li.append(excerpt);
        }

        results.append(li);
      }

      const firstResult = start + 1;
      const lastResult = start + pageResults.length;
      status.textContent =
        `Showing posts ${firstResult}–${lastResult} of ${ranked.length} for “${query}”.`;

      pagination.hidden = totalPages <= 1;
      previousButton.hidden = currentPage === 1;
      nextButton.hidden = currentPage === totalPages;
      pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;

      if (shouldScroll) {
        results.setAttribute("tabindex", "-1");
        results.focus({ preventScroll: true });
        results.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function changePage(nextPage, addHistoryEntry = true) {
      currentPage = Math.max(1, Math.min(nextPage, totalPages));
      const nextParams = new URLSearchParams(window.location.search);
      nextParams.set("q", query);

      if (currentPage === 1) {
        nextParams.delete("page");
      } else {
        nextParams.set("page", String(currentPage));
      }

      const newUrl = `${window.location.pathname}?${nextParams.toString()}`;
      if (addHistoryEntry) {
        window.history.pushState({}, "", newUrl);
      } else {
        window.history.replaceState({}, "", newUrl);
      }

      renderPage(true);
    }

    previousButton.addEventListener("click", () => changePage(currentPage - 1));
    nextButton.addEventListener("click", () => changePage(currentPage + 1));
    window.addEventListener("popstate", () => {
      const pageFromUrl = Number.parseInt(
        new URLSearchParams(window.location.search).get("page") || "1",
        10
      );
      changePage(Number.isFinite(pageFromUrl) ? pageFromUrl : 1, false);
    });

    renderPage();
  }

  // Every search form navigates to the dedicated results page.
  for (const form of forms) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const input = form.querySelector('input[type="search"]');
      const query = input?.value.trim();

      if (!query) {
        input?.focus();
        return;
      }

      window.location.href =
        SEARCH_PAGE + "?q=" + encodeURIComponent(query);
    });
  }

  // Only load the large index on the dedicated results page.
  const results = document.querySelector("[data-search-results]");
  const status = document.querySelector("[data-search-status]");

  if (!results || !status) return;

  const params = new URLSearchParams(window.location.search);
  const query = params.get("q")?.trim() || "";
  const resultsInput = document.querySelector(
    "[data-search-results-page] input[type='search']"
  );

  if (resultsInput) resultsInput.value = query;

  if (!query) {
    status.textContent = "Enter a search term to explore the archive.";
    return;
  }

  status.textContent = "Searching the archive…";

  loadIndex()
    .then((index) => showResults(index, query, status, results))
    .catch((error) => {
      console.error("Antilogicalism search failed:", error);
      status.textContent =
        "Search could not load. Please try again in a moment.";
    });
})();
