/* Compare a saved evaluation trace with a small, human-reviewed passage set.
 * The labels are a bounded gold review of captured candidates, not an AI score
 * or a claim that we searched every page in the library.
 */
function pageKey(value){
 const bookId=String(value?.bookId||'');
 const page=Number(value?.page);
 return bookId&&Number.isSafeInteger(page)?bookId+':'+page:'';
}

function sourcePageMap(item){
 return new Map((Array.isArray(item?.citationSources)?item.citationSources:[])
  .map(source=>[String(source?.id||''),source]));
}

function tracePageSet(items){
 return new Set((Array.isArray(items)?items:[]).map(pageKey).filter(Boolean));
}

function finalStatusByPart(item){
 return new Map((Array.isArray(item?.questionParts)?item.questionParts:[])
  .map(part=>[String(part?.part||''),String(part?.status||'unsupported')]));
}

function reviewerStatusByPart(item){
 const trace=item?.evidenceTrace?.reviewContract;
 const planParts=Array.isArray(trace?.partDecisions)?trace.partDecisions:[];
 const planned=Array.isArray(item?.plannerPlan?.parts)?item.plannerPlan.parts:[];
 return new Map(planParts.map(decision=>{
  const part=planned.find(value=>String(value?.id||'')===String(decision?.partId||''));
  return [String(decision?.partId||''),{
   reviewerStatus:String(decision?.reviewerStatus||'missing'),
   reviewFinalStatus:String(decision?.finalStatus||'unanswered'),
   returnedStatus:part?String(finalStatusByPart(item).get(String(part.question||''))||'unsupported'):'unsupported'
  }];
 }));
}

/* Return trace facts separately from interpretation so tests and reports can
 * distinguish candidate loss, a non-best highlight, and a stale status field. */
export function auditPassageGoldReview(report,gold){
 if(!report||!Array.isArray(report.cases))throw Error('Input must be a saved live evaluation report.');
 if(gold?.schema!=='antilogicalism-reading-companion-passage-gold-v1'||!Array.isArray(gold.cases))
  throw Error('Passage review gold fixture has an unsupported schema.');
 const reportCases=new Map(report.cases.map(item=>[String(item?.id||''),item]));
 const cases=gold.cases.map(spec=>{
  const item=reportCases.get(spec.id);
  if(!item)return {id:spec.id,found:false,claimChecks:[],statusChecks:[]};
  const candidates=tracePageSet(item.retrievalCandidates);
  const submitted=tracePageSet(item.submittedSources);
  const sources=sourcePageMap(item);
  const highlights=Array.isArray(item.evidenceHighlights)?item.evidenceHighlights:[];
  const claimChecks=(spec.claims||[]).map(claim=>{
   const passages=Array.isArray(claim.passages)?claim.passages:[];
   const best=passages.filter(value=>value.label==='best'||value.label==='tied');
   const claimIds=new Set([claim.claimId,...(claim.claimIdAliases||[])].map(String));
   const claimHighlights=highlights.filter(value=>claimIds.has(String(value?.claimId||value?.claim_id||'')))
    .map(value=>{
     const source=sources.get(String(value?.sourceId||value?.source_id||''));
     const key=pageKey(source);
     const passage=passages.find(candidate=>pageKey(candidate)===key);
     return {bookId:String(source?.bookId||''),page:Number.isSafeInteger(source?.page)?source.page:null,
      label:passage?.label||'unrated',quoteLocated:value?.quoteLocated===true};
    });
   return {claimId:claim.claimId,partId:claim.partId,
    bestCandidates:best.map(page=>({bookId:page.bookId,page:page.page})),
    bestCandidateInPool:best.some(page=>candidates.has(pageKey(page))),
    bestCandidateSubmitted:best.some(page=>submitted.has(pageKey(page))),
    submittedPassages:passages.filter(page=>submitted.has(pageKey(page)))
     .map(({bookId,page,label})=>({bookId,page,label})),
    highlights:claimHighlights,
    nonBestHighlights:claimHighlights.filter(value=>!['best','tied','acceptable'].includes(value.label))};
  });
  const reviewerStatuses=reviewerStatusByPart(item);
  const statusChecks=(spec.partStatusChecks||[]).map(expected=>{
   const observed=reviewerStatuses.get(expected.partId)||{
    reviewerStatus:'missing',reviewFinalStatus:'missing',returnedStatus:'missing'};
   return {...expected,...observed,consistent:observed.reviewFinalStatus===
    (observed.returnedStatus==='supported'?'answered':observed.returnedStatus)};
  });
  return {id:spec.id,found:true,claimChecks,statusChecks};
 });
 const checked=cases.filter(item=>item.found);
 const claimChecks=checked.flatMap(item=>item.claimChecks);
 const statusChecks=checked.flatMap(item=>item.statusChecks);
 return {schema:'antilogicalism-reading-companion-passage-review-audit-v1',
  sourceRunId:gold.sourceRun?.runId??null,
  scope:gold.sourceRun?.scope||'',networkCalls:0,aiCalls:0,
  checkedCases:checked.length,missingCases:cases.length-checked.length,
  // Separate retrieval misses from packet loss so a zero packet-loss count
  // cannot hide a passage that never reached the candidate pool.
  bestCandidateRetrievalMisses:claimChecks.filter(item=>item.bestCandidates.length>0&&!item.bestCandidateInPool).length,
  bestCandidatePacketMisses:claimChecks.filter(item=>item.bestCandidateInPool&&!item.bestCandidateSubmitted).length,
  nonBestHighlights:claimChecks.reduce((sum,item)=>sum+item.nonBestHighlights.length,0),
  statusMismatches:statusChecks.filter(item=>!item.consistent).length,cases};
}
