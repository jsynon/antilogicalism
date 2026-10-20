#!/usr/bin/env node
/* Explicit, metered end-to-end evaluation against the public Reading Companion
 * Worker. This is never run by the PR or scheduled retrieval-only workflow.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RemoteLibrary,DEFAULT_INDEX_ROOT} from './remote-library.mjs';
import {mergeFacetSearches,validSearchPlan,buildSearchFacets,selectAnswerSources,canFallbackToDirectSearch,matchExplicitBookIds} from './evidence-search.mjs';

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
function attachRequestFailure(error,stage,details={}){
 const wrapped=error instanceof Error?error:new Error(String(error));
 wrapped.requestFailure={stage,httpStatus:Number.isSafeInteger(details.httpStatus)?details.httpStatus:null,
  failureCode:String(details.failureCode||'request-failed').slice(0,80),
  message:String(details.message||wrapped.message||'Request failed').replace(/(?:bearer\s+)[^\s]+/ig,'Bearer [redacted]').slice(0,240),
  workerFailure:details.workerFailure===true};
 return wrapped;
}
async function callJson(fetcher,url,token,body,beforeCall=async()=>{},stage='worker-request'){
 await beforeCall();
 let response;
 try{response=await fetcher(url,{method:'POST',headers:safeHeaders(token),body:JSON.stringify(body)});}
 catch(error){throw attachRequestFailure(error,stage,{failureCode:'network-error',workerFailure:true});}
 let data;try{data=await response.json();}catch{
  throw attachRequestFailure(new Error('Worker returned invalid JSON.'),stage,{httpStatus:response.status,failureCode:'invalid-json',workerFailure:true});
 }
 if(!response.ok)throw attachRequestFailure(new Error(String(data?.failureCode||data?.error||'Worker request failed').slice(0,240)),stage,{
  httpStatus:response.status,failureCode:String(data?.failureCode||'http-error'),workerFailure:true});
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
async function loadSources(item,queries,{library,manifest,allowed,directFallback=false}){
 if(directFallback){
  if(!Array.isArray(queries)||queries.length!==1||typeof queries[0]!=='string'||queries[0].trim().length<5||queries[0].trim().length>400)
   throw Error('Direct fallback requires the original 5–400 character question.');
 }else if(!validSearchPlan(queries))throw Error('Planner returned an invalid two-query plan.');
 const searchQueries=buildSearchFacets(item.question,queries);
 const bookCatalog=Object.entries(manifest.books).map(([id,book])=>({id,title:book.title}));
 const namedBookIds=matchExplicitBookIds(item.question,bookCatalog);
 const targetBookIds=namedBookIds.length?namedBookIds:[null];
 const searchSets=await Promise.all(searchQueries.map(async query=>{
  const targeted=await Promise.all(targetBookIds.map(bookId=>
   library.search(query,{...(bookId?{bookId}:{}),allowedBookIds:allowed,maxBooks:2,pagesPerBook:3})));
  return {sources:targeted.flatMap(set=>Array.isArray(set.sources)?set.sources:[])
   .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0))};
 }));
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
 return {selected,searches:searchSets.map((set,index)=>({query:searchQueries[index]+
  (namedBookIds.length?' [named books: '+namedBookIds.join(', ')+']':''),
  resultCount:set.sources?.length||0}))};
}
export async function evaluateLiveCase(item,{library,manifest,allowed,token,fetcher=fetch,beforeCall=async()=>{}}){
 const startTime=Date.now();
 let plan,queries,plannerFallback=false,plannerFailure=null;
 try{
  plan=await callJson(fetcher,API+'/api/pilot-plan',token,{question:item.question,bookId:'',history:[],turnstileToken:'evaluation-runner-token'},beforeCall,'planner');
  if(!validSearchPlan(plan?.queries)){
   const error=attachRequestFailure(new Error('Planner returned an invalid search plan.'),'planner',{httpStatus:200,failureCode:'invalid-response',workerFailure:false});
   throw error;
  }
  queries=plan.queries;
 }catch(error){
  if(!error.requestFailure)error.requestFailure={stage:'planner',httpStatus:null,failureCode:'planner-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  const failure=error.requestFailure;
  if(!canFallbackToDirectSearch(failure.httpStatus,failure.failureCode))throw error;
  plannerFallback=true;
  plannerFailure={httpStatus:failure.httpStatus,failureCode:failure.failureCode};
  queries=[item.question];
 }
 let loaded;
 try{loaded=await loadSources(item,queries,{library,manifest,allowed,directFallback:plannerFallback});}
 catch(error){error.requestFailure={stage:'retrieval',httpStatus:null,failureCode:'retrieval-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  error.requestFailure.plannerFallback=plannerFallback;if(plannerFailure)error.requestFailure.plannerFailure=plannerFailure;throw error;}
 const {selected,searches}=loaded;
 let data;
 try{data=await callJson(fetcher,API+'/api/pilot-answer',token,{question:item.question,history:[],turnstileToken:'evaluation-runner-token',
  sources:selected.map(({bookId,page,text})=>({bookId,page,text}))},beforeCall,'answer');}
 catch(error){if(!error.requestFailure)error.requestFailure={stage:'answer',httpStatus:null,failureCode:'answer-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  error.requestFailure.plannerFallback=plannerFallback;if(plannerFailure)error.requestFailure.plannerFailure=plannerFailure;throw error;}
 const audit=auditLiveAnswer(data,selected,item.required_source_groups);
 return {id:item.id,question:item.question,plannerQueries:plannerFallback?[]:queries,plannerFallback,
  ...(plannerFailure?{plannerFailure}:{}),searches,
  submittedSources:selected.map(({bookId,title,page,globalPageId})=>({bookId,title,page,globalPageId})),
  ...audit,elapsedMs:Date.now()-startTime};
}
function failedCaseResult(item,error){
 const failure=error?.requestFailure||{stage:'evaluation',httpStatus:null,failureCode:'evaluation-failed',
  message:String(error?.message||error||'Evaluation failed').slice(0,240),workerFailure:false};
 return {id:item.id,question:item.question,requestFailure:failure,plannerQueries:[],
  plannerFallback:failure.plannerFallback===true,...(failure.plannerFailure?{plannerFailure:failure.plannerFailure}:{}),searches:[],
  submittedSources:[],outcome:'request-failed',coverage:'none',reviewStatus:'request-failed',
  answerText:'',citationCount:0,citationBookIds:[],citationSources:[],inlineCitationCount:0,
  inlineIdsWithoutSource:[],submittedSourceCount:0,
  sourceGroups:(item.required_source_groups||[]).map(group=>({label:group.label,
   expectedBookIds:group.book_ids.map(String),foundBookIds:[],found:false})),
  evidenceHighlightCount:0,evidenceHighlights:[],passed:false,elapsedMs:0};
}
const TERMINAL_PROVIDER_FAILURES=new Set([
 'ai-daily-limit-reached','ai-capacity-unavailable','ai-rate-limited',
]);
export async function runLiveCases(cases,{evaluateCase=evaluateLiveCase,evaluateOptions={},onResult=async()=>{},maxConsecutiveWorkerFailures=2}={}){
 const results=[];let consecutiveWorkerFailures=0,stopReason='';
 for(const item of cases){
  let result;
  try{result=await evaluateCase(item,evaluateOptions);}
  catch(error){result=failedCaseResult(item,error);}
  results.push(result);
  await onResult(result,results);
  if(result.requestFailure?.workerFailure){
   if(TERMINAL_PROVIDER_FAILURES.has(result.requestFailure.failureCode)){
    stopReason='provider-limit-or-capacity';
    break;
   }
   consecutiveWorkerFailures++;
   if(consecutiveWorkerFailures>=maxConsecutiveWorkerFailures){stopReason='consecutive-worker-failures';break;}
  }else consecutiveWorkerFailures=0;
 }
 return {results,stopReason};
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
 const report={schema:'antilogicalism-reading-companion-live-answer-eval-v1',generatedAt:new Date().toISOString(),mode:args.mode,
  caseCount:cases.length,estimatedWorkerAiCalls:cases.length*3,
  callsPerCase:'1 planner + 2 answer pipeline calls; verify configured Worker implementation before interpreting credit use',
  executionStatus:'initializing',completedCases:0,notRunCases:cases.length,requestFailureCases:0,plannerFallbackCases:0,stopReason:'',cases:[]};
 const outputPath=args.output?resolve(args.output):'';
 const saveReport=async()=>{if(outputPath)await writeFile(outputPath,JSON.stringify(report,null,2)+'\n');};
 await saveReport();
 try{
  const results=await Promise.all([fetchJson(FINGERPRINT_ROOT+'coverage-v1.json'),new RemoteLibrary(DEFAULT_INDEX_ROOT,makeCachedFetch(DEFAULT_INDEX_ROOT)).manifest()]);
  const coverage=results[0],manifest=results[1];
  if(coverage?.schema!=='antilogicalism-reader-coverage-v1'||coverage?.libraryVersion!==47||manifest.version!==47)throw Error('Published v47 coverage or corpus is incompatible.');
  const allowed=new Set(Object.keys(coverage.books));
  for(const item of cases)for(const group of item.required_source_groups)if(!group.book_ids.some(id=>allowed.has(String(id))))throw Error(item.id+': no expected source book is fingerprint-covered.');
  const library=new RemoteLibrary(DEFAULT_INDEX_ROOT,makeCachedFetch(DEFAULT_INDEX_ROOT));
  console.log('Starting explicitly confirmed '+args.mode+' live evaluation: '+cases.length+' questions; estimated ~'+report.estimatedWorkerAiCalls+' Worker inference calls.');
  report.executionStatus='running';await saveReport();
  let previousCall=0;
  const beforeCall=async()=>{if(previousCall){const due=Math.max(0,CALL_GAP_MS-(Date.now()-previousCall));if(due)await new Promise(resolve=>setTimeout(resolve,due));}previousCall=Date.now();};
  const run=await runLiveCases(cases,{evaluateOptions:{library,manifest,allowed,token,beforeCall},onResult:async(result,results)=>{
   report.cases=results;report.completedCases=results.length;
   report.notRunCases=cases.length-results.length;
   report.requestFailureCases=results.filter(item=>item.requestFailure).length;
   report.plannerFallbackCases=results.filter(item=>item.plannerFallback).length;
   await saveReport();
   console.log((result.passed?'REVIEW-PASS':result.requestFailure?'REQUEST-FAIL':'REVIEW-MISS')+' '+result.id+': '+(result.outcome||result.requestFailure?.failureCode||'no outcome'));
  }});
  report.cases=run.results;report.stopReason=run.stopReason;
  report.notRunCases=cases.length-run.results.length;
  report.requestFailureCases=run.results.filter(item=>item.requestFailure).length;
  report.plannerFallbackCases=run.results.filter(item=>item.plannerFallback).length;
  report.executionStatus=report.requestFailureCases?'completed-with-request-failures':'completed';
  report.summary={passedCases:report.cases.filter(item=>item.passed).length,
   failedCases:report.cases.filter(item=>!item.passed).length,requestFailureCases:report.requestFailureCases,
   plannerFallbackCases:report.plannerFallbackCases};
  await saveReport();
  console.log('Done: '+report.summary.passedCases+'/'+report.caseCount+' cases met citation and expected-work checks; '+report.completedCases+' completed, '+report.notRunCases+' not run. This is a retrieval/citation review signal, not an AI truth grader.');
  return report.requestFailureCases?1:0;
 }catch(error){
  report.executionStatus=report.cases.length?'interrupted':'setup-failed';
  report.setupFailure={message:String(error?.message||error).slice(0,240)};
  report.completedCases=report.cases.length;report.notRunCases=cases.length-report.cases.length;
  await saveReport();throw error;
 }
}
if(import.meta.url===`file://${process.argv[1]}`)main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
