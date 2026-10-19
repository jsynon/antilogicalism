import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {auditCitationIds,createDiagnosticReport} from './diagnostic-report.mjs';

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
  question:'How do Aristotle and Darwin explain change?',selectedBookId:'',plannerEnabled:false,
  plannerQueries:['Aristotle virtue','Darwin evolution'],stage:'complete',
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
 assert.equal(report.plannerEnabled,false);
 assert.deepEqual(report.answer.inlineIdsWithoutSource,['S2']);
 assert.equal(report.candidates[0].score,2.5);
 assert.equal(report.evidenceHighlights[0].quoteLocated,true);
 assert.equal(serialized.includes('PRIVATE FULL PAGE TEXT'),false);
 assert.equal(serialized.includes('PRIVATE PREVIEW'),false);
 assert.equal(serialized.includes('PRIVATE TOKEN'),false);
 assert.equal(serialized.includes('PRIVATE QUOTE'),false);
 assert.equal(serialized.includes('The authors differ [S1, S2].'),false);
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
 assert.doesNotMatch(client,/JSON\.stringify\(\{question:q,turnstileToken:token,[\s\S]{0,160}diagnostic/);
});
