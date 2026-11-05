import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSearchPrefetch,retrieveEvidence} from './evidence-search.mjs';

// Fixture for the speculative prefetch of the per-part scoped searches in
// retrieveEvidence. The sequential reference is the same flow with
// prefetchPartSearches disabled; the parallel run must return a deep-equal
// result while the per-part searches overlap. In the fake library only the
// searches the per-part loop issues are slow: each part's own facet already
// covers its first resolved work, so the loop owes exactly one scoped search
// per part, plus one exact-work quote retry for the single-work part.

const DELAY=120;
const BOOKS=[
 {id:'11',title:'Work Alpha — Ada Merritt'},
 {id:'12',title:'Work Beta — Ada Merritt'},
 {id:'21',title:'Work Delta — Boris Nolan'},
 {id:'22',title:'Work Epsilon — Boris Nolan'},
 {id:'31',title:'Work Eta — Carla Ivers'},
 {id:'32',title:'Work Theta — Carla Ivers'},
 {id:'41',title:'Work Iota — Dmitri Sorin'},
 {id:'42',title:'Work Kappa — Dmitri Sorin'},
 {id:'51',title:'Work Lambda — Elif Aydin'}
];
const QUERIES=[
 'Ada Merritt causal necessity habit expectation account',
 'Boris Nolan causal necessity habit expectation account'
];
const PART_QUESTIONS=[
 {partId:'P1',question:'In Work Alpha, how is causal necessity grounded in repeated experience?',
  sourceBookIds:['11','12']},
 {partId:'P2',question:'In Work Delta, how is causal necessity grounded in repeated experience?',
  sourceBookIds:['21','22']},
 {partId:'P3',question:'In Work Eta, how is causal necessity grounded in repeated experience?',
  sourceBookIds:['31','32']},
 {partId:'P4',question:'In Work Iota, how is causal necessity grounded in repeated experience?',
  sourceBookIds:['41','42']},
 {partId:'P5',question:'What does the narrator mean by “the habit of causality binds expectation fast” here?',
  sourceBookIds:['51']}
];
const QUESTION='How do the accounts of causal necessity differ in their grounding of expectation?';
// The exact (query, bookId) pairs the per-part loop issues in this fixture.
const LOOP_SEARCHES=new Set([
 `${PART_QUESTIONS[0].question}\n12`,`${PART_QUESTIONS[1].question}\n22`,
 `${PART_QUESTIONS[2].question}\n32`,`${PART_QUESTIONS[3].question}\n42`,
 `${PART_QUESTIONS[4].question}\n51`
]);

function fixtureLibrary({failLoopSearch=null,failBaseQuery=null}={}){
 const calls=[];
 let inFlight=0,maxInFlight=0;
 const sourceFor=bookId=>{
  const index=BOOKS.findIndex(book=>book.id===String(bookId));
  const book=BOOKS[index];
  return {bookId:book.id,title:book.title,page:20+index*3,
   globalPageId:5000+index*10,score:90-index,
   preview:'A passage about causal necessity, habit, and expectation.'};
 };
 const library={search:async(query,options={})=>{
  const bookId=options.bookId?String(options.bookId):'';
  calls.push({query,bookId});
  if(failBaseQuery&&query===failBaseQuery)throw Error('base facet index unavailable');
  if(LOOP_SEARCHES.has(`${query}\n${bookId}`)){
   if(failLoopSearch===`${query}\n${bookId}`)throw Error('scoped partition missing');
   inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
   await new Promise(resolve=>setTimeout(resolve,DELAY));
   inFlight--;
   return {sources:[sourceFor(bookId)]};
  }
  if(bookId)return {sources:[sourceFor(bookId)]};
  return {sources:BOOKS.map(book=>sourceFor(book.id))};
 }};
 const input={question:QUESTION,queries:QUERIES,
  partQueries:[
   {partId:'P1',query:QUERIES[0]},{partId:'P1',query:PART_QUESTIONS[0].question},
   {partId:'P2',query:QUERIES[1]},{partId:'P2',query:PART_QUESTIONS[1].question},
   {partId:'P3',query:QUERIES[0]},{partId:'P3',query:PART_QUESTIONS[2].question},
   {partId:'P4',query:QUERIES[1]},{partId:'P4',query:PART_QUESTIONS[3].question},
   {partId:'P5',query:QUERIES[0]}
  ],
  partQuestions:PART_QUESTIONS,library,books:BOOKS,
  allowedBookIds:new Set(BOOKS.map(book=>book.id)),
  pageLoader:async source=>({text:
   `Verified passage from book ${source.bookId} discussing causal necessity, habit, and expectation in depth.`})};
 return {input,calls,stats:()=>({maxInFlight})};
}

test('per-part scoped searches overlap under prefetch and the merged output matches the sequential flow',async()=>{
 const sequential=fixtureLibrary();
 const startedSequential=performance.now();
 const expected=await retrieveEvidence({...sequential.input,prefetchPartSearches:false});
 const sequentialElapsed=performance.now()-startedSequential;
 const parallel=fixtureLibrary();
 const startedParallel=performance.now();
 const actual=await retrieveEvidence(parallel.input);
 const parallelElapsed=performance.now()-startedParallel;
 assert.deepEqual(actual,expected,
  'speculative prefetch must not change any candidate, facet, or trace output');
 const sortCalls=list=>list.map(call=>`${call.query}\n${call.bookId}`).sort();
 assert.deepEqual(sortCalls(parallel.calls),sortCalls(sequential.calls),
  'both flows issue exactly the same library searches');
 assert.equal(sequential.stats().maxInFlight,1,
  'the sequential reference runs the per-part searches one at a time');
 assert.ok(parallel.stats().maxInFlight>=3,
  `per-part searches should overlap under prefetch, saw ${parallel.stats().maxInFlight} in flight`);
 assert.ok(sequentialElapsed>=LOOP_SEARCHES.size*DELAY*0.9,
  `sequential reference should pay the serial delay, took ${sequentialElapsed}ms`);
 assert.ok(parallelElapsed<sequentialElapsed*0.6,
  `parallel flow took ${parallelElapsed}ms against the sequential ${sequentialElapsed}ms`);
});

test('a failing per-part scoped search is tolerated identically with and without prefetch',async()=>{
 const failLoopSearch=`${PART_QUESTIONS[0].question}\n12`;
 const sequential=fixtureLibrary({failLoopSearch});
 const expected=await retrieveEvidence({...sequential.input,prefetchPartSearches:false});
 const parallel=fixtureLibrary({failLoopSearch});
 const actual=await retrieveEvidence(parallel.input);
 assert.deepEqual(actual,expected,
  'a scoped search failure contributes no sources in either flow');
});

test('a failing quote retry is tolerated identically with and without prefetch',async()=>{
 const failLoopSearch=`${PART_QUESTIONS[4].question}\n51`;
 const sequential=fixtureLibrary({failLoopSearch});
 const expected=await retrieveEvidence({...sequential.input,prefetchPartSearches:false});
 const parallel=fixtureLibrary({failLoopSearch});
 const actual=await retrieveEvidence(parallel.input);
 assert.deepEqual(actual,expected,
  'a failed exact-work quote retry leaves the part result unchanged in either flow');
 assert.ok(actual.searches.some(search=>search.quoteFallback&&search.resultCount===0),
  'the failed retry is still recorded as an empty quote-fallback facet');
});

test('a failing base facet search rejects the retrieval identically with and without prefetch',async()=>{
 const sequential=fixtureLibrary({failBaseQuery:QUERIES[1]});
 await assert.rejects(
  retrieveEvidence({...sequential.input,prefetchPartSearches:false}),
  /base facet index unavailable/);
 const parallel=fixtureLibrary({failBaseQuery:QUERIES[1]});
 await assert.rejects(retrieveEvidence(parallel.input),/base facet index unavailable/);
});

test('search prefetch dedupes identical jobs and returns results for consumption in any order',async()=>{
 let calls=0,inFlight=0,maxInFlight=0;
 const library={search:async(query,{bookId}={})=>{
  calls++;inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
  await new Promise(resolve=>setTimeout(resolve,30));
  inFlight--;
  return {sources:[{bookId,page:query.length}]};
 }};
 const prefetch=createSearchPrefetch(library,{concurrency:2});
 const options=bookId=>({bookId,allowedBookIds:new Set(['7','8']),maxBooks:4,pagesPerBook:4});
 prefetch.prefetch('alpha query',options('7'));
 prefetch.prefetch('alpha query',options('7'));
 prefetch.prefetch('beta query',options('8'));
 const first=await prefetch.search('beta query',options('8'));
 const second=await prefetch.search('alpha query',options('7'));
 assert.equal(calls,2,'identical jobs execute once');
 assert.deepEqual(first.sources,[{bookId:'8',page:10}]);
 assert.deepEqual(second.sources,[{bookId:'7',page:11}]);
 assert.equal(maxInFlight,2,'distinct jobs overlap up to the concurrency cap');
 const direct=await prefetch.search('gamma query',options('7'));
 assert.equal(calls,3,'a search without a prediction runs directly');
 assert.deepEqual(direct.sources,[{bookId:'7',page:11}]);
});

test('search prefetch never exceeds its concurrency cap',async()=>{
 let inFlight=0,maxInFlight=0;
 const library={search:async(query)=>{
  inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
  await new Promise(resolve=>setTimeout(resolve,40));
  inFlight--;
  return {sources:[]};
 }};
 const prefetch=createSearchPrefetch(library,{concurrency:2});
 for(let index=0;index<6;index++)prefetch.prefetch(`query ${index}`,{});
 const started=performance.now();
 await Promise.all([0,1,2,3,4,5].map(index=>prefetch.search(`query ${index}`,{})));
 const elapsed=performance.now()-started;
 assert.equal(maxInFlight,2);
 assert.ok(elapsed>=100,`six 40ms jobs at two in flight need three waves, took ${elapsed}ms`);
});

test('search prefetch rethrows a consumed failure at the call site and settles unused failures quietly',async()=>{
 const failure=Error('partition unavailable');
 const library={search:async(query)=>{
  await new Promise(resolve=>setTimeout(resolve,10));
  if(query==='bad query')throw failure;
  return {sources:[]};
 }};
 const prefetch=createSearchPrefetch(library);
 prefetch.prefetch('bad query',{});
 prefetch.prefetch('good query',{});
 await assert.rejects(prefetch.search('bad query',{}),error=>error===failure);
 assert.deepEqual(await prefetch.search('good query',{}),{sources:[]});
 const quiet=createSearchPrefetch(library);
 quiet.prefetch('bad query',{});
 await new Promise(resolve=>setTimeout(resolve,30));
});
