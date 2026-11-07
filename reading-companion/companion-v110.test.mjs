import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {RemoteLibrary} from './remote-library.mjs';
import {LIVE_RETRIEVAL_CONFIG} from './evidence-search.mjs';
import {parseAnswerMarkdown,parseInlineMarkdown} from './answer-markdown.mjs';

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
test('live browser uses shared 32-candidate, four-book retrieval settings',()=>{
 assert.deepEqual(LIVE_RETRIEVAL_CONFIG,{maxCandidates:32,maxBooks:4,pagesPerBook:4});
 assert.ok(clientV49.includes('LIVE_RETRIEVAL_CONFIG'));
 assert.ok(clientV49.includes('...LIVE_RETRIEVAL_CONFIG,pageLimit:PDF_PAGE_LIMIT'));
 assert.ok(html.includes('companion-v112.mjs?v=1.20.6'));
 assert.match(clientV49,/distinctiveTerms:item\.distinctiveTerms/);
 assert.match(clientV49,/matchedDistinctiveTerms:item\.matchedDistinctiveTerms/);
 assert.match(clientV49,/sharedMatchedTerms:item\.sharedMatchedTerms/);
});
test('v49 answer renderer keeps default prose out of accidental ordered lists',()=>{
 assert.match(clientV49,/questionRequestsEnumeration\(turnQuestion\)/);
 assert.match(clientV49,/parseAnswerMarkdown\(answer/);
 assert.match(clientV49,/document\.createElement\('h3'\)/);
 assert.match(clientV49,/parseInlineMarkdown\(answer\)/);
 const raw='**The Relationship Between Love and Knowing God** The phrase establishes a standard: * **Recognition of God:** Those who love know God [S2]. * **Abiding in God:** Those who abide in love abide in God [S2]. * **The Moral Imperative:** Love of God is shown through love of others [S2]. *';
 const blocks=parseAnswerMarkdown(raw);
 assert.equal(blocks[0].type,'heading');
 assert.equal(blocks[1].type,'paragraph');
 assert.equal(blocks[1].text,'The phrase establishes a standard:');
 assert.deepEqual(blocks.slice(2).map(block=>block.type),['paragraph','paragraph','paragraph']);
 assert.ok(blocks.slice(2).every(block=>block.text.includes('**')),
  'bold labels survive when a list is rendered as separate prose blocks');
 const longWithBold='*A long stretch containing **a bold label** '+('and ordinary explanation '.repeat(8))+'*';
 assert.equal(parseInlineMarkdown(longWithBold).some(token=>token.type==='em'),false,
  'overlong emphasis is removed even when bold markup is nested inside it');
 assert.equal(parseInlineMarkdown('*A Short Work Title*')[0].type,'em',
  'short work titles retain italics');
 const inlineBullets=parseAnswerMarkdown('The answer introduces the distinction: *   First point about choice [S1]. *   Second point about externals [S1].');
 assert.deepEqual(inlineBullets.map(block=>block.type),['paragraph','paragraph','paragraph'],
  'unambiguous inline bullet runs become separate readable prose blocks');
 assert.equal(inlineBullets[1].text,'First point about choice [S1].');
 assert.equal(inlineBullets[2].text,'Second point about externals [S1].');
 const singleSpaceBullets=parseAnswerMarkdown('Unamuno suggests that: * Human consciousness may be viewed as an end [S2]. * Good can be defined as persistence [S2]. * Meaning is tied to religious values [S2].');
 assert.deepEqual(singleSpaceBullets.map(block=>block.type),['paragraph','paragraph','paragraph','paragraph'],
  'a repeated single-space inline bullet run becomes separate prose blocks');
 assert.equal(singleSpaceBullets[0].text,'Unamuno suggests that:');
 assert.deepEqual(singleSpaceBullets.slice(1).map(block=>block.text),[
  'Human consciousness may be viewed as an end [S2].',
  'Good can be defined as persistence [S2].',
  'Meaning is tied to religious values [S2].'
 ]);
 assert.equal(parseAnswerMarkdown('This is * an italic phrase. It continues* in prose.').length,1,
  'ordinary italics are not split into list items');
 const numbered=parseAnswerMarkdown('1. First reason\n2. Second reason',{allowLists:true});
 assert.equal(numbered[0].type,'list');
 assert.equal(numbered[0].ordered,true);
});
test('batch 9 parser backstop unwraps whole-paragraph bold but spares titles, labels, and short bold',()=>{
 // A part opener wrapped in one bold pair (the live B9-8 shape) becomes a
 // plain paragraph: no heading block and no paragraph-wide strong span.
 const wrapped='**Faith as a Paradoxical Encounter In Philosophical Fragments, the pseudonymous speaker describes faith as the result of an encounter between Reason and the Paradox [S1]. This encounter occurs in a "Moment" where Reason sets itself aside to allow the Paradox to bestow itself upon the learner [S1].**';
 const blocks=parseAnswerMarkdown(wrapped);
 assert.equal(blocks.length,1);
 assert.equal(blocks[0].type,'paragraph');
 assert.equal(blocks[0].text,wrapped.slice(2,-2));
 assert.equal(parseInlineMarkdown(blocks[0].text).some(token=>token.type==='strong'),false);
 // The same wrap split across lines unwraps when the lines are joined.
 const multiline=parseAnswerMarkdown('**Faith as a Paradoxical Encounter In Philosophical Fragments, the\npseudonymous speaker describes faith as the result of an encounter between\nReason and the Paradox [S1]. This encounter occurs in a "Moment" where Reason\nsets itself aside to allow the Paradox to bestow itself [S1].**');
 assert.equal(multiline.length,1);
 assert.equal(multiline[0].type,'paragraph');
 assert.equal(multiline[0].text.startsWith('**'),false);
 assert.equal(multiline[0].text.endsWith('[S1].'),true);
 // The underscore form unwraps on length alone (one long sentence).
 const longInner=('word '.repeat(50)).trim()+'.';
 const underscored=parseAnswerMarkdown('__'+longInner+'__');
 assert.deepEqual(underscored,[{type:'paragraph',text:longInner}]);
 // A standalone bold title line still becomes a heading.
 assert.deepEqual(parseAnswerMarkdown('**Faith and the Individual**'),
  [{type:'heading',text:'Faith and the Individual'}]);
 // A short bold paragraph under the threshold keeps its markers.
 const shortBold=parseAnswerMarkdown('**Faith is a leap, a passionate\ncommitment of the self.**');
 assert.deepEqual(shortBold,[{type:'paragraph',
  text:'**Faith is a leap, a passionate commitment of the self.**'}]);
 // A bold lead-in inside a paragraph is untouched.
 const leadIn='Faith involves two movements of the soul. **Beyond Resignation:** faith goes further than infinite resignation, receiving the finite back through the power of the absurd.';
 assert.deepEqual(parseAnswerMarkdown(leadIn),[{type:'paragraph',text:leadIn}]);
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
 assert.match(html,/Explore questions and ideas with help from the Antilogicalism Library/);
 assert.match(html,/The Reading Companion draws on relevant passages and may add general context/);
 assert.match(html,/Select a book or leave “All books” selected, enter your question/);
 assert(html.includes('href="/antilogicalism/digital-library/">Library Search</a>'));
 assert(html.includes('Search the full-text collection with <a href="/antilogicalism/digital-library/">Library Search</a> or browse books by title with the <a href="/antilogicalism/primary-sources/">Bookshelf</a>.'));
 assert.doesNotMatch(html,/all 642 searchable titles|644-book library/);
});
test('waiting screen sets a time expectation and explains the quick check',()=>{
 assert.match(html,/Give it a little time once you ask: answers usually take about one to two minutes/);
 assert.match(html,/searches the library and checks every quote before it replies/);
 assert.match(html,/The quick check below simply confirms you’re a person rather than a bot/);
 assert.match(html,/the Ask button unlocks as soon as it passes/);
 assert.match(html,/pass it again before a follow-up question/);
 const hintAt=html.indexOf('The quick check below simply confirms');
 const widgetAt=html.indexOf('id="companion-turnstile"');
 assert.ok(hintAt>=0&&widgetAt>hintAt,
  'quick-check explanation sits immediately before the Turnstile widget container');
 assert.match(clientV49,/function armLongWaitNotice\(\)/);
 assert.match(clientV49,/},45000\);/);
 assert.match(clientV49,/I’m following those ideas through the sources and sorting out the details…/);
 assert.match(clientV49,/setStatus\('I’ve found a trail of promising pages—now I’m picking out the best clues…'\);\n    armLongWaitNotice\(\);/);
 assert.match(clientV49,/cancelLongWaitNotice\(\);\n    answering=false;/);
});
test('selected-book requests skip the planner call with a deterministic plan; all-books keeps it',()=>{
 assert.match(clientV49,/deterministicSelectedBookPlan\(q,bookList,bookFilter\.value\|\|''\)/);
 const skipAt=clientV49.indexOf('deterministicSelectedBookPlan(q,bookList');
 const planCallAt=clientV49.indexOf('planned=await requestSourcePlan(q,token,history)');
 assert.ok(skipAt>=0&&planCallAt>skipAt,
  'the deterministic selected-book plan is consulted before the hosted planner call');
 assert.match(clientV49,/diagnosticState\.plannerSkipped=true/);
 assert.match(clientV49,/plannerSkipReason='selected-book-deterministic-plan'/,
  'the skip is flagged in diagnostics');
 assert.match(clientV49,/planned=await requestSourcePlan\(q,token,history\)/,
  'the model-planned flow remains for all-books and conflicting questions');
});
test('both retrieval rounds of a question share one search cache',()=>{
 assert.match(clientV49,/const searchCache=createRetrievalSearchCache\(\)/);
 assert.ok(clientV49.includes('partQuestions,allowEmpty:true,searchCache}'),
  'round one populates the shared cache');
 assert.ok(clientV49.includes('partQuestions,gapQueries,gapQueryPartLinks,searchCache}'),
  'the gap round reuses round-one searches through the shared cache');
 assert.match(clientV49,/\.\.\.\(searchCache\?\{searchCache\}:\{\}\),/,
  'retrieveSources threads the cache into shared retrieval only when one is active');
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
 assert.match(clientV49,/I’ve found a trail of promising pages—now I’m picking out the best clues…/);
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
 assert.match(clientV49,/from '\.\/evidence-search\.mjs\?v=1\.20\.6'/,
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
 assert.match(html,/Numbered citations in the answer open their passages in the page reader/);
 assert.doesNotMatch(html,/In Key passages, the citation number labels the source/);
 assert.match(html,/“Read passages” opens its excerpts here, and the book title opens the original scanned book/);
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
 assert.match(html,/“Read passages” opens its excerpts here/);
 assert.ok(clientV49.includes('sourceReader.open({...source,excerpts},read)'));
 assert.ok(clientV49.includes("const citationLabel=node('p','Citation ['+\n        citationDisplayLabel(source.id,numbering)+']','companion-source-number')"),
  'the source citation number is a non-clickable label');
 const quoteOrder=clientV49.indexOf('card.append(quote);');
 const citationOrder=clientV49.indexOf('card.append(citationLabel);',quoteOrder);
 const buttonAndTitleOrder=clientV49.indexOf('card.append(read,link);',citationOrder);
 const attributionOrder=clientV49.indexOf("card.append(node('p',attribution,'companion-source-attribution'));",buttonAndTitleOrder);
 assert.ok([quoteOrder,citationOrder,buttonAndTitleOrder,attributionOrder]
  .every((position,index,all)=>position>=0&&(index===0||position>all[index-1])),
  'the DOM order is passage, citation, button, book title, then attribution');
 assert.ok(clientV49.includes("if(attribution)card.append(node('p',attribution,'companion-source-attribution'))"));
 assert.doesNotMatch(clientV49,/citationButton|sourceReader\.open\(\{\.\.\.source,excerpts\},citationLabel\)/,
  'the source card has no second control for opening the same excerpts');
 assert.ok(clientV49.includes("link.textContent=source.title+' · p. '+source.page;"),
  'only the book title and page label open the scanned book');
 assert.ok(clientV49.includes('// The citation label stays separate from the linked book title.'));
 assert.ok(clientV49.includes('// The title opens the scan; Read passages remains the excerpt control.'));
 assert.doesNotMatch(clientV49,/link\.textContent='\['\+citationDisplayLabel\(source\.id,numbering\)/,
  'the citation number is not part of the scanned-book link');
 assert.ok(clientV49.includes('link.href=source.url'));
 assert.ok(clientV49.includes("panel.append(node('h3','Key passages from the source books'))"));
 assert.ok(html.includes('button.companion-inline-citation{-webkit-appearance:none;appearance:none'));
 assert.ok(html.includes('.companion-source-number{'));
 assert.ok(html.includes('.companion-key-passage>.companion-source-attribution{order:4;'));
 assert.ok(html.includes('.companion-key-quote{order:0}'));
 assert.ok(html.includes('.companion-key-passage>button.companion-inline-read{order:2}'));
});

test('Book Lite opening drop cap and small-caps apply only to the introductory paragraph',()=>{
 const base='#primary .entry-content #companion-pilot > p:first-child';
 assert(html.includes(base+'::first-line'));
 assert(html.includes(base+'::first-letter'));
 assert.match(html,/font-size:7\.03rem;/);
 assert.match(html,/line-height:43px;/);
 assert.match(html,/margin:9px 5px 0 0;/);
 assert.match(html,/<section id="companion-pilot"[^>]*>\s*<p>Explore questions and ideas/);
 assert(!html.includes('#companion-pilot .companion-answer-text::first-letter'));
});
