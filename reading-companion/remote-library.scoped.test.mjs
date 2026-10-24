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

test('long questions retain later discriminating terms after early author and title names',()=>{
 const terms=queryTerms('According to Friedrich Nietzsche in The Portable Nietzsche, what did he think about Plato, and how does that differ from the editor Walter Kaufmann’s discussion of science and morality?');
 assert.ok(terms.length>8);
 assert.ok(terms.includes('morality'));
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

test('an explicitly requested phrase boosts pages containing it in the source text',()=>{
 const terms=['god','love','biblical','meaning','scripture'];
 const exact='Beloved, let us love one another, because love is from God. God is love.';
 const commentary='The biblical meaning of scripture concerns divine love and the nature of God.';
 const direct=substantivePageEvidence(exact,terms,new Set(),'God is love');
 const topical=substantivePageEvidence(commentary,terms,new Set(),'God is love');
 assert.equal(direct.phraseMatches,1);
 assert.equal(topical.phraseMatches,0);
 assert(direct.score>topical.score);
});

const fixture={
 'manifest.json':{
  version:47,postings_encoding:'delta-json-v1',prefix_length:2,
  pages:7,page_books:[7,7,89,89,114,114,529],
  partitions:['mo','vi','pr','wi','ph','ha','eu','fi','ar','ni','et','ra','ex','ma','th','na','mu','da','ch','hu','li','po'],
  books:{
   '7':{title:'Nicomachean Ethics — Aristotle',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '89':{title:'Other Philosophy Anthology',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '114':{title:'Crime and Punishment — Fyodor Dostoevsky',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '529':{title:'On the Origin of Species — Charles Darwin',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
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
 'terms-da.json':{darwin:[6]},
 'terms-ch.json':{change:[0,6],character:[0,6]},
 'terms-hu.json':{human:[0]},
 'terms-li.json':{living:[6]},
 'terms-po.json':{populations:[6]},
 'book-7.json':{pages:[
   {id:0,page:12,text:'Nicomachean Ethics Aristotle. Change in human character concerns the soul and moral development. '+aristotleText},
   {id:1,page:13,text:'Nicomachean Ethics Aristotle. Other philosophers mention happiness in an unrelated historical note about a different period of thought.'}
 ]},
 'book-89.json':{pages:[
   {id:2,page:2,text:otherText},
   {id:3,page:3,text:otherText}
 ]},
 'book-114.json':{pages:[
   {id:4,page:465,text:'Raskolnikov argued that extraordinary men such as Napoleon might transgress ordinary moral law. His theory attempts to justify murder through a claim about historical greatness and individual permission.'},
   {id:5,page:317,text:'Raskolnikov stood beside the workmen. The murder was already over, and he listened in silence while they discussed the scene.'}
 ]},
 'book-529.json':{pages:[
   {id:6,page:200,text:'On the Origin of Species Charles Darwin. Change in living populations occurs as inherited character varies and some traits persist across generations.'}
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

test('all-books comparison retrieves topical evidence for both named authors',async()=>{
 const finder=new RemoteLibrary('https://example.test/v47/',fakeFetch);
 const result=await finder.search('How do Aristotle and Darwin explain change in human character and living populations?',{
   allowedBookIds:new Set(['7','89','114','529']),maxBooks:2,pagesPerBook:2
 });
 assert.deepEqual(new Set(result.sources.map(source=>source.bookId)),new Set(['7','529']));
 assert(result.sources.some(source=>source.bookId==='7'&&source.preview.includes('human character')));
 assert(result.sources.some(source=>source.bookId==='529'&&source.preview.includes('living populations')));
});

test('a neighboring page cannot displace a stronger direct evidence page',async()=>{
 const corpus=structuredClone(fixture);
 corpus['manifest.json']={
  ...corpus['manifest.json'],pages:5,page_books:[7,7,7,7,7],
  partitions:['te','hu','vi','ch','de']
 };
 corpus['terms-te.json']={teleology:[3]};
 corpus['terms-hu.json']={human:[2,1]};
 corpus['terms-vi.json']={virtue:[0,1,1,1]};
 corpus['terms-ch.json']={character:[0,2,1]};
 corpus['terms-de.json']={development:[3]};
 corpus['book-7.json']={pages:[
  {id:0,page:14,text:'Legislators make citizens good by forming habits in them. From the same causes and by the same means every virtue is produced or destroyed; by doing just acts we become just, and states of character arise from like activities.'},
  {id:1,page:15,text:'Temperance and courage are formed by repeated practice and habituation in the appropriate actions.'},
  {id:2,page:114,text:'Friendship and human companionship improve good men; they share life and approve characteristics in one another, and virtue is discussed in this account.'},
  {id:3,page:122,text:'Human character, virtue, teleology, and development are all considered together in this long passage about the nature of the human good.'},
  {id:4,page:123,text:'Human friendship is discussed in this nearby passage, with several observations about what people value in life and the activities they share.'}
 ]};
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v47/',localFetch);
 const result=await finder.search('Aristotle teleology human virtue and character development',{
  allowedBookIds:new Set(['7']),maxBooks:1,pagesPerBook:3
 });
 assert.deepEqual(result.sources.map(source=>source.page),[122,114,14]);
});

test('all-books search honors an explicitly named author when limiting candidate sources',async()=>{
 const finder=new RemoteLibrary('https://example.test/v47/',fakeFetch);
 const result=await finder.search('How did Aristotle describe virtue and the soul?',{
   allowedBookIds:new Set(['7','89','114','529']),maxBooks:2,pagesPerBook:2
 });
 assert(result.sources.length>0);
 assert(result.sources.every(source=>source.bookId==='7'));
});

test('a named scene routed through its canonical author prefers the primary collected work',async()=>{
 const corpus={
  'manifest.json':{
   version:47,postings_encoding:'delta-json-v1',prefix_length:2,pages:2,
   page_books:[212,552],partitions:['ha','sh'],
   books:{
    '212':{title:'The Complete Works of William Shakespeare — William Shakespeare',
     drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
    '552':{title:'French and English Philosophers (Harvard Classics, Vol. 34) — René Descartes, Jean-Jacques Rousseau, Voltaire, and Thomas Hobbes',
     drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
   }
  },
  'terms-ha.json':{hamlet:[0,1]},
  'terms-sh.json':{shakespeare:[0]},
  'book-212.json':{pages:[
   {id:0,page:453,text:'Hamlet. To be, or not to be: that is the question. Whether it is nobler to suffer fortune or to take arms against troubles.'}
  ]},
  'book-552.json':{pages:[
   {id:1,page:140,text:'Voltaire translates Shakespeare: To be, or not to be? Whether it is nobler to suffer fortune or take arms against troubles.'}
  ]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v47/',localFetch);
 const result=await finder.search("Hamlet William Shakespeare 'To be, or not to be'",{
  maxBooks:2,pagesPerBook:2
 });
 assert(result.sources.length>0);
 assert.deepEqual([...new Set(result.sources.map(source=>source.bookId))],['212']);
 assert.match(result.sources[0].title,/Complete Works of William Shakespeare/);
});

test('a thinker named as the subject of another author’s view is not searched as its source',async()=>{
 const corpus={
  'manifest.json':{
   version:47,postings_encoding:'delta-json-v1',prefix_length:2,pages:2,
   page_books:[54,74],partitions:['ni','th','pl'],
   books:{
    '54':{title:'Thus Spake Zarathustra — Friedrich Nietzsche',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
    '74':{title:'The Republic — Plato',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
   }
  },
  'terms-ni.json':{nietzsche:[0,1]},
  'terms-th.json':{think:[0,1]},
  'terms-pl.json':{plato:[0]},
  'book-54.json':{pages:[
   {id:0,page:31,text:'Nietzsche thinks about Plato as an opponent of the ideal world.'}
  ]},
  'book-74.json':{pages:[
   {id:1,page:110,text:'Plato thinks about Nietzsche’s account while discussing justice and the order of the soul.'}
  ]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v47/',localFetch);
 const result=await finder.search('What did Nietzsche think about Plato?',{
  maxBooks:2,pagesPerBook:2
 });
 assert(result.sources.length>0);
 assert.deepEqual([...new Set(result.sources.map(source=>source.bookId))],['54']);
 assert(result.sources[0].preview.includes('Plato'));
});

test('a relevant previous page is retained when the strongest passage starts mid-sentence',async()=>{
 const corpus={
  'manifest.json':{
   version:47,postings_encoding:'delta-json-v1',prefix_length:2,pages:3,
   page_books:[149,149,149],partitions:['eg','pr','he','tr'],
   books:{'149':{title:'The Histories — Herodotus',
    drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}}
  },
  'terms-eg.json':{egyptian:[0,1]},
  'terms-pr.json':{priests:[1]},
  'terms-he.json':{helen:[1,0]},
  'terms-tr.json':{troy:[1]},
  'book-149.json':{pages:[
   {id:0,page:145,text:'The priests said Helen had been brought toward Egypt after Paris took her away.'},
   {id:1,page:146,text:'he found the Egyptian priests could recount Helen at Troy because the affair happened in their country. Their account continues with the events that followed.'},
   {id:2,page:80,text:'Egyptian records discuss a different topic in another section of the book.'}
  ]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v47/',localFetch);
 const result=await finder.search('Herodotus Egyptian priests Helen Troy account',{
  allowedBookIds:new Set(['149']),maxBooks:1,pagesPerBook:2
 });
 assert.deepEqual(result.sources.map(source=>source.page),[146,145]);
 assert(result.sources[1].preview.includes('Helen'));
});

test('uppercase proper-name fragments also retain a relevant previous page',async()=>{
 const corpus={
  'manifest.json':{
   version:47,postings_encoding:'delta-json-v1',prefix_length:2,pages:3,
   page_books:[149,149,149],partitions:['eg','pr','he','tr'],
   books:{'149':{title:'The Histories — Herodotus',
    drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}}
  },
  'terms-eg.json':{egyptian:[0,1]},
  'terms-pr.json':{priests:[1]},
  'terms-he.json':{helen:[1,0]},
  'terms-tr.json':{troy:[1]},
  'book-149.json':{pages:[
   {id:0,page:145,text:'The priests said Helen had been taken toward Egypt after Paris carried her away.'},
   {id:1,page:146,text:'Egypt, and on his arrival he spoke with the priests about Helen and Troy. The account was reported in that country.'},
   {id:2,page:80,text:'Egyptian records discuss a different topic in another section of the book.'}
  ]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v47/',localFetch);
 const result=await finder.search('Herodotus Egyptian priests Helen Troy account',{
  allowedBookIds:new Set(['149']),maxBooks:1,pagesPerBook:2
 });
 assert.deepEqual(result.sources.map(source=>source.page),[146,145]);
 assert(result.sources[1].preview.includes('Helen'));
});

test('an ellipsis-truncated final connector retains the relevant next page',async()=>{
 const corpus={
  'manifest.json':{
   version:47,postings_encoding:'delta-json-v1',prefix_length:2,pages:3,
   page_books:[212,212,212],partitions:['ha','so','dr'],
   books:{'212':{title:'The Complete Works of William Shakespeare — William Shakespeare',
    drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}}
  },
  'terms-ha.json':{hamlet:[0,1]},
  'terms-so.json':{soliloquy:[0,1]},
  'terms-dr.json':{dreams:[1,1]},
  'book-212.json':{pages:[
   {id:0,page:453,text:'Hamlet’s soliloquy weighs a painful choice; the speech contrasts endurance and ending life. Ham. To…'},
   {id:1,page:80,text:'A Hamlet soliloquy discusses a separate introductory passage.'},
   {id:2,page:454,text:'be, or not to be? Dreams after death may follow.'}
  ]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v47/',localFetch);
 const result=await finder.search("Hamlet soliloquy dreams: 'To be, or not to be'",{
  allowedBookIds:new Set(['212']),maxBooks:1,pagesPerBook:2
 });
 assert.deepEqual(result.sources.map(source=>source.page),[453,454]);
 assert(result.sources[1].preview.includes('Dreams after death'));
});

