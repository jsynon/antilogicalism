/* Real-corpus read-only retrieval audit. This is evaluation data, not ranking rules.
 * Set EVAL_REAL_CORPUS=1 in CI. Logs book/page references with short clips,
 * without sending any content to a model or changing public site data.
 */
import {RemoteLibrary} from './remote-library.mjs';
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
 for(const x of result.sources)console.log('page',x.page,':',x.preview.replace(/\s+/g,' ').slice(0,380));
}
