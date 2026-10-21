test('ordinary questions preserve passage ranking instead of promoting weaker books',()=>{
 const candidates=[
  {...page(1,'7'),score:90,text:'strong primary passage'},
  {...page(2,'7'),score:80,text:'second primary passage'},
  {...page(3,'529'),score:40,text:'weaker passage from another book'},
 ];
 const chosen=selectAnswerSources(candidates,'What does Aristotle say about virtue?','token',{maxSources:2});
 assert.deepEqual(chosen.map(item=>item.page),[1,2]);
});

test('author-wide concept questions include evidence from distinct works when available',()=>{
 const candidates=[
  {...page(32,'140'),title:'Fear and Trembling — Søren Kierkegaard',text:'faith passage'},
  {...page(17,'140'),title:'Fear and Trembling — Søren Kierkegaard',text:'faith passage two'},
  {...page(93,'253'),title:'The Sickness Unto Death — Søren Kierkegaard',text:'faith passage'},
  {...page(55,'192'),title:'Philosophical Fragments — Søren Kierkegaard',text:'faith passage'},
 ];
 const chosen=selectAnswerSources(candidates,
   'What did Kierkegaard have to say about faith?','token',{maxSources:3});
 assert.deepEqual(chosen.map(item=>item.bookId),['140','253','192']);
});

test('author-wide selection skips weak marginal works when stronger pages are available',()=>{
 const candidates=[
  {...page(25,'140'),title:'Fear and Trembling — Søren Kierkegaard',score:51.9,text:'faith passage'},
  {...page(17,'140'),title:'Fear and Trembling — Søren Kierkegaard',score:45.9,text:'faith passage two'},
  {...page(32,'140'),title:'Fear and Trembling — Søren Kierkegaard',score:37.0,text:'faith passage three'},
  {...page(134,'253'),title:'The Sickness Unto Death — Søren Kierkegaard',score:48.2,text:'offense and faith'},
  {...page(107,'253'),title:'The Sickness Unto Death — Søren Kierkegaard',score:59.9,text:'strong faith passage'},
  {...page(49,'436'),title:'Kierkegaard’s Attack Upon “Christendom,” 1854–1855 — Søren Kierkegaard',score:33.5,text:'marginal faith reference'},
  {...page(31,'140'),title:'Fear and Trembling — Søren Kierkegaard',score:50.3,text:'stronger related passage'},
 ];
 const chosen=selectAnswerSources(candidates,
   'What did Kierkegaard have to say about faith?','token',{maxSources:4});
 assert(chosen.some(item=>item.bookId==='253'&&item.page===107));
 assert(!chosen.some(item=>item.bookId==='436'));
});

test('questions naming a specific work keep the strongest passages from that work',()=>{
 const candidates=[
  {...page(32,'140'),title:'Fear and Trembling — Søren Kierkegaard',text:'strong passage'},
  {...page(17,'140'),title:'Fear and Trembling — Søren Kierkegaard',text:'second passage'},
  {...page(93,'253'),title:'The Sickness Unto Death — Søren Kierkegaard',text:'other work'},
 ];
 const chosen=selectAnswerSources(candidates,
   'In Fear and Trembling, what does Kierkegaard say about faith?','token',{maxSources:2});
 assert.deepEqual(chosen.map(item=>item.bookId+':'+item.page),['140:32','140:17']);
});

test('questions naming multiple works reserve and alternate evidence pages across works',()=>{
 const candidates=[
  {...page(495,'529'),title:'The Origin of Species — Charles Darwin',score:85,text:'Darwin lead'},
  {...page(240,'529'),title:'The Origin of Species — Charles Darwin',score:74,text:'Darwin alternate one'},
  {...page(96,'529'),title:'The Origin of Species — Charles Darwin',score:73,text:'Darwin alternate two'},
  {...page(58,'102'),title:'A Brief History of Time — Stephen Hawking',score:87,text:'Hawking lead'},
  {...page(48,'102'),title:'A Brief History of Time — Stephen Hawking',score:85,text:'Hawking alternate one'},
  {...page(49,'102'),title:'A Brief History of Time — Stephen Hawking',score:77,text:'Hawking alternate two'},
 ];
 const question='How does Darwin explain selection in On the Origin of Species, and how does Hawking explain black holes in A Brief History of Time?';
 const chosen=selectAnswerSources(candidates,question,'token',{maxSources:4});
 assert.deepEqual(chosen.map(item=>item.bookId+':'+item.page),
  ['102:58','529:495','529:240','102:48']);
});

test('explicit multi-work selection alternates remaining sources when retrieval scores are absent',()=>{
 const candidates=[
  {...page(1,'529'),title:'The Origin of Species — Charles Darwin',text:'Darwin one'},
  {...page(2,'529'),title:'The Origin of Species — Charles Darwin',text:'Darwin two'},
  {...page(1,'102'),title:'A Brief History of Time — Stephen Hawking',text:'Hawking one'},
  {...page(2,'102'),title:'A Brief History of Time — Stephen Hawking',text:'Hawking two'},
 ];
 const question='How does Darwin explain On the Origin of Species, and how does Hawking explain A Brief History of Time?';
 const chosen=selectAnswerSources(candidates,question,'token',{maxSources:4});
 assert.deepEqual(chosen.map(item=>item.bookId+':'+item.page),
  ['529:1','102:1','529:2','102:2']);
});

test('author comparison reserves each named author and keeps direct-question evidence',()=>{
 const candidates=[
  {...page(105,'96'),title:'Athens and Jerusalem — Lev Shestov',score:48.2,
   facetRanks:[{facet:1,rank:1}],text:'Shestov on reason and Spinoza'},
  {...page(39,'140'),title:'Fear and Trembling — Søren Kierkegaard',score:39.6,
   facetRanks:[{facet:0,rank:1}],text:'Kierkegaard on Abraham and the universal'},
  {...page(196,'96'),title:'Athens and Jerusalem — Lev Shestov',score:38.3,
   facetRanks:[{facet:2,rank:1}],text:'Shestov directly compares Kierkegaard and Greek philosophy'},
  {...page(33,'96'),title:'Athens and Jerusalem — Lev Shestov',score:45.8,
   facetRanks:[{facet:1,rank:2}],text:'Shestov on reason'},
  {...page(34,'140'),title:'Fear and Trembling — Søren Kierkegaard',score:38.2,
   facetRanks:[{facet:0,rank:2}],text:'Kierkegaard on faith'},
  {...page(59,'192'),title:'Philosophical Fragments — Søren Kierkegaard',score:33.1,
   facetRanks:[{facet:2,rank:2}],text:'Kierkegaard on faith and the God'},
 ].map(candidate=>({...candidate,globalPageId:candidate.page}));
 const chosen=selectAnswerSources(candidates,
  "what's the difference between the thought of kierkegaard and shestov?",'token',
  {maxSources:4,plannedFacetCount:2});
 assert.deepEqual(chosen.slice(0,2).map(item=>item.page),[196,59]);
 assert(chosen.some(item=>item.bookId==='96'));
 assert(chosen.some(item=>['140','192'].includes(item.bookId)));
});
test('source budget prioritizes distinct books before same-book alternatives',()=>{
 const candidates=[
  {...page(1,'7'),text:'first book'},
  {...page(2,'7'),text:'same book alternate'},
  {...page(3,'529'),text:'second book'},
 ];
 const chosen=selectAnswerSources(candidates,'Compare','token',{maxSources:2});
 assert.deepEqual(chosen.map(item=>item.bookId),['7','529']);
});
test('explicit work titles narrow searches to matching catalog books',()=>{
 const books=[
  {id:'7',title:'Nicomachean Ethics — Aristotle'},
  {id:'529',title:'The Harvard Classics, Volume 11: On the Origin of Species — Charles Darwin'},
  {id:'102',title:'A Brief History of Time — Stephen Hawking'},
  {id:'153',title:'The Iliad — Homer'},
  {id:'186',title:'The Odyssey — Homer'},
  {id:'540',title:'The Harvard Classics, Volume 22: The Odyssey — Homer'},
 ];
 assert.deepEqual(matchExplicitBookIds(
  'How do Aristotle in Nicomachean Ethics and Darwin in On the Origin of Species explain change?',books),
  ['7','529']);
 assert.deepEqual(matchExplicitBookIds(
  "In Homer's Odyssey, what shapes Odysseus' return home?",books),['186','540']);
});
test('explicitly named planner facets search their own work inside the question scope',()=>{
 const books=[
  {id:'529',title:'The Origin of Species — Charles Darwin'},
  {id:'102',title:'A Brief History of Time — Stephen Hawking'},
  {id:'7',title:'Nicomachean Ethics — Aristotle'},
 ];
 assert.deepEqual(targetBooksForFacet('Darwin natural selection in Origin of Species',books,['102','529']),['529']);
 assert.deepEqual(targetBooksForFacet('Hawking Cygnus X-1 unseen companion X-rays',books,['102','529']),['102']);
 assert.deepEqual(targetBooksForFacet('How do their accounts differ?',books,['102','529']),['102','529']);
 assert.deepEqual(targetBooksForFacet('Hawking black holes',books,['7']),['7']);
 assert.deepEqual(targetBooksForFacet('Black holes and evolution',books),[null]);
});
test('comparison author targeting retains a work for each named author',()=>{
 const books=[
  {id:'7',title:'Nicomachean Ethics — Aristotle'},
  {id:'9',title:'Metaphysics — Aristotle'},
  {id:'529',title:'The Harvard Classics, Volume 11: On the Origin of Species — Charles Darwin'},
  {id:'547',title:'The Voyage of the Beagle (Harvard Classics, Vol. 29) — Charles Darwin'},
 ];
 assert.deepEqual(matchExplicitBookIds(
  'How do Aristotle in Nicomachean Ethics and Darwin explain change?',books),['7','529','547']);
});
test('author-only mentions search across the named author’s catalog works',()=>{
 const books=[
  {id:'149',title:'The Histories — Herodotus'},
  {id:'152',title:'History of the Peloponnesian War — Thucydides'},
  {id:'163',title:'Leviathan — Thomas Hobbes'},
  {id:'140',title:'Fear and Trembling — Søren Kierkegaard'},
  {id:'192',title:'Philosophical Fragments — Søren Kierkegaard'},
  {id:'253',title:'The Sickness Unto Death — Søren Kierkegaard'},
  {id:'436',title:'Kierkegaard’s Attack Upon “Christendom,” 1854–1855 — Søren Kierkegaard'},
 ];
 assert.deepEqual(matchExplicitBookIds(
  'How does Herodotus handle accounts heard from others?',books),['149']);
 assert.deepEqual(matchExplicitBookIds(
  'what did kierkegaard have to say about faith?',books),['140','192','253','436']);
 assert.deepEqual(matchExplicitBookIds(
  'In Leviathan, how does Hobbes describe the state of nature?',books),['163']);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeFacetSearches,validSearchPlan,buildSearchFacets,selectAnswerSources,canFallbackToDirectSearch,matchExplicitBookIds,targetBooksForFacet} from './evidence-search.mjs';

const page=(page,bookId='114')=>({page,bookId,title:'Crime and Punishment',
 preview:'Authentic indexed excerpt',url:'https://drive.google.com/file/d/X/view#page='+page});
test('first two selections cover different semantic question facets',()=>{
 const out=mergeFacetSearches([
  {sources:[page(475),page(465),page(476)]},
  {sources:[page(718),page(814),page(719)]}
 ],8);
 assert.deepEqual(out.slice(0,2).map(x=>x.page),[475,718]);
 assert.deepEqual(out.slice(0,2).map(x=>x.facet),[0,1]);
 assert.deepEqual(out.slice(2).map(x=>x.page),[465,814,476,719]);
});
test('deduplicates common matches and selects a distinct second facet page',()=>{
 const out=mergeFacetSearches([
  {sources:[page(38,'152'),page(39,'152')]},
  {sources:[page(38,'152'),page(48,'152')]}
 ],8);
 assert.deepEqual(out.slice(0,2).map(x=>x.page),[38,48]);
 assert.equal(out.length,3);
});
test('comparison queries can surface source pages from different books',()=>{
 const out=mergeFacetSearches([
  {sources:[page(72,'7')]},
  {sources:[page(136,'529')]}
 ]);
 assert.deepEqual(out.map(x=>x.bookId),['7','529']);
});
test('stronger passage evidence outranks a higher-ranked but weaker work match',()=>{
 const out=mergeFacetSearches([{sources:[
  {...page(117,'12'),score:82.2},
  {...page(124,'12'),score:70.7},
  {...page(14,'7'),score:88.8}
 ]}],2);
 assert.deepEqual(out.map(x=>x.page),[14,117]);
});
test('a strong passage later in a facet reaches the bounded answer context',()=>{
 const out=mergeFacetSearches([
  {sources:[
   {...page(83,'7'),score:47.6},
   {...page(84,'7'),score:40.3},
   {...page(8,'7'),score:39.3}
  ]},
  {sources:[
   {...page(122,'7'),score:48.9},
   {...page(63,'7'),score:48.3},
   {...page(125,'7'),score:47.8}
  ]},
  {sources:[
   {...page(87,'12'),score:59.9},
   {...page(14,'7'),score:56.8},
   {...page(117,'12'),score:53.7},
   {...page(108,'12'),score:51.8}
  ]}
 ],8);
 const bounded=out.slice(0,4);
 assert(bounded.some(source=>source.bookId==='7'&&source.page===14));
 const chosen=selectAnswerSources(bounded.map(source=>({...source,text:'full source page'})),
   'How does Aristotle explain becoming virtuous through repeated actions?','token');
 assert(chosen.some(source=>source.bookId==='7'&&source.page===14));
 assert(chosen.some(source=>source.bookId==='12'));
});
test('planned facets keep complementary passages inside the four-page budget',()=>{
 const facets=[
  [page(96,'529'),page(495,'529'),page(218,'529')],
  [page(140,'529'),page(29,'529'),page(31,'529')],
  [page(307,'529'),page(101,'529'),page(167,'529')],
 ].map(group=>({sources:group.map((source,index)=>({...source,score:90-index}))}));
 const merged=mergeFacetSearches(facets,8);
 const chosen=selectAnswerSources(merged.map(source=>({...source,text:'full page'})),
  'How does natural selection operate, and what roles do inherited variation and the struggle for existence play?',
  'token',{maxSources:4,plannedFacetCount:2});
 assert.deepEqual(chosen.map(source=>source.page),[96,140,307,495]);
 assert.deepEqual(merged.find(source=>source.page===29).facetRanks,[{facet:1,rank:2}]);
});

test('direct-question search keeps a high-ranking exact-topic source in the answer budget',()=>{
 const facets=[
  {sources:[{...page(110,'221'),score:48},{...page(65,'221'),score:47}]},
  {sources:[{...page(109,'576'),score:74},{...page(209,'576'),score:62}]},
  {sources:[{...page(47,'318'),score:47.1972,title:'A History of the Warfare of Science with Theology in Christendom — Andrew Dickson White'},
   {...page(317,'317'),score:45.3863,title:'History of the Conflict Between Religion and Science — John William Draper'}]}
 ];
 const candidates=mergeFacetSearches(facets,8).map(source=>({...source,text:'full source page'}));
 const chosen=selectAnswerSources(candidates,'Is there a conflict between religion and science?','token',
  {maxSources:4,plannedFacetCount:2});
 assert(chosen.some(source=>source.facet===2&&source.bookId==='317'),
  'prefer Draper’s exact-topic work title even when White’s bibliographic mention ranks higher');
 assert(chosen.some(source=>source.facet===0));
 assert(chosen.some(source=>source.facet===1));
});
test('six-source packets use the available Worker body budget',()=>{
 const candidates=Array.from({length:6},(_,index)=>({...page(index+1,String(index+1)),
  title:'Work '+(index+1),score:90-index,text:'x'.repeat(5800),
  facetRanks:[{facet:index%3,rank:1}]}));
 const chosen=selectAnswerSources(candidates,'A broad question about six distinct sources?','token',
  {maxSources:6,plannedFacetCount:2});
 const body=JSON.stringify({question:'A broad question about six distinct sources?',
  turnstileToken:'token',history:[],sources:chosen.map(({bookId,page,text})=>({bookId,page,text}))});
 assert.equal(chosen.length,6);
 assert(new TextEncoder().encode(body).byteLength<=40000);
 assert(chosen.reduce((sum,source)=>sum+new TextEncoder().encode(source.text).byteLength,0)<=35000);
});
test('source selection stays within the Worker verified-text limit',()=>{
 const candidates=Array.from({length:6},(_,index)=>({...page(index+1,String(index+1)),
  text:'x'.repeat(6000)}));
 const chosen=selectAnswerSources(candidates,'A question','token',{maxSources:6});
 assert.equal(chosen.length,5);
 assert.equal(chosen.reduce((sum,source)=>sum+new TextEncoder().encode(source.text).byteLength,0),30000);
});
test('invalid metadata or duplicate semantic planning is never accepted',()=>{
 assert.equal(validSearchPlan(['Raskolnikov extraordinary man theory','Raskolnikov conscience guilt Sonia']),true);
 assert.equal(validSearchPlan(['same search phrase','same search phrase']),false);
 assert.equal(validSearchPlan(['too short', 'other']),false);
 const out=mergeFacetSearches([{sources:[page(73),{bookId:'../../11',page:11},page(74)]}],2);
 assert.deepEqual(out.map(x=>x.page),[73,74]);
});

test('the reader question is retained as a third search facet for all-book and selected-book searches',()=>{
 const plan=['Aristotle virtue formation through habituation','Aristotle repeated actions and moral character'];
 const question='How does Aristotle explain becoming virtuous through repeated actions?';
 assert.deepEqual(buildSearchFacets(question,plan),[...plan,question]);
 assert.deepEqual(buildSearchFacets(question,plan,'7'),[...plan,question]);
 assert.deepEqual(buildSearchFacets(question,[plan[0],question]),[plan[0],question]);
 assert.deepEqual(buildSearchFacets(question,null),[question]);
});
test('scripture references retain the exact question under the same general rule',()=>{
 const plan=['1 John 4:7-12 God love theology','1 John commandment love one another'];
 const question='According to 1 John 4:7–12, what does “God is love” say about loving one another?';
 assert.deepEqual(buildSearchFacets(question,plan),[...plan,question]);
 assert.deepEqual(buildSearchFacets(question,plan,'638'),[...plan,question]);
});

test('planner outages fall back to direct search while denials and rate limits remain blocked',()=>{
 assert.equal(canFallbackToDirectSearch(null),true);
 assert.equal(canFallbackToDirectSearch(502,'search-planning-failed'),true);
 assert.equal(canFallbackToDirectSearch(503,'service-unavailable'),true);
 assert.equal(canFallbackToDirectSearch(200,'invalid-response'),true);
 assert.equal(canFallbackToDirectSearch(400,'request-rejected'),false);
 assert.equal(canFallbackToDirectSearch(403,'visitor-or-origin-rejected'),false);
 assert.equal(canFallbackToDirectSearch(403,'invalid-response'),false);
 assert.equal(canFallbackToDirectSearch(429,'rate-limited'),false);
 assert.equal(canFallbackToDirectSearch(502,'ai-daily-limit-reached'),false);
 assert.equal(canFallbackToDirectSearch(502,'ai-capacity-unavailable'),false);
});

test('answer submissions include up to four facet-balanced pages within the exact request byte budget',()=>{
 const candidates=mergeFacetSearches([
  {sources:[page(1,'7'),page(2,'7'),page(3,'7')]},
  {sources:[page(4,'529'),page(5,'529'),page(6,'529')]}
 ],8).map((source,index)=>({...source,text:'passage '+index+' '.repeat(5000)}));
 const question='Compare these accounts';
 const token='turnstile-token';
 const chosen=selectAnswerSources(candidates,question,token);
 assert.equal(chosen.length,4);
 assert.deepEqual(chosen.slice(0,2).map(x=>x.facet),[0,1]);
 const body=JSON.stringify({question,turnstileToken:token,history:[],
  sources:chosen.map(({bookId,page,text})=>({bookId,page,text}))});
 assert(new TextEncoder().encode(body).byteLength<=39000);
 assert(new TextEncoder().encode(body).byteLength>20000);
});

test('answer submission skips pages that do not fit and keeps later source candidates',()=>{
 const candidates=[
  {...page(1),text:'x'.repeat(40000)},
  {...page(2,'529'),text:'useful smaller page'}
 ];
 const chosen=selectAnswerSources(candidates,'A question','a token');
 assert.deepEqual(chosen.map(x=>x.page),[2]);
});

test('answer source byte budget includes recent conversation context',()=>{
 const history=[{role:'user',content:'Previous question'},
   {role:'assistant',content:'Previous answer '.repeat(90)}];
 const candidates=[{...page(1),text:'source '.repeat(2500)}];
 const chosen=selectAnswerSources(candidates,'Follow-up question','a token',
   {history,maxBytes:10000});
 const body=JSON.stringify({question:'Follow-up question',turnstileToken:'a token',
   history,sources:chosen.map(({bookId,page,text})=>({bookId,page,text}))});
 assert.equal(new TextEncoder().encode(body).byteLength<=10000,true);
 assert.equal(JSON.parse(body).history.length,2);
});


test('website only trusts planned search strings and still submits original full pages for fingerprint checks',async()=>{
 const {readFileSync}=await import('node:fs');
 const js=readFileSync(new URL('./companion-v110.mjs',import.meta.url),'utf8');
 assert.match(js,/API\+'\/api\/pilot-plan'/);
 assert.match(js,/data\.searchPlanning===true/);
 assert.match(js,/validSearchPlan\(data\.queries\)/);
 assert.match(js,/buildSearchFacets\(q,plannedQueries,bookFilter\.value\)/);
 assert.match(js,/const found=await retrieveSources\(queries,\{plannerFallback\}\)/);
 assert.match(js,/canFallbackToDirectSearch\(diagnosticState\?\.failureHttpStatus/);
 assert.match(js,/diagnosticState\.fallbackMode=true/);
 assert.match(js,/Search planning is temporarily unavailable; searching directly with your question/);
 assert.match(js,/token=await nextTurnstileToken\(\)/);
 assert.match(js,/window\.turnstile\.reset\(turnstileId\)/);
 assert.match(js,/sources:chosen\.map\(\(\{bookId,page,text\}\)=>\(\{bookId,page,text\}\)\)/);
 assert.match(js,/selectAnswerSources\(candidates,q,token,\{history,\s*maxSources:MAX_ANSWER_SOURCES,\s*plannedFacetCount:/);
 assert.doesNotMatch(js,/searchPages\(|lastSearch|checked passages will guide/i);
 assert.match(js,/data\.outcome==='insufficient-evidence'/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
});
