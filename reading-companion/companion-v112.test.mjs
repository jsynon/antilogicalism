import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {LIVE_RETRIEVAL_CONFIG} from './evidence-search.mjs';
import {parseAnswerMarkdown,parseInlineMarkdown} from './answer-markdown.mjs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const clientV49=readFileSync(new URL('./companion-v112.mjs',import.meta.url),'utf8');
const bookOrder=await import('./book-order.mjs');

// Audit fix C6: this file was companion-v110.test.mjs. The v1.10 client
// is deleted; tests that pinned its source were dropped, and the
// surviving page/renderer tests now read the v1.12 client throughout.

test('response citation labels are plain ordered numbers while IDs stay internal',()=>{
 assert.match(clientV49,/buildCitationNumbering\(answer,citations\)/);
 assert.match(clientV49,/sortCitationsByNumber\(citations,numbering\)/);
 assert.ok(clientV49.includes('highlight=highlights.find(item=>'));
 assert.match(clientV49,/citationDisplayLabel\(source\.id,numbering\)/);
 assert.match(clientV49,/putMarkdownBlocks\(reply,answer,citations,evidenceMap,numbering,citationExcerpts,/);
});

test('public response renderer omits the structured missing-evidence notice',()=>{
 assert.doesNotMatch(clientV49,/data\.missing/);
 assert.doesNotMatch(clientV49,/Evidence gaps:|Evidence check:/);
});
test('live browser uses shared 32-candidate, four-book retrieval settings',()=>{
 assert.deepEqual(LIVE_RETRIEVAL_CONFIG,{maxCandidates:32,maxBooks:4,pagesPerBook:4});
 assert.ok(clientV49.includes('LIVE_RETRIEVAL_CONFIG'));
 assert.ok(clientV49.includes('...LIVE_RETRIEVAL_CONFIG,pageLimit:PDF_PAGE_LIMIT'));
 assert.ok(html.includes('companion-v112.mjs?v=1.20.21'));
 assert.match(clientV49,/distinctiveTerms:item\.distinctiveTerms/);
 assert.match(clientV49,/matchedDistinctiveTerms:item\.matchedDistinctiveTerms/);
 assert.match(clientV49,/sharedMatchedTerms:item\.sharedMatchedTerms/);
});
test('one solved check covers the whole question via the gateway challenge pass (2026-11-15)',()=>{
 // Every verification call site goes through nextVerificationToken;
 // the reset-and-solve flow survives only as its fallback.
 assert.equal((clientV49.match(/nextVerificationToken\(\)/g)||[]).length,5,
  'definition plus planner, gap, gap-retry, and answer call sites');
 assert.equal((clientV49.match(/nextTurnstileToken\(\)/g)||[]).length,2,
  'definition plus the single fallback call inside nextVerificationToken');
 // The pass is captured on all three response paths and forgotten on a 403.
 assert.equal((clientV49.match(/noteChallengePass\(data\)/g)||[]).length,4,
  'definition plus planner, gap, and answer response paths');
 assert.equal((clientV49.match(/forgetChallengePass\(/g)||[]).length,4,
  'definition plus planner, gap, and answer 403 handlers');
 assert.match(clientV49,/challengePassExpiryMs-5000/);
 assert.match(clientV49,/Date\.now\(\)-turnstileTokenAt<240000/,
  'a freshly solved widget token is consumed before any re-solve');
});
test('live browser submits facet ranks with the pilot-answer packet',()=>{
 assert.match(clientV49,/import \{pilotAnswerSources\} from '\.\/answer-payload\.mjs';/);
 assert.match(clientV49,/sources:pilotAnswerSources\(candidatePacket\)/);
 assert.doesNotMatch(clientV49,/candidatePacket\.map\(\(\{bookId,page,text,candidatePartIds\}\)/);
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

test('parser backstop opens a bold wrap that carries bold labels inside it (B9-8 evasion, 2026-11-15)',()=>{
 // The 2026-11-15 live shape: the wrapped opening paragraph contains
 // bold label pairs, so the old clean-pair backstop refused it and the
 // whole block rendered bold. The outer pair comes off; the label
 // pair inside survives as written.
 const labelled='**Faith Against Christendom Kierkegaard argues that institutional religion fails the test of faith because it replaces suffering with social respectability and comfortable belonging [S5]. The established church, he argues, has made Christianity into a matter of custom and citizenship rather than discipleship [S5]. **Social Honor:** True belief seeks honor from God rather than from men, and receiving honor from one another makes belief impossible, since the believer must stand alone before God in opposition to the crowd [S5]. The honor of men is precisely what the confession of faith must renounce [S5].**';
 const blocks=parseAnswerMarkdown(labelled);
 // The parser's section-heading splitter reaches the label first and
 // breaks the wrap at it; the backstop then strips the orphaned
 // opening marker from the first piece and the orphaned closing
 // marker from the last, so nothing renders bold or shows a marker.
 assert.deepEqual(blocks.map(block=>block.type),['paragraph','heading','paragraph']);
 assert.ok(blocks[0].text.startsWith('Faith Against Christendom Kierkegaard argues'));
 assert.ok(!blocks[0].text.includes('**'),'the orphaned opening marker is stripped');
 assert.equal(blocks[1].text,'Social Honor');
 assert.ok(blocks[2].text.startsWith('True belief seeks honor from God'));
 assert.ok(blocks[2].text.endsWith('must renounce [S5].'),'the orphaned closing marker is stripped');
 // The pairwise-artifact form stays one paragraph, and its label
 // pair survives as written.
 const artifact='**Faith Against Christendom Kierkegaard argues that institutional religion fails the test of faith because it replaces suffering with social respectability and comfortable belonging in the congregation of the respectable [S5].**Social Honor:**True belief seeks honor from God rather than from men, and receiving honor from one another makes belief impossible for the person who will not stand alone before God. The honor of men is precisely what the confession of faith must renounce in every generation [S5].**';
 const artifactBlocks=parseAnswerMarkdown(artifact);
 assert.equal(artifactBlocks.length,1);
 assert.equal(artifactBlocks[0].type,'paragraph');
 assert.equal(artifactBlocks[0].text,artifact.slice(2,-2),
  'only the outer marker pair is removed; the label pair and text are byte-identical');
 // A short emphasis span inside a wrap also survives.
 const withShortSpan='**Faith as Passion The experience of faith requires a specific kind of spiritual intensity that reason cannot produce or mediate for the learner, who must receive the condition itself from the god in the Moment of encounter [S2]. The **knight of faith** then returns to finitude.**';
 const opened=parseAnswerMarkdown(withShortSpan);
 assert.equal(opened.length,1);
 assert.equal(opened[0].text,withShortSpan.slice(2,-2));
 // An orphaned opening marker on a long paragraph is stripped (the
 // Worker strips these at assembly; the old backstop let them render).
 const orphaned='**Necessity and Custom Hume explains that our idea of necessity arises from the uniformity observable in nature [S1]. The mind is then determined by custom to infer one event from the other in the same way [S1].';
 const orphanBlocks=parseAnswerMarkdown(orphaned);
 assert.equal(orphanBlocks.length,1);
 assert.equal(orphanBlocks[0].text,orphaned.slice(2));
 // A line that opens with a short bold label is the parser's heading
 // case, however long the prose that follows runs: the label becomes
 // a heading and the prose a plain paragraph — never a bold block.
 const labelFirst='**Non-Rationality:** The leap is not a conclusion of reason but a movement of the whole person toward what reason cannot settle, a transition from the infinite back into the finite that no mediation can perform on the individual\u2019s behalf or explain after the fact.';
 const labelBlocks=parseAnswerMarkdown(labelFirst);
 assert.deepEqual(labelBlocks.map(block=>block.type),['heading','paragraph']);
 assert.equal(labelBlocks[0].text,'Non-Rationality');
 assert.ok(labelBlocks[1].text.startsWith('The leap is not a conclusion of reason'));
});

test('parser backstop removes a lone marker stranded mid-paragraph (live-open orphan, 2026-11-15)',()=>{
 // The live-open Kierkegaard shape on the client edge: a section
 // title whose opening marker was lost, leaving its closer glued
 // between the title and the body text.
 const stranded='The Knight of Faith vs. The Tragic Hero** A central image in the account of faith is the contrast between the knight of faith and the tragic hero, where the tragic hero renounces the universal for a higher ethical purpose while the knight of faith makes the double movement of resignation and belief [S4].';
 const blocks=parseAnswerMarkdown(stranded);
 assert.equal(blocks.length,1);
 assert.equal(blocks[0].type,'paragraph');
 assert.equal(blocks[0].text,stranded.replace('Hero**','Hero'));
});
test('parser backstop removes an orphan glued onto a line inside a multi-section block (completion, 2026-11-15)',()=>{
 // The follow-up run's recurrence shape: the orphan line is glued
 // to the previous section by a single newline, and the block also
 // holds a paired title — the per-paragraph rule counts markers
 // across the joined block and never fires. The line rule does.
 const glued='Faith is a paradox that thought cannot mediate, and the individual stands higher than the universal in the absolute relation to the absolute [S1].\n**Faith as Paradox** The leap moves beyond speculative philosophy and the comfort of human understanding in every generation of believers who take the paradox seriously [S1].\nThe Knight of Faith vs. The Tragic Hero** Johannes de Silentio further illustrates the nature of faith by contrasting the knight of faith with the tragic hero, who renounces the universal for a higher ethical purpose while the knight makes the double movement of resignation and belief [S6].';
 const blocks=parseAnswerMarkdown(glued);
 const prose=blocks.filter(block=>block.type==='paragraph')
  .map(block=>block.text).join('\n');
 assert.ok(prose.includes('The Tragic Hero Johannes'),
  'the orphaned marker is removed from its line');
 assert.ok(!prose.includes('Hero**'),'no stray marker survives');
 assert.ok(blocks.some(block=>block.type==='heading'&&
  block.text==='Faith as Paradox'),'the paired title still parses as a heading');
});

test('parser backstop re-breaks a wall-of-text paragraph at sentence boundaries (completion, 2026-11-15)',()=>{
 // Joshua's live shape: one flowing block with no structure. The
 // parser splits it into readable paragraphs; wording is intact.
 const sentences=Array.from({length:10},(_,i)=>
  `Hume observation ${i+1} links necessity to custom and regular conjunction in the experience of constant succession among resembling instances of cause and effect. [S1]`);
 const blocks=parseAnswerMarkdown(sentences.join(' '));
 assert.ok(blocks.length>=3,
  `the wall of text is broken into paragraphs (got ${blocks.length})`);
 assert.ok(blocks.every(block=>block.type==='paragraph'&&
  block.text.length<=800),'no block is a wall of text');
 for(const s of sentences)
  assert.ok(blocks.some(block=>block.text.includes(
   s.replace(' [S1]',''))),'every sentence survives verbatim');
 // A short paragraph is left as one block.
 assert.equal(parseAnswerMarkdown('Custom guides human life. [S1]').length,1);
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
test('waiting screen sets a time expectation',()=>{
 assert.match(html,/Give it a little time once you ask: answers usually take about one to two minutes/);
 assert.match(html,/searches the library and checks every quote before it replies/);
 // The quick-check explanation paragraph was removed at Joshua's
 // request (2026-11-15); the Turnstile widget itself remains.
 assert.doesNotMatch(html,/The quick check below simply confirms/);
 assert.doesNotMatch(html,/companion-check-hint/);
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
test('the public page presents a clean ask-and-read flow while preserving answer sections',()=>{
 assert.doesNotMatch(html,/companion-suggested-questions|companion-find-button|Review passages/);
 assert.match(html,/id="companion-book-filter"/);
 assert.match(html,/id="companion-book-search" type="search"/);
 assert.match(html,/<strong>Find a book<\/strong>/);
 assert.match(html,/companion-book-controls/);
 assert.ok(clientV49.includes("new Option('All books','')"));
 assert.match(clientV49,/bookSearch\.addEventListener\('input',updateBookOptions\)/);
 assert.match(clientV49,/bookSearch\.value=''/);
 assert.match(html,/id="companion-question"/);
 assert.match(html,/id="companion-status" aria-live="polite" aria-atomic="true" aria-busy="false" role="status"/);
 assert.match(html,/#companion-status\{margin:0;font-size:1\.12em/);
 assert.match(html,/companion-page-flip/);
 assert.doesNotMatch(html,/companion-status-spin/);
 assert.match(html,/prefers-reduced-motion:reduce\).*companion-book/);
 assert.match(html,/id="companion-status-card" hidden/);
 assert.match(html,/#companion-status-card\[hidden\]\{display:none\}/);
 assert.match(html,/id="companion-book" aria-hidden="true"/);
 assert.match(html,/#companion-book\{display:none;position:absolute;left:1\.5rem;top:1\.12rem;width:3\.9rem;height:2\.95rem\}/);
 assert.doesNotMatch(html,/companion-stages|companion-stage-node|companion-stage-label/);
 assert.doesNotMatch(clientV49,/statusStagePatterns|stageNodes/);
 assert.match(clientV49,/statusCard\.hidden=!status\.textContent\.trim\(\)/);
 assert.match(clientV49,/function refreshStatusState\(\)/);
 assert.match(clientV49,/status\.setAttribute\('aria-busy',String\(busy\)\)/);
 assert.match(clientV49,/askButton\.textContent=searching\|\|answering\?'Working…':'Ask Reading Companion'/);
 assert.match(clientV49,/I’ve found a trail of promising pages—now I’m picking out the best clues…/);
 assert.doesNotMatch(html,/Press Enter to ask|companion-question-help/);
 assert.match(clientV49,/question\.addEventListener\('keydown',event=>\{/);
 assert.match(clientV49,/event\.key!=='Enter'\|\|event\.shiftKey\|\|event\.isComposing/);
 assert.match(clientV49,/if\(!askButton\.disabled\)form\.requestSubmit\(askButton\)/);
 assert.doesNotMatch(html,/companion-passage-browser|companion-passage-list/);
 assert.match(clientV49,/function rememberTurn\(questionText,answerText\)/);
 assert.match(clientV49,/conversationHistory\.slice\(-6\)/);
 assert.match(clientV49,/answerBox\.append\(turn\)/);
 assert.match(clientV49,/turn\.scrollIntoView\(\{behavior:reduceMotion\?'auto':'smooth',block:'start'\}\)/);
 assert.match(clientV49,/prefers-reduced-motion/);
 assert.match(clientV49,/history,/);
 assert.match(html,/id="companion-new-conversation" type="button" hidden/);
 assert.match(html,/button\.companion-inline-read\{-webkit-appearance:none;appearance:none;display:inline/);
});

test('catalog loading passes all verified books to the whole-list sorter',()=>{
 assert.match(clientV49,/const list=sortBooksForSelector\(Object\.entries\(index\.books\)/);
 assert.doesNotMatch(clientV49,/\.sort\(sortBooksForSelector\)/);
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
 assert.match(clientV49,/from '\.\/evidence-search\.mjs\?v=1\.20\.17'/,
  'the active client cache-busts the changed shared retriever');
 assert.match(clientV49,/from '\.\/remote-library\.mjs\?v=1\.20\.17'/,
  'the leaf engine import is cache-busted at the same release (audit fix C4)');
 assert.match(clientV49,/from '\.\/reader-contract\.mjs\?v=1\.20\.17'/,
  'the reader contract import is cache-busted at the same release (audit fix C4)');
 assert(clientV49.includes("reader-fingerprints-v3/coverage-v3.json"));
 assert.match(clientV49,/antilogicalism-reader-coverage-v3/);
 assert.match(clientV49,/libraryVersion!==49/);
 assert.doesNotMatch(clientV49,/coverage-v1|coverage-v2|libraryVersion:47/);
});
test('public companion copy explains cited sources and keeps source reading controls',()=>{
 assert.match(html,/Numbered citations in the answer open their passages in the page reader/);
 assert.doesNotMatch(html,/In Key passages, the citation number labels the source/);
 assert.match(html,/“Read passages” opens its excerpts here, and the book title opens the original scanned book/);
 assert.doesNotMatch(html,/Open PDF/);
 assert.doesNotMatch(html,/Citations link to the original PDF pages/);
 assert.doesNotMatch(html,/View full page text|appendFullPage|companion-full-page/);
 assert.match(html,/id="companion-turnstile" aria-label="Quick check"/);
 assert.doesNotMatch(html,/Complete the quick check below before asking a question/);
 assert.doesNotMatch(html,/Verified search scope|books available/);
 assert.doesNotMatch(html,/The report includes your question and retrieval details/);
 assert.doesNotMatch(html,/companion-diagnostic-(?:panel|toggle|details|copy)/,
  'the current public page keeps diagnostic controls out of visitor markup');
 assert.match(clientV49,/matches\.length\+' matching books\.'/);
 assert.match(clientV49,/turnstile\.render\(challengeBox/);
 assert.match(clientV49,/callback:token=>/);
 assert.doesNotMatch(html,/Answer ready below|Checked passages will guide the answer/i);
 assert.doesNotMatch(html,/SHA-256|v47 index|Automatic evidence planning|visitor verification/i);
});

test('the diagnostic pipeline and legacy clients are gone (audit fix C6)',()=>{
 assert.doesNotMatch(clientV49,/diagnosticState|createDiagnosticReport|diagnosticFailureCode|beginDiagnostic|refreshDiagnostic/,
  'no diagnostic state, report builder, or failure-code alias remains in the active client');
 assert.doesNotMatch(clientV49,/companion-diagnostic/);
 assert.doesNotMatch(html,/companion-diagnostic/);
 assert.match(clientV49,/from '\.\/failure-codes\.mjs'/,
  'failure codes and user messages come from the failure-surface module');
 assert.match(clientV49,/resetFailureTracking\(\)/,
  'each ask resets the planner/gap failure bookkeeping the fallback reads');
 assert.match(clientV49,/canFallbackToDirectSearch\(plannerFailure\.status,/);
 assert.match(clientV49,/canFallbackToDirectSearch\(gapFailure\.status,/);
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
 assert.ok(clientV49.includes('link.href=safeUrl'),
  'the source link href is the scheme-validated URL (audit fix C4)');
 assert.ok(clientV49.includes("parsed.protocol==='https:'"),
  'only https payload URLs may become source links');
 assert.doesNotMatch(clientV49,/link\.href=source\.url/,
  'the payload URL never reaches an href verbatim');
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
