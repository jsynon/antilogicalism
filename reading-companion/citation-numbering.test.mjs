import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCitationNumbering,citationDisplayLabel,sortCitationsByNumber,sourceAttributionLabel} from './citation-numbering.mjs';

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
 assert.equal(sourceAttributionLabel({pageSectionHint:'introduction',pageVoiceHint:'editorial-or-front-matter; verify against the passage'}),
  'Introduction: page speaker not confirmed');
 assert.equal(sourceAttributionLabel({pageSectionHint:'undetermined'}),'');
});

test('sources absent from the answer are appended in their returned order',()=>{
 const numbering=buildCitationNumbering('Claim [S2].',[{id:'S1'},{id:'S2'},{id:'S3'}]);
 assert.deepEqual([...numbering],[['S2',1],['S1',2],['S3',3]]);
});
