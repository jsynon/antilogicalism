(() => {
  const root = document.getElementById("bookshelf-browse");
  if (!root) return;

  const searchInput = root.querySelector("#bookshelf-search");
  const legacyAuthorSearch = root.querySelector("#bookshelf-author-search");
  const legacyTitleSearch = root.querySelector("#bookshelf-title-search");
  const results = root.querySelector(".bookshelf-results");
  const pageLabel = root.querySelector(".bookshelf-page-label");
  const previous = root.querySelector(".bookshelf-previous");
  const next = root.querySelector(".bookshelf-next");
  const perPage = 15;
  let data = null;
  let currentPage = 1;

  const normalize = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US");

  const setText = (tag, className, value) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  };

  const authorItems = (entries) => {
    const grouped = new Map();
    entries.forEach((entry) => {
      const key = normalize(entry.author || "Anonymous");
      if (!grouped.has(key)) grouped.set(key, {
        author: entry.author || "Anonymous",
        sortSurname: entry.sortSurname || entry.author || "",
        entries: [],
      });
      grouped.get(key).entries.push(entry);
    });
    return [...grouped.values()].sort((a, b) =>
      normalize(a.sortSurname).localeCompare(normalize(b.sortSurname)) ||
      normalize(a.author).localeCompare(normalize(b.author))
    );
  };

  const renderBookLinks = (books) => {
    const list = document.createElement("ul");
    list.className = "bookshelf-book-links";
    books.forEach((book) => {
      if (!book.url || !/^(https?:\/\/|\/antilogicalism\/)/i.test(book.url)) return;
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
    section.className = "bookshelf-descriptions";
    descriptions.forEach((markup) => {
      const paragraph = document.createElement("p");
      paragraph.innerHTML = markup;
      section.append(paragraph);
    });
    return section;
  };

  const renderEntry = (container, entry) => {
    if (entry.section) container.append(setText("p", "bookshelf-series", entry.section));
    container.append(renderBookLinks(entry.books));
    container.append(renderDescriptions(entry.descriptions));
  };

  const renderAuthor = (item) => {
    const card = document.createElement("article");
    card.className = "bookshelf-result bookshelf-author-result";
    card.append(setText("h3", "", item.author));
    item.entries.forEach((entry) => {
      const group = document.createElement("div");
      group.className = "bookshelf-work-group";
      renderEntry(group, entry);
      card.append(group);
    });
    return card;
  };

  const renderExtras = (catalog) => {
    const extras = document.querySelector(".bookshelf-extras");
    const resources = document.querySelector(".bookshelf-extra-resources");
    const notes = document.querySelector(".bookshelf-extra-notes");
    if (!extras || !resources || !notes) return;
    resources.replaceChildren();
    notes.replaceChildren();
    (catalog.resources || []).forEach((resource) => {
      const card = document.createElement("article");
      card.className = "bookshelf-resource";
      const title = document.createElement("h3");
      const link = document.createElement("a");
      link.href = resource.url;
      link.textContent = resource.title;
      if (/^https?:\/\//i.test(resource.url)) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      title.append(link);
      card.append(title);
      if (resource.section) card.append(setText("p", "bookshelf-series", resource.section));
      card.append(renderDescriptions(resource.descriptions || []));
      resources.append(card);
    });
    (catalog.notes || []).forEach((markup) => {
      const paragraph = document.createElement("p");
      paragraph.innerHTML = markup;
      notes.append(paragraph);
    });
    extras.hidden = !(resources.childElementCount || notes.childElementCount);
  };

  const render = () => {
    const combinedSearch = Boolean(searchInput) || !legacyTitleSearch;
    const query = normalize((searchInput || legacyAuthorSearch)?.value.trim() || "");
    const authorQuery = combinedSearch ? query : normalize(legacyAuthorSearch?.value.trim() || "");
    const titleQuery = combinedSearch ? query : normalize(legacyTitleSearch?.value.trim() || "");
    const filtered = authorItems(data.entries)
      .map((item) => {
        const authorMatches = Boolean(authorQuery) && normalize(item.author).includes(authorQuery);
        const entries = item.entries.map((entry) => ({
          ...entry,
          books: entry.books.filter((book) => combinedSearch
            ? (!query || authorMatches || normalize(book.title).includes(query))
            : (!titleQuery || normalize(book.title).includes(titleQuery))),
        })).filter((entry) => entry.books.length);
        return { ...item, entries };
      })
      .filter((item) => item.entries.length && (combinedSearch || !authorQuery || normalize(item.author).includes(authorQuery)));
    const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
    currentPage = Math.min(Math.max(1, currentPage), pageCount);
    const visible = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
    results.replaceChildren();
    visible.forEach((item) => results.append(renderAuthor(item)));
    if (!filtered.length) results.append(setText("p", "bookshelf-empty", (query || authorQuery || titleQuery) ? "No matching books or authors found." : "No authors found."));
    pageLabel.textContent = filtered.length
      ? `Page ${currentPage} of ${pageCount} · ${perPage} authors per page`
      : "No entries to display";
    previous.disabled = currentPage <= 1;
    next.disabled = currentPage >= pageCount;
  };

  const resetAndRender = () => { currentPage = 1; render(); };
  const scrollToResults = () => results.scrollIntoView({ behavior: "smooth", block: "start" });
  if (searchInput) searchInput.addEventListener("input", resetAndRender);
  else {
    legacyAuthorSearch?.addEventListener("input", resetAndRender);
    legacyTitleSearch?.addEventListener("input", resetAndRender);
  }
  previous.addEventListener("click", () => { currentPage -= 1; render(); scrollToResults(); });
  next.addEventListener("click", () => { currentPage += 1; render(); scrollToResults(); });

  const displayCatalog = (catalog) => {
    data = catalog;
    const intro = document.querySelector(".bookshelf-category-intro");
    if (intro && data.introHtml) intro.innerHTML = data.introHtml;
    renderExtras(data);
    results.setAttribute("aria-busy", "false");
    render();
  };

  const showLoadError = () => {
    results.setAttribute("aria-busy", "false");
    results.replaceChildren(setText("p", "bookshelf-empty", "The browse list could not be loaded. Please reload the page."));
    pageLabel.textContent = "Browse list unavailable";
  };

  if (window.BOOKSHELF_BROWSE_DATA) {
    displayCatalog(window.BOOKSHELF_BROWSE_DATA);
    return;
  }
  fetch(new URL("bookshelf-browse-data.json", window.location.href))
    .then((response) => {
      if (!response.ok) throw new Error("The bookshelf catalog could not be loaded.");
      return response.json();
    })
    .then(displayCatalog)
    .catch(showLoadError);
})();
