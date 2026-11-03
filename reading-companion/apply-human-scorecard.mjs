import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {applyHumanScorecard} from './live-answer-evaluation.mjs';

function parseArgs(argv){
 const args={};
 for(let index=0;index<argv.length;index++){
  const key=argv[index];
  if(!['--report','--scorecard','--output'].includes(key))
   throw Error('Unknown option '+key);
  const value=argv[++index];
  if(!value)throw Error('Missing value for '+key);
  args[key.slice(2)]=value;
 }
 if(!args.report||!args.scorecard)
  throw Error('Usage: node reading-companion/apply-human-scorecard.mjs --report report.json --scorecard report.scorecard.json [--output report.scored.json]');
 return args;
}

async function main(){
 const args=parseArgs(process.argv.slice(2));
 const reportPath=resolve(args.report),scorecardPath=resolve(args.scorecard);
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 const scorecard=JSON.parse(await readFile(scorecardPath,'utf8'));
 const scored=applyHumanScorecard(report,scorecard);
 const outputPath=resolve(args.output||reportPath.replace(/\.json$/i,'.scored.json'));
 await writeFile(outputPath,JSON.stringify(scored,null,2)+'\n');
 console.log('Saved scored report: '+outputPath);
 console.log('Answer average: '+String(scored.humanReview?.averageTotalScoreOutOf10??'pending')+
  '/10; completion-adjusted: '+String(scored.humanReview?.completionAdjustedTotalScoreOutOf10??'pending')+
  '/10. Highlights: '+String(scored.highlightReview?.averageTotalScoreOutOf10??'pending')+
  '/10; completion-adjusted: '+String(scored.highlightReview?.completionAdjustedTotalScoreOutOf10??'pending')+'/10.');
 for(const group of scored.qualityByFailureStage||[]){
  const answer=group.answer||{},highlights=group.highlights||{};
  console.log('Stage '+group.stage+' ('+group.basis+', n='+group.caseCount+'): answers '+
   String(answer.producedOnlyAverageOutOf10??'pending')+'/10 produced, '+
   String(answer.completionAdjustedAverageOutOf10??'pending')+'/10 adjusted; highlights '+
   String(highlights.producedOnlyAverageOutOf10??'pending')+'/10 produced, '+
   String(highlights.completionAdjustedAverageOutOf10??'pending')+'/10 adjusted.');
 }
}

main().catch(error=>{console.error(error.message);process.exitCode=1;});
