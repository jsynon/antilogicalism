#!/usr/bin/env node
/* Re-score a saved quality report using local structural checks only.
 * This tool does not fetch the library, contact the Worker, or call a model.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {recheckQualityReport} from './live-answer-evaluation.mjs';

function parseArgs(argv){
 const result={input:'',output:''};
 for(let index=0;index<argv.length;index++){
  const [flag,inline]=argv[index].split('=',2);
  if(flag==='--help'||flag==='-h'){result.help=true;continue;}
  if(!['--input','--output'].includes(flag))throw Error('Unknown option '+flag);
  const value=inline??argv[++index];
  if(!value)throw Error('Missing value for '+flag);
  result[flag.slice(2)]=value;
 }
 if(!result.help&&!result.input)throw Error('Provide --input with an extracted report JSON file.');
 return result;
}

async function main(){
 const args=parseArgs(process.argv.slice(2));
 if(args.help){
  console.log('Usage: node reading-companion/recheck-live-answer-evaluation.mjs --input report.json [--output rechecked.json]');
  console.log('Input must be the JSON report extracted from the GitHub Actions artifact ZIP. No network or AI calls are made.');
  return;
 }
 const input=resolve(args.input);
 const report=JSON.parse(await readFile(input,'utf8'));
 const result=recheckQualityReport(report);
 const output=args.output?resolve(args.output):input.replace(/\.json$/i,'')+'.offline-rechecked.json';
 await writeFile(output,JSON.stringify(result,null,2)+'\n');
 const summary=result.offlineRecheck;
 console.log('Offline structural recheck: '+summary.passedCases+'/'+summary.checkedCases+' passed.');
 console.log('Question parts: '+summary.questionPartStatusCounts.supported+' supported, '+
  summary.questionPartStatusCounts.partial+' partial, '+summary.questionPartStatusCounts.unsupported+' unsupported.');
 console.log('AI calls: 0. Network calls: 0.');
 console.log('Report: '+output);
}

main().catch(error=>{console.error(error.message);process.exitCode=1;});
