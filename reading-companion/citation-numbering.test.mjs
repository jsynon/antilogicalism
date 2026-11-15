import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {auditCitationIds,buildCitationNumbering,citationDisplayLabel,inlineCitationGroups,sortCitationsByNumber,sourceAttributionLabel} from './citation-numbering.mjs';

const clientV49=readFileSync(new URL('./companion-v112.mjs',import.meta.url),'utf8');

test('citation labels follow first inline use and source rows use the same order',()=>{
 const citations=[{id:'S1'},{id:'S2'},{id:'S3'}];
 const numbering=buildCitationNumbering('Second point [S3]. First point [S1, S2].',citations);
 assert.deepEqual([...numbering],[['S3',1],['S1',2],['S2',3]]);
 assert.deepEqual(sortCitationsByNumber(citations,numbering).map(source=>source.id),['S3','S1','S2']);
 assert.deepEqual(['S3','S1','S2'].map(id=>citationDisplayLabel(id,numbering)),['1','2','3']);
});

test('source attribution labels distinguish curated pseudonymous and editorial context',()=>{
 assert.equal(sourceAttributionLabel({workVoice:{kind:'pseudonymous-author',name:'Johannes de Silentio',creditedAuthor:'Søren Kierkegaard'}}),
  'Published under pseudonym: Johannes de Silentio · Credited author: Søren Kierkegaard');
 assert.equal(sourceAttributionLabel({pageVoice:{kind:'editorial-introduction',name:'David A. Dilworth',creditedAuthor:'Kitarō Nishida'}}),
  'Editorial introduction by David A. Dilworth · Work credited to Kitarō Nishida');
 assert.equal(sourceAttributionLabel({pageVoice:{kind:'editorial-commentary',name:'Walter Kaufmann',creditedAuthor:'Friedrich Nietzsche'}}),
  'Editorial commentary by Walter Kaufmann · Work credited to Friedrich Nietzsche');
 assert.equal(sourceAttributionLabel({pageSectionHint:'introduction',pageVoiceHint:'editorial-or-front-matter; verify against the passage'}),
  'Introduction: page speaker not confirmed');
 assert.equal(sourceAttributionLabel({pageSectionHint:'undetermined'}),'');
});

test('sources absent from the answer are appended in their returned order',()=>{
 const numbering=buildCitationNumbering('Claim [S2].',[{id:'S1'},{id:'S2'},{id:'S3'}]);
 assert.deepEqual([...numbering],[['S2',1],['S1',2],['S3',3]]);
});

test('audits citation markers against the sources returned by the server (moved from diagnostic-report tests, audit fix C6)',()=>{
 const audit=auditCitationIds('Darwin explains variation [S1, S2].',[{id:'S1'}]);
 assert.deepEqual(audit.inlineIds,['S1','S2']);
 assert.deepEqual(audit.returnedIds,['S1']);
 assert.deepEqual(audit.inlineIdsWithoutSource,['S2']);
 assert.deepEqual(audit.sourcesNotCited,[]);
});

test('parses grouped citation markers and the UI renders each source link (audit fix C6)',()=>{
 const answer='The passages support this claim [S1, S3].';
 assert.deepEqual(inlineCitationGroups(answer).map(group=>group.ids),[['S1','S3']]);
 assert.match(clientV49,/const citationAudit=auditCitationIds\(data\.answer,responseCitations\)/);
 assert.match(clientV49,/citationAudit\.inlineIdsWithoutSource\.length/);
 assert.match(clientV49,/const groups=inlineCitationGroups\(answer\)/);
 assert.match(clientV49,/appendCitation\(id,citationGroup,groupExcerpts\)/);
 assert.match(clientV49,/citationGroup\.style\.whiteSpace='nowrap'/);
 assert.match(clientV49,/citationGroup\.append\(document\.createTextNode\('\]'\)\)/);
 const audit=auditCitationIds(answer,[{id:'S1'},{id:'S3'}]);
 assert.deepEqual(audit.inlineIdsWithoutSource,[]);
});
