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
test('canonical Bible references do not resolve James as William James in all-books mode',()=>{
 const books=[
  {id:'39',title:'The Will to Believe — William James'},
  {id:'38',title:'The Varieties of Religious Experience — William James'},
  {id:'335',title:'New King James Version Bible — Various authors'},
  {id:'638',title:'The New Oxford Annotated Bible, Fully Revised Fifth Edition — edited by Michael D. Coogan'},
 ];
 const question='According to James 2:14–26, how does James relate faith to works, and what do Abraham and Rahab illustrate?';
 assert.deepEqual(matchExplicitBookIds(question,books),[]);
 assert.deepEqual(targetBooksForFacet(
  'James 2:14-26 faith without works being dead Bible',books),[null]);
 assert.deepEqual(targetBooksForFacet(
  'James 2:14-26 faith without works being dead Bible',books,['39']),['39']);
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
import {mergeFacetSearches,validSearchPlan,buildSearchFacets,selectAnswerSources,canFallbackToDirectSearch,matchExplicitBookIds,targetBooksForFacet,retrieveEvidence} from './evidence-search.mjs';
import {catalogIdentity,normalizePlan} from './reader-contract.mjs';

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
test('direct-question source selection breaks near-ties by passage relevance',()=>{
 const question='How do Hume’s Enquiry and Kant’s Critique of Pure Reason differ over how we can know causal necessity?';
 const candidates=[
  {...page(24,'40'),title:'Critique of Pure Reason — Immanuel Kant',score:61.9957,
   facetRanks:[{facet:2,rank:1}],text:'How is metaphysics possible as a science? The critique of reason sets limits to speculative assertions.'},
  {...page(23,'40'),title:'Critique of Pure Reason — Immanuel Kant',score:61.9857,
   facetRanks:[{facet:2,rank:2}],text:'Kant discusses Hume’s claim that a priori knowledge of cause and effect is impossible and habit gives necessity its appearance.'}
 ];
 const chosen=selectAnswerSources(candidates,question,'token',{
  maxSources:1,plannedFacetCount:2});
 assert.deepEqual(chosen.map(source=>source.page),[23]);
});
test('multi-work packet includes the relevant direct-question passage among same-work hits',()=>{
 const question='How do Hume’s Enquiry and Kant’s Critique of Pure Reason differ over how we can know causal necessity?';
 const candidates=[
  {...page(54,'40'),title:'Critique of Pure Reason — Immanuel Kant',score:75,
   facetRanks:[{facet:1,rank:1}],text:'Causality is an a priori category in the understanding.'},
  {...page(42,'35'),title:'An Enquiry Concerning Human Understanding — David Hume',score:60.56,
   facetRanks:[{facet:0,rank:1}],text:'Necessity arises from constant conjunction and custom-based inference.'},
  {...page(24,'40'),title:'Critique of Pure Reason — Immanuel Kant',score:61.9957,
   facetRanks:[{facet:2,rank:1}],text:'How is metaphysics possible as a science? The critique of reason sets limits to speculative assertions.'},
  {...page(41,'35'),title:'An Enquiry Concerning Human Understanding — David Hume',score:60.55,
   facetRanks:[{facet:0,rank:2}],text:'Section VIII introduces liberty and necessity.'},
  {...page(53,'40'),title:'Critique of Pure Reason — Immanuel Kant',score:71,
   facetRanks:[{facet:1,rank:2}],text:'The table of categories includes causality and dependence.'},
  {...page(47,'35'),title:'An Enquiry Concerning Human Understanding — David Hume',score:48.94,
   facetRanks:[{facet:0,rank:3}],text:'Constant conjunction and inference define necessity.'},
  {...page(23,'40'),title:'Critique of Pure Reason — Immanuel Kant',score:61.9857,
   facetRanks:[{facet:2,rank:2}],text:'Kant discusses Hume’s claim that a priori knowledge of cause and effect is impossible and habit gives necessity its appearance.'}
 ].map(source=>({...source,globalPageId:source.page}));
 const chosen=selectAnswerSources(candidates,question,'token',{
  maxSources:6,plannedFacetCount:2});
 assert(chosen.some(source=>source.bookId==='40'&&source.page===23),JSON.stringify(chosen.map(s=>s.bookId+':'+s.page)));
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
 assert.equal(validSearchPlan(['Darwin selection favorable variation','Darwin offspring inherit variation','Darwin struggle for existence']),true);
 assert.equal(validSearchPlan(['one facet query phrase','two facet query phrase','three facet query phrase','four facet query phrase','five facet query phrase']),false);
 assert.equal(validSearchPlan(['same search phrase','second different phrase',' same search phrase ']),false);
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

test('three targeted searches survive facet merge and answer-source selection',()=>{
 const question="According to Darwin's On the Origin of Species, how does natural selection operate, and what roles do inherited variation and the struggle for existence play?";
 const queries=[
  'On the Origin of Species natural selection preserves advantageous variation',
  'On the Origin of Species offspring inherit favorable variations',
  'On the Origin of Species struggle for existence more offspring than survive'
 ];
 const facets=buildSearchFacets(question,queries,'529');
 assert.deepEqual(facets,[...queries,question]);
 const results=facets.map((_,facet)=>({sources:[{...page(80+facet,'529'),
  title:'The Harvard Classics, Volume 11: On the Origin of Species — Charles Darwin',
  score:100-facet}]}));
 const candidates=mergeFacetSearches(results,12).map(source=>({...source,
  text:'Darwin passage supporting facet '+source.page}));
 const chosen=selectAnswerSources(candidates,question,'token',{
  maxSources:6,plannedFacetCount:queries.length
 });
 assert.deepEqual(chosen.map(source=>source.page),[80,81,82,83]);
 assert(chosen.some(source=>source.facetRanks.some(item=>item.facet===1)),
  'the offspring inheritance passage retrieved only by the second targeted query must reach answer generation');
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
 assert.equal(canFallbackToDirectSearch(502,'ai-daily-free-allocation'),false);
 assert.equal(canFallbackToDirectSearch(502,'ai-provider-usage-limit'),false);
 assert.equal(canFallbackToDirectSearch(502,'ai-credit-limit'),false);
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


test('edited author collections stay discoverable by their author, not editor',()=>{
 const portable='The Portable Nietzsche — Friedrich Nietzsche (edited by Walter Kaufmann)';
 const identity=catalogIdentity(portable);
 assert.deepEqual(identity.authors,['Friedrich Nietzsche']);
 assert.deepEqual(identity.editors,['Walter Kaufmann']);
 const books=[{id:'239',title:portable},
  {id:'640',title:'Nietzsche and the Modern Mind — Walter Kaufmann'}];
 assert.deepEqual(matchExplicitBookIds('What did Nietzsche think about Plato?',books),['239']);
 assert.deepEqual(matchExplicitBookIds('What did Walter Kaufmann argue?',books),['640']);
});

test('shared retrieval hydrates bounded full pages and returns one reproducible facet pool',async()=>{
 const books=[{id:'239',title:'The Portable Nietzsche — Friedrich Nietzsche (edited by Walter Kaufmann)'}];
 const allowedBookIds=new Set(['239']);let calls=0;
 const library={search:async(query,options)=>{calls++;assert.equal(options.allowedBookIds,allowedBookIds);
  return {sources:[{bookId:'239',title:books[0].title,page:570,globalPageId:569,
   score:4,facet:query,url:'https://drive.google.com/file/d/ABCDEFGHIJK/view#page=570'}]};}};
 const result=await retrieveEvidence({question:'What did Nietzsche think about Plato?',
  queries:['Nietzsche Plato idealism critique','Nietzsche Plato Christianity idealism'],library,books,
  allowedBookIds,pageLoader:async()=>({text:'A verified full source passage with complete context and claims.'})});
 assert.equal(calls,3);
 assert.equal(result.searches.length,3);
 assert.equal(result.candidates.length,1);
 assert.match(result.candidates[0].text,/complete context/);
});

test('part queries keep matching page IDs linked to each question part through selection',async()=>{
 const books=[{id:'74',title:'The Republic — Plato'}],allowedBookIds=new Set(['74']);
 const library={search:async(query)=>({sources:[{bookId:'74',title:books[0].title,
  page:query.includes('common good')?110:28,globalPageId:query.includes('common good')?109:27,
  score:80,facet:query}]})};
 const result=await retrieveEvidence({question:'How does Plato explain political order?',
  queries:['Plato Republic political legitimacy','Plato Republic justice in the soul'],
  partQueries:[{partId:'P1',query:'Plato Republic political legitimacy'},
   {partId:'P2',query:'Plato Republic political order common good'}],library,books,allowedBookIds,
  pageLoader:async source=>({text:`A complete verified page for ${source.page} with more than enough text.`})});
 assert.ok(result.candidates.some(source=>source.page===28&&source.candidatePartIds.includes('P1')));
 assert.ok(result.candidates.some(source=>source.page===110&&source.candidatePartIds.includes('P2')));
 const selected=selectAnswerSources(result.candidates,'How does Plato explain political order?','token',{
  maxSources:2,maxBytes:5000,maxSourceBytes:5000,plannedFacetCount:result.searchQueries.length-1});
 assert.deepEqual(new Set(selected.flatMap(source=>source.candidatePartIds)),new Set(['P1','P2']));
});

test('answer packet selection prefers a page that addresses the part over a higher-ranked topical page',()=>{
 const title='Critique of Pure Reason — Immanuel Kant';
 const candidates=[
  {bookId:'40',title,page:54,score:95,candidatePartIds:['P2'],
   text:'Causality is one of the categories of relation, and the categories are a priori.'},
  {bookId:'40',title,page:98,score:72,candidatePartIds:['P2'],
   text:'The Second Analogy argues that every change follows a causal rule, which grounds the objective necessity of causal judgments in experience.'}
 ];
 const selected=selectAnswerSources(candidates,'How does Kant explain causal necessity?',
  'token',{maxSources:1,maxBytes:5000,maxSourceBytes:5000,
   partQuestions:[{partId:'P2',question:'How does Kant explain the grounds of causal necessity in experience?'}]});
 assert.deepEqual(selected.map(source=>source.page),[98]);
});

test('reused comparison queries may link to more than six parts while unique searches stay bounded',async()=>{
 const books=[{id:'35',title:'An Enquiry Concerning Human Understanding — David Hume'},
  {id:'40',title:'Critique of Pure Reason — Immanuel Kant'}];
 const allowedBookIds=new Set(['35','40']);
 const byBook=new Map(books.map((book,index)=>[book.id,{bookId:book.id,title:book.title,
  page:index?54:41,globalPageId:index?53:40,score:80}]));
 const humeQuery='Hume Enquiry causal necessity custom habit';
 const kantQuery='Kant Critique causal necessity category a priori';
 const question='How do Hume and Kant differ over causal necessity?';
 const result=await retrieveEvidence({question,queries:[humeQuery,kantQuery],
  partQueries:[{partId:'P1',query:humeQuery},{partId:'P1',query:'How does Hume explain causal necessity?'},
   {partId:'P2',query:kantQuery},{partId:'P2',query:'How does Kant explain causal necessity?'},
   {partId:'P3',query:humeQuery},{partId:'P3',query:kantQuery},{partId:'P3',query:question}],
  library:{search:async(_query,options)=>({sources:options.bookId?[byBook.get(options.bookId)]:[...byBook.values()]})},
  books,allowedBookIds,pageLoader:async source=>({text:`Verified full page ${source.page} explains the account of causal necessity with enough context for evidence.`})});
 assert.equal(result.partFacetIndices.length,7);
 assert.ok(result.searches.length<=6,'reused planner queries are searched only once');
 assert.ok(result.candidates.some(source=>source.bookId==='35'&&
  source.candidatePartIds.includes('P1')&&source.candidatePartIds.includes('P3')));
 assert.ok(result.candidates.some(source=>source.bookId==='40'&&
  source.candidatePartIds.includes('P2')&&source.candidatePartIds.includes('P3')));
});

test('a second-ranked directly relevant page survives retrieval and reaches the answer packet',async()=>{
 const question='How do Hume’s Enquiry and Kant’s Critique of Pure Reason differ over causal necessity?';
 const humeQuery='Hume Enquiry causal necessity custom habit';
 const kantQuery='Kant Critique causal necessity category a priori';
 const books=[{id:'35',title:'An Enquiry Concerning Human Understanding — David Hume'},
  {id:'40',title:'Critique of Pure Reason — Immanuel Kant'}];
 const allowedBookIds=new Set(['35','40']);
 const library={search:async(query,{bookId}={})=>{
  if(query===question&&bookId==='40')return {sources:[
   {bookId:'40',title:books[1].title,page:24,globalPageId:3112,score:90},
   {bookId:'40',title:books[1].title,page:23,globalPageId:3111,score:85}]};
  if(query===question&&bookId==='35')return {sources:[
   {bookId:'35',title:books[0].title,page:47,globalPageId:2742,score:60}]};
  if(query===humeQuery)return {sources:[{bookId:'35',title:books[0].title,page:48,globalPageId:2743,score:80}]};
  if(query===kantQuery)return {sources:[{bookId:'40',title:books[1].title,page:86,globalPageId:3174,score:80}]};
  return {sources:[]};
 }};
 const result=await retrieveEvidence({question,queries:[humeQuery,kantQuery],
  partQueries:[{partId:'P1',query:humeQuery},{partId:'P2',query:kantQuery},
   {partId:'P3',query:question}],library,books,allowedBookIds,maxCandidates:12,
  pageLoader:async source=>({text:source.page===23?
   'Kant discusses Hume’s principle of causality, synthetic a priori knowledge, necessity, experience, and habit.':
   source.page===24?'The Critique asks how metaphysics is possible as a science and discusses pure reason.':
   `A verified source page about causal necessity and experience, page ${source.page}.`})});
 const kant23=result.candidates.find(value=>value.bookId==='40'&&value.page===23);
 assert.ok(kant23,'the second-ranked Kant result must survive the candidate cap');
 assert.ok(kant23.candidatePartIds.includes('P3'),
  'the exact question facet should link its result to the comparison part');
 const selected=selectAnswerSources(result.candidates,question,'token',{
  maxSources:4,maxBytes:20000,maxSourceBytes:20000,plannedFacetCount:result.searchQueries.length-1});
 assert.ok(selected.some(value=>value.bookId==='40'&&value.page===23),
  'the page matching the causal-necessity comparison should reach the submitted packet: '+
   JSON.stringify({candidatePages:result.candidates.map(value=>({bookId:value.bookId,page:value.page,parts:value.candidatePartIds,facets:value.facetRanks})),
    selectedPages:selected.map(value=>({bookId:value.bookId,page:value.page,parts:value.candidatePartIds}))}));
});

test('synthetic comparison coverage reuses source searches instead of spending a facet on generic wording',()=>{
 const question='How do Hume’s Enquiry and Kant’s Critique of Pure Reason differ over causal necessity?';
 const humeQuery='Hume Enquiry causal necessity custom habit';
 const kantQuery='Kant Critique causal necessity category a priori';
 const plan=normalizePlan({intent:'compare',resolvedQuestion:question,sources:[
  {label:'David Hume',role:'primary',bookIds:['35']},
  {label:'Critique of Pure Reason',role:'primary',bookIds:['40']}],parts:[
   'How does Hume explain causal necessity in the Enquiry?',
   'How does Kant explain causal necessity in the Critique of Pure Reason?'],
  queries:[humeQuery,kantQuery]},question,{
   '35':'An Enquiry Concerning Human Understanding — David Hume',
   '40':'Critique of Pure Reason — Immanuel Kant'});
 const comparison=plan.parts[2];
 assert.match(comparison.question,/compare in response to this question/i);
 assert.deepEqual(comparison.searchQueries,[humeQuery,kantQuery]);
 assert.ok(!comparison.searchQueries.includes(comparison.question));
});

test('source-specific planner queries also link their results to the matching part',async()=>{
 const books=[{id:'40',title:'Critique of Pure Reason — Immanuel Kant'}],allowedBookIds=new Set(['40']);
 const library={search:async(query)=>({sources:[{bookId:'40',title:books[0].title,
  page:query.includes('categories a priori')?54:105,globalPageId:query.includes('categories a priori')?53:104,
  score:80,facet:query}]})};
 const result=await retrieveEvidence({question:'How does Kant explain causal necessity?',
  queries:['Kant Critique causality categories a priori synthetic','Kant causal necessity experience'],
  partQueries:[{partId:'P2',query:'Kant Critique causality categories a priori synthetic'},
   {partId:'P2',query:'How does Kant explain the origin and justification of causal necessity?'}],
  library,books,allowedBookIds,
  pageLoader:async source=>({text:`A complete verified page ${source.page} explains the category of causality and its role in experience.`})});
 const page54=result.candidates.find(source=>source.page===54);
 assert.ok(page54);
 assert.deepEqual(page54.candidatePartIds,['P2']);
 assert.ok(result.searches.some(search=>search.query.includes('categories a priori')&&search.partIds.includes('P2')));
});

test('a passage found for one facet can link to another part when its full text covers both',async()=>{
 const books=[{id:'149',title:'The Histories — Herodotus'}],allowedBookIds=new Set(['149']);
 const question='What happened in the story of Helen at Troy?';
 const sharedText='The Egyptian priests say Paris took Helen to Egypt, and Herodotus explains he trusts their account because they kept the sanctuary records and gave a coherent account of the events.';
 const result=await retrieveEvidence({question,queries:['Herodotus Helen Troy Egyptian priests','Herodotus Egyptian account credibility'],
  partQueries:[{partId:'P1',query:'What did the Egyptian priests say about Helen?'},
   {partId:'P2',query:'Why did Herodotus find the Egyptian account more credible?'}],
  library:{search:async query=>({sources:query.includes('priests')?[{
   bookId:'149',title:books[0].title,page:146,globalPageId:145,score:90,facet:query
  }]:[]})},books,allowedBookIds,
  pageLoader:async()=>({text:sharedText})});
 const page=result.candidates[0];
 assert.ok(page.candidatePartIds.includes('P1'));
 assert.ok(page.candidatePartIds.includes('P2'),
  'hydrated page text supports the second part even though only the first facet found it');
});

test('a contextual query carries a quoted parent passage into a pronoun-based part link',async()=>{
 const question='In Hamlet’s “To be, or not to be” soliloquy, what alternatives does he weigh, and how does uncertainty about what follows death affect his reasoning?';
 const books=[{id:'212',title:'The Complete Works of William Shakespeare — William Shakespeare'}];
 const result=await retrieveEvidence({question,queries:[
  'Hamlet Shakespeare To be or not to be alternatives suffering',
  'Hamlet Shakespeare To be or not to be death uncertainty afterlife'],
  partQueries:[{partId:'P2',query:'Hamlet To be, or not to be soliloquy how does uncertainty about the afterlife affect his reasoning?'}],
  partQuestions:[{partId:'P2',question:'How does uncertainty about the afterlife affect his reasoning in this soliloquy?'}],
  library:{search:async query=>query.includes('To be, or not to be')?{sources:[
   {bookId:'212',title:books[0].title,page:453,globalPageId:52374,score:90,facet:query}
  ]}:{sources:[]}},
  books,allowedBookIds:new Set(['212']),pageLoader:async()=>({text:
   'Hamlet. To be, or not to be: that is the question. To die, to sleep, perchance to dream.'})});
 const page=result.candidates.find(source=>source.page===453);
 assert.ok(page?.candidatePartIds.includes('P2'),
  'a root-question quote in the contextual part query should connect the source to that part');
});

test('quoted part phrase links an otherwise unassigned page through OCR spacing and reserves it',async()=>{
 const question='What does Hamlet weigh in the famous soliloquy?';
 const books=[{id:'564',title:'Elizabethan Drama, Vol I'}],allowedBookIds=new Set(['564']);
 const text='T o be, or not to be, that is the question: whether it is nobler in the mind to suffer the slings and arrows of outrageous fortune, or to take arms against a sea of troubles and by opposing end them.';
 const result=await retrieveEvidence({question,
  queries:['Hamlet Elizabethan drama soliloquy existence','Hamlet weigh suffering action death'],
  partQueries:[{partId:'P1',query:'Hamlet Elizabethan drama soliloquy existence'},
   {partId:'P1',query:'Hamlet weigh suffering action death'}],
  partQuestions:[{partId:'P1',question:'What alternatives does Hamlet weigh in the “To be, or not to be” soliloquy?'}],
  library:{search:async query=>query===question?{sources:[{bookId:'564',title:books[0].title,
   page:152,globalPageId:151,score:85,facet:query,candidatePartIds:[]}]}:{sources:[]}},
  books,allowedBookIds,pageLoader:async()=>({text})});
 const page=result.candidates.find(source=>source.page===152);
 assert.ok(page);
 assert.ok(page.candidatePartIds.includes('P1'),
  'the quoted distinctive phrase should link the full page to its question part despite OCR spacing');
 const selected=selectAnswerSources([...result.candidates,{bookId:'564',title:books[0].title,
  page:151,score:99,candidatePartIds:['P1'],
  text:'Hamlet considers the fear of death, the unknown afterlife, and uncertainty about what comes after death.'}],question,'token',{maxSources:1,
  maxBytes:5000,maxSourceBytes:5000,partQuestions:[{partId:'P1',
   question:'What alternatives does Hamlet weigh in the “To be, or not to be” soliloquy?'}]});
 assert.equal(selected[0]?.page,152,'the linked full source page should reach the answer packet');
});

test('website only trusts planned search strings and still submits original full pages for fingerprint checks',async()=>{
 const {readFileSync}=await import('node:fs');
 const js=readFileSync(new URL('./companion-v110.mjs',import.meta.url),'utf8');
 assert.match(js,/API\+'\/api\/pilot-plan'/);
 assert.match(js,/data\.searchPlanning===true/);
 assert.match(js,/validSearchPlan\(data\.queries\)/);
 assert.match(js,/retrieveEvidence\(\{question:q/);
 assert.match(js,/const found=await retrieveSources\(planned\?\.queries\|\|null,\{plannerFallback,/);
 assert.match(js,/plan:planned\?\.plan\|\|null,partQuestions\}/);
 assert.match(js,/canFallbackToDirectSearch\(diagnosticState\?\.failureHttpStatus/);
 assert.match(js,/diagnosticState\.fallbackMode=true/);
 assert.match(js,/Search planning is temporarily unavailable; searching directly with your question/);
 assert.match(js,/token=await nextTurnstileToken\(\)/);
 assert.match(js,/window\.turnstile\.reset\(turnstileId\)/);
 assert.match(js,/sources:chosen\.map\(\(\{bookId,page,text,candidatePartIds\}\)=>\(\{bookId,page,text,candidatePartIds\}\)\)/);
 assert.match(js,/selectAnswerSources\(candidates,q,token,\{history,\s*maxSources:MAX_ANSWER_SOURCES,\s*plannedFacetCount:/);
 assert.doesNotMatch(js,/searchPages\(|lastSearch|checked passages will guide/i);
 assert.match(js,/data\.outcome==='insufficient-evidence'/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
});

