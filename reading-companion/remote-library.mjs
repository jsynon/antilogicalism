/* v1.8.1: Read-only browser proof of concept for the published v49 corpus.
 * This does not call an LLM or replace Python's evidence pipeline.
 * Original shard IDs, physical PDF pages and manifest PDF URLs are preserved.
 */
export const DEFAULT_INDEX_ROOT = 'https://jsynon.github.io/antilogicalism-library-data/data-v49/';
export const PRODUCTION_PAGES_PER_BOOK = 4;
const SCRIPTURE_BOOK_NAMES = [
  'genesis','exodus','leviticus','numbers','deuteronomy','joshua','judges','ruth',
  '1 samuel','2 samuel','1 kings','2 kings','1 chronicles','2 chronicles',
  'ezra','nehemiah','esther','job','psalms','psalm','proverbs','ecclesiastes',
  'song of songs','song of solomon','isaiah','jeremiah','lamentations','ezekiel',
  'daniel','hosea','joel','amos','obadiah','jonah','micah','nahum','habakkuk',
  'zephaniah','haggai','zechariah','malachi','matthew','mark','luke','john',
  'acts','romans','1 corinthians','2 corinthians','galatians','ephesians',
  'philippians','colossians','1 thessalonians','2 thessalonians','1 timothy',
  '2 timothy','titus','philemon','hebrews','james','1 peter','2 peter',
  '1 john','2 john','3 john','jude','revelation','wisdom','sirach',
  'ecclesiasticus','1 maccabees','2 maccabees','baruch'
];
const scriptureBookPattern=SCRIPTURE_BOOK_NAMES
  .map(name=>name.replace(/\s+/g,'\\s+')).join('|');
const SCRIPTURE_REFERENCE=new RegExp(
  `\\b(?:${scriptureBookPattern})\\s+\\d{1,3}\\s*[:.]\\s*\\d{1,3}(?:\\s*[-–—]\\s*\\d{1,3})?\\b`,'i');
function scriptureEditionBoost(title,question){
  if(!hasExplicitScriptureReference(question)||!/\bbible\b/i.test(String(title||'')))return 0;
  // A verse citation asks for the passage itself. Study and annotated
  // editions can contain the passage, but their notes can match more strongly
  // than the verses and crowd primary translations out of the small all-books
  // result budget. Keep them eligible as a fallback while ranking unannotated
  // Bible editions first.
  return /\b(?:annotated|study|commentary|notes)\b/i.test(String(title||''))?100:1000;
}
// Remove question framing and common function words before searching. These
// terms describe what the reader wants the assistant to do, not what the
// source passage is likely to say, and can otherwise reward incidental pages.
const STOP = new Set(`
  a about according after all also an and are as at be because been before being
  between both but by can could did do does doing down during each either for
  from further had has have he her hers him his how i if in into is it its
  itself just may might more most must neither no nor not of off on once one
  only or other our ours out over own same she should so some such than that
  the their theirs them themselves then there these they this those through to
  too under until up very was we were what when where which who whom why will
  with would you your yours analyze analyzed analyzing book challenge challenges
  challenged challenging describe described describing discuss discussed
  discussing explain explains explained explaining novel novels relationship
  relationships show shows showed showing work works
`.trim().split(/\s+/));
const PDF = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})\/(?:view|preview)/;
export function hasExplicitScriptureReference(text) {
  return explicitScriptureReferences(text).length > 0;
}
export function explicitScriptureReferences(text) {
  return [...String(text || '').matchAll(new RegExp(SCRIPTURE_REFERENCE.source, 'gi'))]
    .map(match => match[0]);
}
function requestedPhrase(text) {
  const value=String(text||'').trim();
  const quotedDouble=value.match(/["“]([^"”]{2,120})["”]/u)?.[1];
  const quotedSingle=value.match(/(?<![\p{L}\p{N}])['‘]([^'’\n]{2,120})['’](?![\p{L}\p{N}])/u)?.[1];
  const quoted=(quotedDouble||quotedSingle||'').trim();
  if(quoted)return quoted;
  const patterns=[
    /^(?:what\s+does|what\s+do)\s+(.+?)\s+mean\s*[?.!]*$/i,
    /^(?:what\s+is|what\s+are)\s+(?:the\s+)?meaning\s+of\s+(.+?)\s*[?.!]*$/i,
    /^meaning\s+of\s+(.+?)\s*[?.!]*$/i,
  ];
  const match=patterns.map(pattern=>value.match(pattern)).find(Boolean);
  return match?.[1]?.trim().replace(/^[\s'“”‘’]+|[\s'“”‘’]+$/g,'')||'';
}
function exactPhraseMatchCount(text,phrase) {
  const target=String(phrase||'').toLowerCase().match(/[a-z0-9]+/g)||[];
  if(target.length<2)return 0;
  const words=String(text||'').toLowerCase().match(/[a-z0-9]+/g)||[];
  let count=0;
  for(let i=0;i<=words.length-target.length;i++){
    if(target.every((word,index)=>words[i+index]===word))count++;
  }
  return count;
}
function phraseMatchCount(text,phrase) {
  const exact=exactPhraseMatchCount(text,phrase);
  if(exact)return exact;
  const target=String(phrase||'').toLowerCase().match(/[a-z0-9]+/g)||[];
  const words=String(text||'').toLowerCase().match(/[a-z0-9]+/g)||[];
  if(target.length<4)return 0;
  let longest=0;
  for(let i=0;i<target.length;i++)for(let j=0;j<words.length;j++){
    let length=0;
    while(i+length<target.length&&j+length<words.length&&target[i+length]===words[j+length])length++;
    if(length>longest)longest=length;
  }
  // A quoted phrase may be split by a physical page boundary. A contiguous
  // half-phrase is a retrieval lead; the adjacent-page check below verifies
  // the complete phrase before joining the two excerpts.
  return longest>=Math.max(3,Math.ceil(target.length/2))?1:0;
}
export function queryTerms(question) {
  return [...new Set(String(question || '').toLowerCase().match(/[a-z0-9]+/g) || [])]
    .filter(t => t.length >= 3 && !STOP.has(t)).slice(0, 24);
}

// Correct a single-character typo only when it uniquely matches a catalog
// author's surname. Keep this metadata correction separate from page evidence.
function editDistanceOne(left,right){
  const a=String(left||''),b=String(right||'');
  if(Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,differences=0;
  while(i<a.length&&j<b.length){
    if(a[i]===b[j]){i++;j++;continue;}
    if(++differences>1)return false;
    if(a.length>b.length)i++;
    else if(b.length>a.length)j++;
    else{i++;j++;}
  }
  return differences+(i<a.length||j<b.length?1:0)<=1;
}
function fuzzyAuthorMentions(queryTokens,books){
  const bySurname=new Map();
  for(const [id,meta] of Object.entries(books||{})){
    const byline=String(meta?.title||'').split(/\s+[—–-]\s+/).slice(1).join(' ');
    const authorWords=byline.toLowerCase().match(/[a-z0-9]+/g)||[];
    const surname=authorWords.at(-1)||'';
    if(surname.length<7)continue;
    if(!bySurname.has(surname))bySurname.set(surname,new Set());
    bySurname.get(surname).add(String(id));
  }
  const matches=new Map();
  for(const token of queryTokens){
    if(token.length<7||bySurname.has(token))continue;
    let best='',tied=false;
    for(const surname of bySurname.keys()){
      if(!editDistanceOne(token,surname))continue;
      if(!best)best=surname;
      else if(best!==surname)tied=true;
    }
    if(best&&!tied)matches.set(token,{surname:best,bookIds:bySurname.get(best)});
  }
  return matches;
}
function stanceSourceSurname(question,books){
  const text=String(question||'');
  if(/\b(?:compare|contrast|differ(?:s|ed|ence|ent)?|between|versus|vs\.?)\b/i.test(text)||
    /\band\s+(?:how|what|why|where)\b/i.test(text))return '';
  const stance=/\b(?:think|thinks|thought|say|says|said|write|writes|wrote|argue|argues|argued|believe|believes|believed|consider|considers|considered|view|views|opinion|interpretation|criticism|critique|describe|describes|described)\b[^?!.]{0,70}\b(?:about|of|on|regarding|concerning)\b/giu;
  const owners=new Map();
  for(const [id,meta] of Object.entries(books||{})){
    const byline=String(meta?.title||'').split(/\s+[—–-]\s+/).slice(1).join(' ');
    const name=byline.toLocaleLowerCase().match(/[a-z0-9]+/g)||[];
    const surname=name.at(-1)||'';
    if(!surname)continue;
    if(!owners.has(surname))owners.set(surname,new Set());
    owners.get(surname).add(id);
  }
  const subjects=new Set();
  for(const match of text.matchAll(stance)){
    const prefix=text.slice(0,match.index).toLocaleLowerCase().match(/[a-z0-9]+/g)||[];
    const found=[...owners].filter(([surname,ids])=>prefix.includes(surname)&&ids.size>0)
      .map(([surname])=>surname);
    if(found.length===1)subjects.add(found[0]);
    else if(found.length>1)return '';
  }
  return subjects.size===1?[...subjects][0]:'';
}

export function decodeDeltas(deltas, total) {
  if (!Array.isArray(deltas)) throw new Error('Invalid term postings.');
  const ids = []; let current = 0;
  for (const delta of deltas) {
    if (!Number.isSafeInteger(delta) || delta < 0) throw new Error('Corrupt term posting.');
    current += delta;
    if (current >= total) throw new Error('Term posting exceeds manifest pages.');
    ids.push(current);
  }
  return ids;
}
export function previewAtWordBoundary(text, max = 550) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  const before = compact.slice(0, max);
  const lastSpace = before.lastIndexOf(' ');
  return (lastSpace > max / 2 ? before.slice(0, lastSpace) : before) + '…';
}
// This is only a source-form check, not a test of historical truth.
// A long alphabetical index has many page locators but few real sentences.
export function isNavigationPage(text) {
  const raw = String(text || '').trim();
  if (/^(?:(?:\d{1,4}|[ivxlc]+)\s+)?(?:index|table of contents|contents)\b/i.test(raw)) return true;
  const words = raw.match(/[a-z]+/gi) || [];
  const refs = raw.match(/\b\d{1,4}(?:[-–]\d{1,4})?\b/g) || [];
  const sentences = (raw.match(/[.!?]["')\]]?\s+(?=[A-Z])/g) || []).length;
  // Scanned indexes often place the printed folio before the heading
  // ("182 / INDEX") after OCR has already emitted several entries. Detect
  // that label anywhere near the top, but require locator density as well so
  // an ordinary prose mention of an index remains eligible.
  const head = raw.slice(0, 2500);
  if (/\bindex\b/i.test(head) && words.length >= 20 && refs.length >= 5 &&
      refs.length / words.length >= 0.08 && (raw.split(',').length >= 6 || raw.split(';').length >= 3)) return true;
  return words.length >= 20 && refs.length >= 10 &&
    refs.length / words.length >= 0.12 &&
    (raw.split(',').length >= 16 || raw.split(';').length >= 4) &&
    sentences <= 2;
}
// Edition metadata can contain topical keywords, but it is not evidence
// about the work's subject. Preserve the page and link in the corpus; just
// exclude it from a substantive-evidence preview.
export function isPublicationPage(text) {
  const head = String(text || '').slice(0, 1500);
  return /\b(?:copyright|all rights reserved|may not be reproduced)\b/i.test(head) &&
    /\b(?:copyright|all rights reserved|protected by international copyright|may not be reproduced)\b/i.test(head);
}
// Limited morphology, not a semantic thesaurus: e.g. cause/causes/caused.
// Preserve proper-name stems; no question- or book-specific exception lists.
function wordStem(word) {
  let w = String(word || '').toLowerCase();
  if (w.length < 5) return w;
  if (w.length > 5 && /(ing|ed|es)$/.test(w)) {
    w = w.replace(/(ing|ed|es)$/, '');
  } else if (w.length > 5 && w.endsWith('s')) {
    w = w.slice(0, -1);
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}
function titleTermStem(word) {
  const stem=wordStem(word);
  // Treat common adjective/noun pairs as a title match: "ethical" with
  // "Ethics", or "political" with "Politics". This helps a topical query
  // select the relevant work by an explicitly named author.
  return stem.length>6&&stem.endsWith('ical')?stem.slice(0,-2):stem;
}
function termFamily(term, partition) {
  const vocabulary=partition||{};
  const variants=new Set([term]);
  const candidates=new Set([wordStem(term)]);
  // Normalize common derivational forms without broad prefix matching. The
  // index dictionary confirms each generated form is actually present.
  if(term.length>7&&term.endsWith('uation')){
    candidates.add(term.slice(0,-6));
    candidates.add(term.slice(0,-6)+'uate');
  }
  if(term.endsWith('uous'))candidates.add(term.slice(0,-4)+'ue');
  const derivation=term.replace(/(?:ions|ion)$/,'');
  if(derivation!==term) candidates.add(derivation);
  for(const candidate of candidates){
    if(candidate.length>=3&&Object.hasOwn(vocabulary,candidate))
      variants.add(candidate);
  }
  return [...variants];
}
export function substantivePageEvidence(text, terms, headerTerms = new Set(), phrase = '') {
  if (isNavigationPage(text) || isPublicationPage(text)) return null;
  const words = String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  if (words.length < 10) return null;
  const termGroups=[],seenTerms=new Set();
  for(const term of terms){
    const group=[...new Set((Array.isArray(term)?term:[term]).map(wordStem))]
      .filter(value=>!seenTerms.has(value));
    if(!group.length)continue;
    group.forEach(value=>seenTerms.add(value));
    termGroups.push(group);
  }
  const groupByTerm=new Map();
  termGroups.forEach((group,index)=>group.forEach(term=>groupByTerm.set(term,index)));
  let hits = 0, best = {score:0, center:0, unique:0}, unique = new Set();
  const normalized = words.map((word, index) =>
    index < 24 && headerTerms.has(wordStem(word)) ? '' : wordStem(word));
  for (let i = 0; i < normalized.length; i++) {
    const groupIndex=groupByTerm.get(normalized[i]);
    if(groupIndex!==undefined){unique.add(groupIndex);hits++;}
  }
  if (!hits) return null;
  // Find the most locally concentrated part of the actual page. An isolated
  // occurrence in a page heading should not dominate a full prose argument.
  // The small number of query terms keeps this inexpensive on large books.
  for (let i = 0; i < normalized.length; i += 30) {
    const window = normalized.slice(i, i + 110);
    const present=new Set();let matched=0;
    for(const word of window){
      const groupIndex=groupByTerm.get(word);
      if(groupIndex!==undefined){present.add(groupIndex);matched++;}
    }
    const score = 9 * present.size + Math.min(8, matched);
    if (score > best.score) best = {
      score, center:Math.min(words.length-1, i+55), unique:present.size
    };
  }
  // Prefer a compact passage where several topic terms meet over a page that
  // mentions many query terms in unrelated paragraphs. Whole-page coverage is
  // still useful, but should not outweigh local evidence concentration.
  const phraseMatches=phraseMatchCount(text,phrase);
  // A directly requested expression can be strong evidence even when its
  // page has fewer surrounding topic words than a commentary page. Reward
  // exact occurrence and modestly favor pages where it appears in context.
  const phraseBoost=phraseMatches?48+8*Math.min(3,phraseMatches-1):0;
  let score = best.score + 2 * unique.size + Math.min(5, Math.log1p(hits)) + phraseBoost;
  const opening = String(text).trim().slice(0, 180);
  if (/^(?:(?:\d+|[ivxlc]+)\s+)?(?:introduction|preface|foreword|acknowledg(?:e)?ments)\b/i.test(opening)) {
    score -= 12; // A preference, not a ban; introductions can contain arguments.
  }
  return {score, unique:unique.size, localUnique:best.unique, center:best.center,
    phraseMatches};
}
export function excerptAroundEvidence(text, terms, max = 1080) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  const roots = new Set(terms.map(wordStem));
  const matches = [...compact.matchAll(/[a-z0-9]+/gi)];
  let bestStart=0, bestScore=-1;
  // Keep enough continuous prose after a question-matching passage for the
  // author's explanation to finish. A short keyword-window can cut off the
  // very next sentence (the reason for a claim) before the model sees it.
  for (let i=0;i<matches.length;i+=12) {
    const start = matches[i].index;
    const end = Math.min(compact.length, start+max);
    const snippet = compact.slice(start,end);
    const present = new Set((snippet.toLowerCase().match(/[a-z0-9]+/g)||[])
      .map(wordStem).filter(word=>roots.has(word)));
    const score = 5 * present.size + (snippet.match(/[.!?]\s/g)||[]).length;
    if (score>bestScore) {bestScore=score;bestStart=start;}
  }
  if (!bestStart) return previewAtWordBoundary(compact,max);
  let end=Math.min(compact.length,bestStart+max);
  const lastSpace=compact.lastIndexOf(' ',end);
  if(lastSpace>bestStart+max/2)end=lastSpace;
  return '…'+compact.slice(bestStart,end).trim()+(end<compact.length?'…':'');
}

function beginsMidSentence(text) {
  const start=String(text||'').trimStart();
  const firstLetter=start.match(/[A-Za-z]/)?.[0]||'';
  if(firstLetter&&firstLetter===firstLetter.toLowerCase())return true;
  // A page can continue a sentence with a capitalized proper name, so a
  // lowercase-first-letter check misses cases like “Egypt, and on his arrival
  // ...”. Treat a proper noun followed by a comma and a clause connector as a
  // boundary fragment; the neighbor must still pass the normal relevance test.
  return /^[A-Z][\p{Ll}’'-]{1,30},\s+(?:and|but|for|when|while|which|who|because)\b/u.test(start);
}

function endsMidSentence(text) {
  const tail=String(text||'').trimEnd();
  // OCR/page extracts can mark a cut-off with an ellipsis after the final
  // word (for example, “Ham. To…”). Strip that omission marker before testing
  // whether the page ends on a dangling connector; the adjacent page must
  // still pass the usual relevance check before it is included.
  const content=tail.replace(/(?:…|\.{2,})["'’”)}\]]*$/u,'').trimEnd();
  if(!content||/[.!?]["'’”)}\]]*$/.test(content))return false;
  // OCR can join the final word on one page to a capitalized first word on
  // the next (for example, "sleepNo"). The adjacent page still has to pass
  // the usual relevance test before it can be returned.
  if(/[\p{Ll}]{2,}[\p{Lu}][\p{Ll}]{1,6}$/u.test(content.slice(-40)))return true;
  return /\b(?:and|but|because|that|which|when|if|while|although|as|with|for|to|of|in|on|by|from|the|a|an)\s*[,;:]?$/i
    .test(content.slice(-80));
}

export class RemoteLibrary {
  // Call window.fetch through its owning global object. Storing the bare
  // browser method and later invoking it as this.fetcher() can throw
  // "Illegal invocation" because its receiver is the RemoteLibrary object.
  constructor(root = DEFAULT_INDEX_ROOT, fetcher = (url, options) => globalThis.fetch(url, options)) {
    this.root = String(root).replace(/\/?$/, '/');
    this.fetcher = fetcher;
    this.manifestPromise = null;
    this.suppressionPromise = null;
    this.partitions = new Map();
    this.contentDigests = new Map();
  }
  async jsonGzip(filename) {
    if (!/^(?:manifest|url-suppressions|terms-[a-z0-9]{2}|book-[0-9]+)\.json$/.test(filename)) {
      throw new Error('Unexpected corpus filename.');
    }
    const response = await this.fetcher(this.root + filename + '.gz', {cache:'no-store'});
    if (!response.ok) throw new Error('Corpus request returned HTTP ' + response.status + '.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    this.contentDigests.set(filename, [...digest].map(value=>value.toString(16).padStart(2,'0')).join(''));
    // GitHub Pages may transmit the compressed bytes or already decode them.
    let raw;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') throw new Error('A modern browser with gzip support is required.');
      raw = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else {
      raw = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
    }
    return JSON.parse(raw);
  }
  async urlSuppressions() {
    if (!this.suppressionPromise) {
      this.suppressionPromise = this.jsonGzip('url-suppressions.json').catch(error => { this.suppressionPromise = null; throw error; });
    }
    return this.suppressionPromise;
  }
  searchVisibleText(raw, bookId, pdfPage, policy) {
    let text = String(raw || '');
    for (const scope of policy?.scopes || []) {
      if (String(scope.book_id) !== String(bookId) || !scope.pages?.some(p => pdfPage >= p.start && pdfPage <= p.end)) continue;
      for (const source of scope.patterns || []) text = text.replace(new RegExp(source, 'giu'), ' ');
    }
    return text;
  }
  async manifest() {
    if (!this.manifestPromise) {
      this.manifestPromise = this.jsonGzip('manifest.json').then(value => {
        if (value.version !== 49 || value.postings_encoding !== 'delta-json-v1' ||
            value.prefix_length !== 2 || !Array.isArray(value.page_books) ||
            value.page_books.length !== value.pages ||
            !Array.isArray(value.partitions) || typeof value.books !== 'object') {
          throw new Error('Incompatible v49 manifest.');
        }
        return value;
      }).catch(error => { this.manifestPromise = null; throw error; });
    }
    return this.manifestPromise;
  }
  async partition(prefix) {
    if (!/^[a-z0-9]{2}$/.test(prefix)) throw new Error('Invalid term prefix.');
    if (!this.partitions.has(prefix)) {
      this.partitions.set(prefix, this.jsonGzip('terms-' + prefix + '.json').catch(error => {
        this.partitions.delete(prefix); throw error;
      }));
      // Keep only a few decompressed index partitions in browser memory.
      if (this.partitions.size > 8) this.partitions.delete(this.partitions.keys().next().value);
    }
    return this.partitions.get(prefix);
  }
  async search(question, {bookId = '', allowedBookIds = null, maxBooks = 3, pagesPerBook = PRODUCTION_PAGES_PER_BOOK} = {}) {
    const started = performance.now();
    const manifest = await this.manifest();
    const suppressionPolicy = await this.urlSuppressions();
    const selectedTitle = bookId ? String(manifest.books[String(bookId)]?.title || '') : '';
    // The catalog title puts the author's name after a dash. In a selected
    // work, author names are scope metadata, not evidence for a page-level
    // claim (and many digitized books repeat them in headers).
    const authorTerms = new Set((selectedTitle.split(/\s+[—–-]\s+/).slice(1).join(' ')
      .toLowerCase().match(/[a-z0-9]+/g) || []).map(wordStem));
    // Selected-book headers often repeat the title, but the title can also
    // name the reader's actual subject (for example, the Peloponnesian War).
    // Keep those query terms and ignore title words only in page-header text.
    const queryTokens=queryTerms(question);
    const scriptureReference=hasExplicitScriptureReference(question);
    // Canonical references such as "James 2:14–26" identify a Bible passage,
    // not the surname of William James. Do not let author-name matching turn
    // the reference into an author-scoped search before scripture ranking has
    // a chance to select an edition containing the cited passage.
    const fuzzyAuthorCandidates=scriptureReference?new Map():
      fuzzyAuthorMentions(queryTokens,manifest.books);
    // Apply fuzzy author scoping only when the question also has at least one
    // indexed non-author topic term; a surname alone is not enough evidence.
    const hasTopicTerm=queryTokens.some(term=>!fuzzyAuthorCandidates.has(term)&&
      !authorTerms.has(wordStem(term))&&manifest.partitions.includes(term.slice(0,2)));
    const fuzzyAuthorMatches=hasTopicTerm?fuzzyAuthorCandidates:new Map();
    const rawBaseTerms=[...new Set(queryTokens)]
      .filter(term=>!fuzzyAuthorMatches.has(term))
      .filter(term=>!authorTerms.has(wordStem(term)));
    const baseTerms=rawBaseTerms.filter(term=>manifest.partitions.includes(term.slice(0,2)));
    // The index uses only the reader's wording here. The planner may add
    // alternate source-language searches; a term-level whitelist would make
    // retrieval depend on a growing set of question-specific exceptions.
    const queryGroups=baseTerms.map(term=>[term]);
    const terms=[...new Set(queryGroups.flat())];
    const phrase=requestedPhrase(question);
    if (!terms.length) return {terms:[], sources:[], elapsedMs:Math.round(performance.now() - started)};
    const questionWords = new Set(String(question || '').toLowerCase().match(/[a-z0-9]+/g) || []);
    const mentionedAuthors = new Set();
    const namedAuthorBookIds = new Set();
    if(!scriptureReference){
      for (const [id, meta] of Object.entries(manifest.books)) {
        const byline = String(meta.title || '').split(/\s+[—–-]\s+/).slice(1).join(' ');
        const authorWords = byline.toLowerCase().match(/[a-z0-9]+/g) || [];
        const surname = authorWords.at(-1);
        const fullNameMentioned = authorWords.length > 1 && authorWords.every(word => questionWords.has(word));
        if ((surname && surname.length >= 3 && questionWords.has(surname)) || fullNameMentioned) {
          mentionedAuthors.add(surname);
          namedAuthorBookIds.add(id);
        }
      }
      for(const {surname,bookIds} of fuzzyAuthorMatches.values()){
        mentionedAuthors.add(surname);
        for(const id of bookIds)namedAuthorBookIds.add(id);
      }
      const stanceSurname=stanceSourceSurname(question,manifest.books);
      if(stanceSurname){
        mentionedAuthors.clear();
        mentionedAuthors.add(stanceSurname);
        namedAuthorBookIds.clear();
        for(const [id,meta] of Object.entries(manifest.books)){
          const byline=String(meta?.title||'').split(/\s+[—–-]\s+/).slice(1).join(' ');
          const surname=byline.toLocaleLowerCase().match(/[a-z0-9]+/g)?.at(-1)||'';
          if(surname===stanceSurname)namedAuthorBookIds.add(id);
        }
      }
    }
    const comparison = /\b(?:compare|contrast|versus|vs\.?|between)\b/i.test(question) || mentionedAuthors.size >= 2;
    const prefixes = [...new Set(terms.map(t => t.slice(0,2)))];
    // Keep indexed term matches available for candidate generation; relevance
    // is evaluated per book after separating author metadata from topic terms.
    const data = new Map(await Promise.all(prefixes.map(async p => [p, await this.partition(p)])));
    const termGroups=queryGroups.map(group=>[...new Set(group
      .flatMap(term=>termFamily(term,data.get(term.slice(0,2)))))])
      .filter(group=>group.length);
    const evidenceTerms=[...new Set(termGroups.flat())];
    const scores = new Map();
    for (const group of termGroups) {
      for (const term of group) {
        const list = decodeDeltas(data.get(term.slice(0, 2))[term] || [], manifest.page_books.length);
        for (const id of list) {
          const record = scores.get(id) || {matchedTerms:new Map()};
          if(!record.matchedTerms.has(group[0]))record.matchedTerms.set(group[0],new Set());
          record.matchedTerms.get(group[0]).add(term);
          scores.set(id, record);
        }
      }
    }
    const ranked = new Map();
    for (const [pageId, score] of scores) {
      // Author mentions can identify relevant books, but must not count as
      // page-level evidence. Explicit author queries are limited to those
      // authors' indexed works before topic matches are scored.
      const id = String(manifest.page_books[pageId]);
      if (bookId && id !== String(bookId)) continue;
      if (allowedBookIds && !allowedBookIds.has(id)) continue;
      if (!bookId && !scriptureReference && namedAuthorBookIds.size && !namedAuthorBookIds.has(id)) continue;
      if (!manifest.books[id] || !PDF.test(manifest.books[id].drive_url || '')) continue;
      const authorTerms = new Set((String(manifest.books[id].title || '').split(/\s+[—–-]\s+/).slice(1).join(' ')
        .toLowerCase().match(/[a-z0-9]+/g) || []).map(wordStem));
      const topicalTerms = [...score.matchedTerms.entries()]
        .filter(([term]) => !authorTerms.has(wordStem(term)));
      const topicalScore = topicalTerms.reduce((sum, [,variants]) => {
        const idfs=[...variants].map(term=>{
          const posting=data.get(term.slice(0,2))[term]||[];
          return Math.log1p(manifest.page_books.length/(posting.length+1));
        });
        return sum+Math.max(...idfs);
      },0);
      if (!ranked.has(id)) ranked.set(id, []);
      ranked.get(id).push({id:pageId, score:topicalScore, matched:topicalTerms.length});
    }
    let books = [...ranked].map(([id, hits]) => {
      hits.sort((a,b) => b.matched - a.matched || b.score - a.score || a.id - b.id);
      const titleTokens = new Set((String(manifest.books[id].title || '').split(/\s+[—–-]\s+/)[0]
        .toLowerCase().match(/[a-z0-9]+/g) || []).map(titleTermStem));
      const overlap = baseTerms.filter(term => titleTokens.has(titleTermStem(term))).length;
      // A named Bible book plus a chapter-and-verse locator is a precise
      // source request. Prefer Bible editions among otherwise matching works;
      // still rank their actual pages by the question terms below.
      // Prefer unannotated Bible text over study notes while keeping
      // annotated editions eligible when no primary text is found.
      const scriptureBoost=scriptureEditionBoost(manifest.books[id].title,question);
      return {id, hits, titleOverlap:overlap, score:hits[0].score + 3 * hits[0].matched +
        Math.log1p(hits.length) + 12 * overlap + scriptureBoost};
    });
    // If some books have joint topic terms, don't force single-term
    // incidental mentions into the limited set of cited books.
    if (books.some(book => book.hits[0].matched >= 2)) {
      books = books.filter(book => book.hits[0].matched >= 2);
    }
    books.sort((a,b) => b.score - a.score || Number(a.id) - Number(b.id));
    // A query that strongly matches a work's own title should not spend
    // its small evidence budget on a tangential survey, unless readers are
    // explicitly asking for a comparison across authors or works.
    const directWorks = books.filter(book => book.titleOverlap >= 2);
    if (!bookId && !comparison && directWorks.length && directWorks.length <= Math.max(1,Math.min(maxBooks,3))) {
      books = directWorks;
    }
    // In an author-focused question, one distinctive work-title match is
    // enough to disambiguate among that author's books (e.g. "ethical"
    // identifies Nicomachean Ethics over Politics). Avoid applying this
    // weaker signal to unscoped searches where a common title word can mislead.
    const authorScopedTitleMatches = books.filter(book=>book.titleOverlap>=1);
    if(!bookId&&!comparison&&namedAuthorBookIds.size&&authorScopedTitleMatches.length===1){
      books=authorScopedTitleMatches;
    }
    const sources = [];
    let booksScanned = 0, discardedNavigation = 0;
    const bookLimit = Math.max(1, Math.min(maxBooks, 3));
    const pageLimit = Math.max(1, Math.min(pagesPerBook, PRODUCTION_PAGES_PER_BOOK));
    // A small reserve of candidate works allows replacement of an index-
    // only book, without downloading all 644 book shards.
    for (const book of books.slice(0, Math.max(bookLimit, Math.min(6, books.length)))) {
      if (new Set(sources.map(source => source.bookId)).size >= bookLimit) break;
      const meta = manifest.books[book.id];
      const pdfId = PDF.exec(meta.drive_url)[1];
      const bookTitleTerms = new Set((String(meta.title || '').toLowerCase().match(/[a-z0-9]+/g) || []).map(wordStem));
      const bookAuthorTerms = new Set((String(meta.title || '').split(/\s+[—–-]\s+/).slice(1).join(' ')
        .toLowerCase().match(/[a-z0-9]+/g) || []).map(wordStem));
      const bookTerms = baseTerms.filter(term => !bookAuthorTerms.has(wordStem(term)));
      const bookEvidenceGroups=termGroups.map(group=>group
        .filter(term=>!bookAuthorTerms.has(wordStem(term))))
        .filter(group=>group.length);
      const bookEvidenceTerms=bookEvidenceGroups.flat();
      // Keep the existing roughly-half relevance floor (minimum two,
      // maximum three) based on the reader/planner's original indexed terms.
      // Equivalent source phrases are one local evidence concept, so their
      // alternate wording cannot inflate the number of independent matches.
      const minimumEvidenceTerms = bookTerms.length >= 2
        ? (comparison || namedAuthorBookIds.size ? 2 : Math.max(2, Math.min(3, Math.floor(bookTerms.length / 2)))) : 1;
      if (!bookTerms.length) continue;
      const shard = await this.jsonGzip('book-' + book.id + '.json');
      booksScanned++;
      if (!Array.isArray(shard.pages)) throw new Error('Invalid source shard for ' + book.id);
      // The book shard is already downloaded. Inspect its entire indexed
      // main text, not just the first sixty lexical hits; morphological
      // variants and contextual discussion may lie outside that shortlist.
      const relevant = new Map(book.hits.map(hit => [hit.id, hit]));
      const candidates = [], proseByPage = new Map();
      for (const item of shard.pages) {
        if (!Number.isSafeInteger(item.id) || String(manifest.page_books[item.id]) !== book.id ||
            !Number.isSafeInteger(item.page) || item.page <= 0 ||
            typeof item.text !== 'string' || !item.text.trim()) continue;
        const visibleText = this.searchVisibleText(item.text, book.id, item.page, suppressionPolicy);
        if (!visibleText.trim()) continue;
        if (isNavigationPage(visibleText) || isPublicationPage(visibleText)) {
          discardedNavigation++; continue;
        }
        if ((visibleText.match(/[a-z]+/gi) || []).length >= 10 &&
            !proseByPage.has(item.page)) proseByPage.set(item.page, {item, text:visibleText});
        const evidence = substantivePageEvidence(visibleText, bookEvidenceGroups, bookTitleTerms,phrase);
        if (!evidence || (evidence.localUnique < minimumEvidenceTerms&&!evidence.phraseMatches)) continue;
        const hit = relevant.get(item.id);
        candidates.push({item, rank:evidence.score + (hit ? Math.min(8,hit.score) : 0)});
      }
      candidates.sort((a,b) => b.rank - a.rank || a.item.page - b.item.page);
      // Fill the evidence budget with the strongest direct matches first.
      // If the strongest page visibly starts or ends mid-sentence, preserve
      // one relevant adjacent page even when the direct-match budget is full.
      // This recovers arguments split by physical page boundaries without
      // spending a slot on unrelated neighboring pages.
      const selected = candidates.slice(0, pageLimit);
      if (pageLimit >= 2 && selected.length) {
        const anchor=selected[0];
        const neighborPage=beginsMidSentence(anchor.item.text)?anchor.item.page-1:
          endsMidSentence(anchor.item.text)?anchor.item.page+1:0;
        const neighborRecord=neighborPage?proseByPage.get(neighborPage):null;
        const item=neighborRecord?.item||null;
        const neighborText=neighborRecord?.text||'';
        const neighborEvidence=neighborRecord&&substantivePageEvidence(neighborText,
          bookEvidenceGroups,bookTitleTerms,phrase);
        const relevantNeighbor=neighborEvidence&&
          (neighborEvidence.localUnique>=1||neighborEvidence.phraseMatches>0);
        const phraseContinuesAcrossBoundary=phrase&&exactPhraseMatchCount(
          neighborPage<anchor.item.page?neighborText+' '+this.searchVisibleText(anchor.item.text,book.id,anchor.item.page,suppressionPolicy):
            this.searchVisibleText(anchor.item.text,book.id,anchor.item.page,suppressionPolicy)+' '+neighborText,phrase)>0;
        const selectedNeighborIndex=selected.findIndex(entry=>entry.item.page===neighborPage);
        if(item&&relevantNeighbor&&selectedNeighborIndex>=0){
          if(phraseContinuesAcrossBoundary){
            const [neighbor]=selected.splice(selectedNeighborIndex,1);
            const anchorIndex=selected.findIndex(entry=>entry.item.id===anchor.item.id);
            selected.splice(neighborPage<anchor.item.page?anchorIndex:anchorIndex+1,0,neighbor);
          }
        }else if(item&&relevantNeighbor){
          if(selected.length>=pageLimit)selected.pop();
          if(neighborEvidence.localUnique>=1||phraseContinuesAcrossBoundary){
            const anchorIndex=selected.findIndex(entry=>entry.item.id===anchor.item.id);
            selected.splice(neighborPage<anchor.item.page?anchorIndex:anchorIndex+1,0,
              {item,rank:Math.max(0,anchor.rank-0.01),contextual:true});
          }
        }
      }
      for (const entry of candidates) {
        if (selected.length >= pageLimit) break;
        if (!selected.some(existing => existing.item.id === entry.item.id)) selected.push(entry);
      }
      for (const entry of selected) {
        const {item}=entry;
        const url = 'https://drive.google.com/file/d/' + pdfId + '/view?usp=sharing#page=' + item.page;
        sources.push({bookId:book.id, title:meta.title, page:item.page, globalPageId:item.id,
          url, preview:excerptAroundEvidence(this.searchVisibleText(item.text,book.id,item.page,suppressionPolicy),bookEvidenceTerms), textLength:item.text.length,
          score:entry.rank});
      }
    }
    return {terms, sources:sources.map((item,i) => ({id:'S'+(i+1),...item})),
      booksScanned, discardedNavigation, elapsedMs:Math.round(performance.now() - started)};
  }
}

