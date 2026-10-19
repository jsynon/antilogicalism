#!/usr/bin/env node
/* Explicit, metered end-to-end evaluation against the public Reading Companion
 * Worker. This is never run by the PR or scheduled retrieval-only workflow.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RemoteLibrary,DEFAULT_INDEX_ROOT} from './remote-library.mjs';
import {mergeFacetSearches,validSearchPlan,buildSearchFacets,selectAnswerSources} from './evidence-search.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SUITE_PATH=resolve(ROOT,'benchmarks/reading-companion-public-v1.json');
const FINGERPRINT_ROOT='https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v1/';
const API='https://antilogicalism-companion-public.jsynon.workers.dev';
const LIVE_CASES=[
 {id:'live-scripture-god-is-love',question:'According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?',planner_queries:['1 John 4:7–12 text God is love and love one another','1 John 4:7–12 God sent his Son love one another'],required_source_groups:[{label:'1 John Bible passage',book_ids:['638','646']}]},
];
const SMOKE_CASE_IDS=['science-hawking-black-holes','philosophy-aristotle-habituation'];
const CALL_GAP_MS=16_000;
const MAX_PAGE_BYTES=14_000;

export function selectLiveCases(suite,mode='smoke'){
 if(mode==='smoke'){
  const selected=SMOKE_CASE_IDS.map(id=>suite.cases.find(item=>item.id===id));
  if(selected.some(item=>!item))throw Error('The live smoke cases are missing from the retrieval suite.');
  return [...LIVE_CASES,...selected];
 }
 if(mode==='full')return [...suite.cases];
 throw Error('Mode must be smoke or full.');
}
export function auditLiveAnswer(data,submitted,requiredGroups){
 const citations=Array.isArray(data?.citations)?data.citations:[];
 const answer=String(data?.answer||'');
 const inline=[...answer.matchAll(/\[(S\d+)\]/g)].map(match=>match[1]);
 const citationIds=new Set(citations.map(source=>String(source?.id||'')));
 const missingInline=[...new Set(inline.filter(id=>!citationIds.has(id)))];
 const citationBookIds=[...new Set(citations.map(source=>String(source?.bookId||'')))];
 const sourceGroups=requiredGroups.map(group=>({label:group.label,
  expectedBookIds:group.book_ids.map(String),foundBookIds:citationBookIds.filter(id=>group.book_ids.map(String).includes(id)),
  found:citations.some(source=>group.book_ids.map(String).includes(String(source?.bookId||'')))}));
 const highlights=Array.isArray(data?.evidenceHighlights)?data.evidenceHighlights:[];
 const citationSources=citations.map(source=>({id:String(source?.id||''),bookId:String(source?.bookId||''),
  title:String(source?.title||''),page:Number.isSafeInteger(source?.page)?source.page:null,
  globalPageId:Number.isSafeInteger(source?.globalPageId)?source.globalPageId:null,
  url:typeof source?.url==='string'?source.url:''}));
 const evidenceHighlights=highlights.map(item=>({sourceId:String(item?.source_id||item?.sourceId||''),
  title:String(item?.title||''),page:Number.isSafeInteger(item?.page)?item.page:null,
  quote:typeof item?.quote==='string'?item.quote:'',
  quoteLocated:typeof item?.quoteLocated==='boolean'?item.quoteLocated:null}));
 return {outcome:String(data?.outcome||''),coverage:String(data?.coverage||''),reviewStatus:String(data?.reviewStatus||''),
  answerText:answer,citationCount:citations.length,citationBookIds,citationSources,inlineCitationCount:inline.length,
  inlineIdsWithoutSource:missingInline,submittedSourceCount:submitted.length,
  sourceGroups,evidenceHighlightCount:highlights.length,evidenceHighlights,
  passed:sourceGroups.every(group=>group.found)&&missingInline.length===0&&citations.length>0};
}
function safeHeaders(token){return {authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json',origin:'https://jsynon.github.io'};}
async function callJson(fetcher,url,token,body,beforeCall=async()=>{}){
 await beforeCall();
 const response=await fetcher(url,{method:'POST',headers:safeHeaders(token),body:JSON.stringify(body)});
 let data;try{data=await response.json();}catch{throw Error(`${url} returned invalid JSON (HTTP ${response.status}).`);}
 if(!response.ok)throw Error(`${url} returned HTTP ${response.status}: ${String(data?.error||data?.failureCode||'request failed')}`);
 return data;
}
function makeCachedFetch(root){
 const cache=new Map();
 return async(url,options)=>{
  const key=String(url);if(cache.has(key))return new Response(cache.get(key).slice(),{status:200});
  const response=await fetch(url,options);
  if(response.ok&&key.startsWith(root)){const bytes=new Uint8Array(await response.clone().arrayBuffer());cache.set(key,bytes);}
  return response;
 };
}
async function fetchJson(url){const response=await fetch(url,{headers:{accept:'application/json'},cache:'no-store'});if(!response.ok)throw Error(url+' returned HTTP '+response.status);return response.json();}
async function loadSources(item,queries,{library,manifest,allowed}){
 if(!validSearchPlan(queries))throw Error('Planner returned an invalid two-query plan.');
 const searchQueries=buildSearchFacets(item.question,queries);
 const searchSets=await Promise.all(searchQueries.map(query=>library.search(query,{allowedBookIds:allowed,maxBooks:2,pagesPerBook:3})));
 const candidates=mergeFacetSearches(searchSets,8),populated=[];
 for(const source of candidates){
  if(!allowed.has(String(source.bookId)))continue;
  const shard=await library.jsonGzip('book-'+String(source.bookId)+'.json');
  const pages=shard.pages?.filter(page=>page.id===source.globalPageId&&page.page===source.page)||[];
  if(pages.length!==1||typeof pages[0].text!=='string')continue;
  const bytes=Buffer.byteLength(pages[0].text,'utf8');
  if(bytes<25||bytes>MAX_PAGE_BYTES)continue;
  populated.push({...source,text:pages[0].text,byteLength:bytes});
 }
 if(!populated.length)throw Error('Retrieval returned no fingerprint-eligible source pages.');
 const selected=selectAnswerSources(populated,item.question,'evaluation-runner-token',{maxSources:4,maxBytes:30_000,history:[]});
 if(!selected.length)throw Error('No source pages fit the Worker request limit.');
 for(const source of selected){
  const book=manifest.books[String(source.bookId)];
  if(!book)throw Error('A selected source is absent from the published manifest.');
 }
 return {selected,searches:searchSets.map((set,index)=>({query:searchQueries[index],resultCount:set.sources?.length||0}))};
}
export async function evaluateLiveCase(item,{library,manifest,allowed,token,fetcher=fetch,beforeCall=async()=>{}}){
 const start=Date.now();
 const plan=await callJson(fetcher,API+'/api/pilot-plan',token,{question:item.question,bookId:'',history:[],turnstileToken:'evaluation-runner-token'},beforeCall);
 const queries=plan.queries;
 const {selected,searches}=await loadSources(item,queries,{library,manifest,allowed});
 const data=await callJson(fetcher,API+'/api/pilot-answer',token,{question:item.question,history:[],turnstileToken:'evaluation-runner-token',
  sources:selected.map(({bookId,page,text})=>({bookId,page,text}))},beforeCall);
 const audit=auditLiveAnswer(data,selected,item.required_source_groups);
 return {id:item.id,question:item.question,plannerQueries:queries,searches,
  submittedSources:selected.map(({bookId,title,page,globalPageId})=>({bookId,title,page,globalPageId})),
  ...audit,elapsedMs:Date.now()-start};
}
function parseArgs(argv){const out={mode:process.env.LIVE_EVAL_MODE||'smoke',output:process.env.LIVE_EVAL_OUTPUT||'',confirm:process.env.CONFIRM_LIVE_AI==='true'};
 for(let i=0;i<argv.length;i++){const [flag,inline]=argv[i].split('=',2),key=flag.replace(/^--/,'');if(flag==='--help'||flag==='-h'){out.help=true;continue;}
  if(!['mode','output','confirm-live-ai'].includes(key))throw Error('Unknown option '+flag);const value=inline??argv[++i];if(value===undefined)throw Error('Missing value for '+flag);
  if(key==='mode')out.mode=value;else if(key==='output')out.output=value;else out.confirm=value==='true';}
 return out;}
async function main(){
 const args=parseArgs(process.argv.slice(2));if(args.help){console.log('Usage: PILOT_EVALUATION_TOKEN=... node reading-companion/live-answer-evaluation.mjs --confirm-live-ai true [--mode smoke|full] [--output report.json]');return 0;}
 if(!args.confirm)throw Error('Live AI calls are disabled unless --confirm-live-ai true is provided.');
 const token=process.env.PILOT_EVALUATION_TOKEN;if(typeof token!=='string'||token.length<32)throw Error('PILOT_EVALUATION_TOKEN must be set to the configured evaluation secret.');
 if(args.mode==='full'&&process.env.CONFIRM_FULL_30!=='true')throw Error('The full 30-question live run also requires CONFIRM_FULL_30=true.');
 const suite=JSON.parse(await readFile(SUITE_PATH,'utf8'));
 const cases=selectLiveCases(suite,args.mode);
 const [coverage,manifest]=await Promise.all([fetchJson(FINGERPRINT_ROOT+'coverage-v1.json'),new RemoteLibrary(DEFAULT_INDEX_ROOT,makeCachedFetch(DEFAULT_INDEX_ROOT)).manifest()]);
 if(coverage?.schema!=='antilogicalism-reader-coverage-v1'||coverage?.libraryVersion!==47||manifest.version!==47)throw Error('Published v47 coverage or corpus is incompatible.');
 const allowed=new Set(Object.keys(coverage.books));
 for(const item of cases)for(const group of item.required_source_groups)if(!group.book_ids.some(id=>allowed.has(String(id))))throw Error(`${item.id}: no expected source book is fingerprint-covered.`);
 const library=new RemoteLibrary(DEFAULT_INDEX_ROOT,makeCachedFetch(DEFAULT_INDEX_ROOT)),report={schema:'antilogicalism-reading-companion-live-answer-eval-v1',generatedAt:new Date().toISOString(),mode:args.mode,caseCount:cases.length,estimatedWorkerAiCalls:cases.length*3,callsPerCase:'1 planner + 2 answer pipeline calls; verify configured Worker implementation before interpreting credit use',cases:[]};
 console.log(`Starting explicitly confirmed ${args.mode} live evaluation: ${cases.length} questions; estimated ~${report.estimatedWorkerAiCalls} Worker inference calls.`);
 let previousCall=0;
 const beforeCall=async()=>{if(previousCall){const due=Math.max(0,CALL_GAP_MS-(Date.now()-previousCall));if(due)await new Promise(resolve=>setTimeout(resolve,due));}previousCall=Date.now();};
 for(const item of cases){
  const result=await evaluateLiveCase(item,{library,manifest,allowed,token,beforeCall});report.cases.push(result);
  console.log(`${result.passed?'REVIEW-PASS':'REVIEW-MISS'} ${item.id}: ${result.outcome||'no outcome'}, ${result.citationCount} citations; source groups ${result.sourceGroups.filter(g=>g.found).length}/${result.sourceGroups.length}`);
 }
 report.summary={passedCases:report.cases.filter(item=>item.passed).length,failedCases:report.cases.filter(item=>!item.passed).length};
 if(args.output)await writeFile(resolve(args.output),JSON.stringify(report,null,2)+'\n');
 console.log(`Done: ${report.summary.passedCases}/${report.caseCount} cases met citation and expected-work checks. This is a retrieval/citation review signal, not an AI truth grader.`);
 return 0;
}
if(import.meta.url===`file://${process.argv[1]}`)main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
