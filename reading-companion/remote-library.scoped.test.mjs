import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary,queryTerms,substantivePageEvidence} from './remote-library.mjs';

const driveId='ABCDEFGHIJKLMNOPQRSTUVWXY123456';
const question="How do moral virtue, practical wisdom (phronesis), and happiness (eudaimonia) fit together in Aristotle's Nicomachean Ethics?";
const aristotleText=[
  'Moral virtue must be practiced alongside practical wisdom (phronesis) to guide our actions.',
  'Practical wisdom determines the means to worthwhile ends, and moral virtue shapes',
  'the desires through which an individual pursues happiness (eudaimonia). Aristotle distinguishes',
  'the intellectual capacity to deliberate well from the formation of character.'
].join(' ');
const otherText='Other philosophers occasionally mention phronesis or eudaimonia. This is a historical note in a different book and does not explain Aristotelian virtue.';

test('query terms keep source concepts while dropping question framing',()=>{
 assert.deepEqual(queryTerms('How does Raskolnikov justify murder and how does the novel challenge his reasoning?'),
   ['raskolnikov','justify','murder','reasoning']);
 assert.deepEqual(queryTerms('Explain the relationship between virtue and practical wisdom'),
   ['virtue','practical','wisdom']);
 assert.deepEqual(queryTerms('What caused the Peloponnesian War?'),
   ['caused','peloponnesian','war']);
});

test('page ranking favors clustered topic evidence over scattered mentions',()=>{
 const terms=['virtue','practical','wisdom','happiness','justice','character'];
 const filler=Array(140).fill('ordinary').join(' ');
 const focused='Virtue and practical wisdom shape ordinary actions in a meaningful way. '.repeat(2);
 const scattered='Virtue practical '+filler+' wisdom happiness '+filler+' justice character explain the argument clearly.';
 const focusedEvidence=substantivePageEvidence(focused,terms);
 const scatteredEvidence=substantivePageEvidence(scattered,terms);
 assert.equal(focusedEvidence.localUnique,3);
 assert.equal(scatteredEvidence.localUnique,2);
 assert(focusedEvidence.score>scatteredEvidence.score);
});

const fixture={
 'manifest.json':{
  version:47,postings_encoding:'delta-json-v1',prefix_length:2,
  pages:6,page_books:[7,7,89,89,114,114],
  partitions:['mo','vi','pr','wi','ph','ha','eu','fi','ar','ni','et','ra','ex','ma','th','na','mu'],
  books:{
   '7':{title:'Nicomachean Ethics — Aristotle',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '89':{title:'Other Philosophy Anthology',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '114':{title:'Crime and Punishment — Fyodor Dostoevsky',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
  }
 },
 'terms-mo.json':{moral:[0,1],morality:[4]},
 'terms-mu.json':{murder:[4,1]},
 'terms-vi.json':{virtue:[0,1]},
 'terms-pr.json':{practical:[0,1]},
 'terms-wi.json':{wisdom:[0,1]},
 // Global least-common terms occur only in book 89; book 7 is still relevant.
 'terms-ph.json':{phronesis:[2]},
 'terms-ha.json':{happiness:[0,1]},
 'terms-eu.json':{eudaimonia:[2]},
 'terms-fi.json':{fit:[2]},
 'terms-ar.json':{aristotle:[0,1]},
 'terms-ni.json':{nicomachean:[0,1]},
 'terms-et.json':{ethics:[0,1]},
 'terms-ra.json':{raskolnikov:[4,1]},
 'terms-ex.json':{extraordinary:[4]},
 'terms-ma.json':{man:[4]},
 'terms-th.json':{theory:[4]},
 'terms-na.json':{napoleon:[4]},
 'book-7.json':{pages:[
   {id:0,page:12,text:'Nicomachean Ethics Aristotle. '+aristotleText},
   {id:1,page:13,text:'Nicomachean Ethics Aristotle. Other philosophers mention happiness in an unrelated historical note about a different period of thought.'}
 ]},
 'book-89.json':{pages:[
   {id:2,page:2,text:otherText},
   {id:3,page:3,text:otherText}
 ]},
 'book-114.json':{pages:[
   {id:4,page:465,text:'Raskolnikov argued that extraordinary men such as Napoleon might transgress ordinary moral law. His theory attempts to justify murder through a claim about historical greatness and individual permission.'},
   {id:5,page:317,text:'Raskolnikov stood beside the workmen. The murder was already over, and he listened in silence while they discussed the scene.'}
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
 assert.deepEqual(result.sources.map(s=>s.page),[12]);
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

test('selected work running title alone is not passage evidence',async()=>{
 const finder=new RemoteLibrary('https://example.test/v47/',fakeFetch);
 const result=await finder.search('Nicomachean Ethics',{
   bookId:'7',allowedBookIds:new Set(['7']),maxBooks:1,pagesPerBook:2
 });
 assert.deepEqual(result.sources,[]);
});

test('theory question excludes a plot page with only incidental character and event overlap',async()=>{
 const finder=new RemoteLibrary('https://example.test/v47/',fakeFetch);
 const result=await finder.search('Raskolnikov extraordinary man theory Napoleon morality murder',{
   bookId:'114',allowedBookIds:new Set(['114']),maxBooks:1,pagesPerBook:2
 });
 assert.deepEqual(result.sources.map(source=>source.page),[465]);
});
