/* Real-corpus read-only retrieval audit. This is evaluation data, not ranking rules.
 * Set EVAL_REAL_CORPUS=1 in CI. Logs book/page references with short clips,
 * without sending any content to a model or changing public site data.
 */
import {RemoteLibrary} from './remote-library.mjs';
import {rankBookEvidence} from './evidence-planner.mjs';
import {readFileSync} from 'node:fs';

const root='https://jsynon.github.io/antilogicalism-library-data/data-v47/';
const library=new RemoteLibrary(root);
const checks=[
 {name:'Literature',bookId:'114',
  question:'In Crime and Punishment, how does Raskolnikov attempt to justify murder, and how does the novel challenge his reasoning?'},
 {name:'Aristotle',bookId:'7',
  question:"How do moral virtue, practical wisdom (phronesis), and happiness (eudaimonia) fit together in Aristotle's Nicomachean Ethics?"},
 {name:'Darwin',bookId:'529',
  question:"According to Darwin's On the Origin of Species, how does natural selection operate, and what roles do inherited variation and the struggle for existence play?"},
 {name:'Thucydides',bookId:'152',
  question:'According to Thucydides, what were the underlying causes of the Peloponnesian War, and how did they differ from the immediate disputes that preceded it?'}
];
for(const entry of checks) {
 const result=await library.search(entry.question,{bookId:entry.bookId,allowedBookIds:new Set([entry.bookId]),maxBooks:1,pagesPerBook:3});
 console.log('\n=== '+entry.name+' ===');
 console.log('Query terms:',result.terms,'anchor:',result.anchorTerm);
 for(const x of result.sources)console.log('BASELINE page',x.page,':',x.preview.replace(/\s+/g,' ').slice(0,230));
 const shard=await library.jsonGzip('book-'+entry.bookId+'.json');
 const manifest=await library.manifest();
 const evidence=rankBookEvidence({question:entry.question,
   title:manifest.books[entry.bookId].title,
   pages:shard.pages,maxCandidates:10});
 console.log('Facet plan:',JSON.stringify(evidence.plan.facets));
 console.log('Facets covered:',JSON.stringify(evidence.facetsCovered));
 for(const x of evidence.ranked.slice(0,5)){
  const preview=x.item.text.replace(/\s+/g,' ').slice(0,360);
  console.log('PLANNED page',x.item.page,'facets',JSON.stringify(x.facets),
    'score',x.score.toFixed(1),':',preview);
 }
}

console.log('\n=== Reader-reference audit: published Dostoevsky pages ===');
const novel=await library.jsonGzip('book-114.json');
for(const [name,exp] of [
 ['extraordinary',/\bextraordinary\b/i],
 ['Napoleon',/\bNapoleon\b/i],
 ['theory',/\btheory\b/i],
 ['murder moral theory',/\bmurder\b[\s\S]{0,400}\b(?:theory|conscience|right)\b/i],
 ['guilt',/\bguilt\b/i],
 ['conscience',/\bconscience\b/i]
]){
 const hits=novel.pages.filter(p=>exp.test(p.text));
 console.log('MATCH '+name+': '+hits.length+' pages');
 console.log('PAGES '+name+':',hits.slice(0,16).map(x=>x.page));
}
