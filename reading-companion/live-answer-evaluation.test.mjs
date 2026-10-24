import test from 'node:test';
import assert from 'node:assert/strict';
import {auditLiveAnswer,recheckQualityReport,selectLiveCases,applyQualityScope,evaluateLiveCase,evaluatePlannerCase,runLiveCases,summarizeManualReviews,summarizeAnswerVariants} from './live-answer-evaluation.mjs';
import {PRODUCTION_PAGES_PER_BOOK} from './remote-library.mjs';

const suite={cases:[{id:'science-hawking-black-holes'},{id:'philosophy-aristotle-habituation'}]};

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

test('acceptance mode is a separate untouched all-books set',()=>{
 const cases=selectLiveCases({cases:[]},'acceptance');
 assert.equal(cases.length,7);
 assert.ok(cases.every(item=>item.id.startsWith('acceptance-')&&item.selected_book_ids.length===0));
 assert.equal(new Set(cases.map(item=>item.id)).size,7);
 assert.throws(()=>selectLiveCases({cases:[]},'acceptance','holdout-history-herodotus-helen'),/Unknown acceptance case/);
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
 assert.throws(()=>selectLiveCases({cases:[]},'smoke','holdout-religion-james-faith-works'),/only in quality, holdout or acceptance mode/);
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
 assert.throws(()=>selectLiveCases({cases:[]},'smoke',id),/only in quality, holdout or acceptance mode/);
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
  citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[{quoteLocated:true}]},[{bookId:'638'}],[{label:'Bible',book_ids:['638','646']}]);
 assert.equal(result.passed,true);
 assert.equal(result.workerVersionId,'answer-version-1');
 assert.equal(result.workerSourceBuild,'gateway-build-1');
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

test('grouped citations cannot hide an unknown source ID from the evaluation audit',()=>{
 const result=auditLiveAnswer({coverage:'full',answer:'Claim supported by both sources [S1, S99].',
  citations:[{id:'S1',bookId:'638'}],questionParts:[],evidenceMap:[]},
  [{bookId:'638'}],[{label:'Bible',book_ids:['638']}]);
 assert.deepEqual(result.inlineIds,['S1','S99']);
 assert.deepEqual(result.inlineIdsWithoutSource,['S99']);
 assert.equal(result.passed,false);
});

test('audit maps Worker evidence IDs to submitted locators by their request order',()=>{
 const result=auditLiveAnswer({coverage:'full',answer:'A sourced claim [S1].',
  citations:[{id:'S1',bookId:'638'}],
  questionParts:[{part:'the requested claim',status:'supported',evidenceIds:['S1']}],
  evidenceMap:[{id:'S1',point:'The reviewed passage supports the claim.'}]},
  [{bookId:'638',page:10}],[{label:'Bible',book_ids:['638']}]);
 assert.equal(result.partEvidenceAudit[0].structurallyComplete,true);
 assert.equal(result.sourceGroups[0].linkedToSupportedEvidence,true);
 assert.equal(result.passed,true);
});

test('audit rejects a comparison part that cites the other named work',()=>{
 const result=auditLiveAnswer({coverage:'full',answer:'Rousseau’s social contract grounds authority [S1].',
  citations:[{id:'S1',bookId:'245'}],
  questionParts:[{part:'How does Plato explain legitimate political order?',status:'supported',evidenceIds:['S1']}],
  evidenceMap:[{id:'S1',claimId:'C1',quote:'A convention between the body and each of its members.'}]},
  [{bookId:'245',page:24}],[{label:'Rousseau',book_ids:['245']},{label:'Plato',book_ids:['74']}],
  [{partIncludes:'Plato',book_ids:['74']}]);
 assert.equal(result.sourcePartAlignment.length,1);
 assert.equal(result.sourcePartAlignment[0].aligned,false);
 assert.deepEqual(result.sourcePartAlignment[0].misalignedBookIds,['245']);
 assert.equal(result.passed,false);
});

test('human rubric summary keeps semantic review separate from structural passes',()=>{
 const pending=summarizeManualReviews([{id:'a',manualReview:{status:'not-reviewed',scores:{}}}]);
 assert.equal(pending.reviewed,0);assert.equal(pending.pending,1);assert.equal(pending.qualityPass,null);
 const scored=summarizeManualReviews([{id:'a',manualReview:{scores:{accuracy:2,questionCoverage:1,
  explanationQuality:1,citationSupport:2,citationCompleteness:0}}}]);
 assert.equal(scored.reviewed,1);
 assert.deepEqual(scored.averageScores,{accuracy:2,questionCoverage:1,explanationQuality:1,citationSupport:2,citationCompleteness:0});
 assert.equal(scored.qualityPass,null,'human scores are reported, not collapsed into an unsupported pass threshold');
});

test('paired variant summary reports structural results and human scores separately',()=>{
 const summary=summarizeAnswerVariants([{id:'pair',reviewAblation:{variants:[
  {answerVariant:'with-review',structuralPassed:true,manualReview:{scores:{accuracy:2,questionCoverage:2,explanationQuality:1,citationSupport:2,citationCompleteness:2}}},
  {answerVariant:'compose-only',structuralPassed:false,manualReview:{scores:{accuracy:null,questionCoverage:null,explanationQuality:null,citationSupport:null,citationCompleteness:null}}}
 ]}}]);
 assert.equal(summary['with-review'].structuralPassed,1);
 assert.equal(summary['with-review'].humanScores.reviewed,1);
 assert.equal(summary['compose-only'].structuralFailed,1);
 assert.equal(summary['compose-only'].humanScores.pending,1);
});

test('audit rejects prose that denies a comparison marked supported',()=>{
 const result=auditLiveAnswer({coverage:'full',answer:'Aristotle discusses political order through human good [S1]. Hobbes describes common power preserving justice [S2]. The texts do not offer a direct comparison, and the evidence cannot establish a difference between their accounts [S1, S2].',
  citations:[{id:'S1',bookId:'7'},{id:'S2',bookId:'163'}],
  questionParts:[
   {part:'Aristotle’s account',status:'supported',evidenceIds:['S1']},
   {part:'Hobbes’s account',status:'supported',evidenceIds:['S2']},
   {part:'How the accounts differ',status:'supported',evidenceIds:['S1','S2']}
  ],evidenceMap:[{id:'S1',point:'Aristotle connects political order with human good.'},
   {id:'S2',point:'Hobbes connects common power with justice.'}]},
  [{id:'S1',bookId:'7'},{id:'S2',bookId:'163'}],
  [{label:'Aristotle',book_ids:['7']},{label:'Hobbes',book_ids:['163']}]);
 assert.equal(result.answerCoverageConsistent,false);
 assert.deepEqual(result.coverageContradictions,['How the accounts differ']);
 assert.equal(result.passed,false);
});

test('audit distinguishes a retrieved and cited book from evidence assigned to a supported part',()=>{
 const result=auditLiveAnswer({coverage:'full',answer:'Claim [S1].',citations:[{id:'S1',bookId:'102'}],
  questionParts:[{part:'Hawking’s observational evidence',status:'supported',evidenceIds:['S3']}],
  evidenceMap:[{id:'S3',point:'A separate point from another passage.'}]},
  [{bookId:'102'},{bookId:'102'}],
  [{label:'Hawking',book_ids:['102']}]);
 assert.equal(result.sourceGroups[0].retrieved,true);
 assert.equal(result.sourceGroups[0].cited,true);
 assert.equal(result.sourceGroups[0].linkedToSupportedEvidence,false);
 assert.equal(result.partEvidenceComplete,false);
 assert.equal(result.passed,false);
});

test('offline report recheck repairs positional evidence links without changing the original result',()=>{
 const report={mode:'quality',cases:[{
  id:'quality-philosophy-aristotle-practical-wisdom',passed:false,coverage:'full',
  answerText:'Practical wisdom concerns human goods [S1].',
  citationSources:[{id:'S1',bookId:'7',page:66}],
  submittedSources:[{bookId:'7',page:66}],
  evidenceMap:[{id:'S1',point:'Practical wisdom concerns human goods.'}],
  questionParts:[{part:'What is practical wisdom?',status:'supported',evidenceIds:['S1']}],
  evidenceHighlights:[]
 }]};
 const checked=recheckQualityReport(report);
 assert.equal(checked.offlineRecheck.aiCalls,0);
 assert.equal(checked.offlineRecheck.networkCalls,0);
 assert.equal(checked.offlineRecheck.checkedCases,1);
 assert.equal(checked.offlineRecheck.passedCases,1);
 assert.equal(checked.cases[0].passed,false);
 assert.equal(checked.cases[0].offlineRecheck.passed,true);
 assert.equal(checked.cases[0].offlineRecheck.partEvidenceAudit[0].structurallyComplete,true);
});

test('offline report recheck keeps an actual partial answer as a miss',()=>{
 const checked=recheckQualityReport({cases:[{
  id:'quality-science-darwin-selection',coverage:'partial',answerText:'Claim [S1].',
  citationSources:[{id:'S1',bookId:'529'}],submittedSources:[{bookId:'529'}],
  evidenceMap:[{id:'S1',point:'Some relevant evidence.'}],
  questionParts:[{part:'The requested point',status:'partial',evidenceIds:['S1']}]
 }]});
 assert.equal(checked.offlineRecheck.passedCases,0);
 assert.equal(checked.cases[0].offlineRecheck.passed,false);
 assert.equal(checked.cases[0].offlineRecheck.questionPartCoverage.partial,1);
});

test('offline report recheck refreshes both paired variant audits and preserves manual scores',()=>{
 const manualReview={scores:{accuracy:2,questionCoverage:2,explanationQuality:2,citationSupport:2,citationCompleteness:2},notes:'Checked'};
 const variant={answerVariant:'compose-only',answerText:'A sourced claim [S1].',coverage:'full',reviewStatus:'answer-draft-unverified',
  citations:[{id:'S1',bookId:'25'}],citationSources:[{id:'S1',bookId:'25'}],
  questionParts:[{part:'What does the text say?',status:'supported',evidenceIds:['S1']}],
  evidenceMap:[{id:'S1',claimId:'C1',quote:'A passage long enough to demonstrate the claim.'}],
  evidenceHighlights:[],manualReview};
 const report={cases:[{id:'acceptance-descartes-cogito',answerText:variant.answerText,coverage:'full',
  citations:variant.citations,citationSources:variant.citationSources,questionParts:variant.questionParts,
  evidenceMap:variant.evidenceMap,evidenceHighlights:[],submittedSources:[{bookId:'25',page:1}],
  reviewAblation:{variants:[variant]}}]};
 const checked=recheckQualityReport(report);
 assert.equal(checked.cases[0].reviewAblation.variants[0].structuralPassed,true);
 assert.deepEqual(checked.cases[0].reviewAblation.variants[0].manualReview,manualReview);
 assert.equal(checked.answerVariants['compose-only'].humanScores.reviewed,1);
});

test('quality case uses fixed queries, skips planning, and restricts retrieval to its selected book',async()=>{
 const calls=[],searchOptions=[];
 const library={search:async(query,options)=>{searchOptions.push({query,options});return {sources:[{id:'S1',bookId:'529',title:'On the Origin of Species',page:10,globalPageId:10,preview:'A sufficiently long preview passage for testing.',score:4}]};},
  jsonGzip:async()=>({pages:[{id:10,page:10,text:'A sufficiently long source passage for the fake test page.'}]})};
 const item={id:'selected-book-test',question:'Explain Darwin in a named book with enough detail.',discipline:'science',selected_book_ids:['529'],
  planner_queries:['first distinct fixed search concept','second distinct fixed search concept'],review_focus:['Check causal explanation.'],
  required_source_groups:[{label:'Darwin',book_ids:['529']}]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{529:{title:'On the Origin of Species'}}},allowed:new Set(['529','102']),token:'x'.repeat(40),beforeCall:async()=>{},useFixedQueries:true,
  fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({outcome:'verified-source-draft',coverage:'full',reviewStatus:'review',answer:'Claim [S1].',workerVersionId:'answer-worker-9',workerSourceBuild:'gateway-build-9',citations:[{id:'S1',bookId:'529'}],evidenceHighlights:[]}),{status:200,headers:{'content-type':'application/json'}});}});
 assert.equal(calls.length,1);assert.match(calls[0].url,/pilot-answer$/);
 assert.equal(result.plannerSkipped,true);assert.deepEqual(result.plannerQueries,item.planner_queries);
 assert.equal(result.plannerWorkerVersionId,null);
 assert.equal(result.answerWorkerVersionId,'answer-worker-9');
 assert.equal(result.answerWorkerSourceBuild,'gateway-build-9');
 assert.equal(result.selectedBookIds[0],'529');assert.equal(result.reviewFocus[0],'Check causal explanation.');
 assert.equal(result.submittedSources[0].excerpt,'A sufficiently long preview passage for testing.');
 assert.ok(searchOptions.every(({options})=>options.allowedBookIds.size===1&&options.allowedBookIds.has('529')));
 assert.ok(searchOptions.every(({options})=>options.maxBooks===3&&
  options.pagesPerBook===PRODUCTION_PAGES_PER_BOOK));
});

test('all-books evaluation sends the same six-page evidence budget as the public companion',async()=>{
 const item={id:'all-books-six-source-budget',
  question:'How do Darwin in On the Origin of Species and Hawking in A Brief History of Time explain their evidence?',
  selected_book_ids:[],planner_queries:['Darwin On the Origin of Species natural selection evidence',
   'Hawking A Brief History of Time black hole observations'],review_focus:[],
  required_source_groups:[{label:'Darwin',book_ids:['529']},{label:'Hawking',book_ids:['102']}]};
 const pages=new Map();
 for(const [bookId,title] of [['529','On the Origin of Species — Charles Darwin'],
   ['102','A Brief History of Time — Stephen Hawking']]){
  for(let index=0;index<3;index++){
   const page=100+index+(bookId==='102'?10:0),globalPageId=Number(bookId)*100+index;
   pages.set(bookId+':'+globalPageId,{id:globalPageId,page,
    text:`${title} passage ${index+1} gives a distinct observation and explanation relevant to the question.`});
  }
 }
 const library={search:async(_query,{bookId})=>({sources:[...pages.entries()]
   .filter(([key])=>key.startsWith(String(bookId)+':')).map(([,page],index)=>({
    bookId:String(bookId),title:pages.get(String(bookId)+':'+page.id).title||
     (String(bookId)==='529'?'On the Origin of Species — Charles Darwin':'A Brief History of Time — Stephen Hawking'),
    page:page.page,globalPageId:page.id,preview:page.text,score:50-index,
    url:`https://example.test/#page=${page.page}`}))}),
  jsonGzip:async(path)=>{const id=path.match(/book-(\d+)\.json/)[1];return {pages:[...pages.entries()]
   .filter(([key])=>key.startsWith(id+':')).map(([,page])=>page)};}};
 let answerBody;
 const result=await evaluateLiveCase(item,{library,
  manifest:{books:{529:{title:'On the Origin of Species — Charles Darwin'},
   102:{title:'A Brief History of Time — Stephen Hawking'}}},
  allowed:new Set(['529','102']),token:'x'.repeat(40),beforeCall:async()=>{},useFixedQueries:true,
  fetcher:async(_url,options)=>{answerBody=JSON.parse(options.body);return new Response(JSON.stringify({
   outcome:'verified-source-draft',coverage:'full',answer:'Claims from both works [S1, S4].',
   citations:[],evidenceHighlights:[]}),{status:200,headers:{'content-type':'application/json'}});}});
 assert.equal(answerBody.sources.length,6);
 assert.deepEqual(new Set(answerBody.sources.map(source=>source.bookId)),new Set(['529','102']));
 assert.equal(result.submittedSources.length,6);
});

test('planner-only evaluation checks selected and All Books retrieval without answer calls',async()=>{
 const calls=[],searchScopes=[];
 const pages={
  '7':{id:70,title:'Nicomachean Ethics — Aristotle',page:66,text:'Practical wisdom is a reasoned capacity for acting about matters that can be otherwise.'},
  '529':{id:5290,title:'On the Origin of Species — Charles Darwin',page:96,text:'Natural selection preserves favorable individual differences and destroys injurious ones.'},
  '102':{id:1020,title:'A Brief History of Time — Stephen Hawking',page:58,text:'Astronomical observations of X-rays from Cygnus X-1 support an account of a black hole.'}
 };
 const library={
  search:async(query,options)=>{
   const bookId=String(options.bookId||'');searchScopes.push(bookId);
   const page=pages[bookId];
   return {sources:page?[{id:'p'+page.id,bookId,title:page.title,page:page.page,
    globalPageId:page.id,preview:page.text,score:50,url:'https://example.test/#page='+page.page}]:[]};
  },
  jsonGzip:async(path)=>{
   const bookId=path.match(/book-(\d+)\.json/)[1],page=pages[bookId];
   return {pages:page?[{id:page.id,page:page.page,text:page.text}]:[]};
  }
 };
 const cases=selectLiveCases({cases:[]},'planner');
 const results=[];
 for(const item of cases){
  results.push(await evaluatePlannerCase(item,{library,
   manifest:{books:Object.fromEntries(Object.entries(pages).map(([id,page])=>[id,{title:page.title}]))},
   allowed:new Set(Object.keys(pages)),token:'x'.repeat(40),beforeCall:async()=>{},
   fetcher:async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    return new Response(JSON.stringify({queries:['first distinct query concept','second distinct query concept'],
     workerVersionId:'planner-worker-7',workerSourceBuild:'gateway-build-7'}),
     {status:200,headers:{'content-type':'application/json'}});
   }}));
 }
 assert.equal(calls.length,2);
 assert.ok(calls.every(call=>call.url.endsWith('/api/pilot-plan')));
 assert.equal(calls[0].body.bookId,'7');
 assert.equal(calls[1].body.bookId,'');
 assert.ok(results.every(result=>result.passed&&result.coverage==='not-evaluated'));
 assert.ok(results.every(result=>result.reviewStatus==='planner-only'&&!result.answerWorkerVersionId));
 assert.deepEqual(results[0].sourceGroups[0].retrievedBookIds,['7']);
 assert.deepEqual(results[1].sourceGroups.map(group=>group.retrievedBookIds),[['529'],['102']]);
 assert.ok(searchScopes.includes('7'));
 assert.ok(searchScopes.includes('529')&&searchScopes.includes('102'));
});

test('fixed-query retrieval failure still reports that planner execution was skipped',async()=>{
 const item={id:'fixed-query-retrieval-failure',question:'Explain the source question with enough detail.',
  planner_queries:['fixed query one concept','fixed query two concept'],required_source_groups:[]};
 await assert.rejects(evaluateLiveCase(item,{library:{search:async()=>{throw Error('offline search failure');}},
  manifest:{books:{}},allowed:new Set(),token:'x'.repeat(40),useFixedQueries:true}),
  error=>{assert.equal(error.requestFailure.stage,'retrieval');assert.equal(error.requestFailure.plannerSkipped,true);return true;});
});

test('partial Worker coverage is an evaluation miss even when citations and expected books are present',()=>{
 const result=auditLiveAnswer({coverage:'partial',answer:'Supported claim [S1].',citations:[{id:'S1',bookId:'638'}]},[{}],[{label:'Bible',book_ids:['638']}]);
 assert.equal(result.sourceGroups[0].found,true);
 assert.equal(result.passed,false);
});

test('case evaluation sends one selected-book plan and one answer request in order without logging the token',async()=>{
 const calls=[],searched=[];
 const library={search:async(query)=>{searched.push(query);return {sources:[{id:'S1',bookId:'638',title:'Bible',page:10,globalPageId:10,url:'https://drive.google.com/file/d/abcdefghijk/view#page=10',preview:'A sufficiently long preview passage for testing.',score:4}]};},
  jsonGzip:async()=>({pages:[{id:10,page:10,text:'A sufficiently long source passage for the fake test page.'}]})};
 const item={question:'Explain the source question with enough detail.',selected_book_ids:['638'],required_source_groups:[{label:'Bible',book_ids:['638']}]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{638:{title:'Bible'}}},allowed:new Set(['638']),token:'x'.repeat(40),
  beforeCall:async()=>{},fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body),authorization:options.headers.authorization});
   return new Response(JSON.stringify(url.endsWith('pilot-plan')?{queries:['first distinct search concept','second distinct search concept'],
    plan:{parts:[{id:'P1',question:'Explain the source question with enough detail.'}]},
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
 assert.deepEqual(calls[1].body.sources[0].candidatePartIds,['P1']);
 assert.deepEqual(result.submittedSources[0].candidatePartIds,['P1']);
 assert.ok(!JSON.stringify(result).includes('x'.repeat(40)));
});

test('review ablation compares both answer paths against the identical source packet',async()=>{
 const calls=[];
 const library={search:async()=>({sources:[{id:'S1',bookId:'638',title:'Bible',page:10,globalPageId:10,
  url:'https://drive.google.com/file/d/abcdefghijk/view#page=10',preview:'A sufficiently long preview passage for testing.',score:4}]}),
  jsonGzip:async()=>({pages:[{id:10,page:10,text:'A sufficiently long source passage for the fake test page.'}]})};
 const item={id:'paired-test',question:'Explain the source question with enough detail.',selected_book_ids:['638'],
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
 assert.deepEqual(calls[0].body.sources,[{bookId:'638',page:10,text:'A sufficiently long source passage for the fake test page.'}]);
 assert.equal(result.answerVariant,'paired-review-ablation');
 assert.equal(result.passed,true);
 assert.deepEqual(result.reviewAblation.variants.map(variant=>variant.answerVariant),['with-review','compose-only']);
 assert.equal(result.reviewAblation.variants[0].passed,true);
 assert.equal(result.reviewAblation.variants[1].passed,null);
});

test('planner 502 falls back to searching the original question and completes evaluation',async()=>{
 const calls=[],searched=[];
 const library={search:async(query)=>{searched.push(query);return {sources:[{id:'S1',bookId:'638',title:'Bible',page:10,globalPageId:10,preview:'A sufficiently long preview passage for testing.',score:4}]};},
  jsonGzip:async()=>({pages:[{id:10,page:10,text:'A sufficiently long source passage for the fake test page.'}]})};
 const item={id:'planner-outage',question:'Explain the source question with enough detail.',required_source_groups:[{label:'Bible',book_ids:['638']}]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{638:{title:'Bible'}}},allowed:new Set(['638']),token:'x'.repeat(40),
  beforeCall:async()=>{},fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});
   if(url.endsWith('pilot-plan'))return new Response(JSON.stringify({failureCode:'search-planning-failed'}),{status:502,headers:{'content-type':'application/json'}});
   return new Response(JSON.stringify({outcome:'verified-source-draft',coverage:'full',reviewStatus:'review',answer:'Claim [S1].',citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[]}),{status:200,headers:{'content-type':'application/json'}});}});
 assert.equal(calls.length,2);
 assert.match(calls[0].url,/pilot-plan$/);assert.match(calls[1].url,/pilot-answer$/);
 assert.equal(result.plannerFallback,true);
 assert.deepEqual(result.plannerQueries,[]);
 assert.deepEqual(result.plannerFailure,{httpStatus:502,failureCode:'search-planning-failed'});
 assert.ok(result.searches.some(search=>search.query===item.question));
 assert.ok(searched.includes(item.question));
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
   url:'https://drive.google.com/file/d/abcdefghijk/view#page=1821'
  }],evidenceHighlights:[{source_id:'S1',title:'Bible',page:1821,quote:'A passage excerpt.'}]},
  [{}],[{label:'Bible',book_ids:['638']}]);
 assert.equal(result.answerText,'Supported claim [S1].');
 assert.deepEqual(result.citationSources,[{id:'S1',bookId:'638',title:'Bible',page:1821,
  globalPageId:274264,url:'https://drive.google.com/file/d/abcdefghijk/view#page=1821'}]);
 assert.deepEqual(result.evidenceHighlights,[{sourceId:'S1',title:'Bible',page:1821,
  quote:'A passage excerpt.',quoteLocated:null}]);
 assert.equal('evidenceHighlightsLocated' in result,false);
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

