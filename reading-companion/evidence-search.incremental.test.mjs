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
