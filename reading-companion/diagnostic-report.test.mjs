import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {auditCitationIds,createDiagnosticReport,diagnosticFailureCode} from './diagnostic-report.mjs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const client=readFileSync(new URL('./companion-v110.mjs',import.meta.url),'utf8');

test('audits citation markers against the sources returned by the server',()=>{
 const audit=auditCitationIds('Darwin explains variation [S1, S2].',[{id:'S1'}]);
 assert.deepEqual(audit.inlineIds,['S1','S2']);
 assert.deepEqual(audit.returnedIds,['S1']);
 assert.deepEqual(audit.inlineIdsWithoutSource,['S2']);
 assert.deepEqual(audit.sourcesNotCited,[]);
});

test('diagnostic output is bounded and never includes source text or challenge data',()=>{
 const report=createDiagnosticReport({
  question:'How do Aristotle and Darwin explain change?',selectedBookId:'',
  plannerQueries:['Aristotle virtue','Darwin evolution'],stage:'failed',
  failureHttpStatus:502,failureCode:diagnosticFailureCode(502),
  candidates:[{id:'S1',bookId:'7',title:'Ethics',page:12,score:2.5,
    text:'PRIVATE FULL PAGE TEXT',preview:'PRIVATE PREVIEW',turnstileToken:'PRIVATE TOKEN'}],
  submittedSources:[{id:'S1',bookId:'7',title:'Ethics',page:12,text:'PRIVATE FULL PAGE TEXT'}],
  outcome:'verified-source-draft',coverage:'partial',reviewStatus:'citations_not_claim_verified',
  answer:'The authors differ [S1, S2].',citations:[{id:'S1',bookId:'7',title:'Ethics',page:12,
    text:'PRIVATE FULL PAGE TEXT'}],
  evidenceHighlights:[{source_id:'S1',page:12,quoteLocated:true,partialMatch:false,
    quote:'PRIVATE QUOTE'}]
 });
 const serialized=JSON.stringify(report);
 assert.equal(report.schema,'antilogicalism-reading-companion-diagnostic-v1');
 assert.equal(report.question,'How do Aristotle and Darwin explain change?');
 assert.deepEqual(report.answer.inlineIdsWithoutSource,['S2']);
 assert.equal(report.failureHttpStatus,502);
 assert.equal(report.failureCode,'answer-generation-or-citation-failed');
 assert.equal(report.answer.text,'The authors differ [S1, S2].');
 assert.equal(report.candidates[0].score,2.5);
 assert.equal(report.evidenceHighlights[0].quoteLocated,true);
 assert.equal(serialized.includes('PRIVATE FULL PAGE TEXT'),false);
 assert.equal(serialized.includes('PRIVATE PREVIEW'),false);
 assert.equal(serialized.includes('PRIVATE TOKEN'),false);
 assert.equal(serialized.includes('PRIVATE QUOTE'),false);
});

test('diagnostic answer text is bounded to the server answer limit',()=>{
 const report=createDiagnosticReport({stage:'complete',answer:'A'.repeat(3000)});
 assert.equal(report.answer.text.length,2400);
});

test('diagnostic failure codes preserve useful status categories without raw error text',()=>{
 assert.equal(diagnosticFailureCode(403),'visitor-or-origin-rejected');
 assert.equal(diagnosticFailureCode(422),'source-verification-rejected');
 assert.equal(diagnosticFailureCode(429),'rate-limited');
 assert.equal(diagnosticFailureCode(502),'answer-generation-or-citation-failed');
 assert.equal(diagnosticFailureCode(502,'planner'),'search-planning-failed');
 assert.equal(diagnosticFailureCode(503),'service-unavailable');
 assert.equal(diagnosticFailureCode(null),'network-error');
 const report=createDiagnosticReport({failureHttpStatus:999,
   stage:'failed',failureCode:'PRIVATE MODEL ERROR response contains secret'});
 assert.equal(report.failureHttpStatus,null);
 assert.equal(report.failureCode,'unclassified');
 const successful=createDiagnosticReport({stage:'complete',failureCode:''});
 assert.equal(successful.failureCode,'');
});

test('diagnostics retain all four submitted pages without exposing their text',()=>{
 const report=createDiagnosticReport({stage:'complete',failureCode:'',
   submittedSources:[1,2,3,4].map(page=>({id:'S'+page,bookId:'529',
     title:'Origin of Species',page,text:'PRIVATE SOURCE TEXT'}))});
 assert.deepEqual(report.submittedSources.map(source=>source.id),
   ['S1','S2','S3','S4']);
 assert.equal(JSON.stringify(report).includes('PRIVATE SOURCE TEXT'),false);
});

test('diagnostics are opt-in, copyable, and kept out of answer requests',()=>{
 assert.match(html,/id="companion-diagnostic-panel"[^>]+hidden/);
 assert.match(html,/id="companion-diagnostic-toggle" type="checkbox"/);
 assert.match(html,/id="companion-diagnostic-details" hidden/);
 assert.match(html,/id="companion-diagnostic-copy" type="button">Copy diagnostic report/);
 assert.match(html,/shared only if you copy it/);
 assert.match(html,/answer text \(up to 2,400 characters\)/i);
 assert.match(client,/navigator\.clipboard\.writeText\(diagnosticOutput\.textContent\)/);
 assert.match(client,/foundSets\.map\(\(set,index\)=>/);
 assert.match(client,/diagnosticState\.evidenceHighlights=highlights\.map/);
 assert.match(client,/diagnosticState\.failureHttpStatus=res\.status/);
 assert.match(client,/diagnosticState\.failureHttpStatus=response\.status/);
 assert.match(client,/body:JSON\.stringify\(\{question:q,turnstileToken:token,\s*sources:chosen\.map/);
});
