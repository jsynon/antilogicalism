import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {claimQuotesForCitation} from './citation-evidence.mjs';

const client=readFileSync(new URL('./companion-v112.mjs',import.meta.url),'utf8');
const answer='The gifts of Fortune reveal that true happiness cannot be found in external, changeable matters, as these goods lose their value when examined or are subject to being lost. [S1] Lady Philosophy observes that wealth is not inherently valuable for its own nature but depends on human use, and it becomes less of a possession when it is scattered to others. [S1]';
const citationStart=answer.lastIndexOf('[S1]');
const approved=[
  {id:'S1',claimId:'P1-C2',point:'She argues that happiness cannot be fixed in matters of chance because the highest good cannot be something that can be snatched away, whereas Fortune\'s gifts are subject to being lost.',
    quote:'Yet consider this further, that you may be assured that happiness cannot be fixed in matters of chance.',quoteVerified:true},
  {id:'S1',claimId:'P2-C1',point:'The gifts of Fortune reveal that true happiness cannot be found in external, changeable matters, as these goods lose their value when examined or are subject to being lost.',
    quote:'If the gifts of Fortune fade not nor pass quickly away, what is there in them which could ever be truly yours?',quoteVerified:true},
  {id:'S1',claimId:'P1-C1',point:'Lady Philosophy explains that Fortune\'s nature prevents her from being stable because she is characterized by uncertainty and inconstancy.',
    quote:'that Fortune by its own uncertainty can never come near to reaching happiness.',quoteVerified:true},
  {id:'S1',claimId:'P2-C2',point:'Lady Philosophy observes that wealth is not inherently valuable for its own nature but depends on human use, and it becomes less of a possession when it is scattered to others.',
    quote:'But that cannot remain with one person which is handed over to another: therefore money becomes valuable to its possessor when, by being scattered, it is transferred to others, and ceases to be possessed.',quoteVerified:true},
];

test('inline citation can use an approved claim quote omitted from the three-quote page summary',()=>{
  const compactPageSummary=approved.slice(0,3);
  assert.equal(compactPageSummary.some(item=>item.claimId==='P2-C2'),false);
  assert.deepEqual(claimQuotesForCitation(answer,citationStart,'S1',approved),[
    approved[3].quote,
  ]);
});

test('a citation never falls back to another claim’s primary passage',()=>{
  const result=claimQuotesForCitation(answer,citationStart,'S1',approved);
  assert.equal(result.includes(approved[0].quote),false);
});

test('missing or ambiguous claim linkage returns no highlight',()=>{
  assert.deepEqual(claimQuotesForCitation(answer,citationStart,'S1',[
    {...approved[0],point:'A different claim entirely.'},
  ]),[]);
  assert.deepEqual(claimQuotesForCitation(answer,citationStart,'S1',[
    {...approved[3],claimId:'P2-C2'},
    {...approved[3],claimId:'P2-C3'},
  ]),[]);
});

test('only verified evidence for the cited source can be highlighted',()=>{
  assert.deepEqual(claimQuotesForCitation(answer,citationStart,'S2',approved),[]);
  assert.deepEqual(claimQuotesForCitation(answer,citationStart,'S1',[
    {...approved[3],quoteVerified:false},
  ]),[]);
});

test('the live response path uses reviewed evidence, not the capped page summary, for inline citations',()=>{
  assert.match(client,/import \{claimQuotesForCitation\} from '\.\/citation-evidence\.mjs'/);
  assert.match(client,/const evidenceMap=Array\.isArray\(data\.evidenceMap\)/);
  assert.match(client,/putMarkdownBlocks\(reply,answer,citations,evidenceMap,numbering\)/);
  assert.match(client,/claimQuotesForCitation\(answer,citationGroup\.start,source\.id,evidenceMap\)/);
  assert.doesNotMatch(client,/claimQuotesForCitation\(answer,citationGroup\.start,evidence\)/);
});
