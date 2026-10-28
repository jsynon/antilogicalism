(function () {
  'use strict';
  const query = document.getElementById('library-query');
  const button = document.getElementById('library-search-button');
  const results = document.getElementById('library-results');
  const modeInput = document.getElementById('library-match-mode');
  const bookFilter = document.getElementById('library-book-filter');
  if (!query || !button || !results) return;

  // The page sets a versioned data location for preview or publication.
  const root = document.getElementById('digital-library-search').dataset.indexRoot;
  const bookRoot = root;
  const PAGE_SIZE = 10;
  const RESULTS_PER_BOOK = 2;
  const titleCollator = new Intl.Collator('en', {numeric: true, sensitivity: 'base'});
  const authorCollator = new Intl.Collator('en', {sensitivity: 'base'});
  function titleSortKey(title) {
    return title.replace(/\b(volume|vol\.?)\s+([IVXLCDM]+)\b/gi, (whole, label, roman) => {
      const values = {I:1,V:5,X:10,L:50,C:100,D:500,M:1000};
      const letters = roman.toUpperCase();
      if (!/^(?=[IVXLCDM]+$)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(letters)) return whole;
      let value = 0;
      for (let i=0; i<letters.length; i++) {
        const n = values[letters[i]], following = values[letters[i+1]] || 0;
        value += n < following ? -n : n;
      }
      return label + ' ' + value;
    });
  }
  function authorName(title) {
    const parts = title.split(/\s+—\s+/);
    if (parts.length < 2) return '';
    return parts.slice(1).join(' — ')
      .replace(/^\s*(?:\((?:edited|translated|compiled|selected|annotated|introduced|prepared|arranged|revised|adapted)\s+by\s+\)|(?:edited|translated|compiled|selected|annotated|introduced|prepared|arranged|revised|adapted)\s+by\s+)/i, '')
      .replace(/\s*\((?:(?:edited|translated|compiled|selected|annotated|introduced|prepared|arranged|revised|adapted)\b[^)]*|editors?|translators?|compilers?|annotators?|contributors?)\)\s*$/i, '')
      .trim();
  }
  function surnameKey(name) {
    if (!name) return '\uffff';
    const firstContributor = name.split(/\s+(?:and|&)\s+/i)[0].split(/\s*;\s*/)[0].trim();
    const commaParts = firstContributor.split(',').map(part => part.trim()).filter(Boolean);
    if (commaParts.length > 1) return commaParts[0].split(/\s+/).pop();
    const tokens = firstContributor.replace(/[.]/g, '').split(/\s+/).filter(Boolean);
    while (tokens.length > 1 && /^(jr|sr|ii|iii|iv|v)$/i.test(tokens[tokens.length - 1])) tokens.pop();
    if (!tokens.length) return '\uffff';
    // Keep Spanish compound surnames together, but file epithets and place
    // names by their final meaningful word (Hippo, Elder, Areopagite).
    const yIndex = tokens.findIndex(token => token.toLocaleLowerCase() === 'y');
    if (yIndex > 0 && yIndex < tokens.length - 1) return tokens.slice(yIndex - 1).join(' ');
    // Preserve conventional compound surnames while ignoring particles such
    // as "of", "the", and "de" for Augustine, Pliny, and Spinoza.
    const includedParticles = new Set(['da','del','della','di','du','la','le','van','von']);
    if (tokens.length > 1 && includedParticles.has(tokens.at(-2).toLocaleLowerCase())) {
      return tokens.slice(-2).join(' ');
    }
    const particles = new Set(['al','bin','de','el','ibn','of','the']);
    const meaningful = tokens.filter(token => !particles.has(token.toLocaleLowerCase()));
    const key = (meaningful.length ? meaningful : tokens).at(-1);
    return key.replace(/^(?:al|el)-/i, '') || key;
  }
  const groupedSeries = [
    {name: 'Harvard Classics', pattern: /\bHarvard Classics\b/i},
    {name: 'Sacred Books of the East', pattern: /^Sacred Books of the East\b/i}
  ];
  function seriesName(title) {
    const workTitle = title.split(/\s+—\s+/)[0];
    const series = groupedSeries.find(item => item.pattern.test(workTitle));
    if (series) {
      // Keep only numbered collection volumes in the grouped collection block;
      // companion guides and other unnumbered titles sort under their authors.
      const marker = series.name === 'Harvard Classics'
        ? /\b(?:volume|vol\.?)\s*\d+\b/i
        : /\b(?:volume|vol\.?|book|part)\s*(?:\d+|[ivxlcdm]+)\b/i;
      return marker.test(workTitle) ? series.name : '';
    }
    // Titles with a volume marker at the end of their work name form a series
    // even when their records use different authors or translator metadata.
    const match = workTitle.match(/^(.*?)\s*,?\s+(?:volume|vol\.?|book|part)\s*(?:\d+|[ivxlcdm]+)\b/i);
    return match ? match[1].replace(/[,:;–—-]+$/, '').trim() : '';
  }
  function seriesVolume(title, series) {
    // Many Harvard Classics entries are cataloged under the title of the
    // individual work (e.g. "Sacred Writings, Vol. I ... (Harvard Classics,
    // Vol. 44)"). Use the collection's own volume number, not the work's.
    const match = series === 'Harvard Classics'
      ? title.match(/\bHarvard Classics\b[^)]*?\b(?:volume|vol\.?)\s*([0-9]+)\b/i)
      : title.split(/\s+—\s+/)[0].match(/\b(?:volume|vol\.?|book|part)\s*([0-9]+|[ivxlcdm]+)\b/i);
    if (!match) return null;
    const token = match[1];
    if (/^\d+$/.test(token)) return Number(token);
    const letters = token.toUpperCase();
    if (!/^(?=[IVXLCDM]+$)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(letters)) return null;
    const values = {I:1,V:5,X:10,L:50,C:100,D:500,M:1000};
    let value = 0;
    for (let i = 0; i < letters.length; i++) {
      const current = values[letters[i]], next = values[letters[i + 1]] || 0;
      value += current < next ? -current : current;
    }
    return value;
  }
  function compareSeriesTitles(a, b, series) {
    const volumeA = seriesVolume(a, series), volumeB = seriesVolume(b, series);
    if (volumeA !== null || volumeB !== null) {
      if (volumeA === null) return 1;
      if (volumeB === null) return -1;
      if (volumeA !== volumeB) return volumeA - volumeB;
    }
    return titleCollator.compare(titleSortKey(a), titleSortKey(b));
  }
  function compareAuthors(a, b) {
    const seriesA = seriesName(a), seriesB = seriesName(b);
    const authorA = authorName(a), authorB = authorName(b);
    const collectionA = groupedSeries.some(item => item.name === seriesA);
    const collectionB = groupedSeries.some(item => item.name === seriesB);
    // Named collections sort under their collection name; other series sort
    // under the author's surname, with series volumes kept together below.
    const keyA = collectionA ? seriesA : surnameKey(authorA);
    const keyB = collectionB ? seriesB : surnameKey(authorB);
    const keyOrder = authorCollator.compare(keyA, keyB);
    if (keyOrder) return keyOrder;
    if (seriesA && seriesA === seriesB) return compareSeriesTitles(a, b, seriesA);

    const authorOrder = authorCollator.compare(authorA, authorB);
    if (authorOrder) return authorOrder;
    if (seriesA && !seriesB) return -1;
    if (!seriesA && seriesB) return 1;
    if (seriesA && seriesB) {
      const seriesOrder = authorCollator.compare(seriesA, seriesB);
      if (seriesOrder) return seriesOrder;
    }
    return titleCollator.compare(titleSortKey(a), titleSortKey(b));
  }
  let manifestPromise;
  let suppressionPromise;
  const partitions = new Map();
  const chunks = new Map();
  let generation = 0;
  let active = null;
  const bookIdsBySelection = new Map();

  async function loadJson(url) {
    const response = await fetch(url + '.gz', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + url + '.gz');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let text;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser cannot decompress the library. Please use a current browser.');
      }
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } else {
      // A host with Content-Encoding: gzip may already have decoded the response.
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    return JSON.parse(text);
  }
  function manifest() {
    if (!manifestPromise) manifestPromise = loadJson(root + 'manifest.json').catch(e => { manifestPromise = null; throw e; });
    return manifestPromise;
  }
  function urlSuppressions() {
    if (!suppressionPromise) suppressionPromise = loadJson(root + 'url-suppressions.json').catch(e => { suppressionPromise = null; throw e; });
    return suppressionPromise;
  }
  function searchVisibleText(raw, bookId, pdfPage, policy) {
    let text = String(raw || '');
    for (const scope of policy?.scopes || []) {
      if (String(scope.book_id) !== String(bookId) || !scope.pages?.some(p => pdfPage >= p.start && pdfPage <= p.end)) continue;
      for (const source of scope.patterns || []) text = text.replace(new RegExp(source, 'giu'), ' ');
    }
    return text;
  }
  function partition(prefix) {
    if (!partitions.has(prefix)) partitions.set(prefix, loadJson(root + 'terms-' + prefix + '.json').catch(e => { partitions.delete(prefix); throw e; }));
    return partitions.get(prefix);
  }
  function decodeDeltas(deltas) {
    const ids = new Array(deltas.length);
    let current = 0;
    for (let i = 0; i < deltas.length; i++) {
      current += deltas[i];
      ids[i] = current;
    }
    return ids;
  }
  function bookChunk(id) {
    if (!chunks.has(id)) chunks.set(id, loadJson(bookRoot + 'book-' + id + '.json').catch(e => { chunks.delete(id); throw e; }));
    return chunks.get(id);
  }
  function normalized(s) { return s.replace(/\s+/g, ' ').trim(); }
  function displayText(raw) {
    // Soft hyphens are discretionary layout marks. Visible hyphens may be
    // meaningful compounds, so leave them intact without dictionary evidence.
    return normalized(raw.replace(/\u00ad/g, ''));
  }
  function formatOriginalText(raw) {
    // PDF extraction often inserts a newline at the end of every printed line.
    // Join those visual wraps for reading while retaining blank-line paragraph
    // boundaries, headings, and list items. Search still uses the unchanged text.
    const lines = raw.replace(/\r\n?/g, '\n').replace(/\u00ad/g, '').split('\n');
    const blocks = [];
    let current = [];
    function flush() {
      if (current.length) blocks.push(current.join(' '));
      current = [];
    }
    function isHeading(line) {
      const letters = line.match(/[A-Za-z]/g) || [];
      const allCaps = letters.length >= 3 && line === line.toUpperCase();
      return line.length <= 100 && (allCaps || /^(?:chapter|part|book|section|contents|preface|introduction|conclusion|appendix|bibliography|index)\b/i.test(line));
    }
    function isListItem(line) {
      return /^(?:[•*▪‣]|[-–—]\s|\(?\d+[.)]\s|[a-z][.)]\s)/i.test(line);
    }
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+/g, ' ').trim();
      if (!line) { flush(); continue; }
      if (isHeading(line) || isListItem(line)) {
        flush();
        blocks.push(line);
      } else {
        current.push(line);
      }
    }
    flush();
    return blocks.join('\n\n');
  }
  function ocrPenalty(text) {
    const words = (text.match(/[a-z]+/gi) || []).length;
    const broken = (text.match(/[a-z][.,;:][a-z]/gi) || []).length;
    const fragments = (text.match(/\b[a-z]{2,}-\s+[a-z]{2,}\b/gi) || []).length;
    const replacements = (text.match(/\uFFFD/g) || []).length;
    const isolated = (text.match(/(?:^|\s)[,;:](?=\s|$)/g) || []).length;
    const artifacts = broken * 2 + fragments + replacements * 3 + isolated;
    return Math.min(2.5, artifacts * 35 / Math.max(80, words));
  }
  function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function matchRanges(text, term, mode) {
    const needles = mode === 'words' || mode === 'any'
      ? [...new Set(term.match(/[a-z0-9]+/g) || [])] : [term];
    const ranges = [];
    for (const needle of needles) {
      // Unicode boundaries prevent matching will within willing or accented words.
      const rx = new RegExp('(^|[^\\p{L}\\p{N}_])(' + escapeRegex(needle) + ')(?=$|[^\\p{L}\\p{N}_])', 'giu');
      let found = false, match;
      while ((match = rx.exec(text)) !== null) {
        const start = match.index + match[1].length;
        ranges.push({start, end: start + match[2].length});
        found = true;
      }
      if (!found && mode === 'words') return [];
    }
    return ranges.sort((a,b)=>a.start-b.start);
  }
  function pageKind(rawText) {
    const lines = rawText.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const headingLines = lines.slice(0, 25).map(line => line.toLowerCase().replace(/[^a-z]/g, ''));
    const contentsHeading = headingLines.some(line => /^(?:tableof)?contents(?:continued)?$/.test(line));
    const indexHeading = headingLines.some(line => /^(?:(?:general|subject|name|names|analytical)index|index)(?:continued)?$/.test(line));
    const entries = lines.filter(line => line.length < 160 && /[a-z]/i.test(line)
      && /(?:\s|\.{2,})\d{1,4}(?:\s*[-–,]\s*\d{1,4})*[.]?$/.test(line));
    const leaders = lines.filter(line => /\.{3,}\s*(?:\d+|[ivxlcdm]+)\s*$/i.test(line)).length;
    const chapters = lines.filter(line => /^(?:chapter|part|book|section)\s+(?:\d+|[ivxlcdm]+)\b/i.test(line)).length;
    const density = entries.length / Math.max(1, lines.length);
    if (contentsHeading && (entries.length >= 3 || leaders >= 3) && density >= .18) return 'contents';
    if (indexHeading && entries.length >= 4 && density >= .25) return 'index';
    if (entries.length >= 8 && density >= .5 && (leaders >= 3 || chapters >= 4)) return 'contents';
    return 'passage';
  }
  // Score passage usefulness, not just its position in the PDF.
  function rankText(page, rawText, term, mode, bookId, policy) {
    const visibleText = searchVisibleText(rawText, bookId, page.page, policy);
    const kind = pageKind(visibleText);
    const text = displayText(visibleText);
    const ranges = matchRanges(text, term, mode);
    const positions = ranges.map(range => range.start);
    if (!positions.length) return null;
    const words = text.match(/[a-z]+/gi) || [];
    const letters = text.match(/[a-z]/gi) || [];
    const capitals = text.match(/[A-Z]/g) || [];
    const uppercaseRatio = capitals.length / Math.max(1, letters.length);
    const prose = Math.min(words.length / 180, 1);
    const frequency = Math.min(positions.length, 6);
    // These are hints: references and front matter remain searchable.
    const referenceHints = (text.match(/\b(?:bibliography|references|contents|index|translated by|impression|published by|all rights reserved)\b/gi) || []).length;
    const citationHints = (text.match(/\b(?:vol\.|pp\.|p\.\s*\d|\d{4})/gi) || []).length;
    let score = 3 * prose + 1.4 * Math.log2(1 + frequency);
    if (words.length < 45) score -= 4;
    if (uppercaseRatio > 0.45) score -= 3;
    score -= Math.min(referenceHints * 0.8, 3);
    score -= Math.min(citationHints * 0.18, 1.8);
    score -= ocrPenalty(text);
    // Choose an occurrence with surrounding prose rather than an isolated heading.
    let bestPos = positions[0], bestContext = -Infinity;
    for (const at of positions) {
      const context = text.slice(Math.max(0, at - 180), at + term.length + 260);
      const contextWords = (context.match(/[a-z]+/gi) || []).length;
      const upper = (context.match(/[A-Z]/g) || []).length;
      const alpha = (context.match(/[a-z]/gi) || []).length;
      const quality = contextWords - 60 * upper / Math.max(1, alpha);
      if (quality > bestContext) { bestContext = quality; bestPos = at; }
    }
    return { page, text, pos: bestPos, score, rawText, kind };
  }
  function rankPage(page, term, mode, bookId, policy) {
    if (!Array.isArray(page.regions) || !page.regions.length) {
      return rankText(page, page.text || '', term, mode, bookId, policy);
    }
    let matches = page.regions.map(region => rankText(page, region.text || '', term, mode, bookId, policy)).filter(Boolean);
    // Word searches can match across PDF text regions; keep each excerpt inside one region.
    const visiblePageText = searchVisibleText(page.text || '', bookId, page.page, policy);
    if (!matches.length && (mode === 'words' || mode === 'any') && matchRanges(displayText(visiblePageText), term, mode).length) {
      const needles = [...new Set(term.match(/[a-z0-9]+/g) || [])];
      matches = page.regions.map(region => {
        const found = needles.filter(needle => matchRanges(displayText(searchVisibleText(region.text || '', bookId, page.page, policy)), needle, 'phrase').length);
        const match = found.length ? rankText(page, region.text || '', found.join(' '), mode, bookId, policy) : null;
        if (match) match.score += found.length;
        return match;
      }).filter(Boolean);
    }
    matches.sort((a,b) => (a.kind !== 'passage') - (b.kind !== 'passage') || b.score-a.score);
    return matches.length ? {...matches[0], rawRegions: page.regions} : null;
  }
  function snippet(text, at, n) {
    const start = Math.max(0, at - 160);
    const end = Math.min(text.length, at + n + 260);
    return (start ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
  }
  function highlight(element, text, term, mode) {
    // Excerpts may contain only part of an all-words match, so mark each word independently.
    const needles = mode === 'words' || mode === 'any' ? [...new Set(term.match(/[a-z0-9]+/g) || [])] : [term];
    const ranges = needles.flatMap(needle => matchRanges(text, needle, 'phrase'))
      .sort((a,b)=>a.start-b.start);
    appendHighlighted(element, text, ranges);
  }
  function appendHighlighted(element, text, ranges) {
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor) continue;
      element.append(document.createTextNode(text.slice(cursor, range.start)));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(range.start, range.end);
      element.append(mark);
      cursor = range.end;
    }
    element.append(document.createTextNode(text.slice(cursor)));
  }
  function originalMatchRanges(rawText, term, mode) {
    // Map the normalized search text back to the unchanged PDF extraction.
    const characters = [], starts = [], ends = [];
    for (let i = 0; i < rawText.length; i++) {
      const character = rawText[i];
      if (character === '\u00ad') continue;
      if (/\s/.test(character)) {
        if (characters[characters.length - 1] === ' ') {
          ends[ends.length - 1] = i + 1;
          continue;
        }
        characters.push(' ');
      } else characters.push(character);
      starts.push(i);
      ends.push(i + 1);
    }
    const searchText = characters.join('');
    const needles = mode === 'words' || mode === 'any' ? [...new Set(term.match(/[a-z0-9]+/g) || [])] : [term];
    return needles.flatMap(needle => matchRanges(searchText, needle, 'phrase'))
      .map(range => ({start: starts[range.start], end: ends[range.end - 1]}))
      .sort((a,b) => a.start-b.start);
  }
  function highlightOriginal(element, text, term, mode) {
    element.replaceChildren();
    highlight(element, text, term, mode);
  }
  function showMessage(text) {
    results.replaceChildren();
    const p = document.createElement('p');
    p.className = 'library-empty';
    p.textContent = text;
    results.append(p);
  }
  // Version 8: one-character tokens use their own partition; longer tokens use two.
  function wordPrefix(word) { return word.slice(0, 2); }
  function intersection(a, b) {
    const set = new Set(b);
    return a.filter(id => set.has(id));
  }
  function renderMatch(state, match) {
    const book = state.index.books[match.bookId];
    const item = document.createElement('div');
    item.className = 'library-result';
    const heading = document.createElement('h3');
    heading.textContent = `${book.title} — PDF page ${match.page.page}`;
    const excerpt = document.createElement('p');
    highlight(excerpt, snippet(match.text, match.pos, state.term.length), state.term, state.mode);
    item.append(heading);
    if (match.kind !== 'passage') {
      const label = document.createElement('p');
      label.className = 'library-page-kind';
      label.textContent = match.kind === 'contents' ? 'Possible table of contents' : 'Possible index';
      item.append(label);
    }
    item.append(excerpt);
    const details = document.createElement('details');
    details.className = 'library-original';
    const summary = document.createElement('summary');
    summary.textContent = 'View original page text';
    const originals = [];
    details.append(summary);
    for (const region of match.rawRegions || [{region:'whole', text:match.rawText}]) {
      if (match.rawRegions && match.rawRegions.length > 1) {
        const label = document.createElement('p');
        label.className = 'library-region-label';
        label.textContent = ({left:'Left column',right:'Right column',header:'Header',footer:'Footer',whole:'Page'})[region.region] || 'Page';
        details.append(label);
      }
      const original = document.createElement('p');
      const cleanedText = formatOriginalText(region.text);
      original.textContent = cleanedText;
      originals.push({element:original, text:cleanedText});
      details.append(original);
    }
    let originalHighlighted = false;
    details.addEventListener('toggle', () => {
      if (details.open && !originalHighlighted) {
        for (const original of originals) highlightOriginal(original.element, original.text, state.term, state.mode);
        originalHighlighted = true;
      }
    });
    item.append(details);
    if (book.drive_url) {
      const link = document.createElement('a');
      link.href = book.drive_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open PDF on Google Drive';
      item.append(link);
    } else {
      const note = document.createElement('p');
      note.className = 'library-pdf-unavailable';
      note.textContent = 'PDF link is not yet available for this book.';
      item.append(note);
    }
    state.list.append(item);
  }
  function updateStatus(state) {
    const complete = state.queue.length === 0 && state.referenceQueue.length === 0;
    state.status.textContent = complete
      ? `${state.displayed} matching pages found across ${Object.keys(state.index.books).length} indexed books. All candidates checked.`
      : `Showing ${state.displayed} matching pages so far across ${Object.keys(state.index.books).length} indexed books. More results may be available.`;
    state.more.hidden = complete;
    state.more.disabled = false;
    state.more.textContent = 'Load more results';
    if (complete && state.displayed === 0) state.status.textContent = 'No matching passages in the selected books. OCR errors may prevent a match.';
  }
  async function loadMore(state) {
    if (state.loading || active !== state) return;
    state.loading = true;
    state.more.disabled = true;
    state.more.textContent = 'Loading…';
    const myGeneration = state.generation;
    let added = 0;
    try {
      // Fill each batch with confirmed matches, skipping books with no matching passages.
      // Unread pages remain in the queue for later rounds: no matches are discarded.
      while ((state.queue.length || state.referenceQueue.length) && added < PAGE_SIZE) {
        if (myGeneration !== generation || active !== state) return;
        const referencePhase = state.queue.length === 0;
        const queue = referencePhase ? state.referenceQueue : state.queue;
        const bookId = queue.shift();
        let record = state.bookProgress.get(bookId);
        if (!record) {
          const wanted = state.idsByBook.get(bookId);
          let chunk;
          try { chunk = await bookChunk(bookId); }
          catch (error) { state.queue.unshift(bookId); throw error; }
          if (myGeneration !== generation || active !== state) return;
          const matches = chunk.pages.filter(page => wanted.has(page.id))
            .map(page => rankPage(page, state.term, state.mode, bookId, state.suppressionPolicy)).filter(Boolean)
            .sort((a, b) => b.score - a.score || a.page.page - b.page.page);
          record = {pages: matches.filter(match => match.kind === 'passage'), cursor: 0,
                    references: matches.filter(match => match.kind !== 'passage'), referenceCursor: 0};
          if (record.references.length) state.referenceQueue.push(bookId);
          state.bookProgress.set(bookId, record);
        }
        const pages = referencePhase ? record.references : record.pages;
        const cursorKey = referencePhase ? 'referenceCursor' : 'cursor';
        let bookAdded = 0;
        while (record[cursorKey] < pages.length && bookAdded < RESULTS_PER_BOOK && added < PAGE_SIZE) {
          const match = pages[record[cursorKey]++];
          renderMatch(state, {bookId, ...match});
          state.displayed++;
          bookAdded++;
          added++;
        }
        if (record[cursorKey] < pages.length) queue.push(bookId);
        else if (referencePhase || !record.references.length) state.bookProgress.delete(bookId);
      }
      if (myGeneration === generation && active === state) updateStatus(state);
    } catch (error) {
      if (myGeneration === generation && active === state) {
        state.status.textContent = 'Could not load more results: ' + error.message;
        state.more.hidden = false;
        state.more.disabled = false;
        state.more.textContent = 'Retry loading results';
      }
    } finally {
      state.loading = false;
    }
  }
  async function search() {
    const myGeneration = ++generation;
    active = null;
    const raw = query.value.trim().replace(/^"([\s\S]*)"$/, '$1');
    const mode = modeInput && ['words', 'any'].includes(modeInput.value) ? modeInput.value : 'phrase';
    const selectedBook = bookFilter ? bookFilter.value : '';
    const selectedBookIds = selectedBook
      ? (bookIdsBySelection.get(selectedBook) || new Set([selectedBook])) : null;
    if (!raw) return showMessage('Enter a word or phrase to search the library.');
    const term = normalized(raw).toLowerCase();
    const words = term.match(/[a-z0-9]+/g) || [];
    if (!words.length) return showMessage('Enter a search term containing letters or numbers.');
    button.disabled = true;
    showMessage('Searching indexed pages…');
    try {
      const index = await manifest();
      const suppressionPolicy = await urlSuppressions();
      if (myGeneration !== generation) return;
      const available = new Set(index.partitions);
      const searchableWords = [...new Set(words)].filter(word => available.has(wordPrefix(word)));
      if (!searchableWords.length || (mode !== 'any' && searchableWords.length !== new Set(words).size)) {
        return showMessage('No matching passages in the selected books. OCR errors may prevent a match.');
      }
      const prefixes = [...new Set(searchableWords.map(wordPrefix))];
      const loaded = new Map(await Promise.all(prefixes.map(async prefix => [prefix, await partition(prefix)])));
      if (myGeneration !== generation) return;
      const lists = searchableWords.map(word =>
        decodeDeltas(loaded.get(wordPrefix(word))[word] || []));
      let candidates;
      if (mode === 'any') {
        candidates = [...new Set(lists.flat())].sort((a, b) => a - b);
      } else {
        lists.sort((a, b) => a.length - b.length);
        candidates = lists.length ? lists[0].slice() : [];
        for (const list of lists.slice(1)) {
          candidates = intersection(candidates, list);
          if (!candidates.length) break;
        }
      }
      const idsByBook = new Map();
      for (const id of candidates) {
        const bookId = String(index.page_books[id]);
        if (selectedBookIds && !selectedBookIds.has(bookId)) continue;
        if (!idsByBook.has(bookId)) idsByBook.set(bookId, new Set());
        idsByBook.get(bookId).add(id);
      }
      if (myGeneration !== generation) return;

      // Count indexed pages per book.
      const bookPageCounts = new Map();
      for (const id of index.page_books) {
        const key = String(id);
        bookPageCounts.set(key, (bookPageCounts.get(key) || 0) + 1);
      }

      // Rank books by match concentration, with smoothing.
      const rankedBooks = [...idsByBook.keys()].sort((a, b) => {
        const scoreA = (idsByBook.get(a).size + 1) /
          ((bookPageCounts.get(a) || 0) + 10);
        const scoreB = (idsByBook.get(b).size + 1) /
          ((bookPageCounts.get(b) || 0) + 10);

        return scoreB - scoreA ||
          index.books[a].title.localeCompare(index.books[b].title);
      });

      results.replaceChildren();
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      const list = document.createElement('div');
      const more = document.createElement('button');
      more.type = 'button';
      more.textContent = 'Load more results';
      more.hidden = true;
      more.className = 'library-more';
      results.append(status, list, more);
      const state = {
        generation: myGeneration, index, term, mode, idsByBook,
        queue: rankedBooks, referenceQueue: [], bookProgress: new Map(), displayed: 0,
        loading: false, status, list, more, suppressionPolicy
      };
      active = state;
      more.addEventListener('click', () => loadMore(state));
      await loadMore(state);
    } catch (error) {
      if (myGeneration === generation) showMessage('Unable to search the full library index: ' + error.message);
    } finally {
      if (myGeneration === generation) button.disabled = false;
    }
  }
  // Filter titles locally; selecting a book still controls passage searches.
  if (bookFilter) {
    const finder = document.getElementById('library-book-finder');
    const count = document.getElementById('library-book-count');
    bookFilter.disabled = true;
    if (finder) finder.disabled = true;
    manifest().then(index => {
      const sortedBooks = Object.entries(index.books)
        .filter(([, book]) => book.title.trim().toLocaleLowerCase() !== 'unrecognised facts about modern psychiatric practice')
        .sort((a,b)=>compareAuthors(a[1].title,b[1].title));
      const titleGroups = new Map();
      for (const [id, book] of sortedBooks) {
        const title = book.title.trim();
        if (!titleGroups.has(title)) titleGroups.set(title, {id, title:book.title, ids:[]});
        titleGroups.get(title).ids.push(String(id));
      }
      const books = [...titleGroups.values()];
      function refreshBooks() {
        const selected = bookFilter.value;
        const terms = (finder ? finder.value : '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        const matches = books.filter(book=>terms.every(term=>book.title.toLocaleLowerCase().includes(term)));
        bookIdsBySelection.clear();
        for (const book of books) bookIdsBySelection.set(book.id, new Set(book.ids));
        bookFilter.replaceChildren();
        const all = document.createElement('option');
        all.value = ''; all.textContent = 'All books'; bookFilter.append(all);
        if (selected && !matches.some(book=>book.id===selected)) {
          const current = books.find(book=>book.id===selected);
          if (current) {
            const option = document.createElement('option');
            option.value = current.id;
            option.textContent = current.title + (current.ids.length > 1 ? ` (${current.ids.length} files, selected)` : ' (selected)');
            bookFilter.append(option);
          }
        }
        for (const book of matches) {
          const option = document.createElement('option');
          option.value = book.id;
          option.textContent = book.title + (book.ids.length > 1 ? ` (${book.ids.length} files)` : '');
          bookFilter.append(option);
        }
        bookFilter.value = selected;
        if (count) count.textContent = terms.length
          ? (matches.length ? `${matches.length} titles match. Choose a title below.` : 'No titles match. Try fewer words.')
          : `${books.length} titles available.`;
      }
      refreshBooks();
      bookFilter.disabled = false;
      if (finder) {
        finder.disabled = false;
        finder.addEventListener('input', refreshBooks);
        finder.addEventListener('keydown', event => {
          if (event.key === 'Enter') { event.preventDefault(); bookFilter.focus(); }
        });
      }
    }).catch(error => showMessage('Unable to load the book catalog: ' + error.message));
  }
  button.addEventListener('click', search);
  query.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
})();
