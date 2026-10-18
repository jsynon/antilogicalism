import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeFacetSearches,validSearchPlan} from './evidence-search.mjs';

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
