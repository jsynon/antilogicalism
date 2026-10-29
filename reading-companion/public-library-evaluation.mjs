#!/usr/bin/env node
/* Automated, read-only evaluation of the production public-library retrieval.
 * Uses the same RemoteLibrary and mergeFacetSearches modules as the site.
 * Runs no model calls; every selected page is checked against its published
 * SHA-256 fingerprint before it counts as ready for the answer endpoint.
 */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RemoteLibrary,DEFAULT_INDEX_ROOT} from './remote-library.mjs';
import {mergeFacetSearches,validSearchPlan,buildSearchFacets,selectAnswerSources,LIVE_RETRIEVAL_CONFIG} from './evidence-search.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SUITE_PATH=resolve(ROOT,'benchmarks/reading-companion-public-v1.json');
const CATALOG_URL='https://raw.githubusercontent.com/jsynon/antilogicalism/main/digital-library/library-catalog.json';
const FINGERPRINT_ROOT='https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v3/';
const DEFAULT_OUTPUT='';
const PDF_ID=/^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})\/(?:view|preview)/;
const MAX_PAGE_BYTES=14000;

function parseArgs(argv){
 const out={suitePath:SUITE_PATH,corpusRoot:DEFAULT_INDEX_ROOT,catalogUrl:CATALOG_URL,coverageUrl:FINGERPRINT_ROOT+'coverage-v3.json',
   output:DEFAULT_OUTPUT,limit:0,caseIds:[]};
 for(let i=0;i<argv.length;i++){
  const raw=argv[i];if(raw==='--help'||raw==='-h'){out.help=true;continue;}
  const [flag,inline]=raw.split('=',2),key=flag.replace(/^--/,'');
  if(!['suite','corpus-root','catalog-url','coverage-url','output','limit','case'].includes(key))throw Error('Unknown option '+flag);
  const value=inline??argv[++i];if(!value)throw Error('Missing value for '+flag);
  if(key==='case'){out.caseIds.push(value);continue;}
  if(key==='suite')out.suitePath=resolve(value);
  else if(key==='limit'){out.limit=Number(value);if(!Number.isSafeInteger(out.limit)||out.limit<1)throw Error('--limit must be a positive integer');}
  else if(key==='corpus-root')out.corpusRoot=value.replace(/\/?$/,'/');
  else if(key==='catalog-url')out.catalogUrl=value;
  else if(key==='coverage-url')out.coverageUrl=value;
  else out.output=value;
 }
 return out;
}

export function validateSuite(suite){
 if(suite?.schema_version!==1||!['antilogicalism-reading-companion-public-v1',
    'antilogicalism-reading-companion-selected-book-v1'].includes(suite?.suite_id)||
    suite?.corpus_version!==49||!Array.isArray(suite.cases)||!suite.cases.length)
  throw Error('Expected a non-empty public-library v49 evaluation suite.');
 const seen=new Set();
 for(const item of suite.cases){
  if(!item||!/^[a-z][a-z0-9-]{2,79}$/.test(item.id||'')||seen.has(item.id))throw Error('Duplicate or invalid case ID: '+String(item?.id));
  seen.add(item.id);
  if(typeof item.question!=='string'||item.question.length<25||!validSearchPlan(item.planner_queries))throw Error(item.id+': question needs two valid planned searches.');
  if(!Array.isArray(item.required_source_groups)||!item.required_source_groups.length)throw Error(item.id+': expected source groups are required.');
  for(const group of item.required_source_groups)if(!group||typeof group.label!=='string'||!Array.isArray(group.book_ids)||!group.book_ids.length||group.book_ids.some(id=>!/^[1-9]\d{0,3}$/.test(String(id))))throw Error(item.id+': invalid expected source group.');
  if(item.evidence_targets!==undefined){
   if(!Array.isArray(item.evidence_targets))throw Error(item.id+': evidence_targets must be an array.');
   for(const target of item.evidence_targets){
    const bookId=String(target?.book_id||'');
    if(typeof target?.label!=='string'||!target.label.trim()||!/^\d{1,4}$/.test(bookId)||
       !Array.isArray(target.pages)||!target.pages.length||target.pages.some(page=>!Number.isSafeInteger(page)||page<1))
     throw Error(item.id+': invalid evidence target.');
    if(!item.required_source_groups.some(group=>group.book_ids.map(String).includes(bookId)))
     throw Error(item.id+': evidence target book must belong to a required source group.');
   }
  }
  if(item.selected_book_id!==undefined&&(!/^[1-9]\d{0,3}$/.test(String(item.selected_book_id))||
    item.required_source_groups.some(group=>!group.book_ids.map(String).includes(String(item.selected_book_id)))))
   throw Error(item.id+': selected book must be valid and included in an expected source group.');
 }
 return suite;
}

function makeCachedFetch(corpusRoot){
 const cache=new Map();
 return async(url,options)=>{
  const key=String(url);
  if(cache.has(key))return new Response(cache.get(key).slice(),{status:200});
  const response=await fetch(url,options);
  if(response.ok&&key.startsWith(corpusRoot)){
   const bytes=new Uint8Array(await response.clone().arrayBuffer());
   cache.set(key,bytes);
  }
  return response;
 };
}

async function fetchJson(url,fetcher=fetch){
 const response=await fetcher(url,{headers:{accept:'application/json'},cache:'no-store'});
 if(!response.ok)throw Error(url+' returned HTTP '+response.status);
 return response.json();
}

export function sourceIdentityIssues(source,manifest){
 const issues=[],bookId=String(source?.bookId||''),meta=manifest.books[bookId];
 if(!meta)issues.push('unknown_book');
 if(!Number.isSafeInteger(source?.globalPageId)||String(manifest.page_books[source.globalPageId])!==bookId)issues.push('wrong_global_page_book');
 if(!Number.isSafeInteger(source?.page)||source.page<1)issues.push('invalid_pdf_page');
 if(meta&&source?.title!==meta.title)issues.push('wrong_title');
 const expected=meta&&PDF_ID.exec(meta.drive_url)?.[1],actual=PDF_ID.exec(String(source?.url||''))?.[1];
 if(!expected||actual!==expected)issues.push('wrong_pdf');
 if(!source?.url?.endsWith('#page='+source.page))issues.push('wrong_pdf_page_anchor');
 if(typeof source?.preview!=='string'||source.preview.trim().length<25)issues.push('empty_passage_preview');
 return issues;
}

export async function verifyFingerprint(source,library,coverageBooks,fetcher=fetch){
 const bookId=String(source.bookId),page=Number(source.page),chunk=Math.floor((page-1)/32);
 if(!coverageBooks.has(bookId))return {ok:false,status:'book-not-covered'};
 let shard,packet;
 try{
  [shard,packet]=await Promise.all([
   library.jsonGzip('book-'+bookId+'.json'),fetchJson(FINGERPRINT_ROOT+'books/'+bookId+'/'+chunk+'.json',fetcher)
  ]);
 }catch(error){return {ok:false,status:'fingerprint-fetch-failed',error:String(error?.message||error)};}
 if(packet?.schema!=='antilogicalism-reader-fingerprints-v3'||packet?.hashAlgorithm!=='SHA-256-utf8-exact'||packet?.libraryVersion!==49||packet?.bookId!==bookId||packet?.chunk!==chunk||!Array.isArray(packet.pages))
  return {ok:false,status:'invalid-fingerprint-packet'};
 const records=shard.pages?.filter(p=>p.id===source.globalPageId&&p.page===page)||[];
 if(records.length!==1||typeof records[0].text!=='string')return {ok:false,status:'source-page-missing-or-ambiguous'};
 const text=records[0].text,bytes=Buffer.from(text,'utf8'),matches=packet.pages.filter(p=>p.page===page);
 if(bytes.byteLength<25||bytes.byteLength>MAX_PAGE_BYTES)return {ok:false,status:'page-size-out-of-range'};
 if(matches.length!==1)return {ok:false,status:'page-not-fingerprinted'};
 const record=matches[0],sha256=createHash('sha256').update(bytes).digest('hex');
 if(record.globalPageId!==source.globalPageId||record.utf8Bytes!==bytes.byteLength||record.sha256!==sha256)
  return {ok:false,status:'fingerprint-mismatch'};
 return {ok:true,status:'verified',utf8Bytes:bytes.byteLength,sha256};
}

async function sourcePageIsUsable(source,library){
 try{
  const shard=await library.jsonGzip('book-'+String(source.bookId)+'.json');
  const matches=shard.pages?.filter(p=>p.id===source.globalPageId&&p.page===source.page)||[];
  if(matches.length!==1||typeof matches[0].text!=='string')return {ok:false,status:'indexed-page-not-found'};
  const bytes=Buffer.byteLength(matches[0].text,'utf8');
  if(bytes<25||bytes>MAX_PAGE_BYTES)return {ok:false,status:'page-size-out-of-range',utf8Bytes:bytes};
  return {ok:true,status:'usable',utf8Bytes:bytes,text:matches[0].text};
 }catch(error){return {ok:false,status:'page-shard-fetch-failed',error:String(error?.message||error)};}
}

export function selectEvaluationAnswerSources(candidates,question){
 return selectAnswerSources(candidates,question,'evaluation-token',{maxSources:4,history:[]});
}

export async function evaluateCase(item,{library,manifest,allowedBookIds,fetcher}){
 const start=performance.now();
 const searchQueries=buildSearchFacets(item.question,item.planner_queries);
 const selectedBookId=item.selected_book_id===undefined?'':String(item.selected_book_id);
 const searchAllowedBookIds=selectedBookId?new Set([selectedBookId]):allowedBookIds;
 const foundSets=await Promise.all(searchQueries.map(query=>library.search(query,{
  allowedBookIds:searchAllowedBookIds,...LIVE_RETRIEVAL_CONFIG
 })));
 const merged=mergeFacetSearches(foundSets,LIVE_RETRIEVAL_CONFIG.maxCandidates);
 const issues=merged.flatMap((source,index)=>sourceIdentityIssues(source,manifest).map(code=>({sourceId:source.id||'S'+(index+1),bookId:String(source.bookId),page:source.page,code})));
 if(selectedBookId)for(const [index,source] of merged.entries())if(String(source.bookId)!==selectedBookId)
  issues.push({sourceId:source.id||'S'+(index+1),bookId:String(source.bookId),page:source.page,code:'selected_book_scope_leak'});
 const usability=await Promise.all(merged.map(source=>sourcePageIsUsable(source,library)));
 const candidates=merged.flatMap((source,index)=>usability[index].ok?
  [{...source,text:usability[index].text}]:[]);
 const excludedCandidates=[];
 for(let index=0;index<usability.length;index++)if(!usability[index].ok){
  excludedCandidates.push({bookId:String(merged[index].bookId),page:merged[index].page,status:usability[index].status});
  if(usability[index].status==='page-size-out-of-range')continue;
  issues.push({sourceId:merged[index].id||'S'+(index+1),bookId:String(merged[index].bookId),page:merged[index].page,code:usability[index].status});
 }
 const fingerprintChecks=await Promise.all(candidates.map(async source=>({bookId:String(source.bookId),page:source.page,
  globalPageId:source.globalPageId,...await verifyFingerprint(source,library,allowedBookIds,fetcher)})));
 // Mirror the production answer request: up to four full pages, with one
 // passage per work preferred before alternate pages from the same work.
 // The benchmark has no prior-turn context, so use empty history and a fixed
 // placeholder token solely for request byte-budget accounting.
 const defaultSelection=selectEvaluationAnswerSources(candidates,item.question);
 const defaultVerified=new Set(fingerprintChecks.filter(item=>item.ok).slice(0,candidates.length).map(item=>String(item.bookId)+':'+item.page));
 const candidateVerified=new Set(fingerprintChecks.filter(item=>item.ok).map(item=>String(item.bookId)+':'+item.page));
 const groups=item.required_source_groups.map(group=>{
  const expected=group.book_ids.map(String);
  const found=candidates.filter(source=>expected.includes(String(source.bookId)));
  const defaultFound=defaultSelection.filter(source=>expected.includes(String(source.bookId)));
  const verified=found.filter(source=>candidateVerified.has(String(source.bookId)+':'+source.page));
  const defaultVerifiedFound=defaultFound.filter(source=>defaultVerified.has(String(source.bookId)+':'+source.page));
  return {label:group.label,expectedBookIds:expected,candidateBookIds:[...new Set(found.map(s=>String(s.bookId)))],
   defaultSelectedBookIds:[...new Set(defaultFound.map(s=>String(s.bookId)))],fingerprintedCandidateBookIds:[...new Set(verified.map(s=>String(s.bookId)))],
   retrieved:found.length>0,defaultSelected:defaultFound.length>0,sourceVerified:verified.length>0,defaultSourceVerified:defaultVerifiedFound.length>0};
 });
 const evidenceTargets=(item.evidence_targets||[]).map(target=>{
  const bookId=String(target.book_id),pages=[...new Set(target.pages)];
  const candidateMatches=candidates.filter(source=>String(source.bookId)===bookId&&pages.includes(source.page));
  const selectedMatches=defaultSelection.filter(source=>String(source.bookId)===bookId&&pages.includes(source.page));
  return {label:target.label,bookId,pages,candidatePages:[...new Set(candidateMatches.map(source=>source.page))],
   selectedPages:[...new Set(selectedMatches.map(source=>source.page))],candidateHit:candidateMatches.length>0,selectedHit:selectedMatches.length>0};
 });
 const targetedPageKeys=new Set(evidenceTargets.flatMap(target=>target.pages.map(page=>target.bookId+':'+page)));
 const unannotatedSubmittedSources=defaultSelection.filter(source=>!targetedPageKeys.has(String(source.bookId)+':'+source.page))
  .map(source=>({bookId:String(source.bookId),page:source.page,title:source.title}));
 return {id:item.id,discipline:item.discipline,task:item.task,question:item.question,selectedBookId:selectedBookId||null,plannerQueries:item.planner_queries,
  searchQueries,requiredSourceGroups:groups,evidenceTargets,candidates:candidates.map(({id,bookId,title,page,globalPageId,url,preview,score,facet})=>({id,bookId,title,page,globalPageId,url,preview,score,facet})),
  fingerprintChecks,excludedCandidates,submittedSourceCount:defaultSelection.length,
  submittedSources:defaultSelection.map(({id,bookId,title,page,globalPageId,url})=>({id,bookId:String(bookId),title,page,globalPageId,url})),
  unannotatedSubmittedSources,
  candidateEvidenceTargetRecallPercent:evidenceTargets.length?Number((evidenceTargets.filter(target=>target.candidateHit).length/evidenceTargets.length*100).toFixed(1)):null,
  selectedEvidenceTargetRecallPercent:evidenceTargets.length?Number((evidenceTargets.filter(target=>target.selectedHit).length/evidenceTargets.length*100).toFixed(1)):null,
  selectedExactTargetMatchPercent:defaultSelection.length?Number((defaultSelection.filter(source=>targetedPageKeys.has(String(source.bookId)+':'+source.page)).length/defaultSelection.length*100).toFixed(1)):null,
  unannotatedSubmittedSourceCount:unannotatedSubmittedSources.length,
  booksScanned:foundSets.reduce((n,r)=>n+(Number(r.booksScanned)||0),0),
  elapsedMs:Math.round(performance.now()-start),retrievalPass:groups.every(g=>g.retrieved)&&!issues.some(issue=>issue.code==='selected_book_scope_leak'),
  defaultSelectionPass:groups.every(g=>g.defaultSelected),candidateSourcesVerified:groups.every(g=>g.sourceVerified),
  defaultSelectionVerified:groups.every(g=>g.defaultSourceVerified),sourceIdentityIssues:issues};
}

export function summarize(cases){
 const groups=cases.flatMap(c=>c.requiredSourceGroups),sum=(key)=>groups.filter(g=>g[key]).length;
 const annotatedCases=cases.filter(c=>c.evidenceTargets?.length);
 const evidenceTargets=annotatedCases.flatMap(c=>c.evidenceTargets);
 const submitted=annotatedCases.flatMap(c=>c.submittedSources||[]);
 const annotatedSubmitted=annotatedCases.reduce((count,c)=>{
  const keys=new Set(c.evidenceTargets.flatMap(target=>target.pages.map(page=>target.bookId+':'+page)));
  return count+(c.submittedSources||[]).filter(source=>keys.has(String(source.bookId)+':'+source.page)).length;
 },0);
 const errors=cases.flatMap(c=>c.fingerprintChecks.filter(f=>f.status==='fingerprint-fetch-failed'||f.status==='fingerprint-mismatch'||f.status==='invalid-fingerprint-packet'));
 const executionErrors=cases.filter(c=>c.executionError).length;
 const identity=cases.reduce((n,c)=>n+c.sourceIdentityIssues.length,0);
 const oversizedPageCount=cases.reduce((n,c)=>n+(c.excludedCandidates||[]).filter(item=>item.status==='page-size-out-of-range').length,0);
 return {caseCount:cases.length,retrievalPassCases:cases.filter(c=>c.retrievalPass).length,
  defaultSelectionPassCases:cases.filter(c=>c.defaultSelectionPass).length,
  candidateSourcesVerifiedCases:cases.filter(c=>c.candidateSourcesVerified).length,
  defaultSelectionVerifiedCases:cases.filter(c=>c.defaultSelectionVerified).length,
  expectedSourceGroups:groups.length,candidateGroupRecallPercent:Number((sum('retrieved')/groups.length*100).toFixed(1)),
  defaultSelectedGroupRecallPercent:Number((sum('defaultSelected')/groups.length*100).toFixed(1)),
  verifiedCandidateGroupRecallPercent:Number((sum('sourceVerified')/groups.length*100).toFixed(1)),
  verifiedDefaultGroupRecallPercent:Number((sum('defaultSourceVerified')/groups.length*100).toFixed(1)),
  evidenceTargetCount:evidenceTargets.length,
  candidateEvidenceTargetRecallPercent:evidenceTargets.length?Number((evidenceTargets.filter(target=>target.candidateHit).length/evidenceTargets.length*100).toFixed(1)):null,
  selectedEvidenceTargetRecallPercent:evidenceTargets.length?Number((evidenceTargets.filter(target=>target.selectedHit).length/evidenceTargets.length*100).toFixed(1)):null,
  selectedExactTargetMatchPercent:submitted.length?Number((annotatedSubmitted/submitted.length*100).toFixed(1)):null,
  unannotatedSubmittedSourceCount:submitted.length-annotatedSubmitted,
  sourceIdentityIssueCount:identity,fingerprintErrors:errors.length,executionErrorCount:executionErrors,oversizedPageCount,
  meanSearchMs:Math.round(cases.reduce((n,c)=>n+c.elapsedMs,0)/cases.length)};
}

function markdown(report){
 const m=report.corpus,s=report.summary;
 const rows=report.cases.map(c=>{
  const expected=c.requiredSourceGroups.map(g=>g.label).join(', ');
  const scope=c.selectedBookId?report.titles[c.selectedBookId]||c.selectedBookId:'All books';
  const got=[...new Set(c.candidates.map(x=>report.titles[x.bookId]||x.bookId))].join('; ')||'—';
  const result=c.retrievalPass?'PASS':'MISS';
  const ready=c.defaultSelectionVerified?'yes':c.candidateSourcesVerified?'candidate only':'no';
  const evidence=c.evidenceTargets?.length?`${c.evidenceTargets.filter(t=>t.selectedHit).length}/${c.evidenceTargets.length} targets; ${c.unannotatedSubmittedSourceCount} unannotated`:'not annotated';
  return `| ${result} | ${scope} | ${c.discipline} | ${c.id} | ${expected} | ${got} | ${ready} | ${evidence} | ${c.elapsedMs} ms |`;
 }).join('\n');
 return `## Reading Companion public-library evaluation\n\n`+
 `v${m.version}: ${m.indexedBookRecords} indexed records / ${m.indexedPages.toLocaleString()} pages; ${m.catalogTitles} distinct catalog titles; ${m.fingerprintedBooks}/${m.indexedBookRecords} books fingerprinted.\n\n`+
 `Expected-source recall: ${s.candidateGroupRecallPercent}% across merged candidates; ${s.defaultSelectedGroupRecallPercent}% in the production answer-source set (up to four passages, preferring distinct works). `+
 `Fingerprint-verified recall: ${s.verifiedCandidateGroupRecallPercent}% across candidates and ${s.verifiedDefaultGroupRecallPercent}% in the submitted source set. `+
 (s.evidenceTargetCount?`Annotated page targets: ${s.evidenceTargetCount}; candidate target recall ${s.candidateEvidenceTargetRecallPercent}%; submitted-source target recall ${s.selectedEvidenceTargetRecallPercent}%; exact annotated-page match rate ${s.selectedExactTargetMatchPercent}% (${s.unannotatedSubmittedSourceCount} submitted pages lack an exact target annotation). `:'')+
 `Cases passing retrieval: ${s.retrievalPassCases}/${s.caseCount}; identity issues: ${s.sourceIdentityIssueCount}; fingerprint errors: ${s.fingerprintErrors}; execution errors: ${s.executionErrorCount}; excluded oversized pages: ${s.oversizedPageCount}; mean search ${s.meanSearchMs} ms.\n\n`+
  `| Result | Search scope | Area | Case | Expected source groups | Retrieved works | Submitted answer sources verified | Passage targets | Time |\n|---|---|---|---|---|---|---|---|---:|\n${rows}\n\n`+
 `Retrieval and exact page fingerprints are automated. This workflow makes no model calls and does not claim to grade the truth of generated interpretations.`;
}

async function main(){
 const args=parseArgs(process.argv.slice(2));
 if(args.help){console.log('Usage: node reading-companion/public-library-evaluation.mjs [--suite FILE] [--limit N | --case CASE_ID ...] [--output FILE]');return 0;}
 const suite=validateSuite(JSON.parse(await readFile(args.suitePath,'utf8')));
 if(args.limit&&args.caseIds.length)throw Error('--limit and --case cannot be combined.');
 const unknown=args.caseIds.filter(id=>!suite.cases.some(item=>item.id===id));
 if(unknown.length)throw Error('Unknown benchmark case ID: '+unknown.join(', '));
 const cases=args.caseIds.length?suite.cases.filter(item=>args.caseIds.includes(item.id)):
  args.limit?suite.cases.slice(0,args.limit):suite.cases;
 const [catalog,coverage]=await Promise.all([fetchJson(args.catalogUrl),fetchJson(args.coverageUrl)]);
 if(coverage?.schema!=='antilogicalism-reader-coverage-v3'||coverage?.libraryVersion!==49||!coverage.books)throw Error('Published v49 fingerprint coverage is incompatible.');
 const allowedBookIds=new Set(Object.keys(coverage.books));
 const cachedFetch=makeCachedFetch(args.corpusRoot),library=new RemoteLibrary(args.corpusRoot,cachedFetch),manifest=await library.manifest();
 if(manifest.version!==suite.corpus_version)throw Error('Published corpus and benchmark versions differ.');
 for(const item of cases)for(const group of item.required_source_groups)for(const id of group.book_ids)
  if(!manifest.books[String(id)])throw Error(`${item.id}: expected book ${id} is absent from the corpus index.`);
 for(const item of cases)if(item.selected_book_id!==undefined){
  const id=String(item.selected_book_id);
  if(!manifest.books[id])throw Error(`${item.id}: selected book ${id} is absent from the corpus index.`);
  if(!allowedBookIds.has(id))throw Error(`${item.id}: selected book ${id} is not fingerprint-covered.`);
 }
 const catalogTitles=new Set((catalog.books||[]).map(b=>String(b.title||'').trim()).filter(Boolean));
 const report={schema:'antilogicalism-reading-companion-public-eval-v1',suiteId:suite.suite_id,
  generatedAt:new Date().toISOString(),corpusRoot:args.corpusRoot,retrievalConfig:{...LIVE_RETRIEVAL_CONFIG},
  corpus:{version:manifest.version,indexedBookRecords:Object.keys(manifest.books).length,indexedPages:manifest.pages,
   catalogEntries:(catalog.books||[]).length,catalogTitles:catalogTitles.size,fingerprintedBooks:allowedBookIds.size,
   fingerprintCoveragePercent:Number((allowedBookIds.size/Object.keys(manifest.books).length*100).toFixed(1))},
  titles:Object.fromEntries(Object.entries(manifest.books).map(([id,book])=>[id,book.title])),cases:[]};
 console.log(`v${manifest.version}: ${Object.keys(manifest.books).length} indexed records; ${catalogTitles.size} distinct catalog titles; ${allowedBookIds.size} fingerprinted books.`);
 console.log(`Running ${cases.length}/${suite.cases.length} ${suite.suite_id.includes('selected-book')?'selected-book':'all-books'} cases through the production two-facet retrieval and merge path.`);
 for(let i=0;i<cases.length;i++){
  const item=cases[i];
  try{
   const result=await evaluateCase(item,{library,manifest,allowedBookIds,fetcher:cachedFetch});
   report.cases.push(result);
   const found=[...new Set(result.candidates.map(s=>manifest.books[String(s.bookId)]?.title||s.bookId))].join(' / ')||'no sources';
   console.log(`[${i+1}/${cases.length}] ${result.retrievalPass?'PASS':'MISS'} ${item.id} | ${found} | ${result.elapsedMs} ms`);
  }catch(error){
   report.cases.push({id:item.id,discipline:item.discipline,question:item.question,plannerQueries:item.planner_queries,
     requiredSourceGroups:item.required_source_groups.map(g=>({label:g.label,expectedBookIds:g.book_ids,retrieved:false,defaultSelected:false,sourceVerified:false,defaultSourceVerified:false})),
     candidates:[],fingerprintChecks:[],booksScanned:0,elapsedMs:0,retrievalPass:false,defaultSelectionPass:false,
     candidateSourcesVerified:false,defaultSelectionVerified:false,sourceIdentityIssues:[],executionError:String(error?.message||error)});
   console.log(`[${i+1}/${cases.length}] ERROR ${item.id} | ${String(error?.message||error)}`);
  }
 }
 report.summary=summarize(report.cases);report.markdown=markdown(report);
 console.log('\n'+report.markdown);
 if(args.output){const output=resolve(args.output);await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n','utf8');console.log('\nJSON report saved to '+output);}
 if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,report.markdown+'\n','utf8');
 return report.summary.sourceIdentityIssueCount||report.summary.fingerprintErrors||report.cases.some(c=>c.executionError)?1:0;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(code=>{process.exitCode=code;}).catch(error=>{console.error('Evaluation could not run:',String(error?.message||error));process.exitCode=1;});
