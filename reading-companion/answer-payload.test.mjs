import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pilotAnswerSources} from './answer-payload.mjs';

const TEXT='A retrieved page long enough to stand in for a candidate passage.';

test('pilotAnswerSources carries facetRanks normalized to exactly {facet, rank}',()=>{
 const sources=pilotAnswerSources([{bookId:'341',page:119,text:TEXT,
  candidatePartIds:['P3'],facetRanks:[{facet:2,rank:1,score:99},{facet:0,rank:4}]}]);
 assert.deepEqual(sources,[{bookId:'341',page:119,text:TEXT,candidatePartIds:['P3'],
  facetRanks:[{facet:2,rank:1},{facet:0,rank:4}],libraryVersion:49}],
  'extra rank fields are stripped and rank order is preserved');
});

test('pilotAnswerSources omits the facetRanks key when a candidate carries no ranks',()=>{
 const sources=pilotAnswerSources([{bookId:'260',page:612,text:TEXT,candidatePartIds:['P1']}]);
 assert.deepEqual(sources,[{bookId:'260',page:612,text:TEXT,candidatePartIds:['P1'],libraryVersion:49}]);
 assert.equal(Object.hasOwn(sources[0],'facetRanks'),false);
 const wire=JSON.parse(JSON.stringify({sources}));
 assert.equal(Object.hasOwn(wire.sources[0],'facetRanks'),false,
  'the serialized request body carries no facetRanks key for rankless sources');
});

test('pilotAnswerSources treats a non-array facetRanks as absent',()=>{
 for(const facetRanks of [undefined,null,'ranks',42])
  assert.equal(Object.hasOwn(pilotAnswerSources([{bookId:'1',page:1,text:TEXT,facetRanks}])[0],
   'facetRanks'),false);
});

test('pilotAnswerSources mixes ranked and rankless sources in one packet',()=>{
 const sources=pilotAnswerSources([
  {bookId:'341',page:115,text:TEXT,facetRanks:[{facet:0,rank:1}]},
  {bookId:'341',page:127,text:TEXT}]);
 assert.deepEqual(sources[0].facetRanks,[{facet:0,rank:1}]);
 assert.equal(Object.hasOwn(sources[1],'facetRanks'),false);
 assert.equal(Object.hasOwn(sources[1],'candidatePartIds'),false,
  'candidatePartIds stays conditional exactly as before');
});

test('pilotAnswerSources returns an empty list for non-array input',()=>{
 assert.deepEqual(pilotAnswerSources(undefined),[]);
 assert.deepEqual(pilotAnswerSources(null),[]);
});
