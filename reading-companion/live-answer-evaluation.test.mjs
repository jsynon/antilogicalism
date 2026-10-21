import test from 'node:test';
import assert from 'node:assert/strict';
import {auditLiveAnswer,selectLiveCases,evaluateLiveCase,runLiveCases} from './live-answer-evaluation.mjs';

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

test('full mode remains exactly the existing 30-case retrieval suite',()=>{
 const cases=selectLiveCases({cases:Array.from({length:30},(_,i)=>({id:'case-'+i}))},'full');
 assert.equal(cases.length,30);
});

test('audit requires expected-source coverage and citations with no orphan markers',()=>{
 const result=auditLiveAnswer({outcome:'verified-source-draft',coverage:'full',reviewStatus:'citations_not_claim_verified',
  answer:'A sourced claim [S1].',workerVersionId:'answer-version-1',workerSourceBuild:'gateway-build-1',
  citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[{quoteLocated:true}]},[{}],[{label:'Bible',book_ids:['638','646']}]);
 assert.equal(result.passed,true);
 assert.equal(result.workerVersionId,'answer-version-1');
 assert.equal(result.workerSourceBuild,'gateway-build-1');
 assert.deepEqual(result.sourceGroups[0].foundBookIds,['638']);
 const bad=auditLiveAnswer({answer:'Unsupported [S2].',citations:[{id:'S1',bookId:'16'}]},[{}],[{label:'Bible',book_ids:['638']}]);
 assert.equal(bad.passed,false);
 assert.deepEqual(bad.inlineIdsWithoutSource,['S2']);
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
 assert.ok(searchOptions.every(({options})=>options.allowedBookIds.size===1&&options.allowedBookIds.has('529')));
});

test('partial Worker coverage is an evaluation miss even when citations and expected books are present',()=>{
 const result=auditLiveAnswer({coverage:'partial',answer:'Supported claim [S1].',citations:[{id:'S1',bookId:'638'}]},[{}],[{label:'Bible',book_ids:['638']}]);
 assert.equal(result.sourceGroups[0].found,true);
 assert.equal(result.passed,false);
});

test('case evaluation sends one plan and one answer request in order without logging the token',async()=>{
 const calls=[],searched=[];
 const library={search:async(query)=>{searched.push(query);return {sources:[{id:'S1',bookId:'638',title:'Bible',page:10,globalPageId:10,url:'https://drive.google.com/file/d/abcdefghijk/view#page=10',preview:'A sufficiently long preview passage for testing.',score:4}]};},
  jsonGzip:async()=>({pages:[{id:10,page:10,text:'A sufficiently long source passage for the fake test page.'}]})};
 const item={question:'Explain the source question with enough detail.',required_source_groups:[{label:'Bible',book_ids:['638']}]};
 const result=await evaluateLiveCase(item,{library,manifest:{books:{638:{title:'Bible'}}},allowed:new Set(['638']),token:'x'.repeat(40),
  beforeCall:async()=>{},fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body),authorization:options.headers.authorization});
   return new Response(JSON.stringify(url.endsWith('pilot-plan')?{queries:['first distinct search concept','second distinct search concept'],workerVersionId:'plan-worker-3',workerSourceBuild:'gateway-build-3'}:
    {outcome:'verified-source-draft',coverage:'full',reviewStatus:'review',answer:'Claim [S1].',workerVersionId:'answer-worker-3',workerSourceBuild:'gateway-build-3',citations:[{id:'S1',bookId:'638'}],evidenceHighlights:[]}),{status:200,headers:{'content-type':'application/json'}});}});
 assert.equal(calls.length,2);
 assert.match(calls[0].url,/pilot-plan$/);assert.match(calls[1].url,/pilot-answer$/);
 assert.equal(calls[0].authorization,'Bearer '+'x'.repeat(40));
 assert.equal(result.passed,true);
 assert.equal(result.plannerWorkerVersionId,'plan-worker-3');
 assert.equal(result.answerWorkerVersionId,'answer-worker-3');
 assert.deepEqual(searched,['first distinct search concept','second distinct search concept',item.question]);
 assert.equal(result.searches[2].query,item.question);
 assert.ok(!JSON.stringify(result).includes('x'.repeat(40)));
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
   new Response(JSON.stringify({failureCode:'evidence-review-request-failed'}),{status:502,headers:{'content-type':'application/json'}})}});
 assert.equal(result.results[0].requestFailure.stage,'answer');
 assert.equal(result.results[0].plannerFallback,true);
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
