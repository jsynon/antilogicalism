
(() => {
  const forms = document.querySelectorAll("[data-antilogicalism-search]");
  if (!forms.length) return;

  const SEARCH_PAGE = "/antilogicalism/search.html";

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
      .filter((item) => item.document)
      .sort((a, b) =>
        b.matched - a.matched || b.score - a.score
      )
      .slice(0, 20);

    results.replaceChildren();

    if (!ranked.length) {
      status.textContent =
        `No results found for “${query}”. Try different words.`;
      return;
    }

    for (const item of ranked) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      const excerpt = document.createElement("p");

      link.href = item.document.url;
      link.textContent = item.document.title || "Untitled page";
      excerpt.textContent = item.document.excerpt || "";

      li.append(link);

      if (excerpt.textContent) {
        li.append(excerpt);
      }

      results.append(li);
    }

    status.textContent =
      `Showing ${ranked.length} results for “${query}”.`;
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
