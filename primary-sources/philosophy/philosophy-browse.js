(() => {
  const root = document.getElementById("philosophy-browse");
  if (!root) return;

  const periodSelect = root.querySelector("#philosophy-period");
  const searchInput = root.querySelector("#philosophy-search");
  const legacyAuthorSearch = root.querySelector("#philosophy-author-search");
  const legacyTitleSearch = root.querySelector("#philosophy-title-search");
  const results = root.querySelector(".philosophy-results");
  const pageLabel = root.querySelector(".philosophy-page-label");
  const previous = root.querySelector(".philosophy-previous");
  const next = root.querySelector(".philosophy-next");
  const perPage = 15;
  let data = null;
  let currentPage = 1;

  const validPeriods = new Set([...periodSelect.options].map((option) => option.value));
  const requestedPeriod = new URLSearchParams(window.location.search).get("era");
  if (validPeriods.has(requestedPeriod)) periodSelect.value = requestedPeriod;

  const syncPeriodUrl = () => {
    const url = new URL(window.location.href);
    if (periodSelect.value === "all") url.searchParams.delete("era");
    else url.searchParams.set("era", periodSelect.value);
    window.history.replaceState({}, "", url);
  };

  const normalize = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US");

  const activeEntries = () => data.entries.filter((entry) =>
    periodSelect.value === "all" || entry.period === periodSelect.value
  );

  const authorItems = (entries) => {
    const grouped = new Map();
    entries.forEach((entry) => {
      const author = entry.author || "Anonymous";
      const key = normalize(author);
      if (!grouped.has(key)) {
        grouped.set(key, {
          author,
          sortSurname: entry.sortSurname || author,
          periods: new Set(),
          blocks: [],
        });
      }
      const item = grouped.get(key);
      item.periods.add(entry.periodLabel);
      item.blocks.push(entry);
    });
    return [...grouped.values()].sort((a, b) =>
      normalize(a.sortSurname).localeCompare(normalize(b.sortSurname)) ||
      normalize(a.author).localeCompare(normalize(b.author))
    );
  };

  const setText = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };

  const renderBookLinks = (books) => {
    const list = document.createElement("ul");
    list.className = "philosophy-book-links";
    books.forEach((book) => {
      if (!book.url || !book.url.startsWith("https://drive.google.com/file/d/")) return;
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = book.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = book.title;
      item.append(link);
      list.append(item);
    });
    return list;
  };

  const renderDescriptions = (descriptions) => {
    const section = document.createElement("div");
    section.className = "philosophy-descriptions";
    descriptions.forEach((markup) => {
      const paragraph = document.createElement("p");
      paragraph.innerHTML = markup;
      section.append(paragraph);
    });
    return section;
  };

  const renderAuthor = (item) => {
    const card = document.createElement("article");
    card.className = "philosophy-result philosophy-author-result";
    const heading = document.createElement("div");
    heading.className = "philosophy-result-heading";
    heading.append(setText("h3", "", item.author));
    const periodList = document.createElement("div");
    periodList.className = "philosophy-period-badges";
    [...item.periods].forEach((label) => periodList.append(setText("span", "", label)));
    heading.append(periodList);
    card.append(heading);

    item.blocks.forEach((block) => {
      const group = document.createElement("div");
      group.className = "philosophy-work-group";
      group.append(renderBookLinks(block.books));
      group.append(renderDescriptions(block.descriptions));
      card.append(group);
    });
    return card;
  };

  const renderSingleEntry = (entry) => {
    const card = document.createElement("article");
    card.className = `philosophy-result philosophy-${entry.kind}-result`;
    const headingText = entry.kind === "collection"
      ? (entry.collectionTitle || entry.books[0]?.title || "Collection")
      : (entry.books[0]?.title || "Untitled entry");
    card.append(setText("h3", "", headingText));
    if (entry.author && entry.author !== "Anonymous") {
      card.append(setText("p", "philosophy-byline", `Author: ${entry.author}`));
    }
    const labels = document.createElement("div");
    labels.className = "philosophy-period-badges";
    labels.append(setText("span", "", entry.periodLabel));
    card.append(labels);
    card.append(renderBookLinks(entry.books));
    card.append(renderDescriptions(entry.descriptions));
    return card;
  };

  const render = () => {
    const combinedSearch = Boolean(searchInput) || !legacyTitleSearch;
    const query = normalize((searchInput || legacyAuthorSearch)?.value.trim() || "");
    const authorQuery = combinedSearch ? query : normalize(legacyAuthorSearch?.value.trim() || "");
    const titleQuery = combinedSearch ? query : normalize(legacyTitleSearch?.value.trim() || "");
    const items = authorItems(activeEntries())
      .map((item) => {
        const authorMatches = Boolean(authorQuery) && normalize(item.author).includes(authorQuery);
        const blocks = item.blocks.map((block) => ({
          ...block,
          books: block.books.filter((book) => combinedSearch
            ? (!query || authorMatches || normalize(book.title).includes(query))
            : (!titleQuery || normalize(book.title).includes(titleQuery))),
        })).filter((block) => block.books.length);
        return { ...item, blocks, periods: new Set(blocks.map((block) => block.periodLabel)) };
      })
      .filter((item) => item.blocks.length && (combinedSearch || !authorQuery || normalize(item.author).includes(authorQuery)));

    const pageCount = Math.max(1, Math.ceil(items.length / perPage));
    currentPage = Math.min(Math.max(1, currentPage), pageCount);
    const visible = items.slice((currentPage - 1) * perPage, currentPage * perPage);
    results.replaceChildren();
    visible.forEach((item) => results.append(renderAuthor(item)));

    if (!items.length) results.append(setText("p", "philosophy-empty", (query || authorQuery || titleQuery) ? "No matching books or authors found." : "No authors found."));
    pageLabel.textContent = items.length
      ? `Page ${currentPage} of ${pageCount} · ${perPage} author entries per page`
      : "No entries to display";
    previous.disabled = currentPage <= 1;
    next.disabled = currentPage >= pageCount;
  };

  const resetAndRender = () => { currentPage = 1; render(); };
  const scrollToResults = () => results.scrollIntoView({ behavior: "smooth", block: "start" });
  periodSelect.addEventListener("change", () => {
    currentPage = 1;
    syncPeriodUrl();
    render();
  });
  if (searchInput) searchInput.addEventListener("input", resetAndRender);
  else {
    legacyAuthorSearch?.addEventListener("input", resetAndRender);
    legacyTitleSearch?.addEventListener("input", resetAndRender);
  }
  window.addEventListener("popstate", () => {
    const period = new URLSearchParams(window.location.search).get("era");
    periodSelect.value = validPeriods.has(period) ? period : "all";
    currentPage = 1;
    render();
  });
  previous.addEventListener("click", () => {
    currentPage -= 1;
    render();
    scrollToResults();
  });
  next.addEventListener("click", () => {
    currentPage += 1;
    render();
    scrollToResults();
  });

  if (window.PHILOSOPHY_BROWSE_DATA) {
    data = window.PHILOSOPHY_BROWSE_DATA;
    results.setAttribute("aria-busy", "false");
    render();
    return;
  }

  const scriptUrl = document.currentScript?.src || window.location.href;
  fetch(new URL("philosophy-browse-data.json", scriptUrl))
    .then((response) => {
      if (!response.ok) throw new Error("The Philosophy browse catalog could not be loaded.");
      return response.json();
    })
    .then((catalog) => {
      data = catalog;
      results.setAttribute("aria-busy", "false");
      render();
    })
    .catch(() => {
      results.setAttribute("aria-busy", "false");
      results.replaceChildren(setText("p", "philosophy-empty", "The browse list could not be loaded. Please reload the page."));
      pageLabel.textContent = "Browse list unavailable";
    });
})();
