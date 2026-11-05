import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary} from './remote-library.mjs';

// Fixture for the parallel candidate-shard prefetch in RemoteLibrary.search.
// Six books, two pages each, and every page contains all four query terms,
// so all six books become candidates with identical scores and the loop
// visits them in ascending id order. With the default book limit of four,
// the serial loop downloaded books 1-4 one at a time and broke before
// book 5; the prefetch downloads the whole capped slice (books 1-6)
// concurrently but must process, count, and fail exactly as the serial
// loop did.
const driveId='ABCDEFGHIJKLMNOPQRSTUVWXY123456';
const pageText='The zephyr moves across the harbor while the lantern burns beside the quill. '+
  'A zephyr is the soft west wind, the lantern lights the harbor path, and the quill '+
  'records each tide in the keeper ledger through the calm evening hours.';
const bookIds=['1','2','3','4','5','6'];
const corpus={
  'manifest.json':{
    version:49,postings_encoding:'delta-json-v1',prefix_length:2,
    pages:12,page_books:[1,1,2,2,3,3,4,4,5,5,6,6],
    partitions:['ha','la','qu','ze'],
    books:Object.fromEntries(bookIds.map(id=>[
      id,{title:'Volume '+id+' — Writer '+id,
        drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}]))
  },
  'url-suppressions.json':{scopes:[]},
  // Every term occurs on every page: delta encoding of [0..11].
  'terms-ze.json':{zephyr:[0,1,1,1,1,1,1,1,1,1,1,1]},
  'terms-la.json':{lantern:[0,1,1,1,1,1,1,1,1,1,1,1]},
  'terms-qu.json':{quill:[0,1,1,1,1,1,1,1,1,1,1,1]},
  'terms-ha.json':{harbor:[0,1,1,1,1,1,1,1,1,1,1,1]},
  ...Object.fromEntries(bookIds.map(id=>[
    'book-'+id+'.json',{pages:[
      {id:2*(Number(id)-1),page:Number(id)*10+1,text:pageText},
      {id:2*(Number(id)-1)+1,page:Number(id)*10+2,text:pageText}
    ]}]))
};
const ROOT='https://example.test/data-v49/';
const QUERY='zephyr lantern quill harbor';

// A fetcher that serves the fixture, optionally delaying and/or failing
// individual book shards, and records shard request order and peak
// in-flight shard downloads.
function makeFetcher({delays={},failures=new Set()}={}) {
  const started=[];
  let inFlight=0,maxInFlight=0;
  const fetcher=async url=>{
    const name=String(url).split('/').pop().replace(/\.gz$/,'');
    if(name.startsWith('book-')){
      started.push(name);
      inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
      const delay=delays[name]||0;
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      inFlight--;
      if(failures.has(name))return new Response('Not found',{status:404});
    }
    return name in corpus?
      new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
      new Response('Not found',{status:404});
  };
  return {fetcher,started,maxInFlight:()=>maxInFlight};
}
const stripElapsed=({elapsedMs,...rest})=>rest;

test('candidate shards download in parallel and results match the serial behavior',async()=>{
  // Reference run with an instant fetcher: prefetch order cannot affect
  // the outcome, so this pins the result the serial loop produced.
  const instant=makeFetcher();
  const expected=await new RemoteLibrary(ROOT,instant.fetcher).search(QUERY);
  assert.equal(expected.booksScanned,4);
  assert.deepEqual(expected.sources.map(source=>source.bookId),
    ['1','1','2','2','3','3','4','4']);
  assert.deepEqual(expected.sources.map(source=>source.page),
    [11,12,21,22,31,32,41,42]);
  assert.deepEqual(instant.started,
    ['book-1.json','book-2.json','book-3.json','book-4.json','book-5.json','book-6.json']);

  // Delayed run: later candidates finish downloading long before earlier
  // ones. Processing must still follow candidate order, and the search
  // must finish near the slowest single download, not the serial sum
  // (150+110+80+50 = 390ms for the four books the loop processes).
  const delays={'book-1.json':150,'book-2.json':110,'book-3.json':80,
    'book-4.json':50,'book-5.json':25,'book-6.json':10};
  const delayed=makeFetcher({delays});
  const startedAt=Date.now();
  const result=await new RemoteLibrary(ROOT,delayed.fetcher).search(QUERY);
  const elapsed=Date.now()-startedAt;
  assert.deepEqual(delayed.started,
    ['book-1.json','book-2.json','book-3.json','book-4.json','book-5.json','book-6.json']);
  assert.equal(delayed.maxInFlight(),6,
    'all six candidate shards are in flight at once');
  assert(elapsed<300,
    `parallel search took ${elapsed}ms; serial downloads alone exceed 390ms`);
  assert.deepEqual(stripElapsed(result),stripElapsed(expected));
});

test('a candidate shard that fails to load rejects the search when the loop reaches it',async()=>{
  const failing=makeFetcher({failures:new Set(['book-2.json'])});
  await assert.rejects(
    new RemoteLibrary(ROOT,failing.fetcher).search(QUERY),
    /Corpus request returned HTTP 404/);
});

test('a failed shard past the early break does not fail the search',async()=>{
  // Book 6 is prefetched but never processed: the loop breaks after the
  // fourth book produces sources. Its rejection must stay silent, exactly
  // as if the serial loop had never requested it.
  const failing=makeFetcher({failures:new Set(['book-6.json'])});
  const result=await new RemoteLibrary(ROOT,failing.fetcher).search(QUERY);
  assert.equal(result.booksScanned,4);
  assert.deepEqual(result.sources.map(source=>source.bookId),
    ['1','1','2','2','3','3','4','4']);
  // Let any stray unhandled rejection surface (it would fail this run).
  await new Promise(resolve=>setTimeout(resolve,50));
});

test('prefetch uses the shard cache: a repeat search downloads nothing again',async()=>{
  const counter=makeFetcher();
  const library=new RemoteLibrary(ROOT,counter.fetcher);
  await library.search(QUERY);
  assert.equal(counter.started.length,6);
  const again=await library.search(QUERY);
  assert.equal(counter.started.length,6);
  assert.equal(again.booksScanned,4);
  assert.equal(again.sources.length,8);
});
