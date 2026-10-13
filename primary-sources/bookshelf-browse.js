(() => {
  const root = document.getElementById("bookshelf-browse");
  if (!root) return;

  const modeSelect = root.querySelector("#bookshelf-browse-mode");
  const initialSelect = root.querySelector("#bookshelf-author-initial");
  const initialField = root.querySelector(".bookshelf-initial-field");
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

  const getInitial = (entry) => normalize(entry.sortSurname || entry.author || "")
    .replace(/^[^a-z]+/, "").charAt(0).toUpperCase();

  const setText = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };

  const authorItems = (entries) => {
    const grouped = new Map();
    entries.forEach((entry) => {
      const key = normalize(entry.author || "Anonymous");
      if (!grouped.has(key)) {
        grouped.set(key, {
          author: entry.author || "Anonymous",
          sortSurname: entry.sortSurname || entry.author || "",
          entries: [],
        });
      }
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

  const renderEntryContent = (container, entry) => {
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
      renderEntryContent(group, entry);
      card.append(group);
    });
    return card;
  };

  const renderSingleEntry = (entry) => {
    const card = document.createElement("article");
    card.className = `bookshelf-result bookshelf-${entry.kind}-result`;
    card.append(setText("h3", "", entry.books[0]?.title || entry.collectionTitle || "Untitled entry"));
    if (entry.kind === "collection" && entry.collectionTitle) {
      card.append(setText("p", "bookshelf-byline", entry.collectionTitle));
    } else if (entry.author && entry.author !== "Anonymous") {
      card.append(setText("p", "bookshelf-byline", `Author: ${entry.author}`));
    }
    renderEntryContent(card, entry);
    return card;
  };

  const refreshInitialOptions = () => {
    const isAuthorMode = modeSelect.value === "author";
    initialField.hidden = !isAuthorMode;
    const initials = [...new Set(authorItems(data.entries).map(getInitial).filter(Boolean))].sort();
    const previousValue = initialSelect.value;
    initialSelect.replaceChildren(new Option("All authors", "all"));
    initials.forEach((letter) => initialSelect.add(new Option(letter, letter)));
    initialSelect.value = initials.includes(previousValue) ? previousValue : "all";
  };

  const collectionEntries = () => data.entries.filter((entry) =>
    entry.kind === "collection" || entry.books.some((book) => Boolean(book.collection))
  );

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
    refreshInitialOptions();
    const mode = modeSelect.value;
    let items = [];
    if (mode === "author") {
      items = authorItems(data.entries);
      if (initialSelect.value !== "all") items = items.filter((item) => getInitial(item) === initialSelect.value);
    } else if (mode === "anonymous") {
      items = data.entries.filter((entry) => entry.kind === "anonymous");
      items.sort((a, b) => normalize(a.books[0]?.title).localeCompare(normalize(b.books[0]?.title)));
    } else {
      items = collectionEntries();
      items.sort((a, b) => {
        const left = a.collectionTitle || a.books[0]?.collection || a.books[0]?.title || "";
        const right = b.collectionTitle || b.books[0]?.collection || b.books[0]?.title || "";
        return normalize(left).localeCompare(normalize(right)) ||
          (a.books[0]?.collectionOrder || 999) - (b.books[0]?.collectionOrder || 999) ||
          (a.books[0]?.collectionVolume || a.sourceOrder) - (b.books[0]?.collectionVolume || b.sourceOrder);
      });
    }

    const pageCount = Math.max(1, Math.ceil(items.length / perPage));
    currentPage = Math.min(Math.max(1, currentPage), pageCount);
    const visible = items.slice((currentPage - 1) * perPage, currentPage * perPage);
    results.replaceChildren();
    visible.forEach((item) => results.append(mode === "author" ? renderAuthor(item) : renderSingleEntry(item)));

    if (!items.length) {
      const message = mode === "anonymous"
        ? "There are no anonymous titles in this collection."
        : "There are no collected works in this collection.";
      results.append(setText("p", "bookshelf-empty", message));
    }
    const unit = mode === "author" ? "authors" : mode === "anonymous" ? "titles" : "collection entries";
    pageLabel.textContent = items.length
      ? `Page ${currentPage} of ${pageCount} · ${perPage} ${unit} per page`
      : "No entries to display";
    previous.disabled = currentPage <= 1;
    next.disabled = currentPage >= pageCount;
  };

  [modeSelect, initialSelect].forEach((control) => control.addEventListener("change", () => {
    currentPage = 1;
    render();
  }));
  previous.addEventListener("click", () => { currentPage -= 1; render(); });
  next.addEventListener("click", () => { currentPage += 1; render(); });

  const displayCatalog = (catalog) => {
      data = catalog;
      if (!data.entries.some((entry) => entry.kind === "anonymous")) {
        modeSelect.querySelector('option[value="anonymous"]')?.remove();
      }
      if (!collectionEntries().length) modeSelect.querySelector('option[value="collection"]')?.remove();
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
