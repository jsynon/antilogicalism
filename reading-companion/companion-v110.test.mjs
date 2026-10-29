import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {RemoteLibrary} from './remote-library.mjs';
import {LIVE_RETRIEVAL_CONFIG} from './evidence-search.mjs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const client=readFileSync(new URL('./companion-v110.mjs',import.meta.url),'utf8');
const clientV49=readFileSync(new URL('./companion-v112.mjs',import.meta.url),'utf8');
const bookOrder=await import('./book-order.mjs');

test('response citation labels are plain ordered numbers while IDs stay internal',()=>{
 assert.match(client,/buildCitationNumbering\(answer,citations\)/);
 assert.match(client,/sortCitationsByNumber\(citations,numbering\)/);
 assert.ok(client.includes('highlight=highlights.find(item=>'));
 assert.match(client,/citationDisplayLabel\(source\.id,numbering\)/);
 assert.match(client,/putMarkdownBlocks\(reply,answer,citations,highlights,numbering\)/);
});

test('public response renderer omits the structured missing-evidence notice',()=>{
 assert.doesNotMatch(client,/data\\.missing/);
 assert.doesNotMatch(client,/Evidence gaps:|Evidence check:/);
});
test('live browser uses shared 24-candidate, four-book retrieval settings',()=>{
 assert.deepEqual(LIVE_RETRIEVAL_CONFIG,{maxCandidates:24,maxBooks:4,pagesPerBook:4});
 assert.ok(clientV49.includes('LIVE_RETRIEVAL_CONFIG'));
 assert.ok(clientV49.includes('...LIVE_RETRIEVAL_CONFIG,pageLimit:PDF_PAGE_LIMIT'));
 assert.ok(html.includes('companion-v112.mjs?v=1.16.0'));
});
test('answer source packet allows six verified passages',()=>{
 assert.match(client,/const MAX_ANSWER_SOURCES=6/);
 assert.match(client,/maxSources:MAX_ANSWER_SOURCES/);
});
test('v49 Reading Companion page retains Book Lite and loads the v49 client',()=>{
 assert.match(html,/wp-content\/themes\/book-lite/);
 assert.match(html,/id="masthead"/);
 assert.match(html,/id="secondary"/);
 assert.match(html,/companion-v112\.mjs/);
 assert.doesNotMatch(html,/companion-v110\.mjs/);
});
test('companion introduction explains how to use it and links to Library Search',()=>{
 assert.match(html,/Ask questions about books in the Antilogicalism library/);
 assert.match(html,/Select a book or leave “All books” selected, enter your question/);
 assert(html.includes('href="/antilogicalism/digital-library/">Library Search</a>'));
 assert(html.includes('Search the full-text collection with <a href="/antilogicalism/digital-library/">Library Search</a> or browse books by title with the <a href="/antilogicalism/primary-sources/">Bookshelf</a>.'));
 assert.doesNotMatch(html,/all 642 searchable titles|644-book library/);
});
test('v1.10 presents a clean ask-and-read flow while preserving answer sections',()=>{
 const answer=client.indexOf('Reading Companion answer');
 const passages=client.indexOf('Cited sources and verified passages',answer);
 assert(answer>=0);
 assert.equal(client.includes('Explore further'),false);
 assert.doesNotMatch(client,/companion-follow-ups|companion-follow-up-buttons|followUpQuestions/);
 assert(passages>answer);
 assert.equal(client.includes("'Additional sources'"),false);
 assert.ok(client.includes('if(orderedCitations.length)'));
 assert.ok(client.includes('for(const source of orderedCitations)'));
 assert.ok(client.includes("node('p',excerpt||'No reviewer-approved excerpt is available for this source.'"));
 assert.ok(client.includes('highlight?.quote'));
 assert.ok(client.includes("excerpt?'Read highlighted passage':'Read source'"));
 assert.doesNotMatch(client,/original\?\.preview\|\|source\.preview/,
  'generic page previews are never promoted to reviewer-approved highlights');
 assert.ok(client.includes('sourceAttributionLabel(source.provenance)'));
 assert.doesNotMatch(html,/companion-suggested-questions|companion-find-button|Review passages/);
 assert.match(html,/id="companion-book-filter"/);
 assert.match(html,/id="companion-book-search" type="search"/);
 assert.match(html,/<strong>Find a book<\/strong>/);
 assert.match(html,/companion-book-controls/);
 assert.ok(client.includes("new Option('All books','')"));
 assert.match(client,/bookSearch\.addEventListener\('input',updateBookOptions\)/);
 assert.match(client,/bookSearch\.value=''/);
 assert.match(html,/id="companion-question"/);
 assert.match(html,/id="companion-status" aria-live="polite" aria-atomic="true" aria-busy="false" role="status"/);
 assert.match(html,/#companion-status:not\(:empty\).*font-size:1\.12em/);
 assert.match(html,/companion-status-spin/);
 assert.match(html,/prefers-reduced-motion:reduce\).*companion-status/);
 assert.match(client,/function refreshStatusState\(\)/);
 assert.match(client,/status\.setAttribute\('aria-busy',String\(busy\)\)/);
 assert.match(client,/askButton\.textContent=searching\|\|answering\?'Working…':'Ask Reading Companion'/);
 assert.match(client,/Preparing an answer from the selected passages… This can take a little while\./);
 assert.doesNotMatch(html,/Press Enter to ask|companion-question-help/);
 assert.match(client,/question\.addEventListener\('keydown',event=>\{/);
 assert.match(client,/event\.key!=='Enter'\|\|event\.shiftKey\|\|event\.isComposing/);
 assert.match(client,/if\(!askButton\.disabled\)form\.requestSubmit\(askButton\)/);
 assert.doesNotMatch(html,/companion-passage-browser|companion-passage-list/);
 assert.match(client,/function rememberTurn\(questionText,answerText\)/);
 assert.match(client,/conversationHistory\.slice\(-6\)/);
 assert.match(client,/answerBox\.append\(turn\)/);
 assert.match(client,/turn\.scrollIntoView\(\{behavior:reduceMotion\?'auto':'smooth',block:'start'\}\)/);
 assert.match(client,/prefers-reduced-motion/);
 assert.match(client,/Recent conversation|history,/);
 assert.match(html,/id="companion-new-conversation" type="button" hidden/);
 assert.match(html,/button\.companion-inline-read\{-webkit-appearance:none;appearance:none;display:inline/);
});
test('catalog loading passes all verified books to the whole-list sorter',()=>{
 assert.match(client,/const list=sortBooksForSelector\(Object\.entries\(index\.books\)/);
 assert.doesNotMatch(client,/\.sort\(sortBooksForSelector\)/);
});
test('book selector sorts by author surname and keeps numbered collections in natural order',()=>{
 const books=[
  {id:'10',title:'The Harvard Classics, Volume 10: Tenth — Zed Author'},
  {id:'2',title:'The Harvard Classics, Volume 2: Second — Amy Author'},
  {id:'1',title:'The Harvard Classics, Volume 1: First — Zed Author'},
  {id:'3',title:'A Book — Aaron Aardvark'},
  {id:'4',title:'Another Book — Zoe Zebra'}
 ];
 const sorted=bookOrder.sortBooksForSelector(books);
 assert.deepEqual(sorted.map(book=>book.id),['3','1','2','10','4']);
});
test('Copleston volumes sort together under C and de Spinoza sorts under S',()=>{
 const books=[
  {id:'copleston-2',title:'A History of Philosophy, Volume II: Medieval Philosophy — Frederick Copleston'},
  {id:'spinoza',title:'A Theologico-Political Treatise — Benedict de Spinoza'},
  {id:'copleston-1',title:'A History of Philosophy, Volume I: Greece and Rome — Frederick Copleston'},
  {id:'smith',title:'A Book — John Smith'},
  {id:'zebra',title:'A Book — Zoe Zebra'},
  {id:'aardvark',title:'A Book — Aaron Aardvark'}
 ];
 const sorted=bookOrder.sortBooksForSelector(books);
 assert.deepEqual(sorted.map(book=>book.id),
  ['aardvark','copleston-1','copleston-2','smith','spinoza','zebra']);
});
test('book selector search matches title or author without changing source entries',()=>{
 const books=[
  {id:'1',title:'Nicomachean Ethics — Aristotle'},
  {id:'2',title:'Crime and Punishment — Fyodor Dostoevsky'},
  {id:'3',title:'A Treatise on Electricity — James Clerk Maxwell'}
 ];
 assert.deepEqual(bookOrder.filterBooksByText(books,'dostoevsky'),[books[1]]);
 assert.deepEqual(bookOrder.filterBooksByText(books,'nicomachean'),[books[0]]);
 assert.deepEqual(bookOrder.filterBooksByText(books,''),books);
});

test('current browser client validates the v3 fingerprint coverage manifest',()=>{
 assert.match(clientV49,/from '\.\/evidence-search\.mjs\?v=1\.15\.0'/,
  'the active client cache-busts the changed shared retriever');
 assert(clientV49.includes("reader-fingerprints-v3/coverage-v3.json"));
 assert.match(clientV49,/antilogicalism-reader-coverage-v3/);
 assert.match(clientV49,/libraryVersion!==49/);
 assert.doesNotMatch(clientV49,/coverage-v1|coverage-v2|libraryVersion:47/);
});

test('v1.10 uses original v47 retrieval, verified pilot endpoint and safe Markdown rendering',()=>{
 assert.match(client,/new RemoteLibrary\(\)/);
 assert.match(client,/allowedBookIds:allowed/);
 assert.match(client,/\/api\/pilot-answer/);
 assert.match(client,/putMarkdownBlocks\(reply,answer,citations,highlights,numbering\)/);
 assert.ok(client.includes("document.createElement(isBold?'strong':'em')"));
 assert.ok(client.includes('|\\*([^*\\n]+?)\\*'));
 assert.match(client,/document\.createElement\('li'\)/);
 assert.match(client,/\.textContent/);
 assert.doesNotMatch(client,/innerHTML\s*=/);
 assert.doesNotMatch(client,/SOURCE_PROBE_TOKEN|TURNSTILE_SECRET|TEST_TOKEN/);
 assert.equal(typeof RemoteLibrary,'function');
});
test('v1.10 never claims unsupported books are ready if fingerprint index missing',()=>{
 assert.match(client,/oldPilotFallback=true/);
 assert.match(client,/bookList=\[FALLBACK_BOOK\]/);
 assert.match(client,/reader-fingerprints-v1\/coverage-v1\.json/);
});

test('public companion copy explains cited sources and keeps source reading controls',()=>{
 assert.match(html,/citation link opens the original scanned book/);
 assert.doesNotMatch(html,/Open PDF/);
 assert.match(client,/Read highlighted passage/);
 assert.match(client,/Read source/);
 assert.ok(client.includes("link.textContent='['+citationDisplayLabel(source.id,numbering)+'] '+source.title+' · p. '+source.page;"));
 assert.doesNotMatch(client,/Citations link to the original PDF pages/);
 assert.doesNotMatch(client,/View full page text|appendFullPage|companion-full-page/);
 assert.match(client,/sourceReader\.open\(\{\.\.\.source,excerpt\},read\)/);
 assert.match(html,/id="companion-turnstile" aria-label="Quick check"/);
 assert.doesNotMatch(html,/Complete the quick check below before asking a question/);
 assert.doesNotMatch(html,/Verified search scope|books available/);
 assert.doesNotMatch(html,/The report includes your question and retrieval details/);
 assert.doesNotMatch(html,/companion-diagnostic-(?:panel|toggle|details|copy)/,
  'the current public page keeps diagnostic controls out of visitor markup');
 assert.match(client,/matches\.length\+' matching books\.'/);
 assert.match(client,/turnstile\.render\(challengeBox/);
 assert.match(client,/callback:token=>/);
 assert.doesNotMatch(client,/Checked passages will guide the answer/);
 assert.doesNotMatch(client,/Answer ready below\./);
 assert.doesNotMatch(client,/lastSearch|selected\.size|selectionKey/);
 assert.doesNotMatch(html,/Answer ready below|Checked passages will guide the answer/i);
 assert.doesNotMatch(html,/SHA-256|v47 index|Automatic evidence planning|visitor verification/i);
 assert.doesNotMatch(client,/The verified answer is ready/);
});



test('answer citations open in the local page reader while Sources keeps the PDF link',()=>{
 assert.ok(clientV49.includes('function putCitationTokens(target,answer,citations,evidenceMap=[],numbering=new Map(),'));
 assert.ok(clientV49.includes('citationExcerptsForAnswer(answer,evidenceMap)'));
 assert.ok(clientV49.includes('const evidenceMap=Array.isArray(data.evidenceMap)?data.evidenceMap:[];'));
 assert.ok(clientV49.includes('sourceReader.open({...source,excerpts},a)'));
 assert.ok(clientV49.includes("const quote=node('blockquote',undefined,'companion-key-quote')"));
 assert.ok(clientV49.includes('quote.append(node(\'p\',excerpt))'));
 assert.ok(clientV49.includes("const read=node('button','Read passages','companion-inline-read')"),
  'each citation card keeps one source-level reader button');
 assert.match(clientV49,/node\('button','Read passages','companion-inline-read'\)/);
 assert.doesNotMatch(clientV49,/Read highlighted passages|node\('button','Read passage'/);
 assert.match(html,/“Read passages” opens the cited excerpts here/);
 assert.ok(clientV49.includes('sourceReader.open({...source,excerpts},read)'));
 assert.ok(clientV49.includes('link.href=source.url'));
 assert.ok(clientV49.includes("panel.append(node('h3','Key passages from the source books'))"));
 assert.ok(html.includes('button.companion-inline-citation{-webkit-appearance:none;appearance:none'));
});

test('Book Lite opening drop cap and small-caps apply only to the introductory paragraph',()=>{
 const base='#primary .entry-content #companion-pilot > p:first-child';
 assert(html.includes(base+'::first-line'));
 assert(html.includes(base+'::first-letter'));
 assert.match(html,/font-size:7\.03rem;/);
 assert.match(html,/line-height:43px;/);
 assert.match(html,/margin:9px 5px 0 0;/);
 assert.match(html,/<section id="companion-pilot"[^>]*>\s*<p>Ask questions/);
 assert(!html.includes('#companion-pilot .companion-answer-text::first-letter'));
});
