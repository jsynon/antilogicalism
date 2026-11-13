import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRetrievalSearchCache,createSearchPrefetch,deterministicSelectedBookPlan,
 retrieveEvidence} from './evidence-search.mjs';

// Fixtures for batch 5's client track:
//  - L1: one retrieval search cache threaded through a question's initial
//    and conditional gap rounds. The incremental gap round must return a
//    result deep-equal to a full re-run of the same round while executing
//    only the searches that are genuinely new.
//  - A3: a planned part that ends retrieval with zero candidates receives
//    one targeted search in its own wording, traced in the search report.
//  - L5: the deterministic selected-book plan that lets the browser skip
//    the hosted planner call for single-book scope.

const BOOKS=[
 {id:'4',title:'Metaphysics — Aristotle'},
 {id:'35',title:'An Enquiry Concerning Human Understanding — David Hume'},
 {id:'40',title:'Critique of Pure Reason — Immanuel Kant'}
];
const TEXTS={
 '4':'Aristotle explains causality through material, formal, efficient, and final causes.',
 '35':'Hume explains causal necessity through constant conjunction and custom.',
 '40':'Kant explains causality as an a priori category of the understanding.'
};
const QUESTION='How do Aristotle, Hume, and Kant differ on causality?';
const QUERIES=['Aristotle causality explanation','Hume causality custom conjunction',
 'Kant causality a priori'];
const PARTS=[
 {partId:'P1',question:'How does Aristotle understand causality?',sourceBookIds:['4']},
 {partId:'P2',question:'How does Hume understand causality?',sourceBookIds:['35']},
 {partId:'P3',question:'How does Kant understand causality?',sourceBookIds:['40']}
];
const GAP_QUERY='causality necessity skepticism empiricism';

function causalityFixture(){
 const calls=[];
 const sourceFor=(bookId,page=7,score=30)=>({bookId,title:BOOKS.find(book=>book.id===bookId).title,
  page,globalPageId:Number(bookId)*100+page,score,preview:TEXTS[bookId]});
 const library={search:async(query,options={})=>{
  const bookId=options.bookId?String(options.bookId):'';
  calls.push({query,bookId});
  if(bookId)return {sources:[sourceFor(bookId)]};
  if(query===GAP_QUERY)return {sources:[
   {bookId:'35',title:BOOKS[1].title,page:21,globalPageId:3521,score:47,
    preview:'Hume argues causal necessity is felt as an expectation formed by repeated experience.'},
   {bookId:'40',title:BOOKS[2].title,page:22,globalPageId:4022,score:43,
    preview:'Kant treats causal necessity as a condition of possible experience.'}]};
  return {sources:[]};
 }};
 const baseInput={question:QUESTION,queries:QUERIES,
  partQueries:PARTS.map(part=>({partId:part.partId,query:part.question})),
  partQuestions:PARTS,library,books:BOOKS,
  allowedBookIds:new Set(BOOKS.map(book=>book.id)),
  pageLoader:async source=>({text:source.page===21
   ?'Hume argues causal necessity is felt as an expectation formed by repeated experience.'
   :source.page===22?'Kant treats causal necessity as a condition of possible experience.'
   :TEXTS[source.bookId]})};
 const gapInput={...baseInput,gapQueries:[GAP_QUERY],
  gapQueryPartLinks:[{query:GAP_QUERY,partIds:['P2']}]};
 return {calls,baseInput,gapInput};
}

test('incremental gap retrieval returns the full re-run result while executing only the new gap search',async()=>{
 const full=causalityFixture();
 const fullRound1=await retrieveEvidence(full.baseInput);
 const fullRound1Calls=full.calls.length;
 const fullRound2=await retrieveEvidence(full.gapInput);
 const fullRound2Calls=full.calls.slice(fullRound1Calls);

 const incremental=causalityFixture();
 const searchCache=createRetrievalSearchCache();
 const incRound1=await retrieveEvidence({...incremental.baseInput,searchCache});
 assert.deepEqual(incRound1,fullRound1,
  'threading a cache through round one must not change its result');
 assert.equal(incremental.calls.length,fullRound1Calls,
  'round one executes the same searches with or without a cache');
 const incRound2=await retrieveEvidence({...incremental.gapInput,searchCache});
 assert.deepEqual(incRound2,fullRound2,
  'the incremental gap round must build the identical merged pool, traces included');
 assert.deepEqual(incremental.calls.slice(fullRound1Calls).map(call=>`${call.query}\n${call.bookId}`),
  [`${GAP_QUERY}\n35`],
  'only the new gap facet search executes in the incremental round');
 assert.ok(fullRound2Calls.length>5,
  `the full re-run repeats the round-one facets (saw ${fullRound2Calls.length} calls)`);
});

test('a gap round with no new queries executes nothing and still matches the full re-run',async()=>{
 const full=causalityFixture();
 await retrieveEvidence(full.baseInput);
 const duplicateGap={...full.baseInput,gapQueries:[QUERIES[1]],
  gapQueryPartLinks:[{query:QUERIES[1],partIds:['P2']}]};
 const fullRound2=await retrieveEvidence(duplicateGap);

 const incremental=causalityFixture();
 const searchCache=createRetrievalSearchCache();
 await retrieveEvidence({...incremental.baseInput,searchCache});
 const callsBefore=incremental.calls.length;
 const incRound2=await retrieveEvidence({...incremental.baseInput,
  gapQueries:[QUERIES[1]],gapQueryPartLinks:[{query:QUERIES[1],partIds:['P2']}],searchCache});
 assert.deepEqual(incRound2,fullRound2,
  'duplicate gap queries change bookkeeping only, identically in both flows');
 assert.equal(incremental.calls.length,callsBefore,
  'no library search executes when the gap round adds no new query');
});

test('a failing gap facet rejects the incremental round exactly like the full re-run',async()=>{
 const fixture=()=>{ 
  const library={search:async query=>{
   if(query==='reality external world skepticism')throw Error('gap partition unavailable');
   return {sources:[{bookId:'19',title:'A philosophical source',page:4,globalPageId:4,
    score:50,preview:'Experience of the external world is discussed as a ground for knowledge.'}]};
  }};
  const input={question:'How do we know reality exists?',
   queries:['reality exists empirical knowledge','how reality is known'],
   partQuestions:[{partId:'P1',question:'How do we know reality exists?'}],
   library,books:[{id:'19',title:'A philosophical source'}],
   allowedBookIds:new Set(['19']),
   pageLoader:async()=>({text:'Experience of the external world is discussed as a ground for knowledge and belief.'})};
  return {library,input};
 };
 const gap={gapQueries:['reality external world skepticism'],
  gapQueryPartLinks:[{query:'reality external world skepticism',partIds:['P1']}]};
 const full=fixture();
 await retrieveEvidence(full.input);
 await assert.rejects(retrieveEvidence({...full.input,...gap}),/gap partition unavailable/);
 const incremental=fixture();
 const searchCache=createRetrievalSearchCache();
 await retrieveEvidence({...incremental.input,searchCache});
 await assert.rejects(retrieveEvidence({...incremental.input,...gap,searchCache}),
  /gap partition unavailable/);
});

test('search prefetch facades share settled executions through one retrieval cache',async()=>{
 let calls=0;
 const library={search:async()=>{calls++;return {sources:[]};}};
 const cache=createRetrievalSearchCache();
 const first=createSearchPrefetch(library,{cache});
 first.prefetch('shared query',{});
 const second=createSearchPrefetch(library,{cache});
 await second.search('shared query',{});
 assert.equal(calls,1,'a second facade over the same cache reuses the settled execution');
});

// --- A3: per-part zero-candidate gap trigger -------------------------------

const STARVED_PARTS=[
 {partId:'P1',question:'How does Aristotle understand causality?',sourceBookIds:['4']},
 {partId:'P2',question:'How does Kant understand causality?',sourceBookIds:['40']},
 {partId:'P3',question:'How does Hume understand causality?',sourceBookIds:['35']}
];
function starvedFixture({threeParts=false}={}){
 const calls=[];
 const kantSource={bookId:'40',title:BOOKS[2].title,page:9,
  globalPageId:4009,score:52,preview:TEXTS['40']};
 const humeSource={bookId:'35',title:BOOKS[1].title,page:11,
  globalPageId:3511,score:49,preview:TEXTS['35']};
 const library={search:async(query,options={})=>{
  const bookId=options.bookId?String(options.bookId):'';
  const allowed=[...(options.allowedBookIds||[])].map(String);
  calls.push({query,bookId,allowed});
  if(bookId==='4')return {sources:[{bookId:'4',title:BOOKS[0].title,page:7,
   globalPageId:407,score:60,preview:TEXTS['4']}]};
  if(bookId)return {sources:[]};
  // The targeted per-part searches arrive unpinned by bookId, narrowed by
  // the part's allowed set instead. Every planner rewrite for the Kant and
  // Hume parts misses; only their own wording, searched inside their own
  // works by the starved-part trigger, finds a page.
  if(query==='How does Kant understand causality?'&&allowed.length===1&&allowed[0]==='40')
   return {sources:[kantSource]};
  if(query==='How does Hume understand causality?'&&allowed.length===1&&allowed[0]==='35')
   return {sources:[humeSource]};
  return {sources:[]};
 }};
 const parts=threeParts?STARVED_PARTS:STARVED_PARTS.slice(0,2);
 const input={question:QUESTION,queries:QUERIES.slice(0,2),
  partQueries:[{partId:'P1',query:STARVED_PARTS[0].question},
   {partId:'P2',query:'Kant causality a priori categories'},
   ...(threeParts?[{partId:'P3',query:'Hume causality custom habit'}]:[])],
  partQuestions:parts,library,books:BOOKS,
  allowedBookIds:new Set(BOOKS.map(book=>book.id)),
  pageLoader:async source=>({text:TEXTS[source.bookId]})};
 return {calls,input};
}

test('a starved part receives one targeted search in its own wording, traced as a part gap recovery',async()=>{
 const {calls,input}=starvedFixture();
 const result=await retrieveEvidence(input);
 const targeted=calls.filter(call=>call.query==='How does Kant understand causality?');
 assert.equal(targeted.length,1,'exactly one targeted search fires for the starved part');
 assert.deepEqual(targeted[0].allowed,['40'],
  'the targeted search stays inside the part’s validated source scope');
 assert.equal(targeted[0].bookId,'','the targeted search is set-scoped, not single-book pinned');
 const traced=result.searches.filter(search=>search.partGapRecovery);
 assert.equal(traced.length,1);
 assert.equal(traced[0].starvedPartId,'P2');
 assert.equal(traced[0].resultCount,1);
 assert.ok(result.candidates.some(source=>source.bookId==='40'&&source.page===9&&
  source.candidatePartIds.includes('P2')),
  'the recovered page joins the pool linked to the starved part');
});

test('no targeted search fires when every part already has candidates',async()=>{
 const library={search:async(query,options={})=>{
  const bookId=options.bookId?String(options.bookId):'';
  if(!bookId)return {sources:[]};
  return {sources:[{bookId,title:BOOKS.find(book=>book.id===bookId).title,page:7,
   globalPageId:Number(bookId)*100+7,score:50,preview:TEXTS[bookId]}]};
 }};
 const result=await retrieveEvidence({question:QUESTION,queries:QUERIES.slice(0,2),
  partQueries:[{partId:'P1',query:STARVED_PARTS[0].question},
   {partId:'P2',query:'Kant causality a priori categories'}],
  partQuestions:STARVED_PARTS.slice(0,2),
  library,books:BOOKS,allowedBookIds:new Set(BOOKS.map(book=>book.id)),
  pageLoader:async source=>({text:TEXTS[source.bookId]})});
 assert.ok(!result.searches.some(search=>search.partGapRecovery),
  'a fully covered part set triggers no part gap recovery');
});

test('two starved parts each receive exactly one targeted search',async()=>{
 const {calls,input}=starvedFixture({threeParts:true});
 const result=await retrieveEvidence(input);
 assert.equal(calls.filter(call=>call.query==='How does Kant understand causality?').length,1);
 assert.equal(calls.filter(call=>call.query==='How does Hume understand causality?').length,1);
 assert.deepEqual(result.searches.filter(search=>search.partGapRecovery)
  .map(search=>search.starvedPartId),['P2','P3']);
 assert.ok(result.candidates.some(source=>source.bookId==='35'&&source.page===11&&
  source.candidatePartIds.includes('P3')));
});

// --- B6-6 → B10-7: per-position chase -------------------------------------
// A part can end retrieval with candidates that never reach one of its
// requirements: its facets found the topic in general, not the specific
// thing the part must establish. Batch 6 chased only the first uncovered
// requirement, and only in the post-gap round; batch 10 judges every
// requirement in every invocation, traces each chase as a part gap
// recovery with reason 'position', and returns a positionCoverage record.

const COVERAGE_BOOKS=[
 {id:'10',title:'A Treatise on Gardening — A. Green'},
 {id:'11',title:'Poems of the Seasons — R. Brown'}
];
const REQUIREMENT_P2='identify the recommended timing for pruning dormant shrubs';
const GENERIC_PREVIEW='Green surveys the history and practice of ornamental gardening in Britain.';
const SOIL_PREVIEW='Prepare the soil before planting by digging in compost and raking the bed level.';
const PRUNING_PREVIEW='Prune dormant shrubs in late winter; the recommended timing is before the buds break.';
const COVERAGE_QUESTION='What does Green say about preparing soil and about pruning?';
const COVERAGE_GAP='gardening techniques seasonal care overview';

function coverageFixture({covered=false}={}){
 const calls=[];
 const soilSource={bookId:'10',title:COVERAGE_BOOKS[0].title,page:31,
  globalPageId:1031,score:44,preview:SOIL_PREVIEW};
 const genericSource={bookId:'10',title:COVERAGE_BOOKS[0].title,page:44,
  globalPageId:1044,score:39,preview:covered
   ?'The recommended timing for pruning dormant shrubs is late winter.'
   :GENERIC_PREVIEW};
 const pruningSource={bookId:'10',title:COVERAGE_BOOKS[0].title,page:57,
  globalPageId:1057,score:61,preview:PRUNING_PREVIEW};
 const library={search:async(query,options={})=>{
  const bookId=options.bookId?String(options.bookId):'';
  const allowed=[...(options.allowedBookIds||[])].map(String);
  calls.push({query,bookId,allowed});
  if(bookId==='10')return {sources:[query.includes('soil')?soilSource:genericSource]};
  if(bookId)return {sources:[]};
  // The coverage-triggered search arrives unpinned, narrowed to the
  // part's own scope set; broader unpinned facets keep the generic pool.
  if(query===REQUIREMENT_P2&&allowed.length===1&&allowed[0]==='10')
   return {sources:[pruningSource]};
  return {sources:[]};
 }};
 const parts=[
  {partId:'P1',question:'What does Green say about preparing soil?',sourceBookIds:['10'],
   requirements:[{id:'P1-R1',text:'identify the steps used to prepare soil before planting'}]},
  {partId:'P2',question:'What does Green say about pruning?',sourceBookIds:['10'],
   requirements:[{id:'P2-R1',text:REQUIREMENT_P2}]}
 ];
 const input={question:COVERAGE_QUESTION,
  queries:['Green gardening soil preparation','Green gardening pruning advice'],
  partQueries:[{partId:'P1',query:'Green soil preparation steps'},
   {partId:'P2',query:'Green pruning guidance'}],
  partQuestions:parts,library,books:COVERAGE_BOOKS,
  allowedBookIds:new Set(COVERAGE_BOOKS.map(book=>book.id)),
  pageLoader:async source=>({text:source.page===31?SOIL_PREVIEW:
   source.page===57?PRUNING_PREVIEW:GENERIC_PREVIEW})};
 const gapInput={...input,gapQueries:[COVERAGE_GAP],
  gapQueryPartLinks:[{query:COVERAGE_GAP,partIds:['P1']}]};
 return {calls,input,gapInput};
}

test('a part whose candidates miss its requirement gets one targeted search worded from that requirement',async()=>{
 const {calls,gapInput}=coverageFixture();
 const result=await retrieveEvidence(gapInput);
 const targeted=calls.filter(call=>call.query===REQUIREMENT_P2);
 assert.equal(targeted.length,1,'exactly one coverage search fires for the uncovered part');
 assert.deepEqual(targeted[0].allowed,['10'],
  'the coverage search stays inside the part’s validated source scope');
 assert.equal(targeted[0].bookId,'','the coverage search is set-scoped, not single-book pinned');
 const traced=result.searches.filter(search=>search.partGapRecovery);
 assert.equal(traced.length,1,'only the uncovered part traces a recovery');
 assert.equal(traced[0].starvedPartId,'P2');
 assert.equal(traced[0].reason,'position');
 assert.equal(traced[0].resultCount,1);
 assert.ok(result.candidates.some(source=>source.bookId==='10'&&source.page===57&&
  source.candidatePartIds.includes('P2')),
  'the recovered page joins the pool linked to the uncovered part');
 assert.deepEqual(result.positionCoverage,[
  {partId:'P1',requirements:[{requirement:'identify the steps used to prepare soil before planting',
    status:'covered',booksCovering:['10']}]},
  {partId:'P2',requirements:[{requirement:REQUIREMENT_P2,
    status:'chased-covered',booksCovering:['10']}]}],
  'the coverage record shows which planned positions had evidence');
});

test('no coverage search fires when the candidates already reach every requirement',async()=>{
 const {calls,gapInput}=coverageFixture({covered:true});
 const result=await retrieveEvidence(gapInput);
 assert.equal(calls.filter(call=>call.query===REQUIREMENT_P2).length,0);
 assert.ok(!result.searches.some(search=>search.partGapRecovery),
  'covered requirements trigger no part gap recovery');
});

test('the per-position chase fires in the initial round, before any gap planning (batch 10 B10-7)',async()=>{
 const {calls,input}=coverageFixture();
 const result=await retrieveEvidence(input);
 assert.equal(calls.filter(call=>call.query===REQUIREMENT_P2).length,1,
  'a per-position gap inside a lexically adequate part is chased immediately, not left to a gap round that may never come');
 const traced=result.searches.filter(search=>search.partGapRecovery);
 assert.equal(traced.length,1);
 assert.equal(traced[0].reason,'position');
});

test('a page matching only shared terms does not cover a requirement; the distinctive page is chased (B.5)',async()=>{
 // Stage B.5 (item 4b): coverage inside the position chase needs a
 // term distinctive to the part (here, against the full question for
 // a single-part plan), not just overlap on the shared topic words.
 const requirement='the letter Darcy wrote to Elizabeth about Wickham';
 const sharedPage={bookId:'301',title:'Pride and Prejudice',page:88,
  globalPageId:3088,score:70,
  preview:'Darcy gave Elizabeth the letter at the ballroom, and everyone talked of the assembly.'};
 const letterPage={bookId:'301',title:'Pride and Prejudice',page:112,
  globalPageId:3112,score:66,
  preview:'In the letter Darcy owned that Wickham had deceived Georgiana.'};
 const calls=[];
 const library={search:async(query,options={})=>{
  const bookId=options.bookId?String(options.bookId):'';
  const allowed=[...(options.allowedBookIds||[])].map(String);
  calls.push({query,bookId,allowed});
  if(bookId==='301')return {sources:[sharedPage]};
  if(query===requirement&&allowed.length===1&&allowed[0]==='301')
   return {sources:[letterPage]};
  return {sources:[]};
 }};
 const result=await retrieveEvidence({
  question:'What does Darcy write in his letter to Elizabeth?',
  queries:['Darcy letter Elizabeth','Darcy Rosings assembly'],
  partQueries:[{partId:'P1',query:'Darcy letter Elizabeth'}],
  partQuestions:[{partId:'P1',question:'What does Darcy write in his letter to Elizabeth?',
   sourceBookIds:['301'],requirements:[requirement]}],
  library,books:[{id:'301',title:'Pride and Prejudice'}],
  allowedBookIds:new Set(['301']),
  pageLoader:async source=>({text:source.page===112?letterPage.preview:sharedPage.preview})});
 assert.equal(calls.filter(call=>call.query===requirement).length,1,
  'the masked requirement is chased exactly once, inside the part scope');
 const traced=result.searches.filter(search=>search.partGapRecovery);
 assert.equal(traced.length,1);
 assert.equal(traced[0].starvedPartId,'P1');
 assert.equal(traced[0].reason,'position');
 assert.deepEqual(result.positionCoverage,[
  {partId:'P1',requirements:[{requirement,status:'chased-covered',booksCovering:['301']}]}]);
});

test('a page touching a distinctive term covers its requirement without a chase (B.5)',async()=>{
 const requirement='the letter Darcy wrote to Elizabeth about Wickham';
 const letterPage={bookId:'301',title:'Pride and Prejudice',page:112,
  globalPageId:3112,score:70,
  preview:'Darcy gave Elizabeth the letter about Wickham at the ballroom.'};
 const calls=[];
 const library={search:async(query,options={})=>{
  calls.push({query,bookId:String(options.bookId||'')});
  if(options.bookId==='301')return {sources:[letterPage]};
  return {sources:[]};
 }};
 const result=await retrieveEvidence({
  question:'What does Darcy write in his letter to Elizabeth?',
  queries:['Darcy letter Elizabeth','Darcy Rosings assembly'],
  partQueries:[{partId:'P1',query:'Darcy letter Elizabeth'}],
  partQuestions:[{partId:'P1',question:'What does Darcy write in his letter to Elizabeth?',
   sourceBookIds:['301'],requirements:[requirement]}],
  library,books:[{id:'301',title:'Pride and Prejudice'}],
  allowedBookIds:new Set(['301']),
  pageLoader:async()=>({text:letterPage.preview})});
 assert.equal(calls.filter(call=>call.query===requirement).length,0,
  'no chase fires when the pooled page already carries a distinctive term');
 assert.deepEqual(result.positionCoverage,[
  {partId:'P1',requirements:[{requirement,status:'covered',booksCovering:['301']}]}]);
});

test('a part without threaded requirements falls back to its own question as the requirement text',async()=>{
 const calls=[];
 const genericSource={bookId:'10',title:COVERAGE_BOOKS[0].title,page:44,
  globalPageId:1044,score:39,preview:GENERIC_PREVIEW};
 const pruningSource={bookId:'10',title:COVERAGE_BOOKS[0].title,page:57,
  globalPageId:1057,score:61,preview:PRUNING_PREVIEW};
 const partQuestion='What does Green say about winter pruning of shrubs?';
 const library={search:async(query,options={})=>{
  const bookId=options.bookId?String(options.bookId):'';
  const allowed=[...(options.allowedBookIds||[])].map(String);
  calls.push({query,bookId,allowed});
  if(bookId==='10')return {sources:[genericSource]};
  if(bookId)return {sources:[]};
  if(query===partQuestion&&allowed.length===1&&allowed[0]==='10')
   return {sources:[pruningSource]};
  return {sources:[]};
 }};
 const result=await retrieveEvidence({question:partQuestion,
  queries:['Green gardening soil preparation','Green gardening pruning advice'],
  partQueries:[{partId:'P1',query:'Green gardening guidance'}],
  partQuestions:[{partId:'P1',question:partQuestion,sourceBookIds:['10']}],
  gapQueries:[COVERAGE_GAP],gapQueryPartLinks:[{query:COVERAGE_GAP,partIds:['P1']}],
  library,books:COVERAGE_BOOKS,
  allowedBookIds:new Set(COVERAGE_BOOKS.map(book=>book.id)),
  pageLoader:async source=>({text:source.page===57?PRUNING_PREVIEW:GENERIC_PREVIEW})});
 const targeted=calls.filter(call=>call.query===partQuestion&&!call.bookId&&
  call.allowed.length===1&&call.allowed[0]==='10');
 assert.equal(targeted.length,1,'the part’s own wording is searched once inside its scope');
 const traced=result.searches.filter(search=>search.partGapRecovery);
 assert.equal(traced.length,1);
 assert.equal(traced[0].starvedPartId,'P1');
 assert.equal(traced[0].reason,'position');
});

// --- B10-7: every uncovered requirement is chased, up to a global cap -----

const SHARPENING_PREVIEW='Sharpen secateurs on a whetstone; the method keeps the blade safe and clean.';
const REQUIREMENT_R2='describe the method for sharpening secateurs safely';

test('a part with two uncovered requirements gets both chased (batch 10 B10-7)',async()=>{
 const calls=[];
 const genericSource={bookId:'10',title:COVERAGE_BOOKS[0].title,page:44,
  globalPageId:1044,score:39,preview:GENERIC_PREVIEW};
 const pruningSource={bookId:'10',title:COVERAGE_BOOKS[0].title,page:57,
  globalPageId:1057,score:61,preview:PRUNING_PREVIEW};
 const sharpeningSource={bookId:'10',title:COVERAGE_BOOKS[0].title,page:63,
  globalPageId:1063,score:58,preview:SHARPENING_PREVIEW};
 const library={search:async(query,options={})=>{
  const bookId=options.bookId?String(options.bookId):'';
  const allowed=[...(options.allowedBookIds||[])].map(String);
  calls.push({query,bookId,allowed});
  if(bookId==='10')return {sources:[genericSource]};
  if(bookId)return {sources:[]};
  if(query===REQUIREMENT_P2&&allowed.length===1&&allowed[0]==='10')
   return {sources:[pruningSource]};
  if(query===REQUIREMENT_R2&&allowed.length===1&&allowed[0]==='10')
   return {sources:[sharpeningSource]};
  return {sources:[]};
 }};
 const result=await retrieveEvidence({question:COVERAGE_QUESTION,
  queries:['Green gardening soil preparation','Green gardening pruning advice'],
  partQueries:[{partId:'P1',query:'Green pruning guidance'}],
  partQuestions:[{partId:'P1',question:'What does Green say about pruning and tool care?',
   sourceBookIds:['10'],requirements:[REQUIREMENT_P2,REQUIREMENT_R2]}],
  library,books:COVERAGE_BOOKS,
  allowedBookIds:new Set(COVERAGE_BOOKS.map(book=>book.id)),
  pageLoader:async source=>({text:source.page===57?PRUNING_PREVIEW:
   source.page===63?SHARPENING_PREVIEW:GENERIC_PREVIEW})});
 const chases=calls.filter(call=>!call.bookId&&call.allowed.length===1);
 assert.deepEqual(chases.map(call=>call.query),[REQUIREMENT_P2,REQUIREMENT_R2],
  'both uncovered requirements are searched, in plan order — not just the first');
 const traced=result.searches.filter(search=>search.partGapRecovery);
 assert.equal(traced.length,2);
 assert.ok(traced.every(search=>search.starvedPartId==='P1'&&search.reason==='position'));
 assert.deepEqual(result.positionCoverage,[
  {partId:'P1',requirements:[
   {requirement:REQUIREMENT_P2,status:'chased-covered',booksCovering:['10']},
   {requirement:REQUIREMENT_R2,status:'chased-covered',booksCovering:['10']}]}]);
});

test('the chase stops at the global cap, reserved across parts, and records the rest as unchased-cap (batch 11 B11-7)',async()=>{
 const requirements=[
  'identify the recommended timing for pruning dormant shrubs',
  'describe the method for sharpening secateurs safely',
  'explain how to store harvested potatoes through winter',
  'list the steps for dividing overgrown rhubarb crowns',
  'state when to sow broad beans in autumn beds',
  'describe how to protect brassicas from cabbage moths',
  'explain the rotation of legumes in vegetable plots',
  'identify signs of blight on tomato foliage early'];
 const calls=[];
 const genericSource={bookId:'10',title:COVERAGE_BOOKS[0].title,page:44,
  globalPageId:1044,score:39,preview:GENERIC_PREVIEW};
 const library={search:async(query,options={})=>{
  const bookId=options.bookId?String(options.bookId):'';
  const allowed=[...(options.allowedBookIds||[])].map(String);
  calls.push({query,bookId,allowed});
  if(bookId==='10')return {sources:[genericSource]};
  if(bookId)return {sources:[]};
  if(requirements.includes(query)&&allowed.length===1&&allowed[0]==='10')
   return {sources:[{bookId:'10',title:COVERAGE_BOOKS[0].title,page:70,
    globalPageId:1070,score:55,preview:'Notes on '+query}]};
  return {sources:[]};
 }};
 const part=(partId,offset)=>({partId,
  question:'What does Green say about seasonal garden work?',
  sourceBookIds:['10'],requirements:requirements.slice(offset,offset+4)});
 const result=await retrieveEvidence({question:COVERAGE_QUESTION,
  queries:['Green gardening soil preparation','Green gardening pruning advice'],
  partQueries:[{partId:'P1',query:'Green pruning guidance'},
   {partId:'P2',query:'Green soil preparation steps'}],
  partQuestions:[part('P1',0),part('P2',4)],
  library,books:COVERAGE_BOOKS,
  allowedBookIds:new Set(COVERAGE_BOOKS.map(book=>book.id)),
  pageLoader:async()=>({text:'A page of seasonal garden notes covering the requested work in full.'})});
 const chases=calls.filter(call=>requirements.includes(call.query)&&!call.bookId);
 assert.equal(chases.length,6,'exactly the capped number of chases executes');
 assert.deepEqual(chases.map(call=>call.query),
  [requirements[0],requirements[4],requirements[1],requirements[5],
   requirements[2],requirements[6]],
  'the cap is spent round-major under the per-part reservation: the parts alternate, each part’s first chase before any part’s second');
 assert.deepEqual(result.positionCoverage.map(entry=>entry.partId),['P1','P2']);
 assert.deepEqual(result.positionCoverage[0].requirements.map(record=>record.status),
  ['chased-covered','chased-covered','chased-covered','unchased-cap']);
 assert.deepEqual(result.positionCoverage[1].requirements.map(record=>record.status),
  ['chased-covered','chased-covered','chased-covered','unchased-cap']);
});

test('the reservation gives a later part its first chase before an earlier part’s second, past a covered middle part (batch 11 B11-7)',async()=>{
 const first='identify the recommended timing for pruning dormant shrubs';
 const second='describe the method for sharpening secateurs safely';
 const covered='describe the history and practice of ornamental gardening';
 const third='explain how to store harvested potatoes through winter';
 const fourth='list the steps for dividing overgrown rhubarb crowns';
 const chased=[first,second,third,fourth];
 const calls=[];
 const genericSource={bookId:'10',title:COVERAGE_BOOKS[0].title,page:44,
  globalPageId:1044,score:39,preview:GENERIC_PREVIEW};
 const library={search:async(query,options={})=>{
  const bookId=options.bookId?String(options.bookId):'';
  const allowed=[...(options.allowedBookIds||[])].map(String);
  calls.push({query,bookId,allowed});
  if(bookId==='10')return {sources:[genericSource]};
  if(bookId)return {sources:[]};
  if(chased.includes(query)&&allowed.length===1&&allowed[0]==='10')
   return {sources:[{bookId:'10',title:COVERAGE_BOOKS[0].title,page:71,
    globalPageId:1071,score:55,preview:'Notes on '+query}]};
  return {sources:[]};
 }};
 const part=(partId,requirements)=>({partId,
  question:'What does Green say about seasonal garden work?',
  sourceBookIds:['10'],requirements});
 const result=await retrieveEvidence({question:COVERAGE_QUESTION,
  queries:['Green gardening soil preparation','Green gardening pruning advice'],
  partQueries:[{partId:'P1',query:'Green pruning guidance'},
   {partId:'P2',query:'Green gardening history'},
   {partId:'P3',query:'Green storage guidance'}],
  partQuestions:[part('P1',[first,second]),part('P2',[covered]),part('P3',[third,fourth])],
  library,books:COVERAGE_BOOKS,
  allowedBookIds:new Set(COVERAGE_BOOKS.map(book=>book.id)),
  pageLoader:async()=>({text:'A page of seasonal garden notes covering the requested work in full.'})});
 const chases=calls.filter(call=>chased.includes(call.query)&&!call.bookId);
 assert.deepEqual(chases.map(call=>call.query),[first,third,second,fourth],
  'round-major order: P3’s first chase precedes P1’s second, and the covered middle part spends nothing');
 assert.deepEqual(result.positionCoverage.map(entry=>entry.partId),['P1','P2','P3']);
 assert.deepEqual(result.positionCoverage[0].requirements.map(record=>record.status),
  ['chased-covered','chased-covered']);
 assert.deepEqual(result.positionCoverage[1].requirements,
  [{requirement:covered,status:'covered',booksCovering:['10']}],
  'the middle part’s requirement is covered by its own candidates and never chased');
 assert.deepEqual(result.positionCoverage[2].requirements.map(record=>record.status),
  ['chased-covered','chased-covered']);
});

// --- B10-7: diversity-starved requirements chase outside the single book --

const DIVERSITY_BOOKS=[
 {id:'10',title:'A Treatise on Gardening — A. Green'},
 {id:'11',title:'Poems of the Seasons — R. Brown'},
 {id:'12',title:'Essays on Gardens — C. White'}
];
const DIVERSITY_REQUIREMENT='identify the recommended timing for pruning dormant shrubs';
const DIVERSITY_COVERING={bookId:'10',title:DIVERSITY_BOOKS[0].title,page:57,
 globalPageId:1057,score:61,
 preview:'The recommended timing for pruning dormant shrubs is late winter.'};
const DIVERSITY_ELSEWHERE={bookId:'12',title:DIVERSITY_BOOKS[2].title,page:88,
 globalPageId:1288,score:52,
 preview:'White advises pruning dormant shrubs after the first frosts lift.'};

function diversityFixture({scoped=false}={}){
 const calls=[];
 const library={search:async(query,options={})=>{
  const bookId=options.bookId?String(options.bookId):'';
  const allowed=[...(options.allowedBookIds||[])].map(String);
  calls.push({query,bookId,allowed});
  if(bookId)return {sources:bookId==='10'?[DIVERSITY_COVERING]:[]};
  if(query===DIVERSITY_REQUIREMENT&&!allowed.includes('10'))
   return {sources:[DIVERSITY_ELSEWHERE]};
  return {sources:[DIVERSITY_COVERING]};
 }};
 const input={question:'When should dormant shrubs be pruned?',
  queries:['pruning dormant shrubs recommended timing','late winter shrub pruning guidance'],
  partQueries:[{partId:'P1',query:'pruning dormant shrubs timing'}],
  partQuestions:[{partId:'P1',question:'When should dormant shrubs be pruned?',
   ...(scoped?{sourceBookIds:['10']}:{}),
   requirements:[DIVERSITY_REQUIREMENT]}],
  library,books:DIVERSITY_BOOKS,
  allowedBookIds:new Set(DIVERSITY_BOOKS.map(book=>book.id)),
  pageLoader:async source=>({text:source.bookId==='12'
   ?'White advises pruning dormant shrubs after the first frosts lift, once the sap begins to rise.'
   :'The recommended timing for pruning dormant shrubs is late winter, before the buds break.'})};
 return {calls,input};
}

test('a diversity-starved unscoped part chases outside its single covering book (batch 10 B10-7)',async()=>{
 const {calls,input}=diversityFixture();
 const result=await retrieveEvidence(input);
 const chases=calls.filter(call=>call.query===DIVERSITY_REQUIREMENT);
 assert.equal(chases.length,1,'the lexically covered but one-book-deep requirement is chased');
 assert.deepEqual(chases[0].allowed,['11','12'],
  'the diversity chase is scoped to the allowlist minus the covering book');
 const traced=result.searches.filter(search=>search.partGapRecovery);
 assert.equal(traced.length,1);
 assert.equal(traced[0].reason,'position');
 assert.equal(traced[0].diversity,true);
 assert.deepEqual(result.positionCoverage,[
  {partId:'P1',requirements:[{requirement:DIVERSITY_REQUIREMENT,
    status:'chased-covered',booksCovering:['10','12']}]}],
  'the record shows the position now rests on two books');
 assert.ok(result.candidates.some(source=>source.bookId==='12'&&
  source.candidatePartIds.includes('P1')),
  'the elsewhere page joins the pool linked to the part');
});

test('a scoped part never diversity-chases (batch 10 B10-7)',async()=>{
 const {calls,input}=diversityFixture({scoped:true});
 const result=await retrieveEvidence(input);
 assert.equal(calls.filter(call=>call.query===DIVERSITY_REQUIREMENT).length,0,
  'single-book coverage is the design of a scoped part, not a gap');
 assert.ok(!result.searches.some(search=>search.partGapRecovery));
 assert.deepEqual(result.positionCoverage,[
  {partId:'P1',requirements:[{requirement:DIVERSITY_REQUIREMENT,
    status:'covered',booksCovering:['10']}]}]);
});

test('starved-part recovery traces carry no coverage reason',async()=>{
 const {input}=starvedFixture();
 const result=await retrieveEvidence(input);
 const traced=result.searches.filter(search=>search.partGapRecovery);
 assert.equal(traced.length,1);
 assert.ok(!('reason' in traced[0]),
  'the A3 trace shape is unchanged; only coverage recoveries add a reason');
});

// --- L5: deterministic selected-book plan ----------------------------------

const PLAN_BOOKS=[
 {id:'241',title:'The Prince — Niccolò Machiavelli'},
 {id:'74',title:'The Republic — Plato'},
 {id:'103',title:'The Brothers Karamazov — Fyodor Dostoevsky'}
];

test('selected-book plan is built deterministically from the question and the chosen book',()=>{
 const question='What does Machiavelli say about fortune and virtue?';
 const result=deterministicSelectedBookPlan(question,PLAN_BOOKS,'241');
 assert.ok(result,'a catalogued selection with no conflicting mention yields a plan');
 assert.deepEqual(result.queries,[question]);
 assert.equal(result.plan.sources.length,1);
 assert.deepEqual(result.plan.sources[0].bookIds,['241']);
 assert.ok(result.plan.parts.length>=1);
 assert.ok(result.plan.parts.every(part=>
  Array.isArray(part.sourceBookIds)&&part.sourceBookIds.length===1&&
  part.sourceBookIds[0]==='241'),
  'every part is scoped to the selected book');
});

test('selected-book plan keeps the model flow for all-books, unknown books, and conflicting mentions',()=>{
 assert.equal(deterministicSelectedBookPlan(
  'What does Machiavelli say about fortune?',PLAN_BOOKS,''),null,
  'all-books requests keep the planner');
 assert.equal(deterministicSelectedBookPlan(
  'What does Machiavelli say about fortune?',PLAN_BOOKS,'999'),null,
  'a book outside the catalog keeps the planner');
 assert.equal(deterministicSelectedBookPlan(
  'How does Plato describe the philosopher king in the Republic?',PLAN_BOOKS,'241'),null,
  'a question naming a different work keeps the planner');
 const direct=deterministicSelectedBookPlan(
  'In the Republic, how does Plato connect knowledge with ruling?',PLAN_BOOKS,'74');
 assert.ok(direct,'naming the selected work itself is not a conflict');
 assert.deepEqual(direct.plan.sources[0].bookIds,['74']);
});
