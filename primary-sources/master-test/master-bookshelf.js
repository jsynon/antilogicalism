(() => {
  const root = document.getElementById("master-bookshelf-test");
  if (!root) return;

  const categorySelect = root.querySelector("#master-category");
  const periodWrap = root.querySelector(".master-period-wrap");
  const periodSelect = root.querySelector("#master-period");
  const searchInput = root.querySelector("#master-search");
  const searchButton = root.querySelector(".master-search-button");
  const categoryIntro = root.querySelector(".master-category-intro");
  const results = root.querySelector(".master-results");
  const countLabel = root.querySelector(".master-count");
  const pageLabel = root.querySelector(".master-page-label");
  const previous = root.querySelector(".master-previous");
  const next = root.querySelector(".master-next");
  const resources = root.querySelector(".master-resources");
  const notes = root.querySelector(".master-notes");
  const perPage = 15;
  const cache = new Map();
  let catalog = null;
  let currentPage = 1;
  let requestNumber = 0;

  const categories = {
    philosophy: { name: "Philosophy", file: "philosophy/philosophy-browse-data.json", philosophy: true },
    science: { name: "Science", file: "science/bookshelf-browse-data.json" },
    psychology: { name: "Psychology", file: "psychology/bookshelf-browse-data.json" },
    religious: { name: "Religious", file: "religious/bookshelf-browse-data.json" },
    "political-cultural": { name: "Political & Cultural", file: "political-cultural/bookshelf-browse-data.json" },
    literature: { name: "Literature", file: "literature/bookshelf-browse-data.json" },
    historical: { name: "Historical", file: "historical/bookshelf-browse-data.json" },
  };

  const normalize = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US");

  const textNode = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  };

  const visibleEntries = () => {
    if (!catalog) return [];
    if (!categories[categorySelect.value].philosophy || periodSelect.value === "all") return catalog.entries;
    return catalog.entries.filter((entry) => entry.period === periodSelect.value);
  };

  const groupByAuthor = (entries) => {
    const groups = new Map();
    entries.forEach((entry) => {
      const author = entry.author || "Anonymous";
      const key = normalize(author);
      if (!groups.has(key)) {
        groups.set(key, {
          author,
          sortSurname: entry.sortSurname || author,
          entries: [],
        });
      }
      groups.get(key).entries.push(entry);
    });
    return [...groups.values()].sort((a, b) =>
      normalize(a.sortSurname).localeCompare(normalize(b.sortSurname)) ||
      normalize(a.author).localeCompare(normalize(b.author))
    );
  };

  const makeBookLinks = (books) => {
    const list = document.createElement("ul");
    list.className = "master-book-links";
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

  const appendDescriptions = (container, descriptions) => {
    if (!descriptions?.length) return;
    const section = document.createElement("div");
    section.className = "master-descriptions";
    descriptions.forEach((markup) => {
      const paragraph = document.createElement("p");
      paragraph.innerHTML = markup;
      section.append(paragraph);
    });
    container.append(section);
  };

  const renderEntry = (container, entry) => {
    const block = document.createElement("div");
    block.className = "master-work-group";
    if (entry.section) block.append(textNode("p", "master-series", entry.section));
    if (entry.periodLabel) block.append(textNode("p", "master-period-label", entry.periodLabel));
    block.append(makeBookLinks(entry.books || []));
    appendDescriptions(block, entry.descriptions);
    container.append(block);
  };

  const prepareMatches = () => {
    const query = normalize(searchInput.value.trim());
    const groups = groupByAuthor(visibleEntries());
    return groups.map((group) => {
      const authorMatch = query && (
        normalize(group.author).includes(query) ||
        group.entries.some((entry) => (entry.books || []).some((book) => normalize(book.author).includes(query)))
      );
      const entries = group.entries.map((entry) => {
        const books = (entry.books || []).filter((book) =>
          !query || authorMatch || normalize(book.title).includes(query) || normalize(book.author).includes(query)
        );
        return { ...entry, books };
      }).filter((entry) => entry.books.length);
      return { ...group, entries };
    }).filter((group) => group.entries.length);
  };

  const renderResults = () => {
    if (!catalog) return;
    const matches = prepareMatches();
    const pageCount = Math.max(1, Math.ceil(matches.length / perPage));
    currentPage = Math.min(Math.max(1, currentPage), pageCount);
    const start = (currentPage - 1) * perPage;
    const visible = matches.slice(start, start + perPage);
    const bookCount = matches.reduce((sum, group) =>
      sum + group.entries.reduce((n, entry) => n + entry.books.length, 0), 0
    );
    results.replaceChildren();
    visible.forEach((group) => {
      const article = document.createElement("article");
      article.className = "master-result";
      article.append(textNode("h3", "", group.author));
      group.entries.forEach((entry) => renderEntry(article, entry));
      results.append(article);
    });
    if (!matches.length) {
      results.append(textNode("p", "master-empty", searchInput.value.trim()
        ? "No matching books or authors found."
        : "No books are listed in this category."));
    }
    countLabel.textContent = `${bookCount} ${bookCount === 1 ? "book" : "books"} · ${matches.length} ${matches.length === 1 ? "author entry" : "author entries"}`;
    pageLabel.textContent = matches.length ? `Page ${currentPage} of ${pageCount}` : "No entries to display";
    previous.disabled = currentPage <= 1;
    next.disabled = currentPage >= pageCount;
  };

  const renderExtras = () => {
    resources.replaceChildren();
    notes.replaceChildren();
    (catalog.resources || []).forEach((resource) => {
      const article = document.createElement("article");
      article.className = "master-resource";
      const heading = document.createElement("h3");
      const link = document.createElement("a");
      link.href = resource.url;
      link.textContent = resource.title;
      if (/^https?:\/\//i.test(resource.url)) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      heading.append(link);
      article.append(heading);
      if (resource.section) article.append(textNode("p", "master-series", resource.section));
      appendDescriptions(article, resource.descriptions || []);
      resources.append(article);
    });
    (catalog.notes || []).forEach((markup) => {
      const paragraph = document.createElement("p");
      paragraph.innerHTML = markup;
      notes.append(paragraph);
    });
    root.querySelector(".master-extras").hidden = !(resources.childElementCount || notes.childElementCount);
  };

  const updateAddress = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("category", categorySelect.value);
    if (categories[categorySelect.value].philosophy && periodSelect.value !== "all") {
      url.searchParams.set("era", periodSelect.value);
    } else {
      url.searchParams.delete("era");
    }
    if (searchInput.value.trim()) url.searchParams.set("q", searchInput.value.trim());
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url);
  };

  const displayCatalog = (key, nextCatalog) => {
    catalog = nextCatalog;
    const category = categories[key];
    categorySelect.value = key;
    periodWrap.hidden = !category.philosophy;
    if (category.philosophy) {
      const valid = new Set(["all", ...(catalog.periods || []).map((period) => period.id)]);
      if (!valid.has(periodSelect.value)) periodSelect.value = "all";
    } else {
      periodSelect.value = "all";
    }
    categoryIntro.innerHTML = catalog.introHtml || "";
    root.querySelector(".master-browse-heading").textContent = `Browse ${category.name}`;
    renderExtras();
    results.setAttribute("aria-busy", "false");
    renderResults();
  };

  const loadCategory = async (key) => {
    if (!categories[key]) key = "philosophy";
    categorySelect.value = key;
    periodWrap.hidden = !categories[key].philosophy;
    if (!categories[key].philosophy) periodSelect.value = "all";
    currentPage = 1;
    results.setAttribute("aria-busy", "true");
    results.replaceChildren(textNode("p", "master-loading", `Loading ${categories[key].name}…`));
    countLabel.textContent = "";
    pageLabel.textContent = "Loading…";
    previous.disabled = true;
    next.disabled = true;
    updateAddress();

    if (cache.has(key)) {
      displayCatalog(key, cache.get(key));
      return;
    }
    const thisRequest = ++requestNumber;
    try {
      const url = new URL(`../${categories[key].file}`, window.location.href);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Catalog request failed");
      const data = await response.json();
      if (thisRequest !== requestNumber) return;
      cache.set(key, data);
      displayCatalog(key, data);
    } catch (error) {
      if (thisRequest !== requestNumber) return;
      results.setAttribute("aria-busy", "false");
      results.replaceChildren(textNode("p", "master-empty", "This category could not be loaded. Please reload the page."));
      countLabel.textContent = "Category unavailable";
      pageLabel.textContent = "Browse list unavailable";
    }
  };

  const initialParams = new URLSearchParams(window.location.search);
  const initialCategory = categories[initialParams.get("category")] ? initialParams.get("category") : "philosophy";
  if (initialParams.has("q")) searchInput.value = initialParams.get("q");
  if (initialParams.has("era")) periodSelect.value = initialParams.get("era");

  categorySelect.addEventListener("change", () => loadCategory(categorySelect.value));
  searchInput.addEventListener("input", () => {
    currentPage = 1;
    updateAddress();
    renderResults();
  });
  searchButton.addEventListener("click", () => {
    currentPage = 1;
    updateAddress();
    renderResults();
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  periodSelect.addEventListener("change", () => {
    currentPage = 1;
    updateAddress();
    renderResults();
  });
  previous.addEventListener("click", () => {
    currentPage -= 1;
    renderResults();
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  next.addEventListener("click", () => {
    currentPage += 1;
    renderResults();
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  loadCategory(initialCategory);
})();
