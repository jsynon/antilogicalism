import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary,termFamily} from './remote-library.mjs';
import {mergeFacetSearches} from './evidence-search.mjs';

const driveId='ABCDEFGHIJKLMNOPQRSTUVWXY123456';
const passage='Moral virtue comes about as a result of habit, and we are made perfect by habit. The virtues we get by first exercising them: we learn by doing them, so too we become just by doing just acts, temperate by doing temperate acts, brave by doing brave acts.';
const fixture={
 'manifest.json':{
  version:49,postings_encoding:'delta-json-v1',prefix_length:2,
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
  if (key === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
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
   version:49,postings_encoding:'delta-json-v1',prefix_length:2,
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
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
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
   version:49,postings_encoding:'delta-json-v1',prefix_length:2,
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
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
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
   version:49,postings_encoding:'delta-json-v1',prefix_length:2,
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
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v48/',localFetch);
 const result=await finder.search('kierkgaard?',{maxBooks:2,pagesPerBook:2});
 assert.equal(result.sources.length,0);
 assert.deepEqual(result.terms,[]);
});

// Batch-32 term-family bridges. The v49 probe measured the production
// families directly: ambition stopped before ambitious, stupidity before
// stupid, labor before labour, mutilation before mutilated. Each family
// below is checked against a synthetic partition vocabulary; a variant is
// admitted only when the vocabulary attests it.

test('term families bridge the measured derivational gaps',()=>{
 const ambition=termFamily('ambition',{ambition:[],ambit:[],ambitious:[],ambitions:[],ambience:[]});
 assert.ok(ambition.includes('ambitious'),'ambition must reach ambitious');
 assert.ok(ambition.includes('ambitions'),'ambition must reach its plural');
 assert.ok(!ambition.includes('ambience'),
  'an unrelated same-prefix word is not absorbed (no prefix merging)');
 const stupidity=termFamily('stupidity',{stupidity:[],stupid:[]});
 assert.ok(stupidity.includes('stupid'),'stupidity must reach stupid');
 assert.ok(termFamily('stupid',{stupid:[],stupidity:[]}).includes('stupidity'),
  'the -idity/-id bridge runs in both directions');
 const labor=termFamily('labor',{labor:[],labour:[],laboratory:[]});
 assert.ok(labor.includes('labour'),'labor must reach labour');
 assert.ok(!labor.includes('laboratory'),
  'a longer word sharing the prefix is not a spelling variant');
 assert.ok(termFamily('labour',{labour:[],labor:[]}).includes('labor'),
  'the -or/-our bridge runs in both directions');
 const mutilation=termFamily('mutilation',{mutilation:[],mutilated:[],mutilate:[]});
 assert.ok(mutilation.includes('mutilated'),'mutilation must reach mutilated');
 assert.ok(mutilation.includes('mutilate'),'mutilation must reach the verb form');
 assert.ok(termFamily('centre',{centre:[],center:[]}).includes('center'));
 assert.ok(termFamily('organise',{organise:[],organize:[]}).includes('organize'));
});

test('term family bridges stay out when the index does not attest them',()=>{
 assert.deepEqual(termFamily('ambition',{ambition:[]}),['ambition']);
 assert.deepEqual(termFamily('stupidity',{stupidity:[]}),['stupidity']);
 assert.ok(!termFamily('stated',{stated:[],station:[]}).includes('station'),
  'a short-stem participle must not bridge to an unrelated -ion noun');
});

test('search bridges planner wording to source vocabulary at the page level',async()=>{
 // Miniature of the Smith Book V miss: postings exist only under the
 // source text's own words (stupid, labour); the query uses the planner's
 // forms (stupidity, labor). Before the bridges this returned nothing.
 const corpus={
  'manifest.json':{
   version:49,postings_encoding:'delta-json-v1',prefix_length:2,
   pages:1,page_books:[42],partitions:['st','la'],
   books:{'42':{title:'A Treatise on Work — A. Writer',
    drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}}
  },
  'terms-st.json':{stupid:[0]},
  'terms-la.json':{labour:[0]},
  'book-42.json':{pages:[{id:0,page:612,text:'The man whose whole life is spent performing a few simple operations becomes as stupid and ignorant as it is possible for a human creature to become, and his labour is the cause of it.'}]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v49/',localFetch);
 const result=await finder.search('labor stupidity',{allowedBookIds:new Set(['42']),
  maxBooks:1,pagesPerBook:2});
 assert.equal(result.sources.length,1);
 assert.equal(result.sources[0]?.page,612);
});

// Batch 33 (B33-7c) pilots: proper-name transliteration bridges. The
// batch-32 C&P pool spelled the character "Sonia" while planner facets
// said "Sonya"; the family layer now generates the counterpart forms of
// the standard transliteration alternations and admits each only when
// the index partition attests it.

test('term families bridge proper-name transliteration variants',()=>{
 const sonya=termFamily('sonya',{sonya:[],sonia:[],sofya:[]});
 assert.ok(sonya.includes('sonia'),'sonya must reach sonia (-ya/-ia)');
 assert.ok(sonya.includes('sofya'),'sonya must reach sofya (diminutive alternation)');
 const sofya=termFamily('sofya',{sofya:[],sofia:[],sonya:[],sophia:[]});
 assert.ok(sofya.includes('sofia'),'sofya must reach sofia');
 assert.ok(sofya.includes('sonya'),'sofya must reach its diminutive sonya');
 assert.ok(termFamily('sophia',{sophia:[],sofia:[]}).includes('sofia'),
  'sophia must reach sofia (ph/f)');
 assert.ok(termFamily('sofia',{sofia:[],sophia:[]}).includes('sophia'),
  'sofia must reach sophia (f/ph)');
 assert.ok(termFamily('romanov',{romanov:[],romanoff:[]}).includes('romanoff'),
  'romanov must reach romanoff (-v/-ff)');
 assert.ok(termFamily('romanoff',{romanoff:[],romanov:[]}).includes('romanov'),
  'romanoff must reach romanov');
 assert.ok(termFamily('dmitry',{dmitry:[],dmitri:[]}).includes('dmitri'),
  'dmitry must reach dmitri (terminal -y/-i)');
 assert.ok(termFamily('yakov',{yakov:[],iakov:[]}).includes('iakov'),
  'yakov must reach iakov (initial y/i)');
});

test('name bridges stay out when unattested and never merge by prefix',()=>{
 assert.deepEqual(termFamily('sonya',{sonya:[]}),['sonya'],
  'unattested variants (sonia, sofya) stay out');
 const sonya=termFamily('sonya',{sonya:[],son:[],song:[],sonnet:[],sonin:[]});
 assert.deepEqual(sonya,['sonya'],
  'attested but unrelated same-prefix words (son, song, sonnet, sonin) are not absorbed');
 const henry=termFamily('henry',{henry:[],henrie:[],henrick:[]});
 assert.deepEqual(henry,['henry'],
  'forms no rule generates stay out even when attested');
 assert.ok(!termFamily('graph',{graph:[],graf:[]}).includes('graf'),
  'the ph/f bridge is vowel-final only: graph does not reach graf');
});

test('scoped name search reaches the source spelling of a character name',async()=>{
 // Miniature of the C&P Sonya miss: the index and text know the
 // character only as "Sonia"; the query says "Sonya".
 const corpus={
  'manifest.json':{
   version:49,postings_encoding:'delta-json-v1',prefix_length:2,
   pages:1,page_books:[114],partitions:['so','ma'],
   books:{'114':{title:'Crime and Punishment — Fyodor Dostoevsky',
    drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}}
  },
  'terms-so.json':{sonia:[0]},
  'terms-ma.json':{marmeladov:[0]},
  'book-114.json':{pages:[{id:0,page:317,text:'Sonia followed him in silence. Marmeladov had been run over in the street, and Sonia stood beside the bed where the dying Marmeladov lay, her hands trembling as she held the candle for him.'}]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v49/',localFetch);
 const result=await finder.search('Sonya Marmeladov',{bookId:'114',
  allowedBookIds:new Set(['114']),maxBooks:1,pagesPerBook:2});
 assert.equal(result.sources.length,1);
 assert.equal(result.sources[0]?.page,317);
});

// Batch 35 (B35-5-reduced): the -ance/-ant and -ence/-ent bridge. The
// batch-35 prototype measured the gap in termFamily: a facet saying
// "ignorance" never reached source text saying "ignorant" (the Smith
// Book V torpor passage's diction). The bridge swaps the suffix on the
// identical stem, in both directions, and — like every family rule —
// admits a generated form only when the index partition attests it.

test('term families bridge -ance/-ant and -ence/-ent pairs in both directions',()=>{
 const pairs=[
  ['ignorance','ignorant'],['importance','important'],['distance','distant'],
  ['absence','absent'],['innocence','innocent'],['patience','patient'],
  ['silence','silent'],['evidence','evident'],['difference','different']
 ];
 for(const [noun,adjective] of pairs){
  const suffix=adjective.endsWith('ant')?'ance':'ence';
  assert.ok(termFamily(noun,{[noun]:[],[adjective]:[]}).includes(adjective),
   noun+' must reach '+adjective+' (-'+suffix+'/-'+(suffix==='ance'?'ant':'ent')+')');
  assert.ok(termFamily(adjective,{[adjective]:[],[noun]:[]}).includes(noun),
   adjective+' must reach '+noun+' (the bridge runs in both directions)');
 }
});

test('-ance/-ence bridges stay out when unattested, stem-shifted, or colliding',()=>{
 assert.deepEqual(termFamily('ignorance',{ignorance:[]}),['ignorance'],
  'an unattested derived form (ignorant) stays out');
 assert.ok(!termFamily('nuance',{nuance:[],nuant:[]}).includes('nuant'),
  'a short-stem form is not generated even when the index attests it');
 assert.ok(!termFamily('appearance',{appearance:[],apparent:[]}).includes('apparent'),
  'appearance/apparent is not an identical-stem pair and must not bridge');
 assert.ok(!termFamily('comment',{comment:[],commence:[]}).includes('commence'),
  'comment must not bridge to the unrelated common word commence (-ment guard)');
 assert.ok(!termFamily('commence',{commence:[],comment:[]}).includes('comment'),
  'commence must not bridge back to comment');
 assert.ok(!termFamily('government',{government:[],governance:[]}).includes('governance'),
  'a -ment noun generates no -ence form');
});

test('search reaches a page whose only matching forms are the -ant/-ent adjectives',async()=>{
 // Miniature of the Smith Book V shape for the new bridge class: the
 // page argues in the source's adjective forms (ignorant, innocent);
 // the query uses the planner's abstract nouns (ignorance, innocence).
 // Before this bridge the page matched neither query term.
 const corpus={
  'manifest.json':{
   version:49,postings_encoding:'delta-json-v1',prefix_length:2,
   pages:1,page_books:[42],partitions:['ig','in'],
   books:{'42':{title:'A Treatise on Work — A. Writer',
    drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}}
  },
  'terms-ig.json':{ignorant:[0]},
  'terms-in.json':{innocent:[0]},
  'book-42.json':{pages:[{id:0,page:611,text:'He remained ignorant of the wider world and innocent of any design beyond his daily task, spending his whole life at the same bench in the same workshop, year after year.'}]}
 };
 const localFetch=async url=>{
  const name=String(url).split('/').pop().replace(/\.gz$/,'');
  if (name === 'url-suppressions.json') return new Response(gzipSync(JSON.stringify({scopes:[]})),{status:200});
  return name in corpus?
   new Response(gzipSync(JSON.stringify(corpus[name])),{status:200}):
   new Response('Not found',{status:404});
 };
 const finder=new RemoteLibrary('https://example.test/v49/',localFetch);
 const result=await finder.search('ignorance innocence',{allowedBookIds:new Set(['42']),
  maxBooks:1,pagesPerBook:2});
 assert.equal(result.sources.length,1);
 assert.equal(result.sources[0]?.page,611);
});
