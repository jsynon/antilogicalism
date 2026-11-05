import {test} from 'node:test';
import assert from 'node:assert/strict';
import {substantivePageEvidence} from './remote-library.mjs';

// Fixtures for the opt-in IDF-weighted mode of substantivePageEvidence.
// Group 0 ('spirit') stands in for a common query term, group 1 ('sunyata')
// for a rare, discriminative one. The filler sentence contains neither term.
const filler='the river moves slowly through the valley and the stones rest beside the water in quiet order';
const fillerWords=filler.split(' ');
// One dense cluster of the common term, then unrelated prose (148 words).
const denseCommon=('spirit '.repeat(12).trim())+' '+Array(8).fill(filler).join(' ');
// The rare term sustained across the whole page: one mention every 40 words
// in 360 words of prose, so no single window is dense.
function spacedPage(term,count,gap){
  const words=[];
  for(let i=0;i<count;i++){words.push(term);for(let j=0;j<gap;j++)words.push(fillerWords[j%fillerWords.length]);}
  return words.join(' ');
}
const sustainedRare=spacedPage('sunyata',9,39);
const terms=[['spirit'],['sunyata']];

test('weighted scoring ranks a sustained rare-term discussion above one dense common-term cluster',()=>{
  const legacyDense=substantivePageEvidence(denseCommon,terms);
  const legacyRare=substantivePageEvidence(sustainedRare,terms);
  // The legacy scorer ranks them the wrong way for evidence selection: the
  // single dense paragraph of a common term beats the page that sustains a
  // discussion of the rare term, by a clear margin.
  assert(legacyDense.score>legacyRare.score+4,
    `legacy scores: dense ${legacyDense.score}, rare ${legacyRare.score}`);

  const options={groupWeights:[0.25,3],avgPageWords:200};
  const weightedDense=substantivePageEvidence(denseCommon,terms,new Set(),'',options);
  const weightedRare=substantivePageEvidence(sustainedRare,terms,new Set(),'',options);
  // With IDF weights and the whole-page term-frequency component the ranking
  // flips, again by a clear margin.
  assert(weightedRare.score>weightedDense.score+10,
    `weighted scores: dense ${weightedDense.score}, rare ${weightedRare.score}`);
  // unique/localUnique remain raw group counts in weighted mode; the
  // caller's relevance floor depends on them.
  assert.equal(weightedDense.unique,1);
  assert.equal(weightedDense.localUnique,1);
  assert.equal(weightedRare.unique,1);
  assert.equal(weightedRare.localUnique,1);
  assert.deepEqual(Object.keys(weightedRare).sort(),
    ['center','localUnique','phraseMatches','score','unique']);
});

test('calling without options reproduces the legacy score exactly',()=>{
  // Expected objects were recorded from the pre-weighted implementation;
  // the opt-in must not move any existing caller or test.
  assert.deepEqual(substantivePageEvidence(denseCommon,terms),{
    score:21.564949357461536,unique:1,localUnique:1,center:55,phraseMatches:0});
  assert.deepEqual(substantivePageEvidence(sustainedRare,terms),{
    score:16.302585092994047,unique:1,localUnique:1,center:55,phraseMatches:0});
});

test('missing group weights default to 1 and only the term-frequency component is added',()=>{
  const legacy=substantivePageEvidence(denseCommon,terms);
  const weighted=substantivePageEvidence(denseCommon,terms,new Set(),'',{});
  // All weights 1 and avgPageWords falling back to the page's own length
  // (148 words, length norm 1): the dense page has tf=12 for its one group,
  // contributing 4 * (12 * 2.2) / (12 + 1.2) = 8 exactly.
  assert(Math.abs(weighted.score-(legacy.score+8))<1e-9,
    `legacy ${legacy.score}, weighted ${weighted.score}`);
  assert.equal(weighted.unique,legacy.unique);
  assert.equal(weighted.localUnique,legacy.localUnique);
  assert.equal(weighted.center,legacy.center);
});
