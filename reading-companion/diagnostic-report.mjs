const string=(value,limit=180)=>typeof value==='string'?value.slice(0,limit):'';
const optionalString=(value,limit=128)=>typeof value==='string'&&value.length>0?value.slice(0,limit):null;
// The Worker owns this field and emits stable, non-sensitive reason codes. Accept
// newly introduced codes without requiring a synchronized frontend allowlist.
// Reject free-form messages and cap length before including the value in reports.
const SAFE_FAILURE_CODE=/^[a-z][a-z0-9-]{0,63}$/;
function isSafeFailureCode(value){
  return typeof value==='string'&&SAFE_FAILURE_CODE.test(value);
}

// Accept both a single marker ([S1]) and grouped markers ([S1, S3]) for
// rendering. The audit below intentionally remains broader so malformed or
// unmatched markers still appear in diagnostics.
export function inlineCitationGroups(answer){
  return [...String(answer||'').matchAll(/\[((?:S[1-9]\d*)(?:\s*,\s*S[1-9]\d*)*)\]/g)]
    .map(match=>({start:match.index,end:match.index+match[0].length,
      ids:match[1].split(/\s*,\s*/)}));
}

export function userFailureMessage(code=''){
  if(code==='ai-daily-limit-reached')
    return 'The chatbot has reached its daily AI usage limit. Please try again after the daily reset.';
  if(code==='ai-capacity-unavailable')
    return 'The AI service is temporarily at capacity. Please wait a moment and try again.';
  if(code==='ai-rate-limited')
    return 'The AI service is handling too many requests right now. Please wait a moment and try again.';
  return 'Could not prepare the answer. Please try again.';
}
export function diagnosticFailureCode(status,requestStage='answer',serverCode=''){
  if(isSafeFailureCode(serverCode))return serverCode;
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
    .filter(id=>typeof id==='string'&&/^S[1-9][0-9]*$/.test(id)))];
  return {
    inlineIds,
    returnedIds,
    inlineIdsWithoutSource:inlineIds.filter(id=>!returnedIds.includes(id)),
    sourcesNotCited:returnedIds.filter(id=>!inlineIds.includes(id))
  };
}

// Intentionally whitelist fields: never serialize full page text, previews,
// request bodies, CAPTCHA tokens, or arbitrary error messages. Quality
// diagnostics may include only bounded claim anchors and highlight windows.
function reviewedEvidenceSummary(value,submittedSources=[]){
  if(!Array.isArray(value))return [];
  const allowed=new Set((Array.isArray(submittedSources)?submittedSources:[])
    .map(source=>source?.id).filter(id=>typeof id==='string'&&/^S[1-9][0-9]*$/.test(id)));
  const out=[],seen=new Set();
  for(const item of value.slice(0,8)){
    const id=typeof item?.id==='string'?item.id:'';
    const point=typeof item?.point==='string'?item.point.trim().slice(0,220):'';
    const key=JSON.stringify([id,point]);
    if(!allowed.has(id)||seen.has(key)||!point)continue;
    const anchorQuote=typeof item?.anchorQuote==='string'?
      item.anchorQuote.trim().slice(0,320):'';
    const speaker=typeof item?.speaker==='string'?item.speaker.trim().slice(0,80):'';
    const qualifier=typeof item?.qualifier==='string'?item.qualifier.trim().slice(0,160):'';
    seen.add(key);out.push({id,point,quoteVerified:item?.quoteVerified===true,
      ...(anchorQuote&&item?.quoteVerified===true?{anchorQuote}:{}),
      ...(speaker?{speaker}:{}),...(qualifier?{qualifier}:{})});
    if(out.length===6)break;
  }
  return out;
}


function questionPartSummary(value,submittedSources=[]){
  if(!Array.isArray(value))return [];
  const allowed=new Set((Array.isArray(submittedSources)?submittedSources:[])
    .map(source=>source?.id)
    .filter(id=>typeof id==='string'&&/^S[1-9][0-9]*$/.test(id)));
  const out=[];
  for(const item of value.slice(0,4)){
    const part=typeof item?.part==='string'?item.part.trim().slice(0,140):'';
    const status=item?.status;
    if(part.length<3||!['supported','partial','unsupported'].includes(status))continue;
    const evidenceIds=Array.isArray(item.evidenceIds)?
      [...new Set(item.evidenceIds.filter(id=>typeof id==='string'&&allowed.has(id)))].slice(0,4):[];
    out.push({part,status,evidenceIds});
  }
  return out;
}

export function createDiagnosticReport(input={}){
  const audit=auditCitationIds(input.answer,input.citations);
  return {
    schema:'antilogicalism-reading-companion-diagnostic-v1',
    clientBuild:'v1.15-evidence-anchor-diagnostics',
    libraryVersion:Number.isSafeInteger(input.libraryVersion)?input.libraryVersion:null,
    plannerWorkerVersionId:optionalString(input.plannerWorkerVersionId),
    plannerWorkerVersionTag:optionalString(input.plannerWorkerVersionTag),
    plannerWorkerVersionTimestamp:optionalString(input.plannerWorkerVersionTimestamp,64),
    plannerWorkerSourceBuild:optionalString(input.plannerWorkerSourceBuild),
    answerWorkerVersionId:optionalString(input.answerWorkerVersionId),
    answerWorkerVersionTag:optionalString(input.answerWorkerVersionTag),
    answerWorkerVersionTimestamp:optionalString(input.answerWorkerVersionTimestamp,64),
    answerWorkerSourceBuild:optionalString(input.answerWorkerSourceBuild),
    question:string(input.question,400),
    selectedBookId:string(input.selectedBookId,12)||'all',
    fallbackMode:input.fallbackMode===true,
    stage:string(input.stage,40)||'unknown',
    failureCategory:string(input.failureCategory,48),
    failureHttpStatus:Number.isInteger(input.failureHttpStatus)&&
      input.failureHttpStatus>=100&&input.failureHttpStatus<=599?
      input.failureHttpStatus:null,
      failureCode:input.stage==='complete'?'':(
        isSafeFailureCode(input.failureCode)?input.failureCode:'unclassified'),
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
      citations:Array.isArray(input.citations)?input.citations.slice(0,4).map(sourceSummary).filter(Boolean):[],
      reviewedEvidence:reviewedEvidenceSummary(input.reviewedEvidence,input.submittedSources),
      questionParts:questionPartSummary(input.questionParts,input.submittedSources)
    },
    evidenceHighlights:Array.isArray(input.evidenceHighlights)?
      input.evidenceHighlights.slice(0,3).map(item=>({
        sourceId:string(item?.source_id,24),
        page:Number.isSafeInteger(item?.page)?item.page:null,
        quote:string(item?.quote,320),
        quoteLocated:item?.quoteLocated===true,
        partialMatch:item?.partialMatch===true
      })):[]
  };
}
