import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {RemoteLibrary} from './remote-library.mjs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const client=readFileSync(new URL('./companion-v110.mjs',import.meta.url),'utf8');
const bookOrder=await import('./book-order.mjs');

test('response citation labels are plain ordered numbers while IDs stay internal',()=>{
 assert.match(client,/buildCitationNumbering\(answer,citations\)/);
 assert.match(client,/sortCitationsByNumber\(citations,numbering\)/);
 assert.match(client,/citationDisplayLabel\(item\.source_id,numbering\)/);
 assert.match(client,/citationDisplayLabel\(source\.id,numbering\)/);
 assert.match(client,/putCitationTokens\(reply,answer,citations,highlights,numbering\)/);
});

test('structured missing-evidence notice is not repeated when answer already states it',()=>{
 assert.ok(client.includes('normalizeNotice(answer).includes(normalizeNotice(missing))'));
 assert.ok(client.includes("replace(/[^\\p{L}\\p{N}]+/gu,' ').trim()"));
 assert.ok(client.includes('if(missing&&!answerAlreadyContainsMissing)'));
});
test('answer source packet allows six verified passages',()=>{
 assert.match(client,/const MAX_ANSWER_SOURCES=6/);
 assert.match(client,/maxSources:MAX_ANSWER_SOURCES/);
});
test('v1.10 retains Book Lite and the site navigation',()=>{
 assert.match(html,/wp-content\/themes\/book-lite/);
 assert.match(html,/id="masthead"/);
 assert.match(html,/id="secondary"/);
 assert.match(html,/companion-v110\.mjs/);
});
test('companion introduction explains how to use it and links to Library Search',()=>{
 assert.match(html,/Ask questions about books in the Antilogicalism library/);
 assert.match(html,/Select a book or leave “All books” selected, enter your question/);
 assert(html.includes('href="/antilogicalism/digital-library/">Library Search</a>'));
 assert.doesNotMatch(html,/all 642 searchable titles|644-book library/);
});
test('v1.10 presents a clean ask-and-read flow while preserving answer sections',()=>{
 const answer=client.indexOf('Reading Companion answer');
 const passages=client.indexOf('Key passages from the source books',answer);
 const sources=client.indexOf("'Additional sources'",passages);
 assert(answer>=0);
 assert.equal(client.includes('Explore further'),false);
 assert.doesNotMatch(client,/companion-follow-ups|companion-follow-up-buttons|followUpQuestions/);
 assert(passages>answer);
 assert(sources>passages);
 assert.match(client,/highlightedSourceKeys\.add\(citation\.id\+'\|'\+Number\(citation\.page\)\)/);
 assert.match(client,/const remainingCitations=orderedCitations\.filter\(source=>/);
 assert.match(client,/if\(remainingCitations\.length\)/);
 assert.match(client,/for\(const source of remainingCitations\)/);
 assert.doesNotMatch(html,/companion-suggested-questions|companion-find-button|Review passages/);
 assert.match(html,/id="companion-book-filter"/);
 assert.match(html,/id="companion-book-search" type="search"/);
 assert.match(html,/<strong>Find a book<\\/strong>/);
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

test('v1.10 uses original v47 retrieval, verified pilot endpoint and text-only output',()=>{
 assert.match(client,/new RemoteLibrary\(\)/);
 assert.match(client,/allowedBookIds:allowed/);
 assert.match(client,/\/api\/pilot-answer/);
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
 assert.match(html,/Citations open original PDF pages/);
 assert.match(client,/Read passage/);
 assert.doesNotMatch(client,/View full page text|appendFullPage|companion-full-page/);
 assert.match(client,/sourceReader\.open\(\{\.\.\.source,excerpt\},read\)/);
 assert.match(html,/id="companion-turnstile" aria-label="Quick check"/);
 assert.doesNotMatch(html,/Complete the quick check below before asking a question/);
 assert.doesNotMatch(html,/Verified search scope|books available/);
 assert.doesNotMatch(html,/The report includes your question and retrieval details/);
 assert.match(html,/id="companion-diagnostic-toggle" type="checkbox"/);
 assert.match(html,/Show diagnostic report for this result/);
 assert.match(html,/id="companion-diagnostic-copy" type="button"/);
 assert.match(client,/matches\\.length\\+' matching books\\.'/);
 assert.match(html,/border-top:1px solid #dfe2e3/);
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
 assert.ok(client.includes('function putCitationTokens(target,answer,citations,evidenceHighlights=[],numbering=new Map())'));
 assert.ok(client.includes("sourceReader.open({...source,excerpt:evidence?.quote||''},a)"));
 assert.ok(client.includes("sourceReader.open({...citation,excerpt:item.quote},read)"));
 assert.ok(client.includes('link.href=source.url'));
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
