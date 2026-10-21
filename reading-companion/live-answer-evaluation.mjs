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
const QUALITY_CASES=[
 {id:'quality-science-darwin-selection',discipline:'science',question:"According to Darwin's On the Origin of Species, how does natural selection operate, and what roles do inherited variation and the struggle for existence play?",selected_book_ids:['529'],planner_queries:['Darwin natural selection preservation beneficial variations survival reproduction','Origin of species variation inheritance struggle for existence Darwin'],required_source_groups:[{label:'Darwin, On the Origin of Species',book_ids:['529']}],review_focus:['Explain the mechanism linking inherited variation to differential survival and reproduction.','Distinguish Darwin’s account from a claim that organisms consciously adapt.']},
 {id:'quality-history-thucydides-causes',discipline:'history',question:'According to Thucydides, what were the underlying causes of the Peloponnesian War, and how did they differ from the immediate disputes that preceded it?',selected_book_ids:['152'],planner_queries:['Thucydides real cause growth Athenian power fear Lacedaemon','Thucydides immediate disputes Corcyra Potidaea grievances'],required_source_groups:[{label:'Thucydides',book_ids:['152']}],review_focus:['Separate the underlying cause from the immediate disputes.','Support both parts with passages from Thucydides, without treating them as interchangeable.']},
 {id:'quality-literature-dostoevsky-raskolnikov',discipline:'literature',question:'In Crime and Punishment, how does Raskolnikov try to justify murder, and how does the novel test or undermine his reasoning?',selected_book_ids:['114'],planner_queries:['Raskolnikov extraordinary men right to transgress law murder','Crime and Punishment Raskolnikov guilt suffering confession theory'],required_source_groups:[{label:'Dostoevsky, Crime and Punishment',book_ids:['114']}],review_focus:['Describe Raskolnikov’s theory as the character’s argument, not as Dostoevsky’s endorsed view.','Explain how later events in the novel complicate that theory.']},
 {id:'quality-philosophy-aristotle-practical-wisdom',discipline:'philosophy',question:"According to Aristotle's Nicomachean Ethics, what is practical wisdom, and how does it differ from scientific knowledge and skill?",selected_book_ids:['7'],planner_queries:['Aristotle Nicomachean Ethics definition phronesis practical wisdom deliberation human good','Aristotle Nicomachean Ethics phronesis episteme techne variable action making'],required_source_groups:[{label:'Aristotle, Nicomachean Ethics',book_ids:['7']}],review_focus:['Define practical wisdom as a reasoned capacity concerned with human good and action.','Explain why it is not science (variable, deliberable matters rather than necessary demonstrations) or craft (action differs from making).']},
 {id:'quality-all-books-cross-work-science',discipline:'science',question:'How does Darwin explain natural selection preserving favorable variations in On the Origin of Species, and how does Hawking use astronomical observations to support an explanation of black-hole phenomena in A Brief History of Time?',selected_book_ids:[],planner_queries:['Darwin Origin of Species natural selection favorable inherited variations struggle for existence','Hawking A Brief History of Time black hole evidence observations Cygnus X-1 X-rays'],required_source_groups:[{label:'Darwin',book_ids:['529']},{label:'Hawking',book_ids:['102']}],review_focus:['Compare each author’s use of observation and explanation.','Cite evidence from both named works; avoid implying the authors use identical methods.']},
 {id:'quality-all-books-cross-discipline-order',discipline:'philosophy',question:'How does Aristotle describe the aim of political science in the Nicomachean Ethics, and what role does Hobbes give common power in Leviathan? How do these accounts differ?',selected_book_ids:[],planner_queries:['Aristotle Nicomachean Ethics political science human good citizens good obedient laws','Hobbes Leviathan state of nature common power keep them in awe war every man against every man'],required_source_groups:[{label:'Aristotle, Nicomachean Ethics',book_ids:['7']},{label:'Hobbes, Leviathan',book_ids:['163']}],review_focus:['Represent each author’s account in its own terms and identify a meaningful difference.','Ground the comparison in both works instead of importing unsupported modern claims.']},
 {id:'quality-all-books-religion-scripture',discipline:'religion',question:'According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?',selected_book_ids:[],planner_queries:['1 John 4:7-12 God is love sent Son love one another passage','1 John 4:7-12 love of God revealed in Christ command love one another'],required_source_groups:[{label:'1 John 4:7–12',book_ids:['638']}],review_focus:['Explain the passage’s connection between God’s prior love and the command to love one another.','Stay close to the passage and distinguish its claims from later theological interpretation.']},
];
const CALL_GAP_MS=30_500;
const MAX_PAGE_BYTES=14_000;

export function selectLiveCases(suite,mode='smoke'){
 if(mode==='quality')return QUALITY_CASES.map(item=>({...item,selected_book_ids:[...item.selected_book_ids],planner_queries:[...item.planner_queries],required_source_groups:item.required_source_groups.map(group=>({...group,book_ids:[...group.book_ids]})),review_focus:[...item.review_focus]}));
 if(mode==='smoke'){
  const selected=SMOKE_CASE_IDS.map(id=>suite.cases.find(item=>item.id===id));
  if(selected.some(item=>!item))throw Error('The live smoke cases are missing from the retrieval suite.');
  return [...LIVE_CASES,...selected];
 }
 if(mode==='full')return [...suite.cases];
 throw Error('Mode must be smoke, quality, or full.');
}
function normalizeDiagnosticExcerpt(value){
 return String(value||'').normalize('NFKC')
  .replace(/[’‘]/g,"'").replace(/[“”]/g,'"')
  .replace(/…|\.\.\./g,' ')
  .replace(/\s+/g,' ').trim().toLocaleLowerCase();
}
function locateHighlightInSubmittedPage(item,citations,submitted){
 const sourceId=String(item?.source_id||item?.sourceId||'');
 const page=Number(item?.page);
 const citation=citations.find(value=>String(value?.id||'')===sourceId&&
  Number(value?.page)===page);
 const original=citation&&submitted.find(value=>
  String(value?.bookId||'')===String(citation.bookId||'')&&
  Number(value?.page)===page);
 if(typeof original?.text!=='string'||typeof item?.quote!=='string')return null;
 const quote=item.quote.replace(/^(?:…|\.\.\.)\s*/,'')
  .replace(/\s*(?:…|\.\.\.)$/,'').trim();
 const normalizedQuote=normalizeDiagnosticExcerpt(quote);
 if(normalizedQuote.length<24)return null;
 return normalizeDiagnosticExcerpt(original.text).includes(normalizedQuote);
}
export function auditLiveAnswer(data,submitted,requiredGroups){
 const citations=Array.isArray(data?.citations)?data.citations:[];
 const workerVersionId=typeof data?.workerVersionId==='string'&&data.workerVersionId.length<=128?data.workerVersionId:null;
 const workerSourceBuild=typeof data?.workerSourceBuild==='string'&&data.workerSourceBuild.length<=128?data.workerSourceBuild:null;
 const answer=String(data?.answer||'');
 const inline=[...answer.matchAll(/\[(S\d+)\]/g)].map(match=>match[1]);
 const citationIds=new Set(citations.map(source=>String(source?.id||'')));
 const missingInline=[...new Set(inline.filter(id=>!citationIds.has(id)))];
 const citationBookIds=[...new Set(citations.map(source=>String(source?.bookId||'')))];
 const submittedBookIds=[...new Set(submitted.map(source=>String(source?.bookId||'')))];
 const sourceGroups=requiredGroups.map(group=>{
  const expectedBookIds=group.book_ids.map(String);
  const retrievedBookIds=submittedBookIds.filter(id=>expectedBookIds.includes(id));
  const citedBookIds=citationBookIds.filter(id=>expectedBookIds.includes(id));
  const retrieved=submitted.some(source=>expectedBookIds.includes(String(source?.bookId||'')));
  const cited=citations.some(source=>expectedBookIds.includes(String(source?.bookId||'')));
  return {label:group.label,expectedBookIds,retrievedBookIds,citedBookIds,foundBookIds:citedBookIds,retrieved,cited,found:cited};
 });
 const highlights=Array.isArray(data?.evidenceHighlights)?data.evidenceHighlights:[];
 const citationSources=citations.map(source=>({id:String(source?.id||''),bookId:String(source?.bookId||''),
  title:String(source?.title||''),page:Number.isSafeInteger(source?.page)?source.page:null,
  globalPageId:Number.isSafeInteger(source?.globalPageId)?source.globalPageId:null,
  url:typeof source?.url==='string'?source.url:''}));
 const questionParts=Array.isArray(data?.questionParts)?data.questionParts:[];
 const evidenceMap=Array.isArray(data?.evidenceMap)?data.evidenceMap:[];
 const questionPartCoverage={total:questionParts.length,
  supported:questionParts.filter(item=>item?.status==='supported').length,
  partial:questionParts.filter(item=>item?.status==='partial').length,
  unsupported:questionParts.filter(item=>item?.status==='unsupported').length};
 const evidenceHighlights=highlights.map(item=>({sourceId:String(item?.source_id||item?.sourceId||''),
  title:String(item?.title||''),page:Number.isSafeInteger(item?.page)?item.page:null,
  quote:typeof item?.quote==='string'?item.quote:'',
  quoteLocated:typeof item?.quoteLocated==='boolean'?item.quoteLocated:
   locateHighlightInSubmittedPage(item,citations,submitted)}));
 return {workerVersionId,workerSourceBuild,outcome:String(data?.outcome||''),coverage:String(data?.coverage||''),reviewStatus:String(data?.reviewStatus||''),
  answerText:answer,citationCount:citations.length,citationBookIds,citationSources,inlineCitationCount:inline.length,
  inlineIdsWithoutSource:missingInline,submittedSourceCount:submitted.length,
  sourceGroups,questionParts,questionPartCoverage,evidenceMap,
  evidenceHighlightCount:highlights.length,evidenceHighlights,
  passed:String(data?.coverage||'')==='full'&&sourceGroups.every(group=>group.found)&&missingInline.length===0&&citations.length>0};
}
function safeHeaders(token){return {authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json',origin:'https://jsynon.github.io'};}
function attachRequestFailure(error,stage,details={}){
 const wrapped=error instanceof Error?error:new Error(String(error));
 wrapped.requestFailure={stage,httpStatus:Number.isSafeInteger(details.httpStatus)?details.httpStatus:null,
  failureCode:String(details.failureCode||'request-failed').slice(0,80),
  message:String(details.message||wrapped.message||'Request failed').replace(/(?:bearer\s+)[^\s]+/ig,'Bearer [redacted]').slice(0,240),
  workerFailure:details.workerFailure===true,
  workerVersionId:typeof details.workerVersionId==='string'&&details.workerVersionId.length<=128?details.workerVersionId:null,
  workerSourceBuild:typeof details.workerSourceBuild==='string'&&details.workerSourceBuild.length<=128?details.workerSourceBuild:null};
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
  httpStatus:response.status,failureCode:String(data?.failureCode||'http-error'),workerFailure:true,
  workerVersionId:data?.workerVersionId,workerSourceBuild:data?.workerSourceBuild});
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
 const selectedBookIds=Array.isArray(item.selected_book_ids)?item.selected_book_ids.map(String):[];
 const selectedAllowed=new Set(selectedBookIds.filter(id=>allowed.has(id)));
 if(selectedBookIds.length&&selectedAllowed.size!==selectedBookIds.length)
  throw Error('The selected-book scope contains a book absent from the published corpus.');
 const namedBookIds=matchExplicitBookIds(item.question,bookCatalog);
 const targetBookIds=selectedBookIds.length?selectedBookIds:(namedBookIds.length?namedBookIds:[null]);
 const retrievalAllowed=selectedBookIds.length?selectedAllowed:allowed;
 const searchSets=await Promise.all(searchQueries.map(async query=>{
  const targeted=await Promise.all(targetBookIds.map(bookId=>
   library.search(query,{...(bookId?{bookId}:{}),allowedBookIds:retrievalAllowed,maxBooks:2,pagesPerBook:3})));
  return {sources:targeted.flatMap(set=>Array.isArray(set.sources)?set.sources:[])
   .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0))};
 }));
 const candidates=mergeFacetSearches(searchSets,8),populated=[];
 for(const source of candidates){
  if(!retrievalAllowed.has(String(source.bookId)))continue;
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
export async function evaluateLiveCase(item,{library,manifest,allowed,token,fetcher=fetch,beforeCall=async()=>{},useFixedQueries=false}){
 const startTime=Date.now();
 let plan,queries,plannerFallback=false,plannerFailure=null,plannerSkipped=false,
  plannerWorkerVersionId=null,plannerWorkerSourceBuild=null;
 if(useFixedQueries&&validSearchPlan(item.planner_queries)){
  queries=item.planner_queries;
  plannerSkipped=true;
 }else try{
  plan=await callJson(fetcher,API+'/api/pilot-plan',token,{question:item.question,bookId:'',history:[],turnstileToken:'evaluation-runner-token'},beforeCall,'planner');
  if(!validSearchPlan(plan?.queries)){
   const error=attachRequestFailure(new Error('Planner returned an invalid search plan.'),'planner',{httpStatus:200,failureCode:'invalid-response',workerFailure:false});
   throw error;
  }
  queries=plan.queries;
  plannerWorkerVersionId=plan.workerVersionId||null;
  plannerWorkerSourceBuild=plan.workerSourceBuild||null;
 }catch(error){
  if(!error.requestFailure)error.requestFailure={stage:'planner',httpStatus:null,failureCode:'planner-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  const failure=error.requestFailure;
  plannerWorkerVersionId=failure.workerVersionId||null;
  plannerWorkerSourceBuild=failure.workerSourceBuild||null;
  if(!canFallbackToDirectSearch(failure.httpStatus,failure.failureCode))throw error;
  plannerFallback=true;
  plannerFailure={httpStatus:failure.httpStatus,failureCode:failure.failureCode};
  queries=[item.question];
 }
 let loaded;
 try{loaded=await loadSources(item,queries,{library,manifest,allowed,directFallback:plannerFallback});}
 catch(error){error.requestFailure={stage:'retrieval',httpStatus:null,failureCode:'retrieval-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  error.requestFailure.plannerFallback=plannerFallback;
  error.requestFailure.plannerSkipped=plannerSkipped;
  error.requestFailure.plannerWorkerVersionId=plannerWorkerVersionId;
  error.requestFailure.plannerWorkerSourceBuild=plannerWorkerSourceBuild;
  if(plannerFailure)error.requestFailure.plannerFailure=plannerFailure;throw error;}
 const {selected,searches}=loaded;
 let data;
 try{data=await callJson(fetcher,API+'/api/pilot-answer',token,{question:item.question,history:[],turnstileToken:'evaluation-runner-token',
  sources:selected.map(({bookId,page,text})=>({bookId,page,text}))},beforeCall,'answer');}
 catch(error){if(!error.requestFailure)error.requestFailure={stage:'answer',httpStatus:null,failureCode:'answer-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  error.requestFailure.plannerFallback=plannerFallback;
  error.requestFailure.plannerSkipped=plannerSkipped;
  error.requestFailure.plannerWorkerVersionId=plannerWorkerVersionId;
  error.requestFailure.plannerWorkerSourceBuild=plannerWorkerSourceBuild;
  if(plannerFailure)error.requestFailure.plannerFailure=plannerFailure;throw error;}
 const audit=auditLiveAnswer(data,selected,item.required_source_groups);
 return {id:item.id,question:item.question,discipline:item.discipline||'',selectedBookIds:Array.isArray(item.selected_book_ids)?item.selected_book_ids:[],
  reviewFocus:Array.isArray(item.review_focus)?item.review_focus:[],plannerSkipped,plannerQueries:plannerFallback?[]:queries,plannerFallback,
  plannerWorkerVersionId,plannerWorkerSourceBuild,answerWorkerVersionId:audit.workerVersionId,answerWorkerSourceBuild:audit.workerSourceBuild,
  ...(plannerFailure?{plannerFailure}:{}),searches,
  submittedSources:selected.map(({bookId,title,page,globalPageId})=>({bookId,title,page,globalPageId})),
  ...audit,elapsedMs:Date.now()-startTime};
}
function failedCaseResult(item,error){
 const failure=error?.requestFailure||{stage:'evaluation',httpStatus:null,failureCode:'evaluation-failed',
  message:String(error?.message||error||'Evaluation failed').slice(0,240),workerFailure:false};
 return {id:item.id,question:item.question,discipline:item.discipline||'',selectedBookIds:Array.isArray(item.selected_book_ids)?item.selected_book_ids:[],
  reviewFocus:Array.isArray(item.review_focus)?item.review_focus:[],requestFailure:failure,plannerQueries:[],plannerSkipped:failure.plannerSkipped===true,
  plannerWorkerVersionId:failure.plannerWorkerVersionId|| (failure.stage==='planner'?failure.workerVersionId:null),
  plannerWorkerSourceBuild:failure.plannerWorkerSourceBuild|| (failure.stage==='planner'?failure.workerSourceBuild:null),
  answerWorkerVersionId:failure.stage==='answer'?failure.workerVersionId:null,
  answerWorkerSourceBuild:failure.stage==='answer'?failure.workerSourceBuild:null,
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
 const args=parseArgs(process.argv.slice(2));if(args.help){console.log('Usage: PILOT_EVALUATION_TOKEN=... node reading-companion/live-answer-evaluation.mjs --confirm-live-ai true [--mode smoke|quality|full] [--output report.json]');return 0;}
 if(!args.confirm)throw Error('Live AI calls are disabled unless --confirm-live-ai true is provided.');
 const token=process.env.PILOT_EVALUATION_TOKEN;if(typeof token!=='string'||token.length<32)throw Error('PILOT_EVALUATION_TOKEN must be set to the configured evaluation secret.');
 if(args.mode==='full'&&process.env.CONFIRM_FULL_30!=='true')throw Error('The full 30-question live run also requires CONFIRM_FULL_30=true.');
 const suite=JSON.parse(await readFile(SUITE_PATH,'utf8'));
 const cases=selectLiveCases(suite,args.mode);
 const plannerCalls=args.mode==='quality'?0:cases.length;
 const report={schema:'antilogicalism-reading-companion-live-answer-eval-v1',generatedAt:new Date().toISOString(),mode:args.mode,
  caseCount:cases.length,estimatedWorkerAiCalls:plannerCalls+cases.length*2,
  callsPerCase:args.mode==='quality'?'0 planner + 2 baseline answer pipeline calls per case; conditional Worker repair calls may add to this estimate':'1 planner + 2 baseline answer pipeline calls per case; conditional Worker repair calls may add to this estimate',
  answerQualityNote:'Answer text and review_focus are provided for human assessment. Automated pass checks retrieval/citation structure, not factual or interpretive truth.',
  executionStatus:'initializing',completedCases:0,notRunCases:cases.length,requestFailureCases:0,plannerFallbackCases:0,plannerSkippedCases:0,workerVersionIds:[],stopReason:'',cases:[]};
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
  console.log('Starting explicitly confirmed '+args.mode+' live evaluation: '+cases.length+' questions; estimated at least '+report.estimatedWorkerAiCalls+' Worker inference calls, plus conditional repairs.');
  report.executionStatus='running';await saveReport();
  let previousCall=0;
  const beforeCall=async()=>{if(previousCall){const due=Math.max(0,CALL_GAP_MS-(Date.now()-previousCall));if(due)await new Promise(resolve=>setTimeout(resolve,due));}previousCall=Date.now();};
  const run=await runLiveCases(cases,{evaluateOptions:{library,manifest,allowed,token,beforeCall,useFixedQueries:args.mode==='quality'},onResult:async(result,results)=>{
   report.cases=results;report.completedCases=results.length;
   report.notRunCases=cases.length-results.length;
   report.requestFailureCases=results.filter(item=>item.requestFailure).length;
   report.plannerFallbackCases=results.filter(item=>item.plannerFallback).length;
   report.plannerSkippedCases=results.filter(item=>item.plannerSkipped).length;
   report.workerVersionIds=[...new Set(results.flatMap(item=>[item.plannerWorkerVersionId,item.answerWorkerVersionId]).filter(value=>typeof value==='string'&&value))];
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
   plannerFallbackCases:report.plannerFallbackCases,
   questionPartStatusCounts:report.cases.reduce((totals,item)=>{
    const counts=item.questionPartCoverage||{};
    for(const status of ['supported','partial','unsupported'])
     totals[status]+=Number(counts[status])||0;
    totals.total+=Number(counts.total)||0;
    return totals;
   },{total:0,supported:0,partial:0,unsupported:0})};
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
