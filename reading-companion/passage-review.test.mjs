import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auditPassageGoldReview} from './passage-review.mjs';

const gold=JSON.parse(await readFile(new URL('./passage-review-gold.json',import.meta.url),'utf8'));

function savedCase(spec,{candidatePages=null,submitted=[],highlights=[],questionParts=[],reviewDecisions=[],citations=[]}={}){
 const page=(value)=>({bookId:value.bookId,page:value.page,globalPageId:value.globalPageId});
 const plannerPlan={parts:[...new Map(spec.claims.map(claim=>[claim.partId,
  {id:claim.partId,question:claim.partId}])).values()]};
 return {id:spec.id,plannerPlan,retrievalCandidates:(candidatePages||spec.claims.flatMap(claim=>claim.passages))
  .map(page).filter((value,index,values)=>values.findIndex(other=>
   other.bookId===value.bookId&&other.page===value.page)===index),
  submittedSources:submitted.map(page),citationSources:citations,
  evidenceHighlights:highlights,questionParts:questionParts.map((status,index)=>({
   part:plannerPlan.parts[index]?.question||'',status})),
  evidenceTrace:{reviewContract:{partDecisions:reviewDecisions}}};
}

test('gold audit flags the Hamlet primary page lost before the answer packet',()=>{
 const spec=gold.cases.find(item=>item.id==='paired-hamlet-conscience::all-books');
 const result=auditPassageGoldReview({cases:[savedCase(spec,{submitted:[
  {bookId:'212',page:1625,globalPageId:53546}],citations:[]})]},gold);
 const check=result.cases.find(item=>item.id===spec.id).claimChecks[0];
 assert.equal(check.bestCandidateInPool,true);
 assert.equal(check.bestCandidateSubmitted,false);
 assert.deepEqual(check.submittedPassages,[{bookId:'212',page:1625,label:'reject'}]);
 assert.equal(result.bestCandidateRetrievalMisses,0);
 assert.equal(result.bestCandidatePacketMisses,1);
 assert.equal(result.aiCalls,0);
 assert.equal(result.networkCalls,0);
});

test('gold audit reports a best passage missing from retrieval separately from packet loss',()=>{
 const spec=gold.cases.find(item=>item.id==='paired-hamlet-conscience::all-books');
 const result=auditPassageGoldReview({cases:[savedCase(spec,{candidatePages:[
  {bookId:'212',page:453,globalPageId:53545}],submitted:[
   {bookId:'212',page:453,globalPageId:53545}],citations:[]})]},gold);
 const check=result.cases.find(item=>item.id===spec.id).claimChecks[0];
 assert.equal(check.bestCandidateInPool,false);
 assert.equal(check.bestCandidateSubmitted,false);
 assert.equal(result.bestCandidateRetrievalMisses,1);
 assert.equal(result.bestCandidatePacketMisses,0);
});

test('gold audit distinguishes Boethius page 14 from its acceptable companion page',()=>{
 const spec=gold.cases.find(item=>item.id==='paired-boethius-fortune-wheel::all-books');
 const result=auditPassageGoldReview({cases:[savedCase(spec,{submitted:[
  {bookId:'21',page:11,globalPageId:1912},{bookId:'21',page:12,globalPageId:1913}],citations:[]})]},gold);
 const gifts=result.cases.find(item=>item.id===spec.id).claimChecks.find(item=>item.claimId==='P2-C2');
 assert.equal(gifts.bestCandidateInPool,true);
 assert.equal(gifts.bestCandidateSubmitted,false);
 assert.equal(result.bestCandidatePacketMisses,1);
 assert.deepEqual(gifts.submittedPassages,[{bookId:'21',page:11,label:'acceptable'}]);
});

test('all-books Hume/Kant audit catches the context-only Kant p. 213 highlight',()=>{
 const spec=gold.cases.find(item=>item.id==='paired-hume-kant-causal-inference::all-books');
 const result=auditPassageGoldReview({cases:[savedCase(spec,{submitted:[
  {bookId:'40',page:103,globalPageId:3191},{bookId:'40',page:104,globalPageId:3192},
  {bookId:'40',page:213,globalPageId:3301}],citations:[
   {id:'S3',bookId:'40',page:103},{id:'S4',bookId:'40',page:213},{id:'S6',bookId:'40',page:104}],
  highlights:[{sourceId:'S4',claimId:'P2-C3',quoteLocated:true}]})]},gold);
 const check=result.cases.find(item=>item.id===spec.id).claimChecks[0];
 assert.equal(check.bestCandidateInPool,true);
 assert.equal(check.bestCandidateSubmitted,true);
 assert.deepEqual(check.nonBestHighlights,[{bookId:'40',page:213,label:'context-only',quoteLocated:true}]);
 assert.equal(result.nonBestHighlights,1);
});

test('gold audit identifies context-only Kant highlighting and review-to-answer status drift',()=>{
 const spec=gold.cases.find(item=>item.id==='paired-hume-kant-causal-inference::selected-books');
 const decision=(partId,finalStatus)=>({partId,reviewerStatus:'answered',finalStatus});
 const reportCase=savedCase(spec,{submitted:[
  {bookId:'40',page:103,globalPageId:3191},{bookId:'40',page:104,globalPageId:3192},
  {bookId:'40',page:213,globalPageId:3301}],citations:[
   {id:'S3',bookId:'40',page:103},{id:'S4',bookId:'40',page:213},{id:'S6',bookId:'40',page:104}],
  highlights:[{sourceId:'S4',claimId:'P3-C2',quoteLocated:true}],
  questionParts:['partial','supported','partial'],
  reviewDecisions:[decision('P1','partial'),decision('P2','answered'),decision('P3','answered')]});
 const result=auditPassageGoldReview({cases:[reportCase]},gold);
 const checked=result.cases.find(item=>item.id===spec.id);
 const compare=checked.claimChecks.find(item=>item.claimId==='P3-C2');
 assert.deepEqual(compare.nonBestHighlights,[{bookId:'40',page:213,label:'context-only',quoteLocated:true}]);
 const p3=checked.statusChecks.find(item=>item.partId==='P3');
 assert.equal(p3.consistent,false);
 assert.equal(result.nonBestHighlights,1);
 assert.equal(result.statusMismatches,1);
});

test('gold audit reports missing traces explicitly instead of treating absence as a pass',()=>{
 const result=auditPassageGoldReview({cases:[]},gold);
 assert.equal(result.checkedCases,0);
 assert.equal(result.missingCases,4);
 assert.equal(result.bestCandidateRetrievalMisses,0);
 assert.equal(result.bestCandidatePacketMisses,0);
});
