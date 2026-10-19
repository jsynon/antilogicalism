import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeFacetSearches,validSearchPlan,selectAnswerSources} from './evidence-search.mjs';

const page=(page,bookId='114')=>({page,bookId,title:'Crime and Punishment',
 preview:'Authentic indexed excerpt',url:'https://drive.google.com/file/d/X/view#page='+page});
test('first two selections cover different semantic question facets',()=>{
 const out=mergeFacetSearches([
  {sources:[page(475),page(465),page(476)]},
  {sources:[page(718),page(814),page(719)]}
 ],8);
 assert.deepEqual(out.slice(0,2).map(x=>x.page),[475,718]);
 assert.deepEqual(out.slice(0,2).map(x=>x.facet),[0,1]);
 assert.deepEqual(out.slice(2).map(x=>x.page),[465,814,476,719]);
});
test('deduplicates common matches and selects a distinct second facet page',()=>{
 const out=mergeFacetSearches([
  {sources:[page(38,'152'),page(39,'152')]},
  {sources:[page(38,'152'),page(48,'152')]}
 ],8);
 assert.deepEqual(out.slice(0,2).map(x=>x.page),[38,48]);
 assert.equal(out.length,3);
});
test('comparison queries can surface source pages from different books',()=>{
 const out=mergeFacetSearches([
  {sources:[page(72,'7')]},
  {sources:[page(136,'529')]}
 ]);
 assert.deepEqual(out.map(x=>x.bookId),['7','529']);
});
test('invalid metadata or duplicate semantic planning is never accepted',()=>{
 assert.equal(validSearchPlan(['Raskolnikov extraordinary man theory','Raskolnikov conscience guilt Sonia']),true);
 assert.equal(validSearchPlan(['same search phrase','same search phrase']),false);
 assert.equal(validSearchPlan(['too short', 'other']),false);
 const out=mergeFacetSearches([{sources:[page(73),{bookId:'../../11',page:11},page(74)]}],2);
 assert.deepEqual(out.map(x=>x.page),[73,74]);
});

test('answer submissions include up to four facet-balanced pages within the exact request byte budget',()=>{
 const candidates=mergeFacetSearches([
  {sources:[page(1,'7'),page(2,'7'),page(3,'7')]},
  {sources:[page(4,'529'),page(5,'529'),page(6,'529')]}
 ],8).map((source,index)=>({...source,text:'passage '+index+' '.repeat(5000)}));
 const question='Compare these accounts';
 const token='turnstile-token';
 const chosen=selectAnswerSources(candidates,question,token);
 assert.equal(chosen.length,4);
 assert.deepEqual(chosen.slice(0,2).map(x=>x.facet),[0,1]);
 const body=JSON.stringify({question,turnstileToken:token,history:[],
  sources:chosen.map(({bookId,page,text})=>({bookId,page,text}))});
 assert(new TextEncoder().encode(body).byteLength<=30000);
 assert(new TextEncoder().encode(body).byteLength>20000);
});

test('answer submission skips pages that do not fit and keeps later source candidates',()=>{
 const candidates=[
  {...page(1),text:'x'.repeat(31000)},
  {...page(2,'529'),text:'useful smaller page'}
 ];
 const chosen=selectAnswerSources(candidates,'A question','a token');
 assert.deepEqual(chosen.map(x=>x.page),[2]);
});

test('answer source byte budget includes recent conversation context',()=>{
 const history=[{role:'user',content:'Previous question'},
   {role:'assistant',content:'Previous answer '.repeat(90)}];
 const candidates=[{...page(1),text:'source '.repeat(2500)}];
 const chosen=selectAnswerSources(candidates,'Follow-up question','a token',
   {history,maxBytes:10000});
 const body=JSON.stringify({question:'Follow-up question',turnstileToken:'a token',
   history,sources:chosen.map(({bookId,page,text})=>({bookId,page,text}))});
 assert.equal(new TextEncoder().encode(body).byteLength<=10000,true);
 assert.equal(JSON.parse(body).history.length,2);
});


test('website only trusts planned search strings and still submits original full pages for fingerprint checks',async()=>{
 const {readFileSync}=await import('node:fs');
 const js=readFileSync(new URL('./companion-v110.mjs',import.meta.url),'utf8');
 assert.match(js,/API\+'\/api\/pilot-plan'/);
 assert.match(js,/data\.searchPlanning===true/);
 assert.match(js,/validSearchPlan\(data\.queries\)/);
 assert.match(js,/const found=await retrieveSources\(queries\)/);
 assert.match(js,/token=await nextTurnstileToken\(\)/);
 assert.match(js,/window\.turnstile\.reset\(turnstileId\)/);
 assert.match(js,/sources:chosen\.map\(\(\{bookId,page,text\}\)=>\(\{bookId,page,text\}\)\)/);
 assert.match(js,/selectAnswerSources\(candidates,q,token,\{history\}\)/);
 assert.doesNotMatch(js,/searchPages\(|lastSearch|checked passages will guide/i);
 assert.match(js,/data\.outcome==='insufficient-evidence'/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
});
