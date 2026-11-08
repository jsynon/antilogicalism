Warning: truncated output (original token count: 32226)
Total output lines: 1916

import test from 'node:test';
import assert from 'node:assert/strict';
import {auditLiveAnswer,auditHighlightClaimCoverage,auditSelectionHandoff,auditEvidenceContinuity,summarizeEvidenceContinuity,recheckQualityReport,applyHumanScorecard,createHumanScorecardTemplate,evaluationRunContext,selectLiveCases,applyQualityScope,evaluationUsesLivePlanner,evaluateLiveCase,evaluatePlannerCase,runLiveCases,runPairedScopeCases,restrictPlanToSelectedBooks,summarizeManualReviews,summarizeHighlightReviews,summarizeAnswerVariants,summarizeReviewerLabels,summarizePipelineFailures,summarizeQualityByFailureStage,partFacetsFromPlan,validatePublishedCorpus,validateEvaluationBookScopes,sourcesUsedForWorkerSelection,summarizeInferenceTransport} from './live-answer-evaluation.mjs';
import {LIVE_RETRIEVAL_CONFIG} from './evidence-search.mjs';

const suite={cases:[{id:'science-hawking-black-holes'},{id:'philosophy-aristotle-habituation'}]};

test('live evaluation preflight accepts only matching v49 corpus and fingerprint coverage',()=>{
 const coverage={schema:'antilogicalism-reader-coverage-v3',libraryVersion:49,
  books:{'7':{title:'Nicomachean Ethics — Aristotle'}}};
 const allowed=validatePublishedCorpus(coverage,{version:49});
 assert.deepEqual([...allowed],['7']);
 assert.throws(()=>validatePublishedCorpus({...coverage,libraryVersion:48},{version:49}),
  /expected v49; fingerprint coverage v48, corpus v49/);
 assert.throws(()=>validatePublishedCorpus(coverage,{version:48}),
  /expected v49; fingerprint coverage v49, corpus v48/);
});

test('live evaluation preflight rejects selected or expected books missing from published coverage',()=>{
 const allowed=new Set(['40','44']);
 const manifest={books:{'40':{title:'Critique of Pure Reason'},'44':{title:'Prolegomena'}}};
 assert.equal(validateEvaluationBookScopes([
  {id:'focused-kant',selected_book_ids:['40','44'],required_source_groups:[{book_ids:['40','44']}]}
 ],allowed,manifest),true);
 assert.throws(()=>validateEvaluationBookScopes([
  {id:'focused-sunyata',selected_book_ids:['178'],required_source_groups:[]}
 ],allowed,manifest),/focused-sunyata: selected book 178 is not present/);
 assert.throws(()=>validateEvaluationBookScopes([
  {id:'cross-work',selected_book_ids:[],required_source_groups:[{book_ids:['35']}]}
 ],allowed,manifest),/cross-work: no expected source book is fingerprint-covered/);
});

test('handoff suite covers five cases with three all-books and two selected-book controls',()=>{
 const cases=selectLiveCases(suite,'handoff','all');
 assert.equal(cases.length,5);
 assert.equal(cases.filter(item=>item.evaluation_scope==='all-books').length,3);
 assert.equal(cases.filter(item=>item.evaluation_scope==='selected-books').length,2);
 assert.equal(cases.filter(item=>item.id.includes('technology')||item.id.includes('odyssey')).length,2);
 assert.ok(evaluationUsesLivePlanner('handoff','case-default'));
 assert.deepEqual(applyQualityScope(cases,'case-default').map(item=>item.selected_book_ids),
  [[],[],[],['186'],['51']]);
});
test('handoff suite permits one selected diagnostic case and keeps questions open-ended',()=>{
 const selected=selectLiveCases(suite,'handoff','handoff-selected-odyssey-homecoming');
 assert.equal(selected.length,1);
 assert.deepEqual(selected[0].selected_book_ids,['186']);
 assert.match(selected[0].question,/choices and the poem’s picture of heroism/);
 assert.deepEqual(selected[0].review_focus,[]);
});
test('phase-2 library-all suite covers eight open all-books questions with no expected sources',()=>{
 const cases=selectLiveCases(suite,'library-all','all');
 assert.equal(cases.length,8);
 assert.ok(cases.every(item=>item.evaluation_scope==='all-books'));
 assert.ok(cases.every(item=>item.selected_book_ids.length===0));
 assert.ok(cases.every(item=>item.required_source_groups.length===0&&item.review_focus.length===0));
 assert.ok(cases.every(item=>item.planner_queries.length===1&&item.planner_queries[0]===item.question));
 assert.ok(evaluationUsesLivePlanner('library-all','case-default'));
 assert.deepEqual(applyQualityScope(cases,'case-default').map(item=>item.selected_book_ids),
  cases.map(()=>[]));
 assert.deepEqual(cases.map(item=>item.discipline),
  ['philosophy','philosophy','literature','history','science','history','literature','society']);
});
test('phase-2 library-selected suite scopes eight questions to eight distinct catalog books',()=>{
 const cases=selectLiveCases(suite,'library-selected','all');
 assert.equal(cases.length,8);
 assert.ok(cases.every(item=>item.evaluation_scope==='selected-books'));
 assert.ok(cases.every(item=>item.selected_book_ids.length===1));
 assert.equal(new Set(cases.map(item=>item.selected_book_ids[0])).size,8);
 assert.ok(cases.every(item=>item.required_source_groups.length===1&&
  item.required_source_groups[0].book_ids.length===1&&
  item.required_source_groups[0].book_ids[0]===item.selected_book_ids[0]));
 assert.ok(cases.every(item=>item.planner_queries.length===1&&item.planner_queries[0]===item.question));
 assert.ok(evaluationUsesLivePlanner('library-selected','case-default'));
 assert.deepEqual(applyQualityScope(cases,'case-default').map(item=>item.selected_book_ids),
  [['315'],['241'],['74'],['103'],['140'],['260'],['89'],['18']]);
});
test('phase-2 suites permit one selected case and no question duplicates an earlier suite',()=>{
 const selected=selectLiveCases(suite,'library-selected','library-selected-plato-republic-images');
 assert.equal(selected.length,1);
 assert.deepEqual(selected[0].selected_book_ids,['74']);
 assert.throws(()=>selectLiveCases(suite,'library-selected','not-a-library-case'),/Unknown library-selected case/);
 assert.throws(()=>selectLiveCases(suite,'library-all','library-selected-plato-republic-images'),/Unknown library-all case/);
 assert.throws(()=>selectLiveCases(suite,'smoke','library-all-suffering-responses'),
  /only in quality, focused, paired, holdout or acceptance mode/);
 const earlierQuestions=new Set(),earlierIds=new Set();
 for(const mode of ['quality','focused','paired','holdout','acceptance','fresh','fresh3','handoff','philosophy3']){
  for(const item of selectLiveCases({cases:[]},mode,'all')){earlierQuestions.add(item.question);earlierIds.add(item.id);}
 }
 const phase2=[...selectLiveCases({cases:[]},'library-all','all'),
  ...selectLiveCases({cases:[]},'library-selected','all')];
 assert.equal(new Set(phase2.map(item=>item.question)).size,16,'phase-2 questions are mutually distinct');
 assert.ok(phase2.every(item=>!earlierQuestions.has(item.question)),
  'no phase-2 question duplicates an earlier suite question');
 assert.ok(phase2.every(item=>!earlierIds.has(item.id)),'no phase-2 case id repeats an earlier suite');
});
test('batch-17 transport suite pairs all 16 phase-2 questions without changing their scopes',()=>{
 const cases=selectLiveCases({cases:[]},'transport-ab','all');
 assert.equal(cases.length,16);
 assert.equal(cases.filter(item=>item.evaluation_scope==='all-books').length,8);
 assert.equal(cases.filter(item=>item.evaluation_scope==='selected-books').length,8);
 assert.equal(new Set(cases.map(item=>item.id)).size,16);
 assert.equal(evaluationUsesLivePlanner('transport-ab','case-default'),true);
});

test('batch-17 stage profile selects the four registered all-books and selected-book cases',()=>{
 const cases=selectLiveCases({cases:[]},'transport-ab','stage-profile-4');
 assert.deepEqual(cases.map(item=>item.id),[
  'library-all-hobbes-rousseau-nature','library-all-progress-idea',
  'library-selected-conrad-marlow-kurtz','library-selected-kierkegaard-silentio-speaker'
 ]);
 assert.equal(cases.filter(item=>item.evaluation_scope==='all-books').length,2);
 assert.equal(cases.filter(item=>item.evaluation_scope==='selected-books').length,2);
});

test('batch-18 acceptance is one balanced four-question configured-default screen',()=>{
 const cases=selectLiveCases({cases:[]},'batch18-acceptance','stage-profile-4');
 assert.deepEqual(cases.map(item=>item.id),[
  'library-all-hobbes-rousseau-nature','library-all-progress-idea',
  'library-selected-conrad-marlow-kurtz','library-selected-kierkegaard-silentio-speaker'
 ]);
 assert.equal(cases.filter(item=>item.evaluation_scope==='all-books').length,2);
 assert.equal(cases.filter(item=>item.evaluation_scope==='selected-books').length,2);
 assert.equal(evaluationUsesLivePlanner('batch18-acceptance','case-default'),true);
});

test('batch-19 acceptance reuses the same four registered questions and live planner path',()=>{
 const cases=selectLiveCases({cases:[]},'batch19-acceptance','stage-profile-4');
 assert.deepEqual(cases.map(item=>item.id),[
  'library-all-hobbes-rousseau-nature','library-all-progress-idea',
  'library-selected-conrad-marlow-kurtz','library-selected-kierkegaard-silentio-speaker'
 ]);
 assert.equal(cases.filter(item=>item.evaluation_scope==='all-books').length,2);
 assert.equal(cases.filter(item=>item.evaluation_scope==='selected-books').length,2);
 assert.equal(evaluationUsesLivePlanner('batch19-acceptance','case-default'),true);
});

test('batch-18 workflow is a single with-review pass that uses configured transport',async()=>{
 const {readFileSync}=await import('node:fs');
 const workflow=readFileSync(new URL('../.github/workflows/reading-companion-batch-18-acceptance.yml',import.meta.url),'utf8');
 assert.match(workflow,/--mode batch18-acceptance --scope case-default --case stage-profile-4/);
 assert.match(workflow,/--repeat 1 --answer-variant with-review/);
 assert.match(workflow,/name: reading-companion-batch-18-acceptance/);
 assert.doesNotMatch(workflow,/--answer-variant transport-ab/);
});

test('batch-19 workflow is one compact-review acceptance pass over four cases',async()=>{
 const {readFileSync}=await import('node:fs');
 const workflow=readFileSync(new URL('../.github/workflows/reading-companion-batch-19-acceptance.yml',import.meta.url),'utf8');
 assert.match(workflow,/--mode batch19-acceptance --scope case-default --case stage-profile-4/);
 assert.match(workflow,/--repeat 1 --answer-variant with-review/);
 assert.match(workflow,/timeout-minutes: 25/);
 assert.match(workflow,/name: reading-companion-batch-19-acceptance/);
});

test('Batch 21 compact acceptance is one eight-case pass split across both library scopes',async()=>{
 const cases=selectLiveCases({cases:[]},'batch21-compact-acceptance','compact-8');
 assert.equal(cases.length,8);
 assert.equal(cases.filter(item=>item.evaluation_scope==='all-books').length,4);
 assert.equal(cases.filter(item=>item.evaluation_scope==='selected-books').length,4);
 assert.equal(new Set(cases.map(item=>item.id)).size,8);
 assert.ok(evaluationUsesLivePlanner('batch21-compact-acceptance','case-default'));
 assert.deepEqual(applyQualityScope(cases,'case-default').map(item=>item.selected_book_ids.length>0),
  [false,false,false,false,true,true,true,true]);
 const {readFileSync}=await import('node:fs');
 const workflow=readFileSync(new URL('../.github/workflows/reading-companion-batch-21-compact-acceptance.yml',import.meta.url),'utf8');
 assert.match(workflow,/--mode batch21-compact-acceptance --scope case-default --case compact-8 --repeat 1/);
 assert.match(workflow,/timeout-minutes: 60/);
 assert.match(workflow,/--answer-variant with-review/);
 assert.match(workflow,/name: reading-companion-batch-21-compact-acceptance/);
 assert.doesNotMatch(workflow,/--repeat 2|Pass 2|repeats:/);
});

test('transport summary distinguishes timer races, acknowledged stream cancellation and incomplete answers',()=>{
 const report=summarizeInferenceTransport([{id:'case-a',answerVariantComparison:{variants:[
  {inferenceTransport:'default',realWorkStageSumMs:100_000,evidenceTrace:{inferenceCalls:[{timeoutClassification:'timer-race-no-cancel'}]}},
  {inferenceTransport:'streaming',realWorkStageSumMs:90_000,evidenceTrace:{inferenceCalls:[{timeoutFired:true,timeoutClassification:'stream-cancel-acknowledged',providerInferenceCancellation:'unconfirmed'}]}}
 ]}},{id:'case-b',answerVariantComparison:{variants:[
  {inferenceTransport:'default',realWorkStageSumMs:140_000},
  {inferenceTransport:'streaming',realWorkStageSumMs:150_000,noAnswerFailure:true}
 ]}}]);
 assert.equal(report.default.attempts,2);
 assert.equal(report.default.structuralPasses,0);
 assert.equal(report.default.realWorkStageSumMs.median,120_000);
 assert.equal(report.default.timerRaceCases,1);
 assert.equal(report.default.acknowledgedStreamCancels,0);
 assert.equal(report.streaming.acknowledgedStreamCancels,1);
 assert.equal(report.streaming.unconfirmedProviderTerminations,1);
 assert.equal(report.streaming.successfulAnswers,1);
 assert.equal(report.streaming.requestFailures,1);
});

test('transport scorecard template uses rubric-v2 answer and highlight dimensions per path',()=>{
 const report={mode:'transport-ab',cases:[{id:'paired-case',question:'Question?',answerVariantComparison:{variants:[
  {inferenceTransport:'default',answerText:'Answer [S1].',evidenceHighlights:[{}]},
  {inferenceTransport:'streaming',noAnswerFailure:true,answerText:'',evidenceHighlights:[]}
 ]}}]};
 const card=createHumanScorecardTemplate(report);
 assert.equal(card.schema,'antilogicalism-reading-companion-phase2-rubric-v2-transport-scorecard');
 assert.deepEqual(Object.keys(card.scores[0].answer.scores),['accuracy','questionCoverage','explanationQuality','citationSupport','citationCompleteness']);
 assert.deepEqual(Object.keys(card.scores[0].highlights.scores),['fidelity','coverage','context','claimRelevance','completeness']);
 assert.equal(card.scores[1].inferenceTransport,'streaming');
 assert.equal(card.scores[1].noAnswerFailure,true);
 assert.equal(card.protocol.latency.medianMaximumSeconds,95);
 assert.equal(card.protocol.latency.p90MaximumSeconds,145);
});

test('malformed optional planner facets are dropped or fall back without blocking base retrieval',()=>{
 const result=partFacetsFromPlan([
  {id:'P1',question:'What did the priests say about Helen?',searchQueries:['']},
  {id:'P2',question:'How did Herodotus judge the account?',searchQueries:['valid search query for credibility',null]},
  {id:'bad',question:'Invalid planner part identifier',searchQueries:['another valid query']},
  {id:'P3',question:'Tiny',searchQueries:['valid but unusable query']},
 ]);
 assert.deepEqual(result.partQueries,[
  {partId:'P1',query:'What did the priests say about Helen?'},
  {partId:'P2',query:'valid search query for credibility'},
 ]);
 assert.deepEqual(result.partQuestions,[
  {partId:'P1',question:'What did the priests say about Helen?',sourceBookIds:null},
  {partId:'P2',question:'How did Herodotus judge the account?',sourceBookIds:null},
 ]);
 assert.ok(result.warnings.includes('invalid-part-query-fallback'));
 assert.ok(result.warnings.includes('invalid-part-query-dropped'));
 assert.ok(result.warnings.includes('invalid-part'));
});
test('planner author scopes survive into retrieval part metadata for coverage diagnosis',()=>{
 const result=partFacetsFromPlan([{id:'P1',
  question:'How does Augustine explain moral responsibility?',sourceBookIds:['16','17'],
  searchQueries:['Augustine responsibility free will']}]);
 assert.deepEqual(result.partQuestions,[{partId:'P1',
  question:'How does Augustine explain moral responsibility?',sourceBookIds:['16','17']}]);
});

test('planner facet links obey the shared unique-query and total-link budgets',()=>{
 const parts=Array.from({length:8},(_,index)=>({id:`P${index+1}`,
  question:`Question part ${index+1} with enough text`,searchQueries:[`shared query ${index+1} enough`]}));
 const result=partFacetsFromPlan(parts);
 assert.ok(result.partQueries.length<=12);
 assert.ok(new Set(result.partQueries.map(item=>item.query.toLowerCase())).size<=6);
 assert.ok(result.warnings.includes('part-query-budget-exceeded'));
});

test('planner query budget gives each part a first query before extra per-part angles',()=>{
 const parts=Array.from({length:4},(_,index)=>({id:`P${index+1}`,
  question:`Question part ${index+1} with enough text`,
  searchQueries:[`part ${index+1} primary search concept`,`part ${index+1} secondary search concept`]}));
 const result=partFacetsFromPlan(parts);
 assert.deepEqual(result.partQueries.slice(0,4).map(item=>item.partId),['P1','P2','P3','P4']);
 assert.deepEqual(result.partQueries.map(item=>item.partId),['P1','P2','P3','P4','P1','P2']);
 assert.ok(new Set(result.partQueries.map(item=>item.query.toLowerCase())).size<=6);
 assert.ok(result.partQueries.length<=12);
 assert.ok(result.warnings.includes('part-query-budget-exceeded'));
});

test('live answer audit preserves a valid no-evidence selector result as an empty selected set',()=>{
 const retrievalPacket=[{id:'C1',bookId:'283',page:412}];
 assert.deepEqual(sourcesUsedForWorkerSelection(
  {status:'no-relevant-evidence'},[],retrievalPacket),[]);
 assert.deepEqual(sourcesUsedForWorkerSelection(
  {status:'selected'},[{id:'S1',bookId:'7',page:20}],retrievalPacket),
  [{id:'S1',bookId:'7',page:20}]);
 assert.deepEqual(sourcesUsedForWorkerSelection(
  {status:'deterministic-fallback'},[],retrievalPacket),retrievalPacket);
});

test('smoke mode is exactly scripture plus two representative existing cases',()=>{
 const cases=selectLiveCases(suite,'smoke');
 assert.equal(cases.length,3);
 assert.equal(cases[0].id,'live-scripture-god-is-love');
 assert.equal(cases[1].id,'science-hawking-black-holes');
 assert.equal(cases[2].id,'philosophy-aristotle-habituation');
});

test('quality mode selects seven cross-discipline cases across selected-book and All Books scopes',()=>{
 const cases=selectLiveCases({cases:[]},'quality');
 assert.equal(cases.length,7);
 assert.deepEqual(new Set(cases.map(item=>item.discipline)),new Set(['science','history','literature','philosophy','religion']));
 assert.equal(cases.filter(item=>item.selected_book_ids.length>0).length,4);
 assert.equal(cases.filter(item=>item.selected_book_ids.length===0).length,3);
 assert.ok(cases.every(item=>item.planner_queries.length===2&&item.review_focus.length>=2));
});

test('the focused Kant case is selectable without changing the seven-case quality baseline',()=>{
 const baseline=selectLiveCases({cases:[]},'quality');
 assert.equal(baseline.length,7);
 assert.ok(!baseline.some(item=>item.id==='focused-kant-transcendental-idealism'));
 const [focused]=selectLiveCases({cases:[]},'quality','focused-kant-transcendental-idealism');
 assert.equal(focused.question,'What is transcendental idealism?');
 assert.deepEqual(focused.selected_book_ids,['40','44']);
 assert.deepEqual(focused.required_source_groups[0].book_ids,['40','44']);
 assert.equal(focused.planner_queries.length,3);
 assert.ok(focused.review_focus.some(item=>/enough distinct, relevant passages/.test(item)));
 assert.ok(focused.review_focus.some(item=>/Exact quote location alone is not evidence of semantic support/.test(item)));
 assert.throws(()=>selectLiveCases({cases:[]},'holdout','focused-kant-transcendental-idealism'),/Unknown holdout case/);
});

test('focused live cases retain curated scopes and keep the quality baseline unchanged',()=>{
 const baseline=selectLiveCases({cases:[]},'quality');
 const focused=selectLiveCases({cases:[]},'focused');
 assert.equal(baseline.length,7);
 assert.equal(focused.length,5);
 assert.deepEqual(focused.map(item=>item.id),[
  'focused-kant-transcendental-idealism','focused-kierkegaard-faith',
  'focused-nietzsche-christianity','focused-sunyata','focused-nietzsche-kierkegaard'
 ]);
 assert.deepEqual(focused.slice(1).map(item=>item.question),[
  'What did Kierkegaard have to say about faith?',
  'What did Nietzsche think about Christianity?',
  'What is sunyata?',
  'What would Nietzsche think about the thought of Kierkegaard?'
 ]);
 assert.deepEqual(focused.map(item=>item.selected_book_ids),[
  ['40','44'],['140','192','253'],['54','144','239'],['178','23','158'],['144','140','253']
 ],'each focused question needs a stable curated book scope for selected-books evaluation');
 assert.ok(focused.slice(1).every(item=>item.required_source_groups.length===0),
  'exploratory focused cases must not claim unverified expected corpus IDs');
 const selectedBooks=applyQualityScope(focused,'selected-books');
 assert.deepEqual(selectedBooks.map(item=>item.selected_book_ids),focused.map(item=>item.selected_book_ids));
 const allBooks=applyQualityScope(focused,'all-books');
 assert.ok(allBooks.every(item=>item.selected_book_ids.length===0),
  'All Books scope must remove each focused case’s selected-book restriction');
 assert.ok(focused.every(item=>item.selected_book_ids.length>0),
  'selected-books scope must never silently become an unscoped search');
 assert.equal(evaluationUsesLivePlanner('focused','selected-books'),false,
  'selected-books uses fixed case queries and skips the planner');
 assert.equal(evaluationUsesLivePlanner('focused','all-books'),true,
  'All Books uses the live planner');
 assert.equal(evaluationUsesLivePlanner('acceptance','all-books'),true);
 assert.equal(evaluationUsesLivePlanner('acceptance','selected-books'),false);
 assert.equal(selectLiveCases({cases:[]},'focused','focused-sunyata').length,1);
 assert.throws(()=>selectLiveCases({cases:[]},'focused','not-a-focused-case'),/Unknown focused case/);
 assert.throws(()=>selectLiveCases({cases:[]},'focused','quality-science-darwin-selection'),/Unknown focused case/);
});

test('paired new-question suite keeps its own seven cases and gives each a published selected scope',()=>{
 const focused=selectLiveCases({cases:[]},'focused');
 const paired=selectLiveCases({cases:[]},'paired');
 assert.equal(focused.length,5,'the previous focused workflow remains unchanged');
 assert.equal(paired.length,7);
 assert.ok(paired.every(item=>item.id.startsWith('paired-')&&item.selected_book_ids.length>0));
 assert.deepEqual(paired.map(item=>item.id),[
  'paired-hume-kant-causal-inference','paired-wollstonecraft-education-reason',
  'paired-dubois-double-consciousness','paired-boethius-fortune-wheel','paired-hamlet-conscience',
  'paired-nietzsche-good-evil','paired-diamond-sutra-giving'
 ]);
 assert.ok(paired.every(item=>item.planner_queries.length>=2&&item.review_focus.length>=2));
 const humeKant=paired.find(item=>item.id==='paired-hume-kant-causal-inference');
 assert.match(humeKant.question,/An Enquiry Concerning Human Understanding/);
 assert.match(humeKant.question,/Critique of Pure Reason/);
 assert.deepEqual(humeKant.selected_book_ids,['35','40'],
  'both scope modes should be evaluated against the same explicitly named source works');
 const nietzsche=paired.find(item=>item.id==='paired-nietzsche-good-evil');
 assert.deepEqual(nietzsche.selected_book_ids,['144']);
 assert.match(nietzsche.question,/origins of the contrast/);
 const diamond=paired.find(item=>item.id==='paired-diamond-sutra-giving');
 assert.deepEqual(diamond.selected_book_ids,['23']);
 assert.match(diamond.question,/without abiding in forms/);
 assert.ok(evaluationUsesLivePlanner('paired','paired'));
 assert.equal(selectLiveCases({cases:[]},'paired','paired-dubois-double-consciousness').length,1);
 assert.throws(()=>selectLiveCases({cases:[]},'paired','focused-sunyata'),/Unknown paired case/);
});

test('paired selected-scope plan is limited to the exact curated books',()=>{
 const plan={sources:[{label:'Hume',bookIds:['35','276']},{label:'Kant',bookIds:['40','44']}],
  parts:[{id:'P1',question:'Hume position',sourceBookIds:['35','276']},
   {id:'P2',question:'Kant position',sourceBookIds:['40','44']},
   {id:'P3',question:'Compare',sourceBookIds:['35','276','40','44']}]};
 const restricted=restrictPlanToSelectedBooks(plan,['35','40']);
 assert.deepEqual(restricted.sources.map(source=>source.bookIds),[['35'],['40']]);
 assert.deepEqual(restricted.parts.map(part=>part.sourceBookIds),[['35'],['40'],['35','40']]);
 assert.deepEqual(plan.sources.map(source=>source.bookIds),[['35','276'],['40','44']],
  'paired restriction must not mutate the reusable all-books plan');
});

test('paired runner calls the planner once and reuses the same query plan for selected-books',async()=>{
 const item={id:'paired-test',question:'Compare Hume and Kant on causality.',selected_book_ids:['35','40'],
  planner_queries:['Hume causal inference','Kant causal rule'],required_source_groups:[],review_focus:[]};
 const originalPlan={sources:[{label:'David Hume',role:'primary',bookIds:['35','276']},
  {label:'Immanuel Kant',role:'primary',bookIds:['40','44']}],parts:[
   {id:'P1',question:'Hume',sourceBookIds:['35','276']},{id:'P2',question:'Kant',sourceBookIds:['40','44']},
   {id:'P3',question:'Compare',sourceBookIds:['35','276','40','44']}]};
 const calls=[];
 const evaluateCase=async(scoped,options)=>{
  calls.push({scope:scoped.selected_book_ids.length?'selected-books':'all-books',options});
  if(!options.preparedPlan)return {id:scoped.id,passed:true,plannerPlan:originalPlan,
   plannerQueries:['shared planner query about Hume and Kant','shared causal query'],plannerFallback:false,
   plannerWorkerVersionId:'worker-1',plannerWorkerSourceBuild:'build',plannerWorkerSourceRevision:'a'.repeat(40)};
  return {id:scoped.id,passed:true,plannerPlan:restrictPlanToSelectedBooks(options.preparedPlan.plan,scoped.selected_book_ids),
   plannerQueries:options.preparedPlan.queries,plannerReused:true};
 };
 const run=await runPairedScopeCases([item],{evaluateCase,evaluateOptions:{},onResult:async()=>{}});
 assert.equal(run.results.length,2);
 assert.deepEqual(run.results.map(result=>result.scope),['all-books','selected-books']);
 assert.equal(calls.length,2,'selected-books reuses rather than repeats the planner call');
 assert.equal(calls[0].options.preparedPlan,undefined);
 assert.deepEqual(calls[1].options.preparedPlan.queries,
  ['shared planner query about Hume and Kant','shared causal query']);
 assert.deepEqual(run.results[1].plannerPlan.sources.map(source=>source.bookIds),[['35'],['40']]);
 assert.equal(run.results[1].plannerReused,true);
});

test('both manual answer workflows expose every registered focused case',async()=>{
 const {readFileSync}=await import('node:fs');
 const focusedIds=selectLiveCases({cases:[]},'focused').map(item=>item.id);
 for(const path of [
  new URL('../.github/workflows/reading-companion-live-answer-evaluation.yml',import.meta.url),
  new URL('../.github/workflows/reading-companion-holdout-answer-evaluation.yml',import.meta.url)
 ]){
  const workflow=readFileSync(path,'utf8');
  assert.match(workflow,/^\s+- focused\s*$/m);
  for(const id of focusedIds)assert.ok(workflow.includes(id),`${id} must be selectable in ${path.pathname}`);
 }
});

test('the separate paired-scope workflow exposes every new case and explicit live-call confirmation',async()=>{
 const {readFileSync}=await import('node:fs');
 const workflow=readFileSync(new URL('../.github/workflows/reading-companion-paired-scope-evaluation.yml',import.meta.url),'utf8');
 const pairedIds=selectLiveCases({cases:[]},'paired').map(item=>item.id);
 assert.match(workflow,/LIVE_EVAL_MODE: paired/);
 assert.match(workflow,/LIVE_EVAL_SCOPE: paired/);
 assert.match(workflow,/confirm_live_ai:/);
 assert.match(workflow,/node reading-companion\/live-answer-evaluation\.mjs --mode paired --scope paired/);
 for(const id of pairedIds)assert.ok(workflow.includes(id),`${id} must be selectable in paired workflow`);
});

test('holdout mode selects a separate seven-question set across disciplines',()=>{
 const cases=selectLiveCases({cases:[]},'holdout');
 assert.equal(cases.length,7);
 assert.deepEqual(new Set(cases.map(item=>item.discipline)),new Set(['history','literature','philosophy','religion','politics','society']));
 assert.equal(cases.filter(item=>item.selected_book_ids.length>0).length,4);
 assert.equal(cases.filter(item=>item.selected_book_ids.length===0).length,3);
 assert.ok(cases.every(item=>item.planner_queries.length===2&&item.review_focus.length>=2));
 assert.ok(cases.every(item=>item.id.startsWith('holdout-')));
 assert.equal(selectLiveCases({cases:[]},'quality').length,7,'the original quality baseline remains intact');
});

test('acceptance mode preserves its baseline and adds four calibration cases',()=>{
 const cases=selectLiveCases({cases:[]},'acceptance');
 assert.equal(cases.length,11);
 assert.ok(cases.every(item=>item.id.startsWith('acceptance-')&&item.selected_book_ids.length===0));
 assert.equal(new Set(cases.map(item=>item.id)).size,11);
 for(const id of ['acceptance-descartes-cogito','acceptance-mill-harm-principle','acceptance-epictetus-freedom',
  'acceptance-augustine-memory','acceptance-aristotle-tragedy-plot','acceptance-boethius-fortune',
  'acceptance-locke-political-authority'])assert.ok(cases.some(item=>item.id===id),id+' remains in the baseline');
 assert.deepEqual(cases.slice(-4).map(item=>item.id),[
  'acceptance-god-is-love','acceptance-simulation-hypothesis','acceptance-buddha-on-death',
  'acceptance-life-meaning-authors']);
 const focused=selectLiveCases({cases:[]},'acceptance','acceptance-god-is-love');
 assert.equal(focused.length,1);
 assert.deepEqual(focused[0].required_source_groups.map(group=>group.book_ids),[
  ['335','638','646']]);
 assert.match(focused[0].review_focus[0],/Bible source is required/);
 assert.match(focused[0].review_focus[1],/optional/);
 const simulation=selectLiveCases({cases:[]},'acceptance','acceptance-simulation-hypothesis');
 assert.equal(simulation.length,1);
 assert.deepEqual(simulation[0].planner_queries,[]);
 assert.deepEqual(simulation[0].required_source_groups,[]);
 assert.match(simulation[0].review_focus[0],/distinguish a general skeptical possibility/);
 assert.match(simulation[0].review_focus[1],/no particular author, school, or source is required/);
 assert.doesNotMatch(simulation[0].review_focus.join(' '),/Descartes|Berkeley|Hume/);
 const buddha=selectLiveCases({cases:[]},'acceptance','acceptance-buddha-on-death');
 assert.equal(buddha.length,1);
 assert.deepEqual(buddha[0].required_source_groups.map(group=>group.book_ids),[
  ['22','23','104','225']]);
 assert.match(buddha[0].review_focus[1],/more than one distinct work/);
 const meaning=selectLiveCases({cases:[]},'acceptance','acceptance-life-meaning-authors');
 assert.equal(meaning.length,1);
 assert.equal(meaning[0].question,"How do different authors in the library approach the question of life's meaning?");
 assert.deepEqual(meaning[0].planner_queries,[]);
 assert.deepEqual(meaning[0].required_source_groups,[]);
 assert.match(meaning[0].review_focus[0],/rather than listing works/);
 assert.match(meaning[0].review_focus[1],/multiple distinct approaches/);
 const calibration=selectLiveCases({cases:[]},'acceptance','quality-calibration');
 assert.deepEqual(calibration.map(item=>item.id),[
  'acceptance-god-is-love','acceptance-simulation-hypothesis','acceptance-buddha-on-death',
  'acceptance-life-meaning-authors']);
 assert.throws(()=>selectLiveCases({cases:[]},'acceptance','holdout-history-herodotus-helen'),/Unknown acceptance case/);
});

test('acceptance workflow lists all four calibration cases in sequence',async()=>{
 const {readFileSync}=await import('node:fs');
 const workflow=readFileSync(new URL('../.github/workflows/reading-companion-holdout-answer-evaluation.yml',import.meta.url),'utf8');
 assert.match(workflow, /^\s+- acceptance-god-is-love\s*\n\s+- acceptance-simulation-hypothesis\s*\n\s+- acceptance-buddha-on-death\s*\n\s+- acceptance-life-meaning-authors\s*$/m);
 const benchmark=readFileSync(new URL('../.github/workflows/reading-companion-quality-benchmark.yml',import.meta.url),'utf8');
 assert.match(benchmark,/Run calibration, one selected acceptance question, or the full frozen acceptance set/);
 assert.match(benchmark,/default: acceptance-buddha-on-death/);
 assert.match(benchmark,/case_id="\$BENCHMARK_CASE_ID"/);
});

test('holdout all-books scope and single-case selection behave independently of the baseline',()=>{
 const cases=selectLiveCases({cases:[]},'holdout');
 const allBooks=applyQualityScope(cases,'all-books');
 assert.equal(allBooks.length,7);
 assert.ok(allBooks.every(item=>item.selected_book_ids.length===0));
 assert.equal(cases.filter(item=>item.selected_book_ids.length>0).length,4,
  'applying all-books scope must not mutate holdout cases');
 const selected=selectLiveCases({cases:[]},'holdout','holdout-religion-james-faith-works');
 assert.equal(selected.length,1);
 assert.deepEqual(selected[0].required_source_groups[0].book_ids,['335']);
 assert.throws(()=>selectLiveCases({cases:[]},'holdout','quality-history-thucydides-causes'),/Unknown holdout case/);
 assert.throws(()=>selectLiveCases({cases:[]},'smoke','holdout-religion-james-faith-works'),/only in quality, focused, paired, holdout or acceptance mode/);
});

test('all-books quality scope runs every question without a selected-book restriction',()=>{
 const selected=selectLiveCases({cases:[]},'quality');
 const allBooks=applyQualityScope(selected,'all-books');
 assert.equal(allBooks.length,7);
 assert.ok(allBooks.every(item=>item.selected_book_ids.length===0));
 assert.ok(allBooks.every(item=>item.required_source_groups.length>=1));
 assert.equal(selected.filter(item=>item.selected_book_ids.length>0).length,4,
  'applying the scope must not mutate the selected-book suite');
 assert.throws(()=>applyQualityScope(selected,'invalid'),/Evaluation scope must be/);
});

test('quality mode can select exactly one named case for a low-cost live check',()=>{
 const id='quality-all-books-cross-work-science';
 const cases=selectLiveCases({cases:[]},'quality',id);
 assert.equal(cases.length,1);
 assert.equal(cases[0].id,id);
 assert.deepEqual(cases[0].required_source_groups.map(group=>group.book_ids),[['529'],['102']]);
 assert.throws(()=>selectLiveCases({cases:[]},'quality','not-a-quality-case'),/Unknown quality case/);
 assert.throws(()=>selectLiveCases({cases:[]},'smoke',id),/only in quality, focused, paired, holdout or acceptance mode/);
});

test('planner mode selects one selected-book case and one All Books cross-work case',()=>{
 const cases=selectLiveCases({cases:[]},'planner');
 assert.deepEqual(cases.map(item=>item.id),[
  'quality-philosophy-aristotle-practical-wisdom',
  'quality-all-books-cross-work-science'
 ]);
 assert.deepEqual(cases[0].selected_book_ids,['7']);
 assert.deepEqual(cases[1].selected_book_ids,[]);
});

test('full mode remains exactly the existing 30-case retrieval suite',()=>{
 const cases=selectLiveCases({cases:Array.from({length:30},(_,i)=>({id:'case-'+i}))},'full');
 assert.equal(cases.length,30);
});

test('audit requires expected-source coverage and citations with no orphan markers',()=>{
 const result=auditLiveAnswer({outcome:'verified-source-draft',coverage:'full',reviewStatus:'citations_not_claim_verified',
  answer:'A sourced claim [S1].',workerVersionId:'answer-version-1',workerSourceBuild:'gateway-build-1',
  workerSourceRevision:'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
  citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[{quoteLocated:true}]},[{bookId:'638'}],[{label:'Bible',book_ids:['638','646']}]);
 assert.equal(result.passed,true);
 assert.equal(result.workerVersionId,'answer-version-1');
 assert.equal(result.workerSourceBuild,'gateway-build-1');
 assert.equal(result.workerSourceRevision,'abcdef0123456789abcdef0123456789abcdef01');
 assert.deepEqual(result.sourceGroups[0].foundBookIds,['638']);
 assert.deepEqual(result.sourceGroups[0].retrievedBookIds,['638']);
 assert.deepEqual(result.sourceGroups[0].citedBookIds,['638']);
 assert.equal(result.sourceGroups[0].retrieved,true);
 assert.equal(result.sourceGroups[0].cited,true);
 const uncited=auditLiveAnswer({coverage:'partial',answer:'A supported claim [S1].',
  citations:[{id:'S1',bookId:'529'}]},[{bookId:'529'},{bookId:'102'}],
  [{label:'Hawking',book_ids:['102']}]);
 assert.deepEqual(uncited.sourceGroups[0].retrievedBookIds,['102']);
 assert.deepEqual(uncited.sourceGroups[0].citedBookIds,[]);
 assert.equal(uncited.sourceGroups[0].retrieved,true);
 assert.equal(uncited.sourceGroups[0].cited,false);
 assert.equal(uncited.sourceGroups[0].found,false);
 const bad=auditLiveAnswer({answer:'Unsupported [S2].',citations:[{id:'S1',bookId:'16'}]},[{}],[{label:'Bible',book_ids:['638']}]);
 assert.equal(bad.passed,false);
 assert.deepEqual(bad.inlineIdsWithoutSource,['S2']);
});

test('reader-facing internal claim and requirement IDs are counted and fail structural acceptance',()=>{
 const data={outcome:'verified-source-draft',coverage:'full',reviewStatus:'review',
  answer:'This is the answer (P1-C3), covering P1-R2. [S1].',
  citations:[{id:'S1',bookId:'35'}],questionParts:[],evidenceMap:[]};
 const result=auditLiveAnswer(data,[{bookId:'35',page:42}],[]);
 assert.deepEqual(result.answerInternalIdLeaks,['P1-C3','P1-R2']);
 assert.equal(result.internalIdLeakCount,2);
 assert.equal(result.structuralPassed,false);
});

test('answer case records preserve the Worker missing-evidence disclosure string',()=>{
 const missing='Retrieved passages could not be verified as supporting this part of the question: How does Hume explain necessity?';
 const result=auditLiveAnswer({outcome:'verified-source-draft',coverage:'partial',reviewStatus:'claim-review',
  answer:'A claim [S1].',missing,citations:[{id:'S1',bookId:'529'}]},[{bookId:'529'}],[]);
 assert.equal(result.missing,missing);
 const absent=auditLiveAnswer({answer:'A claim [S1].',citations:[{id:'S1',bookId:'529'}]},[{bookId:'529'}],[]);
 assert.equal(absent.missing,'','records keep a stable field when older Workers omit the disclosure');
});

test('citation highlight coverage is reported separately from structural answer validity',()=>{
 const citation={id:'S1',bookId:'529',title:'On the Origin of Species',page:18};
 const without=auditLiveAnswer({coverage:'full',answerCompleteness:'full',answer:'A supported claim [S1].',citations:[citation]},
  [{bookId:'529',page:18}],[]);
 assert.equal(without.structuralPassed,true);
 assert.deepEqual(without.citationHighlightAudit,{citedSourceCount:1,highlightedSourceCount:0,
  citedSourcesWithoutLocatedHighlight:['S1']});
 const withHighlight=auditLiveAnswer({coverage:'full',answerCompleteness:'full',answer:'A supported claim [S1].',citations:[citation],
  evidenceHighlights:[{source_id:'S1',page:18,quote:'Exact passage text.',quoteLocated:true}]},
  [{bookId:'529',page:18}],[]);
 assert.deepEqual(withHighlight.citationHighlightAudit,{citedSourceCount:1,highlightedSourceCount:1,
  citedSourcesWithoutLocatedHighlight:[]});
 assert.equal(withHighlight.structuralPassed,true);
});

test('audit records the gateway depth-repair summary and normalizes its absence',()=>{
 const base={coverage:'full',answerCompleteness:'full',answer:'A supported claim [S1].',
  citations:[{id:'S1',bookId:'529',title:'On the Origin of Species',page:18}]};
 const fired=auditLiveAnswer({...base,depthRepair:{triggered:true,reasons:['thin-part'],applied:true}},
  [{bookId:'529',page:18}],[]);
 assert.deepEqual(fired.depthRepair,{triggered:true,reasons:['thin-part'],applied:true});
 const absent=auditLiveAnswer(base,[{bookId:'529',page:18}],[]);
 assert.equal(absent.depthRepair,null);
 const malformed=auditLiveAnswer({...base,depthRepair:{triggered:'yes',reasons:'thin-part',applied:1}},
  [{bookId:'529',page:18}],[]);
 assert.deepEqual(malformed.depthRepair,{triggered:false,reasons:[],applied:false});
});

test('recorder keeps every claim link when box entries share one quote text (batch 9 B9-6)',()=>{
 const citation={id:'S1',bookId:'140',title:'Fear and Trembling',page:33};
 const quote='It is easy to see, though it scarcely needs to be pointed out, that Faith is not a form of knowledge.';
 const result=auditLiveAnswer({coverage:'full',answerCompleteness:'full',
  answer:'Faith is not a form of knowledge [S1].',citations:[citation],
  evidenceMap:[{id:'S1',claimId:'P1-C1'},{id:'S1',claimId:'P1-C2'},
   {id:'S1',claimId:'P1-C3'}],
  evidenceHighlights:[{source_id:'S1',page:33,quote,quoteLocated:true,quotes:[
   {claim_id:'P1-C1',part_id:'P1',point:'Faith is not a form of knowledge.',quote,claim_ids:['P1-C1','P1-C2'],box:0,quoteLocated:true},
   {claim_id:'P1-C2',part_id:'P1',point:'Fai…12226 tokens truncated…quired_source_groups:[]};
 await assert.rejects(evaluateLiveCase(item,{library:{search:async()=>{throw Error('offline search failure');}},
  manifest:{books:{}},allowed:new Set(),token:'x'.repeat(40),useFixedQueries:true}),
  error=>{assert.equal(error.requestFailure.stage,'retrieval');assert.equal(error.requestFailure.plannerSkipped,true);return true;});
});

test('partial Worker coverage is an evaluation miss even when citations and expected books are present',()=>{
 const result=auditLiveAnswer({coverage:'partial',answer:'Supported claim [S1].',citations:[{id:'S1',bookId:'638'}]},[{}],[{label:'Bible',book_ids:['638']}]);
 assert.equal(result.sourceGroups[0].found,true);
 assert.equal(result.passed,false);
});

test('answer completeness can pass independently while evidence coverage remains partial',()=>{
 const result=auditLiveAnswer({outcome:'verified-source-draft',reviewStatus:'claim-review',
  coverage:'partial',answerCompleteness:'full',answer:'A contextual answer with one reviewed source [S1].',
  citations:[{id:'S1',bookId:'638'}],evidenceMap:[{id:'S1',partId:'P1'}],
  questionParts:[{part:'The requested explanation',status:'partial',answerStatus:'answered',evidenceIds:['S1']}]
 },[{bookId:'638'}],[]);
 assert.equal(result.coverage,'partial','the evidence coverage label remains visible');
 assert.equal(result.answerCompleteness,'full');
 assert.equal(result.questionPartAnswerCompleteness.answered,1);
 assert.equal(result.partEvidenceComplete,true);
 assert.equal(result.structuralPassed,true);
});

test('selection handoff audit catches a selected direct passage dropped from its question part',()=>{
 const trace={stages:[{stage:'evidence-selection',status:'selected',
  decision:{selectedCandidateIds:['C10','C11','C14','C22','C17','C30'],parts:[
   {partId:'P1',candidateIds:['C10','C14','C22'],coverage:'partial',evidence:[
    {candidateId:'C10',support:'context'},{candidateId:'C14',support:'context'},
    {candidateId:'C22',support:'context'}]},
   {partId:'P2',candidateIds:['C11','C17','C30'],coverage:'supported',evidence:[
    {candidateId:'C11',support:'context'},{candidateId:'C14',support:'direct'},
    {candidateId:'C17',support:'context'},{candidateId:'C30',support:'context'}]}
  ]},selected:[
   {id:'S1',candidateId:'C10',candidatePartIds:['P1']},
   {id:'S2',candidateId:'C11',candidatePartIds:['P2']},
   {id:'S3',candidateId:'C14',candidatePartIds:['P1']},
   {id:'S4',candidateId:'C22',candidatePartIds:['P1']},
   {id:'S5',candidateId:'C17',candidatePartIds:['P2']},
   {id:'S6',candidateId:'C30',candidatePartIds:['P2']}
  ]}]};
 const handoff=auditSelectionHandoff(trace);
 assert.equal(handoff.status,'mismatch');
 assert.deepEqual(handoff.supportRelations,{direct:0,context:6},
  'a direct selector label without a selected part link is not counted as handed-off support');
 assert.equal(handoff.partsWithDirectEvidence,0);
 assert.equal(handoff.contextOnlyParts,2);
 assert.ok(handoff.issues.some(issue=>issue.code==='selected-evidence-part-link-missing'&&
  issue.partId==='P2'&&issue.candidateId==='C14'&&issue.support==='direct'));
 const answer=auditLiveAnswer({evidenceTrace:trace,outcome:'verified-source-draft',reviewStatus:'claim-review',
  coverage:'full',answerCompleteness:'full',answer:'A complete answer [S1].',
  citations:[{id:'S1',bookId:'7'}],evidenceMap:[{id:'S1',point:'A supported point.'}],
  questionParts:[{part:'The requested point',status:'supported',answerStatus:'answered',evidenceIds:['S1']}]},
  [{id:'S1',bookId:'7'}],[]);
 assert.equal(answer.selectionHandoffAudit.status,'mismatch');
 assert.equal(answer.structuralPassed,false,
  'a selection-stage support link lost before composition must not count as a structural pass');
});

test('selection handoff audit ignores explicit abstention and unavailable legacy traces',()=>{
 assert.equal(auditSelectionHandoff({stages:[{stage:'evidence-selection',status:'no-relevant-evidence'}]}).status,
  'not-applicable');
 assert.equal(auditSelectionHandoff({}).status,'unavailable');
 const oldSelectedTrace=auditSelectionHandoff({stages:[{stage:'evidence-selection',status:'selected',
  decision:{parts:[{partId:'P1',candidateIds:['C1'],coverage:'supported',
   evidence:[{candidateId:'C1',support:'direct'}]}]},selected:[{candidateId:'C1'}]}]});
 assert.equal(oldSelectedTrace.status,'unavailable');
 assert.equal(oldSelectedTrace.reason,'selection-part-links-not-recorded');
});

test('evidence continuity audit separates selector, composer, review, and final-answer dropoff by part',()=>{
 const composePayload={parts:[
  {partId:'P1',candidateSourceIds:['S1'],answerMode:'source-and-context'},
  {partId:'P2',candidateSourceIds:[],answerMode:'general-context'}
 ],evidence:[{id:'S1',selectionSupport:[{partId:'P1',support:'direct'}]}]};
 const trace={plan:{parts:[
  {id:'P1',question:'How does the view change?',candidateSourceIds:['S1']},
  {id:'P2',question:'What role do first impressions play?',candidateSourceIds:[]}
 ]},stages:[
  {stage:'evidence-selection',status:'selected',decision:{parts:[
   {partId:'P1',candidateIds:['C1'],coverage:'supported'},
   {partId:'P2',candidateIds:[],coverage:'none'}
  ]},selected:[{id:'S1',candidateId:'C1',candidatePartIds:['P1']}]},
  {stage:'compose',messages:[{role:'user',content:JSON.stringify(composePayload)}]},
  {stage:'review',elapsedMs:28000,payloadMetrics:{partCount:2,claimCount:11,sourceCount:1,
   spanCount:16,spanReferenceCount:16,serializedCharacters:7800}}
 ],reviewContract:{reviewDecisions:[{partId:'P1',claimId:'P1-C2',claimStatus:'partial',accepted:false}],
  partDecisions:[{partId:'P1',outputStatus:'partial',outputAnswerStatus:'partial'}]},
  final:{questionParts:[
   {part:'How does the view change?',answerStatus:'partial',evidenceIds:[]},
   {part:'What role do first impressions play?',answerStatus:'answered',evidenceIds:[]}
  ]}};
 const audit=auditEvidenceContinuity(trace);
 assert.equal(audit.status,'available');
 assert.deepEqual(audit.parts.map(part=>part.continuity),[
  'review-left-source-evidence-partial','general-context-answer'
 ]);
 assert.deepEqual(audit.parts[0].selectedSourceIds,['S1']);
 assert.deepEqual(audit.parts[0].composerEvidenceIds,['S1']);
 assert.equal(audit.parts[0].reviewedClaimCount,1);
 assert.equal(audit.parts[0].partialClaimCount,1);
 assert.equal(audit.reviewWorkload.elapsedMs,28000);
 assert.equal(audit.reviewWorkload.payloadMetrics.serializedCharacters,7800);
 const summary=summarizeEvidenceContinuity([{evidenceContinuityAudit:audit}]);
 assert.deepEqual(summary.continuityStatusCounts,{
  'review-left-source-evidence-partial':1,'general-context-answer':1
 });
 assert.equal(summary.reviewWorkload.averageClaimCount,11);
});

test('evidence continuity audit preserves timeout workload metrics when review fails',()=>{
 const audit=auditEvidenceContinuity({plan:{parts:[{id:'P1',question:'What does the source say?'}]},
  stages:[{stage:'compose',messages:[{role:'user',content:JSON.stringify({
    parts:[{partId:'P1',candidateSourceIds:['S1']}],evidence:[{id:'S1'}]})}]},
   {stage:'review',elapsedMs:60000,status:'failed',failureCode:'inference-deadline-exceeded',
   payloadMetrics:{partCount:1,claimCount:22,sourceCount:5,spanCount:49,spanReferenceCount:80,
    serializedCharacters:23811}}]});
 assert.equal(audit.parts[0].continuity,'review-timed-out');
 assert.equal(audit.reviewWorkload.failureCode,'inference-deadline-exceeded');
 assert.equal(summarizeEvidenceContinuity([{evidenceContinuityAudit:audit}]).reviewWorkload.timeoutCases,1);
});

test('selection handoff audit validates deterministic part-recovery links separately from selector decisions',()=>{
 const trace={stages:[{stage:'evidence-selection',status:'selected',
  decision:{selectedCandidateIds:['C1'],parts:[
   {partId:'P1',candidateIds:['C1'],coverage:'supported',evidence:[
    {candidateId:'C1',support:'direct'}]},
   {partId:'P2',candidateIds:[],coverage:'none',evidence:[]}
  ]},selected:[{id:'S1',candidateId:'C1',candidatePartIds:['P1','P2']}],
  recoveredPartLinks:[{partId:'P2',candidateId:'C1',retrievedCandidateId:'C2',
   reason:'retrieved-part-hint'}]}]};
 const valid=auditSelectionHandoff(trace);
 assert.equal(valid.status,'consistent');
 assert.equal(valid.checkedRelations,2);
 assert.deepEqual(valid.supportRelations,{direct:1,context:0});
 assert.equal(valid.partsWithDirectEvidence,1);
 assert.equal(valid.contextOnlyParts,0);
 const missing=auditSelectionHandoff({stages:[{...trace.stages[0],selected:[
  {id:'S1',candidateId:'C1',candidatePartIds:['P1']}
 ]}]});
 assert.equal(missing.status,'mismatch');
 assert.ok(missing.issues.some(issue=>issue.code==='recovered-part-link-missing'&&
  issue.partId==='P2'&&issue.candidateId==='C1'));
 const absent=auditSelectionHandoff({stages:[{...trace.stages[0],selected:[
  {id:'S1',candidateId:'C1',candidatePartIds:['P1','P2']}
 ],recoveredPartLinks:[{partId:'P2',candidateId:'C9'}]}]});
 assert.equal(absent.status,'mismatch');
 assert.ok(absent.issues.some(issue=>issue.code==='recovered-part-link-source-not-selected'));
});

test('selection audit reports context-only evidence separately from direct support',()=>{
 const result=auditSelectionHandoff({stages:[{stage:'evidence-selection',status:'selected',
  decision:{parts:[
   {partId:'P1',candidateIds:['C1'],coverage:'partial',evidence:[{candidateId:'C1',support:'context'}]},
   {partId:'P2',candidateIds:['C2','C3'],coverage:'supported',evidence:[
    {candidateId:'C2',support:'context'},{candidateId:'C3',support:'direct'}]}
  ]},selected:[
   {candidateId:'C1',candidatePartIds:['P1']},
   {candidateId:'C2',candidatePartIds:['P2']},
   {candidateId:'C3',candidatePartIds:['P2']}
  ]}]});
 assert.equal(result.status,'consistent');
 assert.deepEqual(result.supportRelations,{direct:1,context:2});
 assert.equal(result.partsWithDirectEvidence,1);
 assert.equal(result.contextOnlyParts,1);
});

test('complete general-context answer can pass with partial library coverage',()=>{
 const result=auditLiveAnswer({outcome:'general-context-answer',reviewStatus:'general-context-review',
  coverage:'partial',answerCompleteness:'full',answer:'A direct, qualified answer from general knowledge.',
  citations:[],questionParts:[{part:'The requested explanation',status:'partial',
   answerStatus:'answered',evidenceIds:[]}]},[],[]);
 assert.equal(result.coverage,'partial','library evidence coverage remains visible');
 assert.equal(result.answerCompleteness,'full');
 assert.equal(result.evidenceApplicability,'not-applicable');
 assert.equal(result.answerCoverageConsistent,true);
 assert.equal(result.structuralPassed,true);
});

test('partial general-context review does not pass as a complete answer',()=>{
 const result=auditLiveAnswer({outcome:'general-context-answer',reviewStatus:'general-context-review',
  coverage:'none',answerCompleteness:'partial',answer:'A related but incomplete explanation.',
  citations:[],questionParts:[{part:'The requested explanation',status:'unsupported',
   answerStatus:'partial',evidenceIds:[]}]},[],[]);
 assert.equal(result.evidenceApplicability,'required');
 assert.equal(result.answerCompleteness,'partial');
 assert.equal(result.structuralPassed,false);
});

test('case evaluation sends one selected-book plan and one answer request in order without logging the token',async()=>{
 const calls=[],searched=[],progress=[];
 const library={search:async(query)=>{searched.push(query);return {sources:[{id:'S1',bookId:'638',title:'Bible',page:10,globalPageId:10,url:'https://drive.google.com/file/d/abcdefghijk/view#page=10',preview:'A sufficiently long preview passage for testing.',score:4}]};},
  jsonGzip:async()=>({pages:[{id:10,page:10,text:'A sufficiently long source passage for the fake test page.'}]})};
 const item={question:'Explain the source question.',selected_book_ids:['638'],required_source_groups:[{label:'Bible',book_ids:['638']}]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{638:{title:'Bible'}}},allowed:new Set(['638']),token:'x'.repeat(40),
  beforeCall:async()=>{},onProgress:event=>progress.push(event),fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body),authorization:options.headers.authorization});
   return new Response(JSON.stringify(url.endsWith('pilot-plan')?{queries:['first distinct search concept','second distinct search concept'],
    plan:{parts:[{id:'P1',question:item.question}]},
    workerVersionId:'plan-worker-3',workerSourceBuild:'gateway-build-3'}:
    {outcome:'verified-source-draft',coverage:'full',reviewStatus:'review',answer:'Claim [S1].',workerVersionId:'answer-worker-3',workerSourceBuild:'gateway-build-3',citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[]}),{status:200,headers:{'content-type':'application/json'}});}});
 assert.equal(calls.length,2);
 assert.match(calls[0].url,/pilot-plan$/);assert.match(calls[1].url,/pilot-answer$/);
 assert.equal(calls[0].body.bookId,'638');
 assert.equal(calls[0].authorization,'Bearer '+'x'.repeat(40));
 assert.equal(result.passed,true);
 assert.equal(result.plannerWorkerVersionId,'plan-worker-3');
 assert.equal(result.answerWorkerVersionId,'answer-worker-3');
 assert.deepEqual(searched,['first distinct search concept','second distinct search concept',item.question]);
 assert.equal(result.searches[2].query,item.question+' [named books: 638]');
 assert.equal(calls[1].body.bookId,'638');
 assert.deepEqual(calls[1].body.sources[0].candidatePartIds,['P1'],
  'the Worker receives retrieval part links as hints for matching pages to plan parts');
 assert.deepEqual(result.submittedSources[0].candidatePartIds,['P1']);
 assert.deepEqual(result.retrievalCandidates.map(source=>source.bookId+':'+source.page),['638:10']);
 assert.ok(!JSON.stringify(result).includes('x'.repeat(40)));
 assert.deepEqual(progress.filter(event=>['case','planner','retrieval'].includes(event.stage))
  .map(event=>event.stage+':'+event.status),[
   'case:started','planner:started','planner:completed','retrieval:started','retrieval:completed']);
 const retrievalCompleted=progress.find(event=>event.stage==='retrieval'&&event.status==='completed');
 assert.deepEqual(retrievalCompleted.candidatePages,[{bookId:'638',page:10,partIds:['P1']}]);
 assert.deepEqual(retrievalCompleted.selectedPages,[{bookId:'638',page:10,partIds:['P1']}]);
 assert.ok(progress.some(event=>event.stage==='answer'&&event.status==='started'&&/Worker will select evidence before composition/.test(event.message)));
 assert.ok(progress.some(event=>event.stage==='answer'&&event.status==='completed'&&/verified-source-draft/.test(event.message)));
 assert.ok(!JSON.stringify(progress).includes('x'.repeat(40)));
});

test('conditional search can recover when the initial retrieval returns no pages',async()=>{
 const calls=[],searched=[];
 const pageText='Experience and perception provide evidence about the external world.';
 const library={search:async query=>{
  searched.push(query);
  return query.includes('alternate wording')?{sources:[{id:'S1',bookId:'638',title:'A Source',
   page:4,globalPageId:44,preview:pageText,score:8}]}:{sources:[]};
 },jsonGzip:async()=>({pages:[{id:44,page:4,text:pageText}]})};
 const item={id:'empty-first-pass',question:'What are the properties of the external world?',
  selected_book_ids:['638'],review_focus:['Evaluator-only note'],
  planner_queries:['external world reality existence query','properties of perceived reality query'],
  required_source_groups:[{label:'A Source',book_ids:['638']}]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{638:{title:'A Source'}}},
  allowed:new Set(['638']),token:'x'.repeat(40),useFixedQueries:true,
  fetcher:async(url,options)=>{
   const body=JSON.parse(options.body);calls.push({url,body});
   if(body.retrievalGap)return new Response(JSON.stringify({queries:['alternate wording search lead']}),
    {status:200,headers:{'content-type':'application/json'}});
   return new Response(JSON.stringify({outcome:'verified-source-draft',coverage:'full',
    reviewStatus:'review',answer:'The source discusses experience and perception [S1].',
    citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[]}),
    {status:200,headers:{'content-type':'application/json'}});
  }});
 assert.equal(calls.length,2);
 assert.ok(calls[0].body.retrievalGap);
 assert.equal('reviewFocus' in calls[0].body,false);
 assert.equal(result.gapPlannerAttempted,true);
 assert.deepEqual(result.gapQueries,['alternate wording search lead']);
 assert.deepEqual(result.retrievalCoverageAfterGap.weakParts,[]);
 assert.ok(searched.some(query=>query==='alternate wording search lead'));
 assert.equal(result.passed,true);
});

test('review ablation compares both answer paths against the identical source packet',async()=>{
 const calls=[];
 const library={search:async()=>({sources:[{id:'S1',bookId:'638',title:'Bible',page:10,globalPageId:10,
  url:'https://drive.google.com/file/d/abcdefghijk/view#page=10',preview:'A sufficiently long preview passage for testing.',score:4}]}),
  jsonGzip:async()=>({pages:[{id:10,page:10,text:'A sufficiently long source passage for the fake test page.'}]})};
const item={id:'paired-test',question:'Explain the source question.',selected_book_ids:['638'],
  planner_queries:['first distinct query concept','second distinct query concept'],
  required_source_groups:[{label:'Bible',book_ids:['638']}],review_focus:[]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{638:{title:'Bible'}}},allowed:new Set(['638']),
  token:'x'.repeat(40),beforeCall:async()=>{},useFixedQueries:true,answerVariant:'paired-review-ablation',
  fetcher:async(url,options)=>{
   const body=JSON.parse(options.body);calls.push({url,body});
   const reviewed=body.answerVariant==='with-review';
   return new Response(JSON.stringify({outcome:reviewed?'verified-source-draft':'unverified-source-draft',
    coverage:reviewed?'full':'partial',reviewStatus:reviewed?'claim-review':'answer-draft-unverified',
    answer:'A sourced claim [S1].',workerVersionId:'answer-worker-10',workerSourceBuild:'gateway-build-10',
    citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[]}),{status:200,headers:{'content-type':'application/json'}});
  }});
 assert.equal(calls.length,2);
 assert.deepEqual(calls.map(call=>call.body.answerVariant),['with-review','compose-only']);
 assert.deepEqual(calls[0].body.sources,calls[1].body.sources);
 assert.deepEqual(calls[0].body.sources,[{bookId:'638',page:10,text:'A sufficiently long source passage for the fake test page.',libraryVersion:49}]);
 assert.equal(result.answerVariant,'paired-review-ablation');
 assert.equal(result.passed,true);
 assert.deepEqual(result.reviewAblation.variants.map(variant=>variant.answerVariant),['with-review','compose-only']);
 assert.equal(result.reviewAblation.variants[0].passed,true);
 assert.equal(result.reviewAblation.variants[1].passed,null);
});

test('planner and conditional gap fallback keep the unchanged reader question in scope',async()=>{
 const calls=[],searched=[];
 const question='What does “God is love” mean?';
 const library={search:async query=>{
   searched.push(query);
   return {sources:[{id:'B1',bookId:'638',title:'The New Oxford Annotated Bible',
    page:1821,globalPageId:1821,preview:'God is love; let us love one another.',score:99}]};
  },jsonGzip:async()=>({pages:[{id:1821,page:1821,text:'God is love; let us love one another, because love is from God.'}]})};
 const item={id:'planner-outage',question,required_source_groups:[{label:'Bible',book_ids:['638']}]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{638:{title:'The New Oxford Annotated Bible'},427:{title:'Waiting for God'}}},
  allowed:new Set(['638','427']),token:'x'.repeat(40),
  beforeCall:async()=>{},fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});
   if(url.endsWith('pilot-plan'))return new Response(JSON.stringify({failureCode:'search-planning-failed'}),{status:502,headers:{'content-type':'application/json'}});
   return new Response(JSON.stringify({outcome:'verified-source-draft',coverage:'full',reviewStatus:'review',
    answer:'In 1 John, God’s love is revealed and calls people to love one another [S1].',
    citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[]}),{status:200,headers:{'content-type':'application/json'}});}});
 assert.equal(calls.length,3);
 assert.match(calls[0].url,/pilot-plan$/);assert.match(calls[1].url,/pilot-plan$/);
 assert.ok(calls[1].body.retrievalGap);assert.match(calls[2].url,/pilot-answer$/);
 assert.equal(result.plannerFallback,true);
 assert.deepEqual(result.plannerQueries,[]);
 assert.deepEqual(result.plannerFailure,{httpStatus:502,failureCode:'search-planning-failed'});
 assert.equal(result.gapPlannerFailure,'search-planning-failed');
 assert.deepEqual(searched,[question]);
 assert.ok(result.searches.some(search=>search.query===question));
 assert.ok(result.submittedSources.some(source=>source.bookId==='638'&&source.page===1821),
  'the Bible page must survive retrieval and reach the Worker packet');
 assert.equal(result.passed,true);
});

test('planner rate limit remains fail-closed and skips answer generation',async()=>{
 const item={id:'planner-rate-limit',question:'Explain the source question with enough detail.',required_source_groups:[]};
 const library={search:async()=>{throw Error('search should not run');},jsonGzip:async()=>{throw Error('page fetch should not run');}};
 await assert.rejects(evaluateLiveCase(item,{library,manifest:{books:{}},allowed:new Set(),token:'x'.repeat(40),
  beforeCall:async()=>{},fetcher:async()=>new Response(JSON.stringify({failureCode:'rate-limited',workerVersionId:'limited-worker-3',workerSourceBuild:'gateway-build-3'}),
   {status:429,headers:{'content-type':'application/json'}})}),error=>{
    assert.equal(error.requestFailure.stage,'planner');
    assert.equal(error.requestFailure.httpStatus,429);
    assert.equal(error.requestFailure.failureCode,'rate-limited');
    assert.equal(error.requestFailure.workerVersionId,'limited-worker-3');
    return true;
   });
});

test('evaluation report preserves planner fallback when the later answer request fails',async()=>{
 const item={id:'planner-fallback-answer-failure',question:'Explain the source question with enough detail.',required_source_groups:[]};
 const library={search:async()=>({sources:[{id:'S1',bookId:'638',title:'Bible',page:10,globalPageId:10,preview:'A sufficiently long preview passage for testing.',score:4}]}),
  jsonGzip:async()=>({pages:[{id:10,page:10,text:'A sufficiently long source passage for the fake test page.'}]})};
 const result=await runLiveCases([item],{evaluateOptions:{library,manifest:{books:{638:{title:'Bible'}}},allowed:new Set(['638']),token:'x'.repeat(40),
  beforeCall:async()=>{},fetcher:async url=>url.endsWith('pilot-plan')?
   new Response(JSON.stringify({failureCode:'search-planning-failed'}),{status:502,headers:{'content-type':'application/json'}}):
   new Response(JSON.stringify({failureCode:'evidence-review-invalid-response',failureDetail:'retry_invalid_json'}),
    {status:502,headers:{'content-type':'application/json'}})}});
 assert.equal(result.results[0].requestFailure.stage,'answer');
 assert.equal(result.results[0].plannerFallback,true);
 assert.equal(result.results[0].requestFailure.failureDetail,'retry_invalid_json');
 assert.deepEqual(result.results[0].plannerFailure,{httpStatus:502,failureCode:'search-planning-failed'});
});

test('audit report preserves answer text, citation locations, and Worker quote highlights',()=>{
 const result=auditLiveAnswer({answer:'Supported claim [S1].',citations:[{
   id:'S1',bookId:'638',title:'Bible',page:1821,globalPageId:274264,
   url:'https://drive.google.com/file/d/abcdefghijk/view#page=1821',provenance:{
    work:'Bible',creditedAuthors:['Unknown','A'.repeat(300)],creditedEditors:[],creditedTranslators:[],
    plannerSourceRole:'primary',pageSectionHint:'undetermined',pageVoiceHint:'undetermined',
    workVoice:{kind:'pseudonymous-author',name:'Johannes de Silentio',creditedAuthor:'Søren Kierkegaard'},
    pageVoice:{kind:'editorial-introduction',name:'David A. Dilworth',creditedAuthor:'Kitarō Nishida'}}
  }],evidenceHighlights:[{source_id:'S1',title:'Bible',page:1821,quote:'A passage excerpt.',
   claim_id:'P1-C1',point:'Supported claim.',quotes:[{claim_id:'P1-C1',part_id:'P1',
    point:'Supported claim.',quote:'A passage excerpt.'}]}]},
  [{}],[{label:'Bible',book_ids:['638']}]);
 assert.equal(result.answerText,'Supported claim [S1].');
 assert.deepEqual(result.citationSources,[{id:'S1',bookId:'638',title:'Bible',page:1821,
  globalPageId:274264,url:'https://drive.google.com/file/d/abcdefghijk/view#page=1821',provenance:{
   work:'Bible',creditedAuthors:['Unknown','A'.repeat(160)],creditedEditors:[],creditedTranslators:[],
   plannerSourceRole:'primary',pageSectionHint:'undetermined',pageVoiceHint:'undetermined',
   workVoice:{kind:'pseudonymous-author',name:'Johannes de Silentio',creditedAuthor:'Søren Kierkegaard'},
   pageVoice:{kind:'editorial-introduction',name:'David A. Dilworth',creditedAuthor:'Kitarō Nishida'}}}]);
 assert.deepEqual(result.evidenceHighlights,[{sourceId:'S1',title:'Bible',page:1821,
  quote:'A passage excerpt.',claimId:'P1-C1',point:'Supported claim.',quoteLocated:null,
  quotes:[{claimId:'P1-C1',partId:'P1',point:'Supported claim.',quote:'A passage excerpt.',
   quoteLocated:null,partialMatch:false,box:null,claimIds:[]}]}]);
 assert.equal('evidenceHighlightsLocated' in result,false);
});

test('audit report records every claim-linked quote a source carries, not just the first three',()=>{
 const claimIds=['P1-C1','P1-C2','P1-C3','P1-C4','P1-C5','P1-C6'];
 const result=auditLiveAnswer({coverage:'full',answerCompleteness:'full',
  answer:'Johannes de Silentio presents faith as a paradox that cannot be mediated [S1].',
  citations:[{id:'S1',bookId:'140',title:'Fear and Trembling',page:40}],
  questionParts:[{part:'Faith as paradox',status:'supported',answerStatus:'answered',evidenceIds:['S1']}],
  evidenceHighlights:[{source_id:'S1',title:'Fear and Trembling',page:40,
   quote:'A verified excerpt about Abraham and the paradox of faith.',claim_id:'P1-C1',
   point:'Faith is presented as a paradox.',quoteLocated:true,
   quotes:claimIds.map((claimId,index)=>({claim_id:claimId,part_id:'P1',
    point:`Supported point ${index+1} about the paradox of faith.`,
    quote:`Verified passage excerpt number ${index+1} concerning Abraham and faith.`,
    quoteLocated:true}))}]},
  [{bookId:'140',page:40}],[]);
 assert.deepEqual(result.evidenceHighlights[0].quotes.map(quote=>quote.claimId),claimIds,
  'all six claimIds on the source are recorded, in gateway order');
 assert.deepEqual(result.highlightRelevance.excerpts.map(excerpt=>excerpt.claimId),claimIds,
  'downstream relevance excerpts see every recorded claim link');
});

test('live runner records a failed Worker case and continues with checkpoint callbacks',async()=>{
 const items=[{id:'a',question:'first',required_source_groups:[]},{id:'b',question:'second',required_source_groups:[]}];
 const seen=[];let calls=0;
 const run=await runLiveCases(items,{evaluateCase:async item=>{
  calls++;
  if(item.id==='a'){const error=new Error('HTTP 502');error.requestFailure={stage:'answer',httpStatus:502,failureCode:'evidence-review-truncated',message:'truncated',workerFailure:true};throw error;}
  return {id:item.id,question:item.question,passed:true,outcome:'verified-source-draft',sourceGroups:[]};
 },onResult:async(_item,results)=>seen.push(results.map(item=>item.id))});
 assert.equal(calls,2);
 assert.deepEqual(seen,[['a'],['a','b']]);
 assert.equal(run.results[0].requestFailure.failureCode,'evidence-review-truncated');
 assert.equal(run.results[1].passed,true);
 assert.equal(run.stopReason,'');
});
test('live runner stops immediately on quota or provider availability failures',async()=>{
 for(const failureCode of ['ai-daily-limit-reached','ai-capacity-unavailable','ai-rate-limited']){
  let calls=0;
  const run=await runLiveCases(['a','b','c'].map(id=>({id,question:id,required_source_groups:[]})),{
   evaluateCase:async item=>{
    calls++;
    const error=new Error('Worker provider limit');
    error.requestFailure={stage:'planner',httpStatus:502,failureCode,message:'provider limit',workerFailure:true};
    throw error;
   }
  });
  assert.equal(calls,1);
  assert.equal(run.results.length,1);
  assert.equal(run.stopReason,'provider-limit-or-capacity');
  assert.equal(run.results[0].requestFailure.failureCode,failureCode);
 }
});
test('live runner stops after two consecutive Worker failures and keeps prior results',async()=>{
 const items=['a','b','c','d'].map(id=>({id,question:id,required_source_groups:[]}));
 let calls=0;const run=await runLiveCases(items,{evaluateCase:async item=>{
  calls++;
  if(item.id==='a')return {id:'a',question:'a',passed:true,sourceGroups:[]};
  const error=new Error('Worker unavailable');error.requestFailure={stage:'planner',httpStatus:502,failureCode:'http-error',message:'unavailable',workerFailure:true};throw error;
 }});
 assert.equal(calls,3);
 assert.deepEqual(run.results.map(item=>item.id),['a','b','c']);
 assert.equal(run.stopReason,'consecutive-worker-failures');
 assert.equal(run.results[0].passed,true);
 assert.equal(run.results[1].requestFailure.httpStatus,502);
});


test('stage timings record live planner, retrieval and answer durations for a selected-book case',async()=>{
 const library={search:async()=>({sources:[{id:'S1',bookId:'638',title:'Bible',page:10,globalPageId:10,url:'https://drive.google.com/file/d/abcdefghijk/view#page=10',preview:'A sufficiently long preview passage for testing.',score:4}]}),
  jsonGzip:async()=>({pages:[{id:10,page:10,text:'A sufficiently long source passage for the fake test page.'}]})};
 const item={question:'Explain the source question.',selected_book_ids:['638'],required_source_groups:[{label:'Bible',book_ids:['638']}]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{638:{title:'Bible'}}},allowed:new Set(['638']),token:'x'.repeat(40),
  beforeCall:async()=>{},fetcher:async(url)=>new Response(JSON.stringify(url.endsWith('pilot-plan')?{queries:['first distinct search concept','second distinct search concept'],
   plan:{parts:[{id:'P1',question:item.question}]}}:
   {outcome:'verified-source-draft',coverage:'full',reviewStatus:'review',answer:'Claim [S1].',citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[]}),{status:200,headers:{'content-type':'application/json'}})});
 assert.equal(result.plannerSkipped,false);
 assert.deepEqual(result.stageTimings.map(entry=>entry.stage+':'+entry.status),
  ['planner:completed','retrieval:completed','answer:completed']);
 assert.ok(result.stageTimings.every(entry=>Number.isFinite(entry.elapsedMs)&&entry.elapsedMs>=0));
});

test('stage timings mark fixed-query planning as skipped and record both conditional gap stages',async()=>{
 const calls=[],searched=[];
 const pageText='Experience and perception provide evidence about the external world.';
 const library={search:async query=>{
  searched.push(query);
  return query.includes('alternate wording')?{sources:[{id:'S1',bookId:'638',title:'A Source',
   page:4,globalPageId:44,preview:pageText,score:8}]}:{sources:[]};
 },jsonGzip:async()=>({pages:[{id:44,page:4,text:pageText}]})};
 const item={id:'empty-first-pass-timings',question:'What are the properties of the external world?',
  selected_book_ids:['638'],review_focus:['Evaluator-only note'],
  planner_queries:['external world reality existence query','properties of perceived reality query'],
  required_source_groups:[{label:'A Source',book_ids:['638']}]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{638:{title:'A Source'}}},
  allowed:new Set(['638']),token:'x'.repeat(40),useFixedQueries:true,
  fetcher:async(url,options)=>{
   const body=JSON.parse(options.body);calls.push({url,body});
   if(body.retrievalGap)return new Response(JSON.stringify({queries:['alternate wording search lead']}),
    {status:200,headers:{'content-type':'application/json'}});
   return new Response(JSON.stringify({outcome:'verified-source-draft',coverage:'full',
    reviewStatus:'review',answer:'The source discusses experience and perception [S1].',
    citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[]}),
    {status:200,headers:{'content-type':'application/json'}});
  }});
 assert.equal(result.plannerSkipped,true);
 assert.equal(result.gapPlannerAttempted,true);
 assert.deepEqual(result.stageTimings.map(entry=>entry.stage+':'+entry.status),
  ['planner:skipped','retrieval:completed','gap-planner:completed','gap-retrieval:completed','answer:completed']);
 assert.equal(result.stageTimings[0].elapsedMs,0);
});

test('stage timings mark planner and gap-planner fallbacks with the failed request durations',async()=>{
 const calls=[];
 const question='What does “God is love” mean?';
 const library={search:async()=>({sources:[{id:'B1',bookId:'638',title:'The New Oxford Annotated Bible',
    page:1821,globalPageId:1821,preview:'God is love; let us love one another.',score:99}]}),
  jsonGzip:async()=>({pages:[{id:1821,page:1821,text:'God is love; let us love one another, because love is from God.'}]})};
 const item={id:'planner-outage-timings',question,required_source_groups:[{label:'Bible',book_ids:['638']}]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{638:{title:'The New Oxford Annotated Bible'},427:{title:'Waiting for God'}}},
  allowed:new Set(['638','427']),token:'x'.repeat(40),
  beforeCall:async()=>{},fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});
   if(url.endsWith('pilot-plan'))return new Response(JSON.stringify({failureCode:'search-planning-failed'}),{status:502,headers:{'content-type':'application/json'}});
   return new Response(JSON.stringify({outcome:'verified-source-draft',coverage:'full',reviewStatus:'review',
    answer:'In 1 John, God’s love is revealed and calls people to love one another [S1].',
    citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[]}),{status:200,headers:{'content-type':'application/json'}});}});
 assert.equal(result.plannerFallback,true);
 assert.equal(result.gapPlannerFailure,'search-planning-failed');
 assert.deepEqual(result.stageTimings.map(entry=>entry.stage+':'+entry.status),
  ['planner:fallback','retrieval:completed','gap-planner:fallback','answer:completed']);
});

test('stage timings mark a prepared paired plan as reused with no planner duration',async()=>{
 const calls=[];
 const library={search:async()=>({sources:[{id:'S1',bookId:'638',title:'Bible',page:10,globalPageId:10,preview:'A sufficiently long preview passage for testing.',score:4}]}),
  jsonGzip:async()=>({pages:[{id:10,page:10,text:'A sufficiently long source passage for the fake test page.'}]})};
 const item={question:'Explain the source question.',selected_book_ids:['638'],required_source_groups:[{label:'Bible',book_ids:['638']}]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{638:{title:'Bible'}}},allowed:new Set(['638']),token:'x'.repeat(40),
  beforeCall:async()=>{},preparedPlan:{queries:['first distinct search concept','second distinct search concept'],
   plan:{parts:[{id:'P1',question:item.question,sourceBookIds:['638']}]},plannerFallback:false},
  fetcher:async(url)=>{calls.push(url);return new Response(JSON.stringify(
   {outcome:'verified-source-draft',coverage:'full',reviewStatus:'review',answer:'Claim [S1].',citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[]}),{status:200,headers:{'content-type':'application/json'}});}});
 assert.equal(result.plannerReused,true);
 assert.equal(calls.length,1);assert.match(calls[0],/pilot-answer$/);
 assert.deepEqual(result.stageTimings.map(entry=>entry.stage+':'+entry.status),
  ['planner:reused','retrieval:completed','answer:completed']);
 assert.equal(result.stageTimings[0].elapsedMs,0);
});

test('stage timings stay attached to fatal planner failures and failed answer requests',async()=>{
 const rateLimited={id:'planner-rate-limit-timings',question:'Explain the source question with enough detail.',required_source_groups:[]};
 const noSearch={search:async()=>{throw Error('search should not run');},jsonGzip:async()=>{throw Error('page fetch should not run');}};
 await assert.rejects(evaluateLiveCase(rateLimited,{library:noSearch,manifest:{books:{}},allowed:new Set(),token:'x'.repeat(40),
  beforeCall:async()=>{},fetcher:async()=>new Response(JSON.stringify({failureCode:'rate-limited'}),
   {status:429,headers:{'content-type':'application/json'}})}),error=>{
    assert.deepEqual(error.requestFailure.stageTimings.map(entry=>entry.stage+':'+entry.status),['planner:failed']);
    return true;
   });
 const library={search:async()=>({sources:[{id:'S1',bookId:'638',title:'Bible',page:10,globalPageId:10,preview:'A sufficiently long preview passage for testing.',score:4}]}),
  jsonGzip:async()=>({pages:[{id:10,page:10,text:'A sufficiently long source passage for the fake test page.'}]})};
 const item={question:'Explain the source question.',selected_book_ids:['638'],
  planner_queries:['first distinct query concept','second distinct query concept'],
  required_source_groups:[{label:'Bible',book_ids:['638']}]};
 await assert.rejects(evaluateLiveCase(item,{library,manifest:{books:{638:{title:'Bible'}}},allowed:new Set(['638']),token:'x'.repeat(40),
  beforeCall:async()=>{},useFixedQueries:true,
  fetcher:async()=>new Response(JSON.stringify({failureCode:'answer-failed'}),{status:500,headers:{'content-type':'application/json'}})}),error=>{
    assert.equal(error.requestFailure.stage,'answer');
    assert.deepEqual(error.requestFailure.stageTimings.map(entry=>entry.stage+':'+entry.status),
     ['planner:skipped','retrieval:completed','answer:failed']);
    return true;
   });
});

test('request-failure case records preserve attached stage timings and default to none',async()=>{
 const stageTimings=[{stage:'planner',elapsedMs:12,status:'completed'},
  {stage:'retrieval',elapsedMs:34,status:'completed'},{stage:'answer',elapsedMs:56,status:'failed'}];
 const items=[{id:'timing-failure',question:'Explain the source question with enough detail.',required_source_groups:[]},
  {id:'untimed-failure',question:'Explain the source question with enough detail.',required_source_groups:[]}];
 const run=await runLiveCases(items,{evaluateCase:async item=>{
  const error=new Error('Worker unavailable');
  error.requestFailure={stage:'answer',httpStatus:502,failureCode:'http-error',message:'unavailable',workerFailure:false,
   ...(item.id==='timing-failure'?{stageTimings}:{})};
  throw error;
 }});
 assert.equal(run.results[0].outcome,'request-failed');
 assert.equal(run.results[0].missing,'');
 assert.deepEqual(run.results[0].stageTimings,stageTimings);
 assert.deepEqual(run.results[1].stageTimings,[]);
});

test('planner-only evaluation records planner and retrieval stage timings',async()=>{
 const item=selectLiveCases({cases:[]},'planner')[0];
 const library={search:async()=>({sources:[{id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:66,globalPageId:70,
   preview:'Practical wisdom is a reasoned capacity for acting about matters that can be otherwise.',score:50}]}),
  jsonGzip:async()=>({pages:[{id:70,page:66,text:'Practical wisdom is a reasoned capacity for acting about matters that can be otherwise.'}]})};
 const result=await evaluatePlannerCase(item,{library,manifest:{books:{7:{title:'Nicomachean Ethics — Aristotle'}}},
  allowed:new Set(['7']),token:'x'.repeat(40),beforeCall:async()=>{},
  fetcher:async()=>new Response(JSON.stringify({queries:['first distinct query concept','second distinct query concept']}),
   {status:200,headers:{'content-type':'application/json'}})});
 assert.deepEqual(result.stageTimings.map(entry=>entry.stage+':'+entry.status),
  ['planner:completed','retrieval:completed']);
 assert.ok(result.stageTimings.every(entry=>Number.isFinite(entry.elapsedMs)&&entry.elapsedMs>=0));
});
