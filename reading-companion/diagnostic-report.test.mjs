import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {auditCitationIds,createDiagnosticReport,diagnosticFailureCode,userFailureMessage,
  inlineCitationGroups} from './diagnostic-report.mjs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const client=readFileSync(new URL('./companion-v110.mjs',import.meta.url),'utf8');

test('audits citation markers against the sources returned by the server',()=>{
 const audit=auditCitationIds('Darwin explains variation [S1, S2].',[{id:'S1'}]);
 assert.deepEqual(audit.inlineIds,['S1','S2']);
 assert.deepEqual(audit.returnedIds,['S1']);
 assert.deepEqual(audit.inlineIdsWithoutSource,['S2']);
 assert.deepEqual(audit.sourcesNotCited,[]);
});

test('parses grouped citation markers and the UI renders each source link',()=>{
 const answer='The passages support this claim [S1, S3].';
 assert.deepEqual(inlineCitationGroups(answer).map(group=>group.ids),[['S1','S3']]);
 assert.match(client,/diagnosticState\.plannerWorkerVersionId=data\.workerVersionId/);
 assert.match(client,/diagnosticState\.answerWorkerVersionId=data\.workerVersionId/);
 assert.match(client,/const citationAudit=auditCitationIds\(data\.answer,responseCitations\)/);
 assert.match(client,/citationAudit\.inlineIdsWithoutSource\.length/);
 assert.match(client,/const groups=inlineCitationGroups\(answer\)/);
 assert.match(client,/appendCitation\(id,citationGroup\)/);
 assert.match(client,/citationGroup\.style\.whiteSpace='nowrap'/);
 assert.match(client,/citationGroup\.append\(document\.createTextNode\('\]'\)\)/);
 const audit=auditCitationIds(answer,[{id:'S1'},{id:'S3'}]);
 assert.deepEqual(audit.inlineIdsWithoutSource,[]);
});

test('diagnostic output is bounded and excludes full source text and challenge data',()=>{
 const report=createDiagnosticReport({
  question:'How do Aristotle and Darwin explain change?',selectedBookId:'',
  plannerQueries:['Aristotle virtue','Darwin evolution'],stage:'failed',
  plannerWorkerVersionId:'worker-plan-7',plannerWorkerVersionTag:'production',
  plannerWorkerVersionTimestamp:'2026-10-21T00:00:00Z',plannerWorkerSourceBuild:'build-a',
  answerWorkerVersionId:'worker-answer-7',answerWorkerSourceBuild:'build-a',
  failureHttpStatus:502,failureCode:diagnosticFailureCode(502),
  failureStage:'answer-composition',failureProviderClass:'timeout',
  failureAnswerCharacters:2810,failureDetail:'retry_invalid_json',
  candidates:[{id:'S1',bookId:'7',title:'Ethics',page:12,score:2.5,
    text:'PRIVATE FULL PAGE TEXT',preview:'PRIVATE PREVIEW',turnstileToken:'PRIVATE TOKEN'}],
  submittedSources:[{id:'S1',bookId:'7',title:'Ethics',page:12,text:'PRIVATE FULL PAGE TEXT'}],
  outcome:'verified-source-draft',coverage:'partial',reviewStatus:'citations_not_claim_verified',
  answer:'The authors differ [S1, S2].',citations:[{id:'S1',bookId:'7',title:'Ethics',page:12,
    text:'PRIVATE FULL PAGE TEXT'}],
  reviewedEvidence:[{id:'S1',point:'The speaker makes a conditional claim.',
    quoteVerified:true,anchorQuote:'If they could observe justice',speaker:'Hobbes',
    qualifier:'If they could observe justice without common power'}],
  evidenceHighlights:Array.from({length:6},(_,index)=>({source_id:'S'+(index+1),page:12+index,
    quoteLocated:true,partialMatch:false,quote:index===0?'PRIVATE QUOTE':'QUOTE '+index,
    claim_id:index===0?'P1-C1':'',point:index===0?'The sentence is supported.':'',
    quotes:index===0?[{claim_id:'P1-C1',part_id:'P1',point:'The sentence is supported.',
      quote:'PRIVATE QUOTE',quoteLocated:true}]:[]}))
 });
 const serialized=JSON.stringify(report);
 assert.equal(report.schema,'antilogicalism-reading-companion-diagnostic-v1');
 assert.deepEqual(report.answer.inlineIdsWithoutSource,['S2']);
 assert.equal(report.failureHttpStatus,502);
 assert.equal(report.plannerWorkerVersionId,'worker-plan-7');
 assert.equal(report.answerWorkerVersionId,'worker-answer-7');
 assert.equal(report.answerWorkerVersionTag,null);
 assert.equal(report.failureCode,'answer-generation-or-citation-failed');
  assert.equal(report.failureStage,'answer-composition');
  assert.equal(report.failureProviderClass,'timeout');
  assert.equal(report.failureAnswerCharacters,2810);
  assert.equal(report.failureDetail,'retry_invalid_json');
 assert.equal(report.candidates[0].score,2.5);
 assert.equal(report.evidenceHighlights[0].quoteLocated,true);
 assert.equal(report.evidenceHighlights[0].quote,'PRIVATE QUOTE');
 assert.equal(report.evidenceHighlights[0].claimId,'P1-C1');
 assert.deepEqual(report.evidenceHighlights[0].quotes,[{claimId:'P1-C1',partId:'P1',
  point:'The sentence is supported.',quote:'PRIVATE QUOTE',quoteLocated:true,partialMatch:false}]);
 assert.equal(report.evidenceHighlights.length,6,'diagnostics retain the public six-source highlight window');
 assert.deepEqual(report.answer.reviewedEvidence,[{id:'S1',
  point:'The speaker makes a conditional claim.',quoteVerified:true,
  anchorQuote:'If they could observe justice',speaker:'Hobbes',
  qualifier:'If they could observe justice without common power'}]);
 assert.equal(serialized.includes('PRIVATE FULL PAGE TEXT'),false);
 assert.equal(serialized.includes('PRIVATE PREVIEW'),false);
 assert.equal(serialized.includes('PRIVATE TOKEN'),false);
 assert.equal(serialized.includes('PRIVATE QUOTE'),true);
 assert.equal(serialized.includes('The authors differ [S1, S2].'),false);
});

test('worker failure diagnostics retain only bounded safe detail',()=>{
 const report=createDiagnosticReport({stage:'failed',
  failureStage:'answer-pipeline',failureProviderClass:'daily-free-allocation',
  failureProviderCode:'3036',
  failureAnswerCharacters:5050,failureDetail:'retry_invalid_json'});
 assert.equal(report.failureStage,'answer-pipeline');
 assert.equal(report.failureProviderClass,'daily-free-allocation');
 assert.equal(report.failureProviderCode,'3036');
 assert.equal(report.failureAnswerCharacters,5050);
 assert.equal(report.failureDetail,'retry_invalid_json');
 const unsafe=createDiagnosticReport({stage:'failed',
  failureStage:'PRIVATE PROVIDER MESSAGE',failureProviderClass:'Unknown Provider',
  failureAnswerCharacters:-5,failureDetail:'private exception body'});
 assert.equal(unsafe.failureStage,null);
 assert.equal(unsafe.failureProviderClass,null);
 assert.equal(unsafe.failureAnswerCharacters,null);
 assert.equal(unsafe.failureDetail,null);
});

test('diagnostic reports preserve the selector no-relevant-evidence status',()=>{
 const report=createDiagnosticReport({sourceSelection:{status:'no-relevant-evidence',
  candidateCount:24,pages:[],usage:{calls:1,neurons:3,inputTokens:120,outputTokens:40}}});
 assert.equal(report.sourceSelection.status,'no-relevant-evidence');
 assert.equal(report.sourceSelection.candidateCount,24);
 assert.deepEqual(report.sourceSelection.pages,[]);
});
test('diagnostic failure codes preserve useful status categories without raw error text',()=>{
 assert.equal(diagnosticFailureCode(403),'visitor-or-origin-rejected');
 assert.equal(diagnosticFailureCode(422),'source-verification-rejected');
 assert.equal(diagnosticFailureCode(429),'rate-limited');
 assert.equal(diagnosticFailureCode(502),'answer-generation-or-citation-failed');
 assert.equal(diagnosticFailureCode(502,'answer','evidence-review-request-failed'),
   'evidence-review-request-failed');
 // New Worker reason codes should survive without a frontend allowlist update.
 assert.equal(diagnosticFailureCode(502,'answer','answer-quotation-not-source-verified'),
   'answer-quotation-not-source-verified');
 const precise=createDiagnosticReport({stage:'failed',failureHttpStatus:502,
   failureCode:'answer-quotation-not-source-verified'});
 assert.equal(precise.failureCode,'answer-quotation-not-source-verified');
 assert.equal(diagnosticFailureCode(502,'answer','PRIVATE MODEL ERROR'),
   'answer-generation-or-citation-failed');
 assert.equal(diagnosticFailureCode(502,'planner'),'search-planning-failed');
 assert.equal(diagnosticFailureCode(502,'planner','ai-daily-free-allocation'),
   'ai-daily-free-allocation');
 assert.match(userFailureMessage('ai-daily-free-allocation'),/Cloudflare Workers AI reported/);
 assert.match(userFailureMessage('ai-daily-free-allocation'),/paid Workers account/);
 assert.match(userFailureMessage('ai-provider-usage-limit'),/usage or billing limit/);
 assert.match(userFailureMessage('ai-credit-limit'),/cannot verify the account’s plan/);
 assert.match(userFailureMessage('ai-capacity-unavailable'),/temporarily at capacity/);
 assert.match(userFailureMessage('ai-rate-limited'),/too many requests/);
 assert.equal(diagnosticFailureCode(503),'service-unavailable');
 assert.equal(diagnosticFailureCode(null),'network-error');
 const report=createDiagnosticReport({stage:'failed',failureHttpStatus:999,
   failureCode:'PRIVATE MODEL ERROR response contains secret'});
 assert.equal(report.failureHttpStatus,null);
 assert.equal(report.failureCode,'unclassified');
 const complete=createDiagnosticReport({stage:'complete',
   failureCode:'unclassified'});
 assert.equal(complete.failureCode,'');
});

test('diagnostic reports all six source pages sent to the answer service',()=>{
 const submittedSources=Array.from({length:6},(_,index)=>({id:'S'+(index+1),
   bookId:'102',title:'A Brief History of Time',page:53+index,text:'PRIVATE TEXT'}));
 const citations=submittedSources.map(({text,...source})=>source);
 const report=createDiagnosticReport({submittedSources,answer:'[S1] [S2] [S3] [S4] [S5] [S6]',
   citations});
 assert.deepEqual(report.submittedSources.map(source=>source.page),[53,54,55,56,57,58]);
 assert.deepEqual(report.answer.citations.map(source=>source.id),['S1','S2','S3','S4','S5','S6']);
 assert.equal(JSON.stringify(report).includes('PRIVATE TEXT'),false);
});


test('diagnostics expose bounded question-part coverage tied to submitted sources',()=>{
 const report=createDiagnosticReport({
  submittedSources:Array.from({length:6},(_,index)=>({id:'S'+(index+1)})),
  questionParts:[
   {part:'definition',status:'supported',evidenceIds:['S1','S2','S3','S4','S5','S6','S9']},
   {part:'contrast with skill',status:'unsupported',evidenceIds:[]},
   {part:'x'.repeat(200),status:'partial',evidenceIds:['S2','S1','S2']}
  ]
 });
 assert.equal(report.clientBuild,'v1.18-conditional-gap-search');
 assert.deepEqual(report.answer.questionParts,[
  {part:'definition',status:'supported',evidenceIds:['S1','S2','S3','S4','S5','S6']},
  {part:'contrast with skill',status:'unsupported',evidenceIds:[]},
  {part:'x'.repeat(140),status:'partial',evidenceIds:['S2','S1']}
 ]);
 assert.match(client,/diagnosticState\.questionParts=data\.questionParts/);
});
test('diagnostics record bounded conditional retrieval decisions without excerpts',()=>{
 const report=createDiagnosticReport({retrievalCoverage:{triggered:true,weakParts:[
  {question:'How is reality known?',overlap:1},{question:'x'.repeat(300),overlap:0}]},
  gapPlannerAttempted:true,
  gapQueries:['experience and external reality','perception and certainty','third bounded query','fourth ignored'],
  gapPlannerFailure:'search-planning-failed',
  retrievalCoverageAfterGap:{weakParts:[{question:'How is reality known?',overlap:3}]},
  candidates:[{excerpt:'must never be copied into diagnostic output'}]});
 assert.equal(report.gapSearch.triggered,true);
 assert.equal(report.gapSearch.plannerAttempted,true);
 assert.equal(report.gapSearch.weakParts.length,2);
 assert.equal(report.gapSearch.weakParts[1].part.length,240);
 assert.equal(report.gapSearch.queries.length,3);
 assert.equal(report.gapSearch.failureCode,'search-planning-failed');
 assert.equal(report.gapSearch.afterGap[0].overlap,3);
 assert.equal(JSON.stringify(report).includes('must never be copied'),false);
});

test('diagnostics preserve per-part coverage ratios and reasons safely',()=>{
 const report=createDiagnosticReport({retrievalCoverage:{triggered:true,parts:[
  {question:'How does climate change affect people?',matchedTerms:['climate','change'],
   distinctiveTerms:['climate','change','people'],matchedDistinctiveTerms:['climate'],
   sharedMatchedTerms:['change'],
   overlap:2,distinctiveTermCount:7,coverageRatio:0.286,requiredTermCount:3,
   coverageReason:'no-coherent-term-cluster'},
  {question:'What is memory?',matchedTerms:['memory'],overlap:1,
   distinctiveTermCount:1,coverageRatio:1,requiredTermCount:1,
   coverageReason:'unexpected free form value!'}],weakParts:[
    {question:'What is memory?',overlap:1,distinctiveTerms:['memory'],
     matchedDistinctiveTerms:[],sharedMatchedTerms:['meaning'],coverageReason:'only-shared-part-terms'}
   ]}});
 assert.equal(report.gapSearch.parts[0].coverageRatio,0.286);
 assert.equal(report.gapSearch.parts[0].reason,'no-coherent-term-cluster');
 assert.deepEqual(report.gapSearch.parts[0].distinctiveTerms,['climate','change','people']);
 assert.deepEqual(report.gapSearch.parts[0].matchedDistinctiveTerms,['climate']);
 assert.deepEqual(report.gapSearch.parts[0].sharedMatchedTerms,['change']);
 assert.equal(report.gapSearch.parts[1].reason,null);
 assert.equal(report.gapSearch.weakParts[0].reason,'only-shared-part-terms');
 assert.deepEqual(report.gapSearch.weakParts[0].distinctiveTerms,['memory']);
 assert.deepEqual(report.gapSearch.weakParts[0].matchedDistinctiveTerms,[]);
 assert.deepEqual(report.gapSearch.weakParts[0].sharedMatchedTerms,['meaning']);
 assert.equal(JSON.stringify(report).includes('unexpected free form'),false);
});
test('diagnostics preserve bounded per-part search and selected-page mappings',()=>{
 const searches=Array.from({length:7},(_,index)=>({
  query:'question facet '+index,resultCount:10,partIds:['P'+(index+1)],
  sources:[{id:'S'+(index+1),bookId:'40',title:'Critique of Pure Reason',page:index+1,
   candidatePartIds:['P'+(index+1),'P0','invalid']}]
 }));
 const report=createDiagnosticReport({searches,
  candidates:[{id:'S1',candidatePartIds:['P1','P2','bad']}],
  submittedSources:[{id:'S1',candidatePartIds:['P1','P2','P2','bad']}]});
 assert.equal(report.searches.length,7,'all planned question facets fit in the diagnostic');
 assert.deepEqual(report.searches.map(search=>search.partIds),[
  ['P1'],['P2'],['P3'],['P4'],['P5'],['P6'],['P7']]);
 assert.deepEqual(report.searches[6].sources[0].candidatePartIds,['P7']);
 assert.deepEqual(report.candidates[0].candidatePartIds,['P1','P2']);
 assert.deepEqual(report.submittedSources[0].candidatePartIds,['P1','P2']);
});

test('diagnostic data stays out of answer requests',()=>{
 assert.doesNotMatch(html,/companion-diagnostic-(?:panel|toggle|details|copy)/,
  'diagnostic controls are not included in the current public page markup');
 assert.doesNotMatch(html,/The report includes your question and retrieval details|shared only if you copy it/);
 assert.match(client,/navigator\.clipboard\.writeText\(diagnosticOutput\.textContent\)/);
 assert.match(client,/diagnosticState\.searches=retrieval\.searches/);
 assert.match(client,/diagnosticState\.evidenceHighlights=highlights\.map/);
 assert.match(client,/diagnosticState\.failureHttpStatus=res\.status/);
 assert.match(client,/diagnosticState\.failureHttpStatus=response\.status/);
 assert.match(client,/diagnosticState\.failureStage=data\.failureStage/);
 assert.match(client,/diagnosticState\.failureProviderClass=data\.failureProviderClass/);
 assert.match(client,/diagnosticState\.failureAnswerCharacters=data\.failureAnswerCharacters/);
 assert.match(client,/diagnosticState\.failureDetail=data\.failureDetail/);
 assert.match(client,/body:JSON\.stringify\(\{question:q,turnstileToken:token,\s*history,bookId:bookFilter\.value\|\|'',plan:diagnosticState\?\.plannerPlan\|\|undefined,/);
});


test('diagnostics expose only bounded reviewed points tied to submitted sources',()=>{
 const report=createDiagnosticReport({
  submittedSources:[{id:'S1'},{id:'S2'}],
  reviewedEvidence:[
   {id:'S1',point:'Directly supported summary.'},
   {id:'S1',point:'A separate point from the same source.'},
   {id:'S2',point:'x'.repeat(300)},
   {id:'S9',point:'Invented source must be excluded.'},
   {id:'S1',point:'Directly supported summary.'},
   {id:'S2',point:' '}
  ]
 });
 assert.deepEqual(report.answer.reviewedEvidence,[
  {id:'S1',point:'Directly supported summary.',quoteVerified:false},
  {id:'S1',point:'A separate point from the same source.',quoteVerified:false},
  {id:'S2',point:'x'.repeat(220),quoteVerified:false}
 ]);
});

test('diagnostics summarize v2 validated claim spans without exposing full pages',()=>{
 const report=createDiagnosticReport({submittedSources:[{id:'S1',text:'PRIVATE FULL PAGE'}],
  reviewedEvidence:[{id:'S1',claimId:'C2',quote:'A validated exact passage from this source.',start:10,end:51}]});
 assert.deepEqual(report.answer.reviewedEvidence,[{id:'S1',point:'Claim C2',quoteVerified:true,
  anchorQuote:'A validated exact passage from this source.'}]);
 assert.equal(JSON.stringify(report).includes('PRIVATE FULL PAGE'),false);
});

test('diagnostics retain complete sentence context around a verified quote anchor',()=>{
 const sentence='If a great multitude could observe justice without a common power to keep them in awe, there would be peace without subjection and no need for civil government.';
 const report=createDiagnosticReport({
  submittedSources:[{id:'S1'}],
  reviewedEvidence:[{id:'S1',point:'The claim is conditional.',quoteVerified:true,
    anchorQuote:sentence,speaker:'Hobbes'}]
 });
 assert.equal(report.answer.reviewedEvidence[0].anchorQuote,sentence);
});

