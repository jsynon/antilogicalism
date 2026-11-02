import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {compareQualityEvaluations} from './quality-comparison.mjs';

function parseArgs(argv){
 const args={};
 for(let index=0;index<argv.length;index++){
  const flag=argv[index];
  if(!['--before','--after','--output'].includes(flag))throw Error('Unknown option '+flag);
  const value=argv[++index];
  if(!value)throw Error('Missing value for '+flag);
  args[flag.slice(2)]=value;
 }
 if(!args.before||!args.after)throw Error('Usage: node reading-companion/compare-human-evaluations.mjs --before before.scored.json --after after.scored.json [--output comparison.json]');
 return args;
}
async function main(){
 const args=parseArgs(process.argv.slice(2));
 const before=JSON.parse(await readFile(resolve(args.before),'utf8'));
 const after=JSON.parse(await readFile(resolve(args.after),'utf8'));
 const result=compareQualityEvaluations(before,after);
 const serialized=JSON.stringify(result,null,2)+'\n';
 if(args.output){
  const {writeFile}=await import('node:fs/promises');
  await writeFile(resolve(args.output),serialized);
  console.log('Saved paired quality comparison: '+resolve(args.output));
 }else process.stdout.write(serialized);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
