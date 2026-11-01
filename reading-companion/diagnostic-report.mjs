const string=(value,limit=180)=>typeof value==='string'?value.slice(0,limit):'';
const optionalString=(value,limit=128)=>typeof value==='string'&&value.length>0?value.slice(0,limit):null;
// The Worker owns this field and emits stable, non-sensitive reason codes. Accept
// newly introduced codes without requiring a synchronized frontend allowlist.
// Reject free-form messages and cap length before including the value in reports.
const SAFE_FAILURE_CODE=/^[a-z][a-z0-9-]{0,63}$/;
const SAFE_DIAGNOSTIC_TOKEN=/^[a-z0-9_-]{1,48}$/;
function safeDiagnosticToken(value){
  return typeof value==='string'&&SAFE_DIAGNOSTIC_TOKEN.test(value)?value:null;
}
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
  if(code==='ai-daily-free-allocation')
    return 'Cloudflare Workers AI reported that this account reached its daily free allocation. If this Worker is on a paid Workers account, check that account’s Workers AI billing and usage; paid usage above the free allocation should be billed.';
  if(code==='ai-provider-usage-limit'||code==='ai-credit-limit')
    return 'Cloudflare Workers AI reported a usage or billing limit for the account serving this Worker. Check that account’s Workers AI usage and billing. The Reading Companion cannot verify the account’s plan or spending limit.';
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
  const candidatePartIds=Array.isArray(source.candidatePartIds)?
    [...new Set(source.candidatePartIds.filter(id=>typeof id==='string'&&/^P[1-9]\d*$/.test(id)))].slice(0,6):null;
  return {
    id:string(source.id,24),
    bookId:string(source.bookId,12),
    title:string(source.title),
    page:Number.isSafeInteger(source.page)?source.page:null,
    globalPageId:Number.isSafeInteger(source.globalPageId)?source.globalPageId:null,
    score:Number.isFinite(source.score)?Number(source.score.toFixed(4)):null,
    facet:string(source.facet,120),
    ...(candidatePartIds?{candidatePartIds}:{})
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
    const point=typeof item?.point==='string'?item.point.trim().slice(0,220):
      (typeof item?.claimId==='string'&&/^C[1-9][0-9]*$/.test(item.claimId)?'Claim '+item.claimId:'');
    const key=JSON.stringify([id,point]);
    if(!allowed.has(id)||seen.has(key)||!point)continue;
    const anchorQuote=typeof item?.anchorQuote==='string'?item.anchorQuote.trim().slice(0,320):
      (typeof item?.quote==='string'?item.quote.trim().slice(0,320):'');
    const speaker=typeof item?.speaker==='string'?item.speaker.trim().slice(0,80):'';
    const qualifier=typeof item?.qualifier==='string'?item.qualifier.trim().slice(0,160):'';
    const quoteVerified=item?.quoteVerified===true||
      (typeof item?.quote==='string'&&Number.isSafeInteger(item?.start)&&Number.isSafeInteger(item?.end)&&item.end>item.start);
    seen.add(key);out.push({id,point,quoteVerified,
      ...(anchorQuote&&quoteVerified?{anchorQuote}:{}),
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
      [...new Set(item.evidenceIds.filter(id=>typeof id==='string'&&allowed.has(id)))].slice(0,6):[];
    out.push({part,status,evidenceIds});
  }
  return out;
}

export function createDiagnosticReport(input={}){
  const audit=auditCitationIds(input.answer,input.citations);
  const partIds=value=>Array.isArray(value)?
    [...new Set(value.filter(id=>typeof id==='string'&&/^P[1-9]\d*$/.test(id)))].slice(0,6):[];
  return {
    schema:'antilogicalism-reading-companion-diagnostic-v1',
    clientBuild:'v1.18-conditional-gap-search',
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
    failureStage:input.stage==='complete'?null:safeDiagnosticToken(input.failureStage),
    failureProviderClass:input.stage==='complete'?null:safeDiagnosticToken(input.failureProviderClass),
    failureProviderCode:input.stage==='complete'?null:
      (typeof input.failureProviderCode==='string'&&/^[A-Za-z0-9_.-]{1,48}$/.test(input.failureProviderCode)?
        input.failureProviderCode:null),
    failureAnswerCharacters:Number.isSafeInteger(input.failureAnswerCharacters)&&
      input.failureAnswerCharacters>=0&&input.failureAnswerCharacters<=20000?
      input.failureAnswerCharacters:null,
    failureDetail:input.stage==='complete'?null:safeDiagnosticToken(input.failureDetail),
    plannerQueries:Array.isArray(input.plannerQueries)?
      input.plannerQueries.filter(x=>typeof x==='string').slice(0,4).map(x=>x.slice(0,240)):[],
    gapSearch:input.retrievalCoverage&&typeof input.retrievalCoverage==='object'?{
      triggered:input.retrievalCoverage.triggered===true,
      plannerAttempted:input.gapPlannerAttempted===true,
      parts:Array.isArray(input.retrievalCoverage.parts)?input.retrievalCoverage.parts.slice(0,6).map(part=>({
        part:string(part?.question,240),
        matchedTerms:Array.isArray(part?.matchedTerms)?part.matchedTerms.slice(0,12).map(value=>string(value,40)):[],
        overlap:Number.isSafeInteger(part?.overlap)?part.overlap:0,
        distinctiveTermCount:Number.isSafeInteger(part?.distinctiveTermCount)?part.distinctiveTermCount:0,
        coverageRatio:Number.isFinite(part?.coverageRatio)?part.coverageRatio:0,
        requiredTermCount:Number.isSafeInteger(part?.requiredTermCount)?part.requiredTermCount:0,
        reason:safeDiagnosticToken(part?.coverageReason),
        requestedBookIds:Array.isArray(part?.requestedBookIds)?part.requestedBookIds.slice(0,16).map(value=>string(value,12)):[],
        candidateBookIds:Array.isArray(part?.candidateBookIds)?part.candidateBookIds.slice(0,16).map(value=>string(value,12)):[]
      })):[],
      weakParts:Array.isArray(input.retrievalCoverage.weakParts)?input.retrievalCoverage.weakParts.slice(0,6).map(part=>({
        part:string(part?.question,240),overlap:Number.isSafeInteger(part?.overlap)?part.overlap:0,
        requestedBookIds:Array.isArray(part?.requestedBookIds)?part.requestedBookIds.slice(0,16).map(value=>string(value,12)):[],
        candidateBookIds:Array.isArray(part?.candidateBookIds)?part.candidateBookIds.slice(0,16).map(value=>string(value,12)):[]
      })):[],
      queries:Array.isArray(input.gapQueries)?input.gapQueries.slice(0,3).map(value=>string(value,160)):[],
      failureCode:isSafeFailureCode(input.gapPlannerFailure)?input.gapPlannerFailure:null,
      afterGap:Array.isArray(input.retrievalCoverageAfterGap?.parts)?input.retrievalCoverageAfterGap.parts.slice(0,6).map(part=>({
        part:string(part?.question,240),
        matchedTerms:Array.isArray(part?.matchedTerms)?part.matchedTerms.slice(0,12).map(value=>string(value,40)):[],
        overlap:Number.isSafeInteger(part?.overlap)?part.overlap:0,
        distinctiveTermCount:Number.isSafeInteger(part?.distinctiveTermCount)?part.distinctiveTermCount:0,
        coverageRatio:Number.isFinite(part?.coverageRatio)?part.coverageRatio:0,
        requiredTermCount:Number.isSafeInteger(part?.requiredTermCount)?part.requiredTermCount:0,
        reason:safeDiagnosticToken(part?.coverageReason)
      })):Array.isArray(input.retrievalCoverageAfterGap?.weakParts)
        ?input.retrievalCoverageAfterGap.weakParts.slice(0,6).map(part=>({
          part:string(part?.question,240),overlap:Number.isSafeInteger(part?.overlap)?part.overlap:0
        })):[]
    }:null,
    plannerPlan:input.plannerPlan&&typeof input.plannerPlan==='object'?{
      version:string(input.plannerPlan.version,40),
      resolvedQuestion:string(input.plannerPlan.resolvedQuestion,600),
      intent:['explain','compare','interpret','locate'].includes(input.plannerPlan.intent)?input.plannerPlan.intent:'explain',
      scope:string(input.plannerPlan.scope,200),
      sources:Array.isArray(input.plannerPlan.sources)?input.plannerPlan.sources.slice(0,8).map(source=>({
        label:string(source?.label,120),role:['primary','subject','commentary'].includes(source?.role)?source.role:'primary',
        bookIds:Array.isArray(source?.bookIds)?source.bookIds.map(id=>string(id,12)).slice(0,8):[]})):[],
      parts:Array.isArray(input.plannerPlan.parts)?input.plannerPlan.parts.slice(0,6).map(part=>({
        id:string(part?.id,8),question:string(part?.question,240)})):[],
    }:null,
    pipeline:string(input.pipeline,48)||null,
    usage:input.usage&&typeof input.usage==='object'?{
      calls:Number.isSafeInteger(input.usage.calls)?input.usage.calls:null,
      neurons:Number.isFinite(input.usage.neurons)?input.usage.neurons:null,
      inputTokens:Number.isFinite(input.usage.inputTokens)?input.usage.inputTokens:null,
      outputTokens:Number.isFinite(input.usage.outputTokens)?input.usage.outputTokens:null,
    }:null,
    searches:Array.isArray(input.searches)?input.searches.slice(0,10).map(search=>({
      query:string(search?.query,240),
      resultCount:Number.isSafeInteger(search?.resultCount)?search.resultCount:null,
      partIds:partIds(search?.partIds),
      sources:Array.isArray(search?.sources)?search.sources.slice(0,8).map(sourceSummary).filter(Boolean):[]
    })):[],
    candidates:Array.isArray(input.candidates)?input.candidates.slice(0,24).map(sourceSummary).filter(Boolean):[],
    candidatePool:Array.isArray(input.candidatePool)?input.candidatePool.slice(0,24).map(sourceSummary).filter(Boolean):[],
    submittedSources:Array.isArray(input.submittedSources)?
      input.submittedSources.slice(0,6).map(sourceSummary).filter(Boolean):[],
    sourceSelection:input.sourceSelection&&typeof input.sourceSelection==='object'?{
      status:['selected','no-relevant-evidence','deterministic-fallback','legacy'].includes(input.sourceSelection.status)?input.sourceSelection.status:'unknown',
      candidateCount:Number.isSafeInteger(input.sourceSelection.candidateCount)?input.sourceSelection.candidateCount:null,
      pages:Array.isArray(input.sourceSelection.pages)?input.sourceSelection.pages.slice(0,6).map(sourceSummary).filter(Boolean):[],
      usage:input.sourceSelection.usage&&typeof input.sourceSelection.usage==='object'?{
        calls:Number.isSafeInteger(input.sourceSelection.usage.calls)?input.sourceSelection.usage.calls:null,
        neurons:Number.isFinite(input.sourceSelection.usage.neurons)?input.sourceSelection.usage.neurons:null,
        inputTokens:Number.isFinite(input.sourceSelection.usage.inputTokens)?input.sourceSelection.usage.inputTokens:null,
        outputTokens:Number.isFinite(input.sourceSelection.usage.outputTokens)?input.sourceSelection.usage.outputTokens:null
      }:null
    }:null,
    answer:{
      outcome:string(input.outcome,48),
      coverage:string(input.coverage,24),
      reviewStatus:string(input.reviewStatus,48),
      citationIds:audit.returnedIds,
      inlineCitationIds:audit.inlineIds,
      inlineIdsWithoutSource:audit.inlineIdsWithoutSource,
      sourcesNotCited:audit.sourcesNotCited,
      citations:Array.isArray(input.citations)?input.citations.slice(0,6).map(sourceSummary).filter(Boolean):[],
      reviewedEvidence:reviewedEvidenceSummary(input.reviewedEvidence,input.submittedSources),
      questionParts:questionPartSummary(input.questionParts,input.submittedSources)
    },
    evidenceHighlights:Array.isArray(input.evidenceHighlights)?
      input.evidenceHighlights.slice(0,6).map(item=>({
        sourceId:string(item?.source_id,24),
        page:Number.isSafeInteger(item?.page)?item.page:null,
        quote:string(item?.quote,320),
        claimId:string(item?.claim_id,48),
        point:string(item?.point,320),
        quoteLocated:item?.quoteLocated===true,
        partialMatch:item?.partialMatch===true,
        quotes:(Array.isArray(item?.quotes)?item.quotes:[]).slice(0,3).map(quote=>({
          claimId:string(quote?.claim_id,48),partId:string(quote?.part_id,24),
          point:string(quote?.point,320),quote:string(quote?.quote,320),
          quoteLocated:quote?.quoteLocated===true,partialMatch:quote?.partialMatch===true
        }))
      })):[]
  };
}

