import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary,queryTerms,substantivePageEvidence,isNavigationPage} from './remote-library.mjs';
import {retrieveEvidence,selectAnswerSources} from './evidence-search.mjs';

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

test('OCR index pages with a folio before the heading are excluded while prose index mentions remain searchable',()=>{
 const index='intrinsic, 14f Vedanta, 55, 170: advaita, 58n Vedas, 105; Vedic, 147, 168 Virgin Mother, 148; virtue: as synonym for quality or being, 2nf 182 / INDEX traditio, 146 Transformist Illusion, 111 transpersonal: journal of Psychology, 156n; Trauma of Birth, 162, 165; trikaya, 58n; Tristes Tropiques, 126; truth: as not needing us, 58; objective, 7, 10; subjective, 7';
 assert.equal(isNavigationPage(index),true);
 assert.equal(substantivePageEvidence(index,['sunyata','void']),null);
 assert.equal(isNavigationPage('An index of the evidence can be useful. The author then explains how the argument depends on experience and judgment.'),false);
});

test('index search uses only terms from the submitted query',async()=>{
 const queries=[
  'Kant Critique of Pure Reason causal necessity transcendental deduction categories',
  'sunyata explained through emptiness and dependent arising'
 ];
 const terms=queries.flatMap(query=>queryTerms(query));
 const prefixes=[...new Set(terms.map(term=>term.slice(0,2)))];
 const corpus={
  'manifest.json':{version:49,postings_encoding:'delta-json-v1',prefix_length:2,
   pages:0,page_books:[],partitions:prefixes,books:{}},
  'url-suppressions.json':{scopes:[]},
  ...Object.fromEntries(prefixes.map(prefix=>['terms-'+prefix+'.json',{}]))
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  return name in corpus?new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const library=new RemoteLibrary('https://example.test/data-v49/',localFetch);
 const kantTerms=(await library.search(queries[0],{allowedBookIds:new Set()})).terms;
 assert.equal(kantTerms.includes('second'),false);
 assert.equal(kantTerms.includes('analogy'),false);
 assert.equal(kantTerms.includes('succession'),false);
 const buddhistTerms=(await library.search(queries[1],{allowedBookIds:new Set()})).terms;
 assert.equal(buddhistTerms.includes('origination'),false);
 assert.equal(buddhistTerms.includes('dependent'),true);
 assert.equal(buddhistTerms.includes('arising'),true);
});

test('remote library records the exact bytes of each corpus file used',async()=>{
 const bytes=new TextEncoder().encode('{"version":47,"postings_encoding":"delta-json-v1","prefix_length":2,"page_books":[],"pages":0,"partitions":[],"books":{}}');
 const library=new RemoteLibrary('https://example.test/data-v49/',async()=>new Response(bytes));
 await library.jsonGzip('manifest.json');
 const expected=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');
 assert.equal(library.contentDigests.get('manifest.json'),expected);
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
  version:49,postings_encoding:'delta-json-v1',prefix_length:2,
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
  if (key === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
 return Promise.resolve(key in fixture?
   new Response(gzipSync(JSON.stringify(fixture[key])),{status:200}):
   new Response('Not found',{status:404}));
}

test('long Aristotle synthesis question retrieves evidence from explicitly selected Aristotle book',async()=>{
 const finder=new RemoteLibrary('https://example.test/v48/',fakeFetch);
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
 const finder=new RemoteLibrary('https://example.test/v48/',fakeFetch);
 const result=await finder.search(question,{
   bookId:'7',allowedBookIds:new Set(['89']),
   maxBooks:2,pagesPerBook:2
 });
 assert.deepEqual(result.sources,[]);
});

test('selected-book mode still rejects irrelevant text instead of citing an arbitrary page',async()=>{
 const finder=new RemoteLibrary('https://example.test/v48/',fakeFetch);
 const result=await finder.search('Quantum field entanglement experiment?',{
   bookId:'7',allowedBookIds:new Set(['7']),
   maxBooks:2,pagesPerBook:2
 });
 assert.deepEqual(result.sources,[]);
});

test('selected work running title alone is not passage evidence',async()=>{
 const finder=new RemoteLibrary('https://example.test/v48/',fakeFetch);
 const result=await finder.search('Nicomachean Ethics',{
   bookId:'7',allowedBookIds:new Set(['7']),maxBooks:1,pagesPerBook:2
 });
 assert.deepEqual(result.sources,[]);
});

test('theory question excludes a plot page with only incidental character and event overlap',async()=>{
 const finder=new RemoteLibrary('https://example.test/v48/',fakeFetch);
 const result=await finder.search('Raskolnikov extraordinary man theory Napoleon morality murder',{
   bookId:'114',allowedBookIds:new Set(['114']),maxBooks:1,pagesPerBook:2
 });
 assert.deepEqual(result.sources.map(source=>source.page),[465]);
});

test('all-books comparison retrieves topical evidence for both named authors',async()=>{
 const finder=new RemoteLibrary('https://example.test/v48/',fakeFetch);
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
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v48/',localFetch);
 const result=await finder.search('Aristotle teleology human virtue and character development',{
  allowedBookIds:new Set(['7']),maxBooks:1,pagesPerBook:3
 });
 assert.deepEqual(result.sources.map(source=>source.page),[122,114,14]);
});

test('all-books search honors an explicitly named author when limiting candidate sources',async()=>{
 const finder=new RemoteLibrary('https://example.test/v48/',fakeFetch);
 const result=await finder.search('How did Aristotle describe virtue and the soul?',{
   allowedBookIds:new Set(['7','89','114','529']),maxBooks:2,pagesPerBook:2
 });
 assert(result.sources.length>0);
 assert(result.sources.every(source=>source.bookId==='7'));
});

test('a named scene routed through its canonical author prefers the primary collected work',async()=>{
 const corpus={
  'manifest.json':{
   version:49,postings_encoding:'delta-json-v1',prefix_length:2,pages:2,
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
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v48/',localFetch);
 const result=await finder.search("Hamlet William Shakespeare 'To be, or not to be'",{
  maxBooks:2,pagesPerBook:2
 });
 assert(result.sources.length>0);
 assert.deepEqual([...new Set(result.sources.map(source=>source.bookId))],['212']);
 assert.match(result.sources[0].title,/Complete Works of William Shakespeare/);
});

test('an OCR-joined page ending can retrieve the relevant adjacent continuation',async()=>{
 const first='Hamlet. To be, or not to be: that is the question. To die, to sleepNo';
 const second='more; and by a sleep to say we end the heartache. To sleep, perchance to dream; for in that sleep of death what dreams may come must give us pause.';
 const corpus={
  'manifest.json':{version:49,postings_encoding:'delta-json-v1',prefix_length:2,pages:3,
   page_books:[212,212,212],partitions:['ha','wi','sh','de'],books:{
    '212':{title:'The Complete Works of William Shakespeare — William Shakespeare',
     drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}}},
  'terms-ha.json':{hamlet:[0]},
  'terms-wi.json':{william:[0]},
  'terms-sh.json':{shakespeare:[0]},
  'terms-de.json':{death:[2]},
  'book-212.json':{pages:[
   {id:0,page:453,text:first},
   {id:1,page:454,text:second},
   {id:2,page:600,text:'Death appears as an unrelated topic on this later page.'}
  ]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
  return name in corpus?new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v48/',localFetch);
 const result=await finder.search("Hamlet William Shakespeare 'To be, or not to be' death",{
  allowedBookIds:new Set(['212']),maxBooks:1,pagesPerBook:2
 });
 assert.ok(result.sources.some(source=>source.page===454),
  'an adjacent continuation ending with the requested death reasoning should be retained');
});

test('a thinker named as the subject of another author’s view is not searched as its source',async()=>{
 const corpus={
  'manifest.json':{
   version:49,postings_encoding:'delta-json-v1',prefix_length:2,pages:2,
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
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v48/',localFetch);
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
   version:49,postings_encoding:'delta-json-v1',prefix_length:2,pages:3,
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
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v48/',localFetch);
 const result=await finder.search('Herodotus Egyptian priests Helen Troy account',{
  allowedBookIds:new Set(['149']),maxBooks:1,pagesPerBook:2
 });
 assert.deepEqual(result.sources.map(source=>source.page),[146,145]);
 assert(result.sources[1].preview.includes('Helen'));
});

test('uppercase proper-name fragments also retain a relevant previous page',async()=>{
 const corpus={
  'manifest.json':{
   version:49,postings_encoding:'delta-json-v1',prefix_length:2,pages:3,
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
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v48/',localFetch);
 const result=await finder.search('Herodotus Egyptian priests Helen Troy account',{
  allowedBookIds:new Set(['149']),maxBooks:1,pagesPerBook:2
 });
 assert.deepEqual(result.sources.map(source=>source.page),[146,145]);
 assert(result.sources[1].preview.includes('Helen'));
});

test('an ellipsis-truncated final connector retains the relevant next page',async()=>{
 const corpus={
  'manifest.json':{
   version:49,postings_encoding:'delta-json-v1',prefix_length:2,pages:3,
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
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v48/',localFetch);
 const result=await finder.search("Hamlet soliloquy dreams: 'To be, or not to be'",{
  allowedBookIds:new Set(['212']),maxBooks:1,pagesPerBook:2
 });
 assert.deepEqual(result.sources.map(source=>source.page),[453,454]);
 assert(result.sources[1].preview.includes('Dreams after death'));
});


// Batch-32 scoped candidacy guarantee. Before the fix, a bookId-scoped
// search whose query terms had no postings in the book returned a hard
// empty with booksScanned = 0: the book never became a candidate, so the
// exhaustive shard rescore never ran. The corpus below attests the query
// terms in the partitions but gives them no postings anywhere, while the
// scoped book's shard text contains them clustered.
const scopedCorpus={
 'manifest.json':{
  version:49,postings_encoding:'delta-json-v1',prefix_length:2,
  pages:2,page_books:[7,89],partitions:['we','gu','so'],
  books:{
   '7':{title:'The Weaver’s Tale — Jane Cooper',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '89':{title:'Other Songs — John Ball',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
  }
 },
 'terms-we.json':{weaver:[]},
 'terms-gu.json':{guild:[]},
 'terms-so.json':{solidarity:[]},
 'book-7.json':{pages:[
   {id:0,page:31,text:'The weaver and his guild showed solidarity with the journeymen when the masters tried to cut their wages in the winter season.'}
 ]},
 'book-89.json':{pages:[
   {id:1,page:9,text:'A song about harvest time and the turning of the year in the village.'}
 ]}
};
function scopedFetch(url){
 const key=String(url).split('/').pop().replace(/\.gz$/,'');
 if (key === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
 return Promise.resolve(key in scopedCorpus?
  new Response(gzipSync(JSON.stringify(scopedCorpus[key])),{status:200}):
  new Response('Not found',{status:404}));
}

test('scoped search scans its book even when no query term has postings there',async()=>{
 const finder=new RemoteLibrary('https://example.test/v49/',scopedFetch);
 const result=await finder.search('weaver guild solidarity',{
  bookId:'7',allowedBookIds:new Set(['7','89']),maxBooks:1,pagesPerBook:2
 });
 assert.equal(result.booksScanned,1,'the scoped book must actually be scanned');
 assert.deepEqual(result.sources.map(source=>source.page),[31],
  'the shard rescore must decide on full text when postings are absent');
});

test('scoped search distinguishes scanned-and-zero from never-scanned',async()=>{
 const finder=new RemoteLibrary('https://example.test/v49/',scopedFetch);
 const zero=await finder.search('weaver guild solidarity',{
  bookId:'89',allowedBookIds:new Set(['7','89']),maxBooks:1,pagesPerBook:2
 });
 assert.equal(zero.booksScanned,1,'a scoped book with no matching text was still scanned');
 assert.deepEqual(zero.sources,[]);
 const unscoped=await finder.search('weaver guild solidarity',{
  allowedBookIds:new Set(['7','89']),maxBooks:1,pagesPerBook:2
 });
 assert.equal(unscoped.booksScanned,0,
  'unscoped search keeps the old behavior: no postings, no candidates, no scans');
 assert.deepEqual(unscoped.sources,[]);
});

test('scoped guarantee honors the allowlist intersection',async()=>{
 const finder=new RemoteLibrary('https://example.test/v49/',scopedFetch);
 const result=await finder.search('weaver guild solidarity',{
  bookId:'7',allowedBookIds:new Set(['89']),maxBooks:1,pagesPerBook:2
 });
 assert.equal(result.booksScanned,0,'a scoped book outside the allowlist is never synthesized');
 assert.deepEqual(result.sources,[]);
});

// Batch 33 (B33-7a) pilots: within-book diversity for large scoped books.
// Book 42 has 120 pages: six strong evidence pages at the start sweep the
// rank slots, and one more floor-passing page sits in the last page-extent
// quartile (p. 119). Book 43 repeats the shape in 30 pages, below the
// extent where section spread activates.
const diversityStrong='The harbor lantern signal watch guided the fleet home each night. ' +
  'Every harbor lantern signal watch was tended with care through the long winter season.';
const diversityModerate='The harbor lantern hung above the dock while the crew repaired the boats. ' +
  'Ordinary work filled the remaining hours of the quiet afternoon in the yard.';
const diversityFiller='Ordinary prose about daily routines in the town fills this page with plain ' +
  'sentences concerning markets gardens weather and the habits of its residents over many years.';
function diversityCorpus(){
  const pages42=[],pages43=[];
  for(let page=1;page<=120;page++){
    pages42.push({id:page-1,page,text:page<=6?diversityStrong:
      page===119?diversityModerate:diversityFiller});
  }
  for(let page=1;page<=30;page++){
    pages43.push({id:119+page,page,text:page<=6?diversityStrong:
      page===29?diversityModerate:diversityFiller});
  }
  // Delta-encoded postings: harbor/lantern occur on the strong and
  // moderate pages of both books; signal/watch only on the strong pages.
  const strong42=[0,1,2,3,4,5],moderate42=[118],strong43=[120,121,122,123,124,125],moderate43=[148];
  const deltas=ids=>ids.map((id,i)=>i?id-ids[i-1]:id);
  const all=[...strong42,...moderate42,...strong43,...moderate43];
  const strong=[...strong42,...strong43];
  return {
    'manifest.json':{
      version:49,postings_encoding:'delta-json-v1',prefix_length:2,
      pages:150,page_books:[...Array(120).fill(42),...Array(30).fill(43)],
      partitions:['ha','la','si','wa'],
      books:{
        '42':{title:'The Long Voyage — A. Writer',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
        '43':{title:'The Short Voyage — A. Writer',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
      }
    },
    'terms-ha.json':{harbor:deltas(all)},
    'terms-la.json':{lantern:deltas(all)},
    'terms-si.json':{signal:deltas(strong)},
    'terms-wa.json':{watch:deltas(strong)},
    'book-42.json':{pages:pages42},
    'book-43.json':{pages:pages43}
  };
}
function diversityFetch(corpus){
  return async url=>{
    const key=String(url).split('/').pop().replace(/\.gz$/,'');
    if(key==='url-suppressions.json')
      return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
    return key in corpus?
      new Response(gzipSync(JSON.stringify(corpus[key])),{status:200}):
      new Response('Not found',{status:404});
  };
}

test('scoped search in a large book reserves leaf slots for unreached sections',async()=>{
  const finder=new RemoteLibrary('https://example.test/v49/',diversityFetch(diversityCorpus()));
  const result=await finder.search('harbor lantern signal watch',{
    bookId:'42',allowedBookIds:new Set(['42','43'])});
  const pages=result.sources.map(source=>source.page);
  // The four rank-selected pages keep the production cap positions and
  // the top-ranked hit is never displaced; the diversity slots append
  // the last-quartile page and the next rank page.
  assert.deepEqual(pages.slice(0,4),[1,2,3,4]);
  assert.equal(pages.length,6);
  assert.ok(pages.includes(119),'the last-quartile evidence page is returned');
});

test('unscoped search keeps the plain per-book cap (no diversity slots)',async()=>{
  const finder=new RemoteLibrary('https://example.test/v49/',diversityFetch(diversityCorpus()));
  const result=await finder.search('harbor lantern signal watch',{
    allowedBookIds:new Set(['42','43'])});
  const book42=result.sources.filter(source=>source.bookId==='42').map(source=>source.page);
  assert.deepEqual(book42,[1,2,3,4]);
});

test('scoped search in a small book keeps the plain per-book cap',async()=>{
  const finder=new RemoteLibrary('https://example.test/v49/',diversityFetch(diversityCorpus()));
  const result=await finder.search('harbor lantern signal watch',{
    bookId:'43',allowedBookIds:new Set(['42','43'])});
  assert.deepEqual(result.sources.map(source=>source.page),[1,2,3,4]);
});
