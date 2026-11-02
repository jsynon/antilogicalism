const DIMENSIONS=['accuracy','questionCoverage','explanationQuality','citationSupport','citationCompleteness'];

function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
 return value;
}
function caseKey(item){return JSON.stringify([String(item.id||''),item.attemptNumber??null,
 item.answerVariant||'with-review',item.selectionVariant||null]);}
function revisions(report){
 const values=Array.isArray(report.workerSourceRevisions)?report.workerSourceRevisions:
  (report.cases||[]).map(item=>item.workerSourceRevision).filter(Boolean);
 return [...new Set(values.map(String))].sort();
}
function outputScore(item,kind,label){
 if(item.noAnswerFailure===true||!String(item.answerText||'').trim())return 0;
 const review=kind==='answer'?item.manualReview:item.highlightHumanReview;
 const scores=review?.scores;
 if(review?.status!=='complete'||!scores||DIMENSIONS.some(key=>
   !Number.isInteger(scores[key])||scores[key]<0||scores[key]>2))
  throw Error(`${label}: ${item.id} is missing a complete ${kind} scorecard.`);
 return DIMENSIONS.reduce((sum,key)=>sum+scores[key],0);
}
function mean(values){return values.length?Number((values.reduce((sum,value)=>sum+value,0)/values.length).toFixed(2)):null;}
function summarize(cases,kind,label){
 const rows=cases.map(item=>({failed:item.noAnswerFailure===true||!String(item.answerText||'').trim(),
  score:outputScore(item,kind,label)}));
 const produced=rows.filter(row=>!row.failed).map(row=>row.score);
 return {produced:produced.length,failed:rows.length-produced.length,
  producedOnlyAverageOutOf10:mean(produced),
  completionAdjustedAverageOutOf10:rows.length?mean(rows.map(row=>row.score)):null};
}

/** Compare two fully scored reports without hiding panel/config/revision differences. */
export function compareQualityEvaluations(before,after){
 for(const [name,report] of [['before',before],['after',after]])
  if(!report||!Array.isArray(report.cases)||!report.cases.length)
   throw Error(`${name} evaluation must contain cases.`);
 const beforeCases=before.cases,afterCases=after.cases;
 if(beforeCases.length!==afterCases.length)
  throw Error('Evaluations must contain the same number of cases.');
 const beforeByKey=new Map(beforeCases.map(item=>[caseKey(item),item]));
 if(beforeByKey.size!==beforeCases.length)throw Error('Before evaluation contains duplicate case identities.');
 const rows=[];
 for(const next of afterCases){
  const key=caseKey(next),prior=beforeByKey.get(key);
  if(!prior)throw Error(`After evaluation has no matching before case: ${next.id}.`);
  if(String(prior.question||'')!==String(next.question||''))
   throw Error(`Question text changed for case ${next.id}.`);
  if(String(prior.evaluationScope||'')!==String(next.evaluationScope||''))
   throw Error(`Evaluation scope changed for case ${next.id}.`);
  const priorBooks=Array.isArray(prior.selectedBookIds)?[...prior.selectedBookIds].map(String).sort():[];
  const nextBooks=Array.isArray(next.selectedBookIds)?[...next.selectedBookIds].map(String).sort():[];
  if(JSON.stringify(priorBooks)!==JSON.stringify(nextBooks))
   throw Error(`Selected book scope changed for case ${next.id}.`);
  const beforeFailed=prior.noAnswerFailure===true||!String(prior.answerText||'').trim();
  const afterFailed=next.noAnswerFailure===true||!String(next.answerText||'').trim();
  const beforeAnswer=outputScore(prior,'answer','before');
  const afterAnswer=outputScore(next,'answer','after');
  const beforeHighlights=outputScore(prior,'highlights','before');
  const afterHighlights=outputScore(next,'highlights','after');
  rows.push({caseId:String(next.id),...(Number.isInteger(next.attemptNumber)?{attemptNumber:next.attemptNumber}:{}),
   question:String(next.question||''),beforeFailed,afterFailed,
   answer:{before:beforeAnswer,after:afterAnswer,delta:afterAnswer-beforeAnswer},
   highlights:{before:beforeHighlights,after:afterHighlights,delta:afterHighlights-beforeHighlights}});
  beforeByKey.delete(key);
 }
 if(beforeByKey.size)throw Error('Before evaluation contains cases missing from after evaluation.');
 const sameSettings=JSON.stringify(stable({mode:before.mode,searchScope:before.searchScope,
  answerVariant:before.answerVariant,retrievalProfile:before.retrievalProfile,
  retrievalConfig:before.retrievalConfig}))===JSON.stringify(stable({mode:after.mode,
  searchScope:after.searchScope,answerVariant:after.answerVariant,
  retrievalProfile:after.retrievalProfile,retrievalConfig:after.retrievalConfig}));
 const beforeRevisions=revisions(before),afterRevisions=revisions(after);
 const sameWorkerRevisions=JSON.stringify(beforeRevisions)===JSON.stringify(afterRevisions);
 const beforeAnswer=summarize(beforeCases,'answer','before');
 const afterAnswer=summarize(afterCases,'answer','after');
 const beforeHighlights=summarize(beforeCases,'highlights','before');
 const afterHighlights=summarize(afterCases,'highlights','after');
 return {schema:'antilogicalism-reading-companion-quality-comparison-v1',
  panelMatched:true,settingsMatched:sameSettings,sameWorkerRevisions,
  beforeWorkerRevisions:beforeRevisions,afterWorkerRevisions:afterRevisions,
  beforeRunId:before.evaluationRun?.runId||null,afterRunId:after.evaluationRun?.runId||null,
  caseCount:rows.length,
  answer:{before:beforeAnswer,after:afterAnswer,
   producedOnlyDelta:beforeAnswer.producedOnlyAverageOutOf10===null||afterAnswer.producedOnlyAverageOutOf10===null?null:
    Number((afterAnswer.producedOnlyAverageOutOf10-beforeAnswer.producedOnlyAverageOutOf10).toFixed(2)),
   completionAdjustedDelta:beforeAnswer.completionAdjustedAverageOutOf10===null||afterAnswer.completionAdjustedAverageOutOf10===null?null:
    Number((afterAnswer.completionAdjustedAverageOutOf10-beforeAnswer.completionAdjustedAverageOutOf10).toFixed(2))},
  highlights:{before:beforeHighlights,after:afterHighlights,
   producedOnlyDelta:beforeHighlights.producedOnlyAverageOutOf10===null||afterHighlights.producedOnlyAverageOutOf10===null?null:
    Number((afterHighlights.producedOnlyAverageOutOf10-beforeHighlights.producedOnlyAverageOutOf10).toFixed(2)),
   completionAdjustedDelta:beforeHighlights.completionAdjustedAverageOutOf10===null||afterHighlights.completionAdjustedAverageOutOf10===null?null:
    Number((afterHighlights.completionAdjustedAverageOutOf10-beforeHighlights.completionAdjustedAverageOutOf10).toFixed(2))},
  cases:rows,
  interpretation:sameSettings&&sameWorkerRevisions?
   'Matched cases, settings, and Worker revisions; differences are repeat-run variation, not a code-change effect.':
   'Matched case panel. Treat score deltas as descriptive; changed settings or Worker revisions prevent attributing the difference to one cause.'};
}
