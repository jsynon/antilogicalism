import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary} from './remote-library.mjs';

const driveId='ABCDEFGHIJKLMNOPQRSTUVWXY123456';
const question="How do moral virtue, practical wisdom (phronesis), and happiness (eudaimonia) fit together in Aristotle's Nicomachean Ethics?";
const aristotleText=[
  'Moral virtue must be practiced alongside practical wisdom to guide our actions.',
  'Practical wisdom determines the means to worthwhile ends, and moral virtue shapes',
  'the desires through which an individual pursues happiness. Aristotle distinguishes',
  'the intellectual capacity to deliberate well from the formation of character.'
].join(' ');
const otherText='Other philosophers occasionally mention phronesis or eudaimonia. This is a historical note in a different book and does not explain Aristotelian virtue.';

const fixture={
 'manifest.json':{
  version:47,postings_encoding:'delta-json-v1',prefix_length:2,
  pages:4,page_books:[7,7,89,89],
  partitions:['mo','vi','pr','wi','ph','ha','eu','fi'],
  books:{
   '7':{title:'Nicomachean Ethics — Aristotle',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '89':{title:'Other Philosophy Anthology',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
  }
 },
 'terms-mo.json':{moral:[0,1]},
 'terms-vi.json':{virtue:[0,1]},
 'terms-pr.json':{practical:[0,1]},
 'terms-wi.json':{wisdom:[0,1]},
 // Global least-common terms occur only in book 89; book 7 is still relevant.
 'terms-ph.json':{phronesis:[2]},
 'terms-ha.json':{happiness:[0,1]},
 'terms-eu.json':{eudaimonia:[2]},
 'terms-fi.json':{fit:[2]},
 'book-7.json':{pages:[
   {id:0,page:12,text:aristotleText},
   {id:1,page:13,text:aristotleText.replace('guide our actions','inform our choices')}
 ]},
 'book-89.json':{pages:[
   {id:2,page:2,text:otherText},
   {id:3,page:3,text:otherText}
 ]}
};
function fakeFetch(url) {
 const key=String(url).split('/').pop().replace(/\.gz$/,'');
 return Promise.resolve(key in fixture?
   new Response(gzipSync(JSON.stringify(fixture[key])),{status:200}):
   new Response('Not found',{status:404}));
}

test('long Aristotle synthesis question retrieves evidence from explicitly selected Aristotle book',async()=>{
 const finder=new RemoteLibrary('https://example.test/v47/',fakeFetch);
 const result=await finder.search(question,{
   bookId:'7',allowedBookIds:new Set(['7','89']),
   maxBooks:2,pagesPerBook:2
 });
 assert(result.sources.length>0,'A rare term in another book must not erase Aristotle results');
 assert(result.sources.every(s=>s.bookId==='7'));
 assert(result.sources.some(s=>s.page===12));
 assert(result.sources.some(s=>s.preview.includes('practical wisdom')));
});

test('explicit book scope must never leak evidence from another book',async()=>{
 const finder=new RemoteLibrary('https://example.test/v47/',fakeFetch);
 const result=await finder.search(question,{
   bookId:'7',allowedBookIds:new Set(['89']),
   maxBooks:2,pagesPerBook:2
 });
 assert.deepEqual(result.sources,[]);
});

test('selected-book mode still rejects irrelevant text instead of citing an arbitrary page',async()=>{
 const finder=new RemoteLibrary('https://example.test/v47/',fakeFetch);
 const result=await finder.search('Quantum field entanglement experiment?',{
   bookId:'7',allowedBookIds:new Set(['7']),
   maxBooks:2,pagesPerBook:2
 });
 assert.deepEqual(result.sources,[]);
});
