import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeFacetSearches} from './evidence-search.mjs';
import {evaluateCase,selectEvaluationAnswerSources,sourceIdentityIssues,summarize,validateSuite,verifyFingerprint} from './public-library-evaluation.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SUITE_PATH=resolve(ROOT,'benchmarks/reading-companion-public-v1.json');
const SELECTED_SUITE_PATH=resolve(ROOT,'benchmarks/reading-companion-selected-book-v1.json');
const DRIVE='1XVInAFS2zutV8PDp8A3DirUrW6nLLfvY';

test('benchmark covers 31 fixed global questions across six subject areas, including scripture',async()=>{
 const suite=validateSuite(JSON.parse(await readFile(SUITE_PATH,'utf8')));
 assert.equal(suite.cases.length,31);
 const scripture=suite.cases.find(c=>c.id==='religion-1-john-love');
 assert.ok(scripture,'the 1 John retrieval regression is present');
 assert.deepEqual(scripture.required_source_groups,[{label:'1 John 4:7–12',book_ids:['638']}]);
 assert.deepEqual(scripture.evidence_targets,[{label:'1 John 4:7–12',book_id:'638',pages:[1821]}]);
 assert.deepEqual(new Set(suite.cases.map(c=>c.discipline)),new Set(['science','history','literature','philosophy','politics-society','religion']));
 assert.ok(suite.cases.every(c=>c.planner_queries.length===2));
 assert.ok(suite.cases.every(c=>!('book_id' in c)), 'every search starts in all-books scope');
});

test('benchmark validation rejects duplicate IDs and incomplete two-facet plans',async()=>{
 const suite=JSON.parse(await readFile(SUITE_PATH,'utf8'));
 const duplicate=[...suite.cases];duplicate[29]={...duplicate[0]};
 assert.throws(()=>validateSuite({...suite,cases:duplicate}),/Duplicate or invalid case ID/);
 const cases=suite.cases.map(c=>({...c,planner_queries:[...c.planner_queries]}));
 cases[0].planner_queries[1]=cases[0].planner_queries[0];
 assert.throws(()=>validateSuite({...suite,cases}),/two valid planned searches/);
 const invalidTargets=suite.cases.map(c=>({...c}));
 invalidTargets[0]={...invalidTargets[0],evidence_targets:[{label:'wrong book',book_id:'7',pages:[14]}]};
 assert.throws(()=>validateSuite({...suite,cases:invalidTargets}),/must belong to a required source group/);
});

test('selected-book benchmark covers all six subject areas without changing all-books cases',async()=>{
 const suite=validateSuite(JSON.parse(await readFile(SELECTED_SUITE_PATH,'utf8')));
 assert.equal(suite.suite_id,'antilogicalism-reading-companion-selected-book-v1');
 assert.equal(suite.cases.length,7);
 assert.deepEqual(new Set(suite.cases.map(item=>item.discipline)),new Set(['science','history','literature','philosophy','politics-society','religion']));
 assert.ok(suite.cases.every(item=>/^[1-9]\d{0,3}$/.test(item.selected_book_id)));
 assert.ok(suite.cases.every(item=>item.required_source_groups.some(group=>
  group.book_ids.map(String).includes(String(item.selected_book_id)))));
 assert.ok(suite.cases.some(item=>item.id==='selected-philosophy-aristotle-habituation'));
});

test('selected-book evaluation constrains every search facet to the requested book',async()=>{
 const text='Virtue is produced and destroyed by the same means, habituation.';
 const drive=`https://drive.google.com/file/d/${DRIVE}/view`;
 const source={id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:14,globalPageId:0,
  url:drive+'?usp=sharing#page=14',preview:text,score:10};
 const manifest={page_books:['7'],books:{'7':{title:source.title,drive_url:drive}}};
 const sha256=createHash('sha256').update(Buffer.from(text,'utf8')).digest('hex');
 const packet={schema:'antilogicalism-reader-fingerprints-v1',hashAlgorithm:'SHA-256-utf8-exact',
  libraryVersion:47,bookId:'7',chunk:0,pages:[{page:14,globalPageId:0,utf8Bytes:Buffer.byteLength(text),sha256}]};
 const scopeArgs=[];
 const library={search:async(query,options)=>{scopeArgs.push(options);return {sources:[source],booksScanned:1};},
  jsonGzip:async()=>({pages:[{id:0,page:14,text}]})};
 const item={id:'selected-aristotle-test',discipline:'philosophy',task:'mechanism-explanation',
  selected_book_id:'7',question:'How does Aristotle explain becoming virtuous through repeated actions?',
  planner_queries:['Aristotle virtue habituation','Aristotle moral character actions'],
  required_source_groups:[{label:'Nicomachean Ethics',book_ids:['7']}]};
 const result=await evaluateCase(item,{library,manifest,allowedBookIds:new Set(['7']),
  fetcher:async()=>new Response(JSON.stringify(packet),{status:200})});
 assert.equal(scopeArgs.length,3);
 assert.ok(scopeArgs.every(options=>options.allowedBookIds.size===1&&options.allowedBookIds.has('7')&&options.pagesPerBook===4));
 assert.equal(result.retrievalPass,true);
 assert.equal(result.candidateSourcesVerified,true);
 assert.equal(result.sourceIdentityIssues.length,0);
});

test('selected-book evaluation fails if retrieval leaks a passage from another book',async()=>{
 const text='A passage returned from an unrelated work must fail selected-book scope.';
 const drive=`https://drive.google.com/file/d/${DRIVE}/view`;
 const source={id:'S1',bookId:'12',title:'Politics — Aristotle',page:14,globalPageId:0,
  url:drive+'?usp=sharing#page=14',preview:text,score:10};
 const manifest={page_books:['12'],books:{'12':{title:source.title,drive_url:drive}}};
 const sha256=createHash('sha256').update(Buffer.from(text,'utf8')).digest('hex');
 const packet={schema:'antilogicalism-reader-fingerprints-v1',hashAlgorithm:'SHA-256-utf8-exact',
  libraryVersion:47,bookId:'12',chunk:0,pages:[{page:14,globalPageId:0,utf8Bytes:Buffer.byteLength(text),sha256}]};
 const library={search:async()=>({sources:[source],booksScanned:1}),jsonGzip:async()=>({pages:[{id:0,page:14,text}]})};
 const item={id:'selected-book-scope-leak',discipline:'philosophy',task:'scope-check',
  selected_book_id:'7',question:'How does Aristotle explain becoming virtuous through repeated actions?',
  planner_queries:['Aristotle virtue habituation','Aristotle moral character actions'],
  required_source_groups:[{label:'Nicomachean Ethics',book_ids:['7','12']}]};
 const result=await evaluateCase(item,{library,manifest,allowedBookIds:new Set(['12']),
  fetcher:async()=>new Response(JSON.stringify(packet),{status:200})});
 assert.equal(result.retrievalPass,false);
 assert.ok(result.sourceIdentityIssues.some(issue=>issue.code==='selected_book_scope_leak'));
});

test('the production facet merger preserves both facets and ranks stronger passage evidence first',()=>{
 const page=(bookId,page,score)=>({bookId,page,score,title:'Primary source',preview:'A sufficiently long passage preview.',url:`https://drive.google.com/file/d/${DRIVE}/view#page=${page}`});
 const result=mergeFacetSearches([
  {sources:[page('7',14,64),page('12',117,55)]},
  {sources:[page('529',495,84),page('547',215,45)]},
 ],8);
 assert.deepEqual(result.map(x=>x.bookId),['529','7','12','547']);
 assert.deepEqual(result.slice(0,2).map(x=>x.facet),[1,0]);
});

test('public retrieval evaluation searches both planner facets and exact question',async()=>{
 const text='Virtue is produced through habit; by doing just acts we become just.';
 const url=`https://drive.google.com/file/d/${DRIVE}/view?usp=sharing#page=14`;
 const manifest={page_books:['7'],books:{'7':{title:'Nicomachean Ethics — Aristotle',
  drive_url:`https://drive.google.com/file/d/${DRIVE}/view`}}};
 const source={id:'S1',bookId:'7',title:manifest.books['7'].title,page:14,globalPageId:0,
  url,preview:text,score:10};
 const plan=['Aristotle virtue habituation','Aristotle moral character actions'];
 const question='How does Aristotle explain becoming virtuous through repeated actions?';
 const searched=[];
 const library={search:async(query)=>{searched.push(query);return {sources:[source],booksScanned:1};},
  jsonGzip:async()=>({pages:[{id:0,page:14,text}]})};
 const sha256=createHash('sha256').update(Buffer.from(text,'utf8')).digest('hex');
 const packet={schema:'antilogicalism-reader-fingerprints-v1',hashAlgorithm:'SHA-256-utf8-exact',
  libraryVersion:47,bookId:'7',chunk:0,pages:[{page:14,globalPageId:0,utf8Bytes:Buffer.byteLength(text),sha256}]};
 const item={id:'aristotle-habituation',discipline:'philosophy',task:'mechanism-explanation',
  question,planner_queries:plan,required_source_groups:[{label:'Aristotle',book_ids:['7']}],
  evidence_targets:[{label:'Habituation passage',book_id:'7',pages:[14]}]};
 const result=await evaluateCase(item,{library,manifest,allowedBookIds:new Set(['7']),
  fetcher:async()=>new Response(JSON.stringify(packet),{status:200})});
 assert.deepEqual(searched,[...plan,question]);
 assert.deepEqual(result.searchQueries,[...plan,question]);
 assert.equal(result.retrievalPass,true);
 assert.equal(result.candidateEvidenceTargetRecallPercent,100);
 assert.equal(result.selectedEvidenceTargetRecallPercent,100);
 assert.equal(result.selectedExactTargetMatchPercent,100);
 assert.deepEqual(result.submittedSources.map(source=>source.page),[14]);
 assert.equal(result.unannotatedSubmittedSourceCount,0);
});

test('fourth per-book search result can reach the verified answer-source set',async()=>{
 const text='The event horizon marks the boundary beyond which light cannot escape.';
 const drive='https://drive.google.com/file/d/1JvAh83Yp-Tk3UIflSu6uy1sY_iWZFxvw/view';
 const source={id:'S1',bookId:'102',title:'A Brief History of Time — Stephen Hawking',page:53,globalPageId:11232,
  url:drive+'?usp=sharing#page=53',preview:text,score:10};
 const pageBooks=Array(11233).fill('102');
 const manifest={page_books:pageBooks,books:{'102':{title:source.title,drive_url:drive}}};
 const sha256=createHash('sha256').update(Buffer.from(text,'utf8')).digest('hex');
 const packet={schema:'antilogicalism-reader-fingerprints-v1',hashAlgorithm:'SHA-256-utf8-exact',
  libraryVersion:47,bookId:'102',chunk:1,pages:[{page:53,globalPageId:11232,utf8Bytes:Buffer.byteLength(text),sha256}]};
 const optionsSeen=[];
 const library={search:async(_query,options)=>{optionsSeen.push(options);return options.pagesPerBook===4?{sources:[source],booksScanned:1}:{sources:[],booksScanned:1};},
  jsonGzip:async()=>({pages:[{id:11232,page:53,text}]})};
 const item={id:'hawking-page-depth',discipline:'science',task:'event-horizon',
  question:'In A Brief History of Time, how does Hawking define the event horizon?',
  planner_queries:['Hawking event horizon boundary light cannot escape','A Brief History of Time definition of event horizon'],
  required_source_groups:[{label:'Hawking',book_ids:['102']}],
  evidence_targets:[{label:'Event horizon definition',book_id:'102',pages:[53]}]};
 const result=await evaluateCase(item,{library,manifest,allowedBookIds:new Set(['102']),
  fetcher:async()=>new Response(JSON.stringify(packet),{status:200})});
 assert.equal(optionsSeen.length,3);
 assert.ok(optionsSeen.every(options=>options.pagesPerBook===4));
 assert.ok(optionsSeen.every(options=>options.maxBooks===3));
 assert.equal(result.selectedEvidenceTargetRecallPercent,100);
 assert.equal(result.submittedSources[0].page,53);
});

test('source identity audit checks global ID, title, PDF ID and page anchor',()=>{
 const manifest={page_books:['7'],books:{'7':{title:'Nicomachean Ethics — Aristotle',drive_url:`https://drive.google.com/file/d/${DRIVE}/view`}}};
 const source={bookId:'7',title:manifest.books['7'].title,page:14,globalPageId:0,
  url:`https://drive.google.com/file/d/${DRIVE}/view?usp=sharing#page=14`,preview:'A sufficiently long source passage preview.'};
 assert.deepEqual(sourceIdentityIssues(source,manifest),[]);
 assert.ok(sourceIdentityIssues({...source,globalPageId:4},manifest).includes('wrong_global_page_book'));
 assert.ok(sourceIdentityIssues({...source,url:`https://drive.google.com/file/d/BadPdfIdentifier123/view#page=13`},manifest).includes('wrong_pdf'));
});

test('exact page fingerprint is checked against the retrieved indexed text',async()=>{
 const text='Virtue is produced and destroyed by the same means, habituation.';
 const sha256=createHash('sha256').update(Buffer.from(text,'utf8')).digest('hex');
 const page={id:0,page:14,text};
 const library={jsonGzip:async name=>{
  assert.equal(name,'book-7.json');
  return {pages:[page]};
 }};
 const packet={schema:'antilogicalism-reader-fingerprints-v1',hashAlgorithm:'SHA-256-utf8-exact',
  libraryVersion:47,bookId:'7',chunk:0,pages:[{page:14,globalPageId:0,utf8Bytes:Buffer.byteLength(text),sha256}]};
 const fetcher=async()=>new Response(JSON.stringify(packet),{status:200,headers:{'Content-Type':'application/json'}});
 const source={bookId:'7',page:14,globalPageId:0};
 assert.deepEqual(await verifyFingerprint(source,library,new Set(['7']),fetcher),
  {ok:true,status:'verified',utf8Bytes:Buffer.byteLength(text),sha256});
 const changed={...packet,pages:[{...packet.pages[0],sha256:'0'.repeat(64)}]};
 const bad=await verifyFingerprint(source,library,new Set(['7']),async()=>new Response(JSON.stringify(changed)));
 assert.equal(bad.status,'fingerprint-mismatch');
});

test('summary reports retrieval, default-selection, and verified-source coverage separately',()=>{
 const result=summarize([
  {retrievalPass:true,defaultSelectionPass:false,candidateSourcesVerified:true,defaultSelectionVerified:false,
   elapsedMs:20,sourceIdentityIssues:[],fingerprintChecks:[],requiredSourceGroups:[
    {retrieved:true,defaultSelected:false,sourceVerified:true,defaultSourceVerified:false}]},
 ]);
 assert.equal(result.retrievalPassCases,1);
 assert.equal(result.defaultSelectionPassCases,0);
 assert.equal(result.candidateGroupRecallPercent,100);
 assert.equal(result.defaultSelectedGroupRecallPercent,0);
 assert.equal(result.verifiedCandidateGroupRecallPercent,100);
 assert.equal(result.verifiedDefaultGroupRecallPercent,0);
});

test('summary distinguishes exact annotated-page matches from submitted pages without annotations',()=>{
 const result=summarize([
  {elapsedMs:1,sourceIdentityIssues:[],fingerprintChecks:[],requiredSourceGroups:[],
   evidenceTargets:[{candidateHit:true,selectedHit:true,bookId:'7',pages:[14]}],
   submittedSources:[{bookId:'7',page:14},{bookId:'7',page:15}]},
 ]);
 assert.equal(result.evidenceTargetCount,1);
 assert.equal(result.candidateEvidenceTargetRecallPercent,100);
 assert.equal(result.selectedEvidenceTargetRecallPercent,100);
 assert.equal(result.selectedExactTargetMatchPercent,50);
 assert.equal(result.unannotatedSubmittedSourceCount,1);
});

test('evaluation mirrors production source selection and covers distinct works before alternate pages',()=>{
 const candidates=[
  {bookId:'54',page:19,text:'Nietzsche source page one with enough usable text.'},
  {bookId:'144',page:84,text:'Another Nietzsche work with relevant evidence.'},
  {bookId:'436',page:248,text:'A relevant Kierkegaard source page.'},
  {bookId:'54',page:9,text:'An alternate page from the first Nietzsche work.'},
 ];
 const selected=selectEvaluationAnswerSources(candidates,'Compare Nietzsche and Kierkegaard');
 assert.deepEqual(selected.map(source=>source.bookId),['54','144','436','54']);
});
