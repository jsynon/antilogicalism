import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary} from './remote-library.mjs';

const driveId='ABCDEFGHIJKLMNOPQRSTUVWXY123456';
const passage='Moral virtue comes about as a result of habit, and we are made perfect by habit. The virtues we get by first exercising them: we learn by doing them, so too we become just by doing just acts, temperate by doing temperate acts, brave by doing brave acts.';
const fixture={
 'manifest.json':{
  version:47,postings_encoding:'delta-json-v1',prefix_length:2,
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
 const finder=new RemoteLibrary('https://example.test/v47/',fakeFetch);
 const result=await finder.search(
  'Aristotle habituation process through repeated virtuous actions and character formation',
  {allowedBookIds:new Set(['7']),maxBooks:2,pagesPerBook:2}
 );
 assert.equal(result.sources[0]?.page,13);
 assert.match(result.sources[0]?.preview||'',/become just by doing just acts/i);
});
