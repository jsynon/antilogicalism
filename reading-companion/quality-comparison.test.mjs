import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compareQualityEvaluations} from './quality-comparison.mjs';

const scores=(value)=>({accuracy:value,questionCoverage:value,explanationQuality:value,
 citationSupport:value,citationCompleteness:value});
function report({runId,revision,values,failed=[]}){
 return {mode:'fresh',searchScope:'all-books',answerVariant:'with-review',
  retrievalProfile:{name:'default'},retrievalConfig:{limit:6},
  evaluationRun:{runId},workerSourceRevisions:[revision],
  cases:values.map((value,index)=>({id:`case-${index+1}`,question:`Question ${index+1}`,
   evaluationScope:'all-books',selectedBookIds:[],answerText:failed.includes(index)?'':'Answer',
   noAnswerFailure:failed.includes(index),workerSourceRevision:revision,
   manualReview:{status:'complete',scores:scores(value)},
   highlightHumanReview:{status:'complete',scores:scores(Math.max(0,value-1))}}))};
}

test('paired comparison scores answers and highlights separately and counts failures as zero',()=>{
 const before=report({runId:'100',revision:'a',values:[1,2],failed:[1]});
 const after=report({runId:'101',revision:'b',values:[2,1]});
 const result=compareQualityEvaluations(before,after);
 assert.equal(result.panelMatched,true);
 assert.equal(result.settingsMatched,true);
 assert.equal(result.sameWorkerRevisions,false);
 assert.equal(result.answer.before.producedOnlyAverageOutOf10,5);
 assert.equal(result.answer.before.completionAdjustedAverageOutOf10,2.5);
 assert.equal(result.answer.after.producedOnlyAverageOutOf10,7.5);
 assert.equal(result.answer.after.completionAdjustedAverageOutOf10,7.5);
 assert.equal(result.highlights.before.completionAdjustedAverageOutOf10,0);
 assert.equal(result.highlights.after.producedOnlyAverageOutOf10,2.5);
 assert.equal(result.cases[0].answer.delta,5);
 assert.match(result.interpretation,/descriptive/);
});

test('comparison rejects changed questions, settings, case panels, and incomplete scores',()=>{
 const before=report({runId:'100',revision:'a',values:[1,2]});
 const after=report({runId:'101',revision:'a',values:[1,2]});
 after.cases[0].question='Changed question';
 assert.throws(()=>compareQualityEvaluations(before,after),/Question text changed/);
 after.cases[0].question='Question 1';
 after.cases[0].selectedBookIds=['42'];
 assert.throws(()=>compareQualityEvaluations(before,after),/Selected book scope changed/);
 after.cases[0].selectedBookIds=[];
 after.retrievalConfig={limit:5};
 assert.equal(compareQualityEvaluations(before,after).settingsMatched,false);
 after.cases.pop();
 assert.throws(()=>compareQualityEvaluations(before,after),/same number of cases/);
 after.cases=report({runId:'101',revision:'a',values:[1,2]}).cases;
 after.cases[0].manualReview.status='not-reviewed';
 assert.throws(()=>compareQualityEvaluations(before,after),/complete answer scorecard/);
});
