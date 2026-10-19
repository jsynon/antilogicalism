const string=(value,limit=180)=>typeof value==='string'?value.slice(0,limit):'';
const FAILURE_CODES=new Set([
  'network-error','request-rejected','authorization-rejected',
  'visitor-or-origin-rejected','request-too-large',
  'source-verification-rejected','rate-limited',
  'answer-generation-or-citation-failed','search-planning-failed','service-unavailable',
  'evidence-review-request-failed','evidence-review-truncated',
  'evidence-review-invalid-response','answer-composition-request-failed',
  'answer-composition-truncated','answer-composition-empty',
  'answer-composition-too-long','answer-citations-missing',
  'answer-citations-invalid','http-error','invalid-response','retrieval-error'
]);

export function diagnosticFailureCode(status,requestStage='answer',serverCode=''){
  if(FAILURE_CODES.has(serverCode))return serverCode;
  if(!Number.isInteger(status)||status<100||status>599)return 'network-error';
  if(status===400)return 'request-rejected';
  if(status===401)return 'authorization-rejected';
  if(status===403)return 'visitor-or-origin-rejected';
  if(status===413)return 'request-too-large';
  if(status===422)return 'source-verification-rejected';
  if(status===429)return 'rate-limited';
  if(status===502)return requestStage==='planner'?
    'search-planning-failed':'answer-generation-or-citation-failed';
  if(status===503)return 'service-unavailable';
  return 'http-error';
}

function sourceSummary(source){
  if(!source||typeof source!=='object')return null;
  return {
    id:string(source.id,24),
    bookId:string(source.bookId,12),
    title:string(source.title),
    page:Number.isSafeInteger(source.page)?source.page:null,
    globalPageId:Number.isSafeInteger(source.globalPageId)?source.globalPageId:null,
    score:Number.isFinite(source.score)?Number(source.score.toFixed(4)):null,
    facet:string(source.facet,120)
  };
}

export function auditCitationIds(answer,citations=[]){
  const inlineIds=[...new Set([...String(answer||'').matchAll(/\[([^\]]+)\]/g)]
    .flatMap(match=>match[1].match(/\bS[1-9]\d*\b/g)||[]))];
  const returnedIds=[...new Set(citations.map(source=>source?.id)
    .filter(id=>typeof id==='string'&&/^S[1-9]\d*$/.test(id)))];
  return {
    inlineIds,
    returnedIds,
    inlineIdsWithoutSource:inlineIds.filter(id=>!returnedIds.includes(id)),
    sourcesNotCited:returnedIds.filter(id=>!inlineIds.includes(id))
  };
}

// Intentionally whitelist fields: never serialize full page text, previews,
// request bodies, CAPTCHA tokens, or arbitrary error messages.
export function createDiagnosticReport(input={}){
  const audit=auditCitationIds(input.answer,input.citations);
  return {
    schema:'antilogicalism-reading-companion-diagnostic-v1',
    clientBuild:'v1.11-diagnostics',
    libraryVersion:Number.isSafeInteger(input.libraryVersion)?input.libraryVersion:null,
    question:string(input.question,400),
    selectedBookId:string(input.selectedBookId,12)||'all',
    fallbackMode:input.fallbackMode===true,
    stage:string(input.stage,40)||'unknown',
    failureCategory:string(input.failureCategory,48),
    failureHttpStatus:Number.isInteger(input.failureHttpStatus)&&
      input.failureHttpStatus>=100&&input.failureHttpStatus<=599?
      input.failureHttpStatus:null,
      failureCode:input.stage==='complete'?'':(
        FAILURE_CODES.has(input.failureCode)?input.failureCode:'unclassified'),
    plannerQueries:Array.isArray(input.plannerQueries)?
      input.plannerQueries.filter(x=>typeof x==='string').slice(0,4).map(x=>x.slice(0,240)):[],
    searches:Array.isArray(input.searches)?input.searches.slice(0,4).map(search=>({
      query:string(search?.query,240),
      resultCount:Number.isSafeInteger(search?.resultCount)?search.resultCount:null,
      sources:Array.isArray(search?.sources)?search.sources.slice(0,8).map(sourceSummary).filter(Boolean):[]
    })):[],
    candidates:Array.isArray(input.candidates)?input.candidates.slice(0,8).map(sourceSummary).filter(Boolean):[],
    submittedSources:Array.isArray(input.submittedSources)?
      input.submittedSources.slice(0,4).map(sourceSummary).filter(Boolean):[],
    answer:{
      outcome:string(input.outcome,48),
      coverage:string(input.coverage,24),
      reviewStatus:string(input.reviewStatus,48),
      citationIds:audit.returnedIds,
      inlineCitationIds:audit.inlineIds,
      inlineIdsWithoutSource:audit.inlineIdsWithoutSource,
      sourcesNotCited:audit.sourcesNotCited,
      citations:Array.isArray(input.citations)?input.citations.slice(0,3).map(sourceSummary).filter(Boolean):[]
    },
    evidenceHighlights:Array.isArray(input.evidenceHighlights)?
      input.evidenceHighlights.slice(0,3).map(item=>({
        sourceId:string(item?.source_id,24),
        page:Number.isSafeInteger(item?.page)?item.page:null,
        quoteLocated:item?.quoteLocated===true,
        partialMatch:item?.partialMatch===true
      })):[]
  };
}
