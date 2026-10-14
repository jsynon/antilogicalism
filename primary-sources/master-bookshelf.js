(() => {
  const root = document.getElementById("master-bookshelf");
  if (!root) return;

  const categorySelect = root.querySelector("#master-category");
  const collectionSelect = root.querySelector("#master-collection");
  const searchInput = root.querySelector("#master-search");
  const searchButton = root.querySelector(".master-search-button");
  const categoryIntro = root.querySelector(".master-category-intro");
  const results = root.querySelector(".master-results");
  const countLabel = root.querySelector(".master-count");
  const pageLabel = root.querySelector(".master-page-label");
  const previous = root.querySelector(".master-previous");
  const next = root.querySelector(".master-next");
  const scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : window.location.href;
  const catalogBase = new URL("./", scriptUrl);
  const perPage = 15;
  const cache = new Map();
  let catalog = null;
  let currentPage = 1;
  let requestNumber = 0;

  const categories = {
    all: { name: "All Books", all: true },
    philosophy: { name: "Philosophy", file: "philosophy/philosophy-browse-data.json", philosophy: true },
    science: { name: "Science", file: "science/bookshelf-browse-data.json" },
    psychology: { name: "Psychology", file: "psychology/bookshelf-browse-data.json" },
    religious: { name: "Religious", file: "religious/bookshelf-browse-data.json" },
    "political-cultural": { name: "Political & Cultural", file: "political-cultural/bookshelf-browse-data.json" },
    literature: { name: "Literature", file: "literature/bookshelf-browse-data.json" },
    historical: { name: "Historical", file: "historical/bookshelf-browse-data.json" },
  };
  const collections = {
    "sacred-books-of-the-east": { name: "Sacred Books of the East", file: "sacred-books-of-the-east/bookshelf-browse-data.json" },
    "harvard-classics": { name: "Harvard Classics", file: "harvard-classics/bookshelf-browse-data.json" },
    "church-fathers": { name: "Church Fathers", file: "church-fathers/bookshelf-browse-data.json" },
  };
  const subjectCategoryKeys = ["philosophy", "science", "psychology", "religious", "political-cultural", "literature", "historical"];
  let browseType = "category";
  let browseKey = "philosophy";

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
    return catalog.entries;
  };

  const fetchCatalog = async (key, type = "category") => {
    const definition = type === "collection" ? collections[key] : categories[key];
    const cacheKey = `${type}:${key}`;
    if (!definition?.file) throw new Error(`No catalog is defined for ${key}`);
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const url = new URL(definition.file, catalogBase);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Catalog request failed for ${key}: ${response.status}`);
    const data = await response.json();
    cache.set(cacheKey, data);
    return data;
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
    if (categorySelect.value === "all" && entry.sourceCategory) {
      block.append(textNode("p", "master-category-label", entry.sourceCategory));
    }
    if (entry.section) block.append(textNode("p", "master-series", entry.section));
    if (entry.periodLabel) block.append(textNode("p", "master-period-label", entry.periodLabel));
    block.append(makeBookLinks(entry.books || []));
    appendDescriptions(block, entry.descriptions);
    container.append(block);
  };

  const prepareMatches = () => {
    const query = normalize(searchInput.value.trim());
    if (browseType === "collection") {
      return catalog.entries
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => (a.entry.sourceOrder ?? a.index) - (b.entry.sourceOrder ?? b.index))
        .map(({ entry }) => {
          const author = entry.author || "Anonymous";
          const authorMatch = query && normalize(author).includes(query);
          const books = (entry.books || []).filter((book) =>
            !query || authorMatch || normalize(book.title).includes(query) || normalize(book.author).includes(query)
          );
          return { author, entries: books.length ? [{ ...entry, books }] : [] };
        })
        .filter((item) => item.entries.length);
    }
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
        : browseType === "collection" ? "No books are listed in this collection." : "No books are listed in this category."));
    }
    countLabel.textContent = `${bookCount} ${bookCount === 1 ? "book" : "books"} · ${matches.length} ${matches.length === 1 ? "author entry" : "author entries"}`;
    pageLabel.textContent = matches.length ? `Page ${currentPage} of ${pageCount}` : "No entries to display";
    previous.disabled = currentPage <= 1;
    next.disabled = currentPage >= pageCount;
  };

  const updateAddress = () => {
    const url = new URL(window.location.href);
    if (browseType === "collection") {
      url.searchParams.delete("category");
      url.searchParams.set("collection", browseKey);
    } else {
      url.searchParams.set("category", browseKey);
      url.searchParams.delete("collection");
    }
    url.searchParams.delete("era");
    if (searchInput.value.trim()) url.searchParams.set("q", searchInput.value.trim());
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url);
  };

  const displayCatalog = (key, nextCatalog, type = "category") => {
    catalog = nextCatalog;
    browseType = type;
    browseKey = key;
    const definition = type === "collection" ? collections[key] : categories[key];
    categorySelect.value = type === "category" ? key : "";
    collectionSelect.value = type === "collection" ? key : "";
    categoryIntro.innerHTML = catalog.introHtml || "";
    root.querySelector(".master-browse-heading").textContent = `Browse ${definition.name}`;
    results.setAttribute("aria-busy", "false");
    renderResults();
  };

  const loadBrowse = async (key, type = "category") => {
    const definitions = type === "collection" ? collections : categories;
    if (!definitions[key]) {
      type = "category";
      key = "all";
    }
    browseType = type;
    browseKey = key;
    categorySelect.value = type === "category" ? key : "";
    collectionSelect.value = type === "collection" ? key : "";
    currentPage = 1;
    results.setAttribute("aria-busy", "true");
    const name = definitions[key].name;
    results.replaceChildren(textNode("p", "master-loading", type === "category" && key === "all"
      ? "Loading books from all categories…"
      : `Loading ${name}…`));
    countLabel.textContent = "";
    pageLabel.textContent = "Loading…";
    previous.disabled = true;
    next.disabled = true;
    updateAddress();

    const thisRequest = ++requestNumber;
    try {
      if (type === "category" && key === "all") {
        const catalogs = await Promise.all(subjectCategoryKeys.map(async (categoryKey) =>
          [categoryKey, await fetchCatalog(categoryKey)]
        ));
        if (thisRequest !== requestNumber) return;
        const entries = catalogs.flatMap(([categoryKey, data]) => data.entries.map((entry) => ({
          ...entry,
          sourceCategory: categories[categoryKey].name,
          sourceCategoryKey: categoryKey,
        })));
        displayCatalog("all", { entries, resources: [], notes: [], periods: [] }, "category");
        return;
      }

      const data = await fetchCatalog(key, type);
      if (thisRequest !== requestNumber) return;
      displayCatalog(key, data, type);
    } catch (error) {
      if (thisRequest !== requestNumber) return;
      results.setAttribute("aria-busy", "false");
      results.replaceChildren(textNode("p", "master-empty", "The selected book list could not be loaded. Please reload the page."));
      countLabel.textContent = "Book list unavailable";
      pageLabel.textContent = "Browse list unavailable";
    }
  };

  const initialParams = new URLSearchParams(window.location.search);
  const initialCategory = categories[initialParams.get("category")] ? initialParams.get("category") : "all";
  const initialCollection = collections[initialParams.get("collection")] ? initialParams.get("collection") : "";
  if (initialParams.has("q")) searchInput.value = initialParams.get("q");

  categorySelect.addEventListener("change", () => {
    if (categorySelect.value) loadBrowse(categorySelect.value, "category");
  });
  collectionSelect.addEventListener("change", () => {
    if (collectionSelect.value) loadBrowse(collectionSelect.value, "collection");
  });
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
  loadBrowse(initialCollection ? initialCollection : initialCategory, initialCollection ? "collection" : "category");
})();
