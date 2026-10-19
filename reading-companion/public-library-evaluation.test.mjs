import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeFacetSearches} from './evidence-search.mjs';
import {evaluateCase,sourceIdentityIssues,summarize,validateSuite,verifyFingerprint} from './public-library-evaluation.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SUITE_PATH=resolve(ROOT,'benchmarks/reading-companion-public-v1.json');
const DRIVE='1XVInAFS2zutV8PDp8A3DirUrW6nLLfvY';

test('benchmark covers 30 fixed global questions across five subject areas',async()=>{
 const suite=validateSuite(JSON.parse(await readFile(SUITE_PATH,'utf8')));
 assert.equal(suite.cases.length,30);
 assert.deepEqual(new Set(suite.cases.map(c=>c.discipline)),new Set(['science','history','literature','philosophy','politics-society']));
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
});

test('the production facet merger preserves both facets and ranks stronger evidence first',()=>{
 const page=(bookId,page,score)=>({bookId,page,score,title:'Primary source',preview:'A sufficiently long passage preview.',url:`https://drive.google.com/file/d/${DRIVE}/view#page=${page}`});
 const result=mergeFacetSearches([
  {sources:[page('7',14,64),page('12',117,55)]},
  {sources:[page('529',495,84),page('547',215,45)]},
 ],8);
 assert.deepEqual(result.map(x=>x.bookId),['7','529','12','547']);
 assert.deepEqual(result.slice(0,2).map(x=>x.facet),[0,1]);
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
  question,planner_queries:plan,required_source_groups:[{label:'Aristotle',book_ids:['7']}]};
 const result=await evaluateCase(item,{library,manifest,allowedBookIds:new Set(['7']),
  fetcher:async()=>new Response(JSON.stringify(packet),{status:200})});
 assert.deepEqual(searched,[...plan,question]);
 assert.deepEqual(result.searchQueries,[...plan,question]);
 assert.equal(result.retrievalPass,true);
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
