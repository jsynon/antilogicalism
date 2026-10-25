import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary} from './remote-library.mjs';
import {mergeFacetSearches} from './evidence-search.mjs';

const driveId='ABCDEFGHIJKLMNOPQRSTUVWXY123456';
const passage='Moral virtue comes about as a result of habit, and we are made perfect by habit. The virtues we get by first exercising them: we learn by doing them, so too we become just by doing just acts, temperate by doing temperate acts, brave by doing brave acts.';
const fixture={
 'manifest.json':{
  version:48,postings_encoding:'delta-json-v1',prefix_length:2,
  pages:1,page_books:[7],partitions:['ar','ha','pr','th','re','vi','ac','ch'],
  books:{'7':{title:'Nicomachean Ethics — Aristotle',
    drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}}
 },
 'terms-ar.json':{},'terms-pr.json':{},'terms-th.json':{},'terms-re.json':{},'terms-ch.json':{},
 'terms-ha.json':{habituation:[],habit:[0]},
 'terms-vi.json':{virtuous:[],virtue:[0]},
 'terms-ac.json':{actions:[],act:[0]},
 'book-7.json':{pages:[{id:0,page:13,text:passage}]}
};
function fakeFetch(url){
 const key=String(url).split('/').pop().replace(/\.gz$/,'');
 return Promise.resolve(key in fixture?
  new Response(gzipSync(JSON.stringify(fixture[key])),{status:200}):
  new Response('Not found',{status:404}));
}

test('all-books retrieval bridges planner wording to indexed source word families',async()=>{
 const finder=new RemoteLibrary('https://example.test/v48/',fakeFetch);
 const result=await finder.search(
  'Aristotle habituation process through repeated virtuous actions and character formation',
  {allowedBookIds:new Set(['7']),maxBooks:2,pagesPerBook:2}
 );
 assert.equal(result.sources[0]?.page,13);
 assert.match(result.sources[0]?.preview||'',/become just by doing just acts/i);
});

test('passage evidence ranks Nicomachean Ethics ahead of Politics without a title hint',async()=>{
 const corpus={
  'manifest.json':{
   version:48,postings_encoding:'delta-json-v1',prefix_length:2,
   pages:2,page_books:[12,7],
   partitions:['ar','ha','pr','re','ac','fo','vi','ch'],
   books:{
    '12':{title:'Politics — Aristotle',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
    '7':{title:'Nicomachean Ethics — Aristotle',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
   }
  },
  'terms-ar.json':{aristotle:[0,1]},
  'terms-ha.json':{habituation:[],habit:[1]},
  'terms-pr.json':{process:[]},
  'terms-re.json':{repeated:[]},
  'terms-ac.json':{actions:[0,1],act:[1]},
  'terms-fo.json':{forming:[]},
  'terms-vi.json':{virtue:[0,1]},
  'terms-ch.json':{character:[1]},
  'book-12.json':{pages:[{id:0,page:128,text:'Aristotle discusses virtue and right actions in the political community, and how good citizens contribute to a well governed city.'}]},
  'book-7.json':{pages:[{id:1,page:14,text:'Moral virtue comes about as a result of habit. We become just by doing just acts, temperate by doing temperate acts, and states of character arise from like activities.'}]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v48/',localFetch);
 const result=await finder.search('Aristotle habituation through repeated actions forming virtuous character',{
   allowedBookIds:new Set(['7','12']),maxBooks:2,pagesPerBook:2
 });
 const best=mergeFacetSearches([result],2)[0];
 assert.equal(best?.bookId,'7');
 assert.equal(best?.page,14);
 assert.match(best?.preview||'',/result of habit/i);
 assert(Number.isFinite(best?.score));
});

test('all-books search recovers a uniquely misspelled author surname',async()=>{
 const corpus={
  'manifest.json':{
   version:48,postings_encoding:'delta-json-v1',prefix_length:2,
   pages:2,page_books:[140,223],partitions:['fa'],
   books:{
    '140':{title:'Fear and Trembling — Søren Kierkegaard',
      drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
    '223':{title:'Summa Theologica — Thomas Aquinas',
      drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
   }
  },
  'terms-fa.json':{faith:[0,1]},
  'book-140.json':{pages:[{id:0,page:21,text:'Kierkegaard describes faith as a movement beyond resignation, made by virtue of the absurd.'}]},
  'book-223.json':{pages:[{id:1,page:4147,text:'Faith is a theological virtue directed toward God and taught in sacred doctrine.'}]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v48/',localFetch);
 const result=await finder.search('what does kierkgaard have to say about faith?',{
  maxBooks:2,pagesPerBook:2
 });
 assert.equal(result.sources.length,1);
 assert.equal(result.sources[0]?.bookId,'140');
 assert.equal(result.sources[0]?.page,21);
});

test('fuzzy author scoping requires a distinct indexed topic term',async()=>{
 const corpus={
  'manifest.json':{
   version:48,postings_encoding:'delta-json-v1',prefix_length:2,
   pages:2,page_books:[140,223],partitions:['fa'],
   books:{
    '140':{title:'Fear and Trembling — Søren Kierkegaard',
      drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
    '223':{title:'Summa Theologica — Thomas Aquinas',
      drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
   }
  },
  'terms-fa.json':{faith:[0,1]},
  'book-140.json':{pages:[{id:0,page:21,text:'Kierkegaard describes faith as a movement beyond resignation.'}]},
  'book-223.json':{pages:[{id:1,page:4147,text:'Faith is a theological virtue directed toward God.'}]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v48/',localFetch);
 const result=await finder.search('kierkgaard?',{maxBooks:2,pagesPerBook:2});
 assert.equal(result.sources.length,0);
 assert.deepEqual(result.terms,[]);
});
