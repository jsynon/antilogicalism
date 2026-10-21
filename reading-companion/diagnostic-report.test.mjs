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
 assert.match(client,/appendCitation\(id\)/);
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
  candidates:[{id:'S1',bookId:'7',title:'Ethics',page:12,score:2.5,
    text:'PRIVATE FULL PAGE TEXT',preview:'PRIVATE PREVIEW',turnstileToken:'PRIVATE TOKEN'}],
  submittedSources:[{id:'S1',bookId:'7',title:'Ethics',page:12,text:'PRIVATE FULL PAGE TEXT'}],
  outcome:'verified-source-draft',coverage:'partial',reviewStatus:'citations_not_claim_verified',
  answer:'The authors differ [S1, S2].',citations:[{id:'S1',bookId:'7',title:'Ethics',page:12,
    text:'PRIVATE FULL PAGE TEXT'}],
  reviewedEvidence:[{id:'S1',point:'The speaker makes a conditional claim.',
    quoteVerified:true,anchorQuote:'If they could observe justice',speaker:'Hobbes',
    qualifier:'If they could observe justice without common power'}],
  evidenceHighlights:[{source_id:'S1',page:12,quoteLocated:true,partialMatch:false,
    quote:'PRIVATE QUOTE'}]
 });
 const serialized=JSON.stringify(report);
 assert.equal(report.schema,'antilogicalism-reading-companion-diagnostic-v1');
 assert.deepEqual(report.answer.inlineIdsWithoutSource,['S2']);
 assert.equal(report.failureHttpStatus,502);
 assert.equal(report.plannerWorkerVersionId,'worker-plan-7');
 assert.equal(report.answerWorkerVersionId,'worker-answer-7');
 assert.equal(report.answerWorkerVersionTag,null);
 assert.equal(report.failureCode,'answer-generation-or-citation-failed');
 assert.equal(report.candidates[0].score,2.5);
 assert.equal(report.evidenceHighlights[0].quoteLocated,true);
 assert.equal(report.evidenceHighlights[0].quote,'PRIVATE QUOTE');
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
 assert.equal(diagnosticFailureCode(502,'planner','ai-daily-limit-reached'),
   'ai-daily-limit-reached');
 assert.equal(userFailureMessage('ai-daily-limit-reached'),
   'The chatbot has reached its daily AI usage limit. Please try again after the daily reset.');
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
 assert.equal(report.clientBuild,'v1.15-evidence-anchor-diagnostics');
 assert.deepEqual(report.answer.questionParts,[
  {part:'definition',status:'supported',evidenceIds:['S1','S2','S3','S4','S5','S6']},
  {part:'contrast with skill',status:'unsupported',evidenceIds:[]},
  {part:'x'.repeat(140),status:'partial',evidenceIds:['S2','S1']}
 ]);
 assert.match(client,/diagnosticState\.questionParts=data\.questionParts/);
});

test('diagnostics are opt-in, copyable, and kept out of answer requests',()=>{
 assert.match(html,/id="companion-diagnostic-panel"[^>]+hidden/);
 assert.match(html,/id="companion-diagnostic-toggle" type="checkbox"/);
 assert.match(html,/id="companion-diagnostic-details" hidden/);
 assert.match(html,/id="companion-diagnostic-copy" type="button">Copy diagnostic report/);
 assert.match(html,/shared only if you copy it/);
 assert.match(client,/navigator\.clipboard\.writeText\(diagnosticOutput\.textContent\)/);
 assert.match(client,/foundSets\.map\(\(set,index\)=>/);
 assert.match(client,/diagnosticState\.evidenceHighlights=highlights\.map/);
 assert.match(client,/diagnosticState\.failureHttpStatus=res\.status/);
 assert.match(client,/diagnosticState\.failureHttpStatus=response\.status/);
 assert.match(client,/body:JSON\.stringify\(\{question:q,turnstileToken:token,\s*history,\s*sources:chosen\.map/);
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

test('diagnostics retain complete sentence context around a verified quote anchor',()=>{
 const sentence='If a great multitude could observe justice without a common power to keep them in awe, there would be peace without subjection and no need for civil government.';
 const report=createDiagnosticReport({
  submittedSources:[{id:'S1'}],
  reviewedEvidence:[{id:'S1',point:'The claim is conditional.',quoteVerified:true,
    anchorQuote:sentence,speaker:'Hobbes'}]
 });
 assert.equal(report.answer.reviewedEvidence[0].anchorQuote,sentence);
});
