Warning: truncated output (original token count: 53255)
Total output lines: 2362

#!/usr/bin/env node
/* Explicit, metered end-to-end evaluation against the public Reading Companion
 * Worker. This is never run by the PR or scheduled retrieval-only workflow.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {RemoteLibrary,DEFAULT_INDEX_ROOT} from './remote-library.mjs';
import {validSearchPlan,selectAnswerSources,prepareAnswerCandidates,canFallbackToDirectSearch,retrieveEvidence,assessEvidenceCoverage,auditSelectionCoverage,auditEvidencePacketSelection,LIVE_RETRIEVAL_CONFIG,RETRIEVAL_PROFILES} from './evidence-search.mjs';
import {auditCitationIds} from './diagnostic-report.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SUITE_PATH=resolve(ROOT,'benchmarks/reading-companion-public-v1.json');
const FINGERPRINT_ROOT='https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v3/';
const API='https://antilogicalism-companion-public.jsynon.workers.dev';
const PART_ID=/^P[1-9]\d*$/;
const validPartText=value=>typeof value==='string'&&value.trim().length>=5&&value.trim().length<=400;

export function validatePublishedCorpus(coverage,manifest){
 if(coverage?.schema!=='antilogicalism-reader-coverage-v3'||coverage?.libraryVersion!==49||
    !coverage.books||typeof coverage.books!=='object'||Array.isArray(coverage.books)||
    manifest?.version!==49){
  const coverageVersion=Number.isInteger(coverage?.libraryVersion)?coverage.libraryVersion:'unknown';
  const corpusVersion=Number.isInteger(manifest?.version)?manifest.version:'unknown';
  throw Error(`Published library version mismatch (expected v49; fingerprint coverage v${coverageVersion}, corpus v${corpusVersion}).`);
 }
 return new Set(Object.keys(coverage.books));
}
export function validateEvaluationBookScopes(cases,allowed,manifest){
 for(const item of cases){
  for(const bookId of Array.isArray(item.selected_book_ids)?item.selected_book_ids:[]){
   const id=String(bookId);
   if(!allowed.has(id)||!manifest?.books?.[id])
    throw Error(`${item.id}: selected book ${id} is not present in the published corpus and fingerprint coverage.`);
  }
  for(const group of item.required_source_groups||[]){
   if(!group.book_ids.some(id=>allowed.has(String(id))))
    throw Error(item.id+': no expected source book is fingerprint-covered.');
  }
 }
 return true;
}

/* Planner part facets are optional retrieval hints. A malformed hint should
 * be visible in the trace and dropped, never allowed to abort the base search
 * for the reader's complete question. Keep the same bounded contract as the
 * shared retriever: at most 12 links and 6 distinct part queries. */
export function partFacetsFromPlan(parts){
 const partQueries=[],partQuestions=[],warnings=[],candidateGroups=[];
 if(!Array.isArray(parts))return {partQueries,partQuestions,warnings};
 for(const part of parts){
  const partId=typeof part?.id==='string'?part.id.trim():'';
  const question=part?.question;
  if(!PART_ID.test(partId)||!validPartText(question)){
   warnings.push('invalid-part');
   continue;
  }
  const requirementTexts=Array.isArray(part.requirements)?part.requirements
   .map(item=>typeof item==='string'?item:item?.text)
   .filter(text=>typeof text==='string'&&text.trim().length>=5&&text.trim().length<=200)
   .map(text=>text.trim()).slice(0,4):[];
  partQuestions.push({partId,question:question.trim(),
   sourceBookIds:Array.isArray(part.sourceBookIds)?part.sourceBookIds.map(String):null,
   ...(requirementTexts.length?{requirements:requirementTexts}:{})});
  const proposed=Array.isArray(part.searchQueries)&&part.searchQueries.length
   ?part.searchQueries:[question];
  let candidates=proposed.filter(validPartText).map(value=>value.trim());
  if(candidates.length!==proposed.length)warnings.push('invalid-part-query-dropped');
  if(!candidates.length){
   candidates=[question.trim()];
   warnings.push('invalid-part-query-fallback');
  }
  candidateGroups.push({partId,queries:candidates});
 }
 // Give each planned part its first retrieval hint before spending the
 // remaining distinct-query budget on extra angles from earlier parts.
 // Round-robin keeps the existing six-unique-query and twelve-link limits.
 const seenQueries=new Set();
 const rounds=Math.max(0,...candidateGroups.map(group=>group.queries.length));
 for(let queryIndex=0;queryIndex<rounds;queryIndex++){
  for(const group of candidateGroups){
   const query=group.queries[queryIndex];
   if(!query)continue;
   const key=query.toLocaleLowerCase();
   if(partQueries.length>=12){warnings.push('part-query-budget-exceeded');continue;}
   if(!seenQueries.has(key)&&seenQueries.size>=6){
    warnings.push('part-query-budget-exceeded');continue;
   }
   seenQueries.add(key);
   partQueries.push({partId:group.partId,query});
  }
 }
 return {partQueries,partQuestions,warnings:[...new Set(warnings)]};
}
function reportProvenance(value){
 if(!value||typeof value!=='object')return undefined;
 const strings=(items)=>Array.isArray(items)?items.filter(item=>typeof item==='string').slice(0,8).map(item=>item.slice(0,160)):[];
 const result={work:typeof value.work==='string'?value.work.slice(0,180):'',
  creditedAuthors:strings(value.creditedAuthors),creditedEditors:strings(value.creditedEditors),
  creditedTranslators:strings(value.creditedTranslators),
  plannerSourceRole:['primary','subject','commentary','unspecified'].includes(value.plannerSourceRole)?value.plannerSourceRole:'unspecified',
  pageSectionHint:typeof value.pageSectionHint==='string'?value.pageSectionHint.slice(0,40):'undetermined',
  pageVoiceHint:typeof value.pageVoiceHint==='string'?value.pageVoiceHint.slice(0,120):'undetermined'};
 for(const key of ['workVoice','pageVoice']){
  const voice=value[key];
  if(voice&&typeof voice==='object'&&typeof voice.name==='string'&&
    ['pseudonymous-author','editorial-introduction'].includes(voice.kind))
   result[key]={kind:voice.kind,name:voice.name.slice(0,120),
    ...(typeof voice.creditedAuthor==='string'?{creditedAuthor:voice.creditedAuthor.slice(0,160)}:{})};
 }
 return result;
}
const LIVE_CASES=[
 {id:'live-scripture-god-is-love',question:'According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?',planner_queries:['1 John 4:7–12 text God is love and love one another','1 John 4:7–12 God sent his Son love one another'],required_source_groups:[{label:'1 John Bible passage',book_ids:['335']}]},
];
const SMOKE_CASE_IDS=['science-hawking-black-holes','philosophy-aristotle-habituation'];
const QUALITY_CASES=[
 {id:'quality-science-darwin-selection',discipline:'science',question:"According to Darwin's On the Origin of Species, how does natural selection operate, and what roles do inherited variation and the struggle for existence play?",selected_book_ids:['529'],planner_queries:['Darwin natural selection preservation beneficial variations survival reproduction','Origin of species variation inheritance struggle for existence Darwin'],required_source_groups:[{label:'Darwin, On the Origin of Species',book_ids:['529']}],review_focus:['Explain the mechanism linking inherited variation to differential survival and reproduction.','Distinguish Darwin’s account from a claim that organisms consciously adapt.']},
 {id:'quality-history-thucydides-causes',discipline:'history',question:'According to Thucydides, what were the underlying causes of the Peloponnesian War, and how did they differ from the immediate disputes that preceded it?',selected_book_ids:['152'],planner_queries:['Thucydides real cause growth Athenian power fear Lacedaemon','Thucydides immediate disputes Corcyra Potidaea grievances'],required_source_groups:[{label:'Thucydides',book_ids:['152']}],review_focus:['Separate the underlying cause from the immediate disputes.','Support both parts with passages from Thucydides, without treating them as interchangeable.']},
 {id:'quality-literature-dostoevsky-raskolnikov',discipline:'literature',question:'In Crime and Punishment, how does Raskolnikov try to justify murder, and how does the novel test or undermine his reasoning?',selected_book_ids:['114'],planner_queries:['Raskolnikov extraordinary men right to transgress law murder','Crime and Punishment Raskolnikov guilt suffering confession theory'],required_source_groups:[{label:'Dostoevsky, Crime and Punishment',book_ids:['114']}],review_focus:['Describe Raskolnikov’s theory as the character’s argument, not as Dostoevsky’s endorsed view.','Explain how later events in the novel complicate that theory.']},
 {id:'quality-philosophy-aristotle-practical-wisdom',discipline:'philosophy',question:"According to Aristotle's Nicomachean Ethics, what is practical wisdom, and how does it differ from scientific knowledge and skill?",selected_book_ids:['7'],planner_queries:['Aristotle Nicomachean Ethics definition phronesis practical wisdom deliberation human good','Aristotle Nicomachean Ethics phronesis episteme techne variable action making'],required_source_groups:[{label:'Aristotle, Nicomachean Ethics',book_ids:['7']}],review_focus:['Define practical wisdom as a reasoned capacity concerned with human good and action.','Explain why it is not science (variable, deliberable matters rather than necessary demonstrations) or craft (action differs from making).']},
 {id:'quality-all-books-cross-work-science',discipline:'science',question:'How does Darwin explain natural selection preserving favorable variations in On the Origin of Species, and how does Hawking use astronomical observations to support an explanation of black-hole phenomena in A Brief History of Time?',selected_book_ids:[],planner_queries:['Darwin Origin of Species natural selection favorable inherited variations struggle for existence','Hawking Cygnus X-1 unseen companion strong X-rays evidence black hole'],required_source_groups:[{label:'Darwin',book_ids:['529']},{label:'Hawking',book_ids:['102']}],required_part_source_groups:[{partIncludes:'Darwin',book_ids:['529']},{partIncludes:'Hawking',book_ids:['102']}],review_focus:['Compare each author’s use of observation and explanation.','Cite evidence from both named works; avoid implying the authors use identical methods.']},
 {id:'quality-all-books-cross-discipline-order',discipline:'philosophy',question:'How does Aristotle describe the aim of political science in the Nicomachean Ethics, and what role does Hobbes give common power in Leviathan? How do these accounts differ?',selected_book_ids:[],planner_queries:['Aristotle Nicomachean Ethics political science human good citizens good obedient laws','Hobbes Leviathan state of nature common power keep them in awe war every man against every man'],required_source_groups:[{label:'Aristotle, Nicomachean Ethics',book_ids:['7']},{label:'Hobbes, Leviathan',book_ids:['163']}],required_part_source_groups:[{partIncludes:'Aristotle',book_ids:['7']},{partIncludes:'Hobbes',book_ids:['163']}],review_focus:['Represent each author’s account in its own terms and identify a meaningful difference.','Ground the comparison in both works instead of importing unsupported modern claims.']},
 {id:'quality-all-books-religion-scripture',discipline:'religion',question:'According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?',selected_book_ids:[],planner_queries:['1 John 4:7-12 God is love sent Son love one another passage','1 John 4:7-12 love of God revealed in Christ command love one another'],required_source_groups:[{label:'1 John 4:7–12',book_ids:['335']}],review_focus:['Explain the passage’s connection between God’s prior love and the command to love one another.','Stay close to the passage and distinguish its claims from later theological interpretation.']},
];
// A small holdout set for broad quality checks. The open all-books prompts
// carry no expected-author labels; selected-book cases use the book chosen in
// the test setup. Keep this separate from the frozen acceptance set.
const FRESH_CASES=[
 {id:'fresh2-all-freedom-circumstances',discipline:'philosophy',evaluation_scope:'all-books',question:'What does it mean to be free when a person’s choices are shaped by circumstances they did not choose?',selected_book_ids:[],planner_queries:['What does it mean to be free when a person’s choices are shaped by circumstances they did not choose?'],required_source_groups:[],review_focus:[]},
 {id:'fresh2-all-nature-responsibility',discipline:'science',evaluation_scope:'all-books',question:'How do different authors understand the human relationship to the natural world, and what responsibilities follow from that relationship?',selected_book_ids:[],planner_queries:['How do different authors understand the human relationship to the natural world, and what responsibilities follow from that relationship?'],required_source_groups:[],review_focus:[]},
 {id:'fresh2-all-belief-conduct',discipline:'society',evaluation_scope:'all-books',question:'Why do people sometimes act against the principles they profess, and how have writers explained that gap between belief and conduct?',selected_book_ids:[],planner_queries:['Why do people sometimes act against the principles they profess, and how have writers explained that gap between belief and conduct?'],required_source_groups:[],review_focus:[]},
 {id:'fresh2-selected-walden-necessities',discipline:'philosophy',evaluation_scope:'selected-books',question:'How does Thoreau distinguish necessities from luxuries, and how does that distinction shape his criticism of work and everyday life?',selected_book_ids:['257'],planner_queries:['How does Thoreau distinguish necessities from luxuries, and how does that distinction shape his criticism of work and everyday life?'],required_source_groups:[{label:'Henry David Thoreau, Walden; or, Life in the Woods',book_ids:['257']}],review_focus:[]},
 {id:'fresh2-selected-austen-first-impressions',discipline:'literature',evaluation_scope:'selected-books',question:'How does Elizabeth’s view of Darcy change over the course of the novel, and what role do her first impressions play in that change?',selected_book_ids:['341'],planner_queries:['How does Elizabeth’s view of Darcy change over the course of the novel, and what role do her first impressions play in that change?'],required_source_groups:[{label:'Jane Austen, Pride and Prejudice',book_ids:['341']}],review_focus:[]},
];
// The third fresh set adds different question forms after the first two sets.
// All-books questions have no expected author groups or review hints; selected-book
// cases constrain only the work searched, leaving the interpretation open.
// Three open-ended, all-books questions for trace inspection. No preselected sources or answer steering.
const PHILOSOPHY3_CASES=[
 {id:"philosophy3-dostoevsky-nietzsche-nihilism",discipline:'philosophy',evaluation_scope:'all-books',question:"How does Dostoevsky's treatment of nihilism compare with Nietzsche's?",selected_book_ids:[],planner_queries:["How does Dostoevsky's treatment of nihilism compare with Nietzsche's?"],required_source_groups:[],review_focus:[]},
 {id:"philosophy3-augustine-aquinas-kant-responsibility",discipline:'philosophy',evaluation_scope:'all-books',question:"How do Augustine, Aquinas, and Kant differ in their understanding of moral responsibility?",selected_book_ids:[],planner_queries:["How do Augustine, Aquinas, and Kant differ in their understanding of moral responsibility?"],required_source_groups:[],review_focus:[]},
 {id:"philosophy3-aristotle-hume-kant-causality",discipline:'philosophy',evaluation_scope:'all-books',question:"How did philosophical understandings of causality change between Aristotle, Hume, and Kant?",selected_book_ids:[],planner_queries:["How did philosophical understandings of causality change between Aristotle, Hume, and Kant?"],required_source_groups:[],review_focus:[]},
];
const FRESH3_CASES=[
 {id:'fresh3-all-imagination-understanding',discipline:'philosophy',evaluation_scope:'all-books',question:'What role does imagination play in how people understand the world?',selected_book_ids:[],planner_queries:['What role does imagination play in how people understand the world?'],required_source_groups:[],review_focus:[]},
 {id:'fresh3-all-justice-mercy',discipline:'philosophy',evaluation_scope:'all-books',question:'How do writers distinguish justice from mercy, and when might these values come into conflict?',selected_book_ids:[],planner_queries:['How do writers distinguish justice from mercy, and when might these values come into conflict?'],required_source_groups:[],review_focus:[]},
 {id:'fresh3-all-technology-living',discipline:'society',evaluation_scope:'all-books',question:'How have writers described the effects of technological change on the ways people live?',selected_book_ids:[],planner_queries:['How have writers described the effects of technological change on the ways people live?'],required_source_groups:[],review_focus:[]},
 {id:'fresh3-selected-odyssey-homecoming',discipline:'literature',evaluation_scope:'selected-books',question:'How does Odysseus’s desire to return home shape his choices and the poem’s picture of heroism?',selected_book_ids:['186'],planner_queries:['How does Odysseus’s desire to return home shape his choices and the poem’s picture of heroism?'],required_source_groups:[{label:'Homer, The Odyssey',book_ids:['186']}],review_focus:[]},
 {id:'fresh3-selected-douglass-literacy',discipline:'history',evaluation_scope:'selected-books',question:'How does Douglass describe the role of literacy in his experience of enslavement and pursuit of freedom?',selected_book_ids:['459'],planner_queries:['How does Douglass describe the role of literacy in his experience of enslavement and pursuit of freedom?'],required_source_groups:[{label:'Frederick Douglass, Narrative of the Life of Frederick Douglass, an American Slave',book_ids:['459']}],review_focus:[]},
];
// Phase-2 suites: two dedicated, single-scope sets of brand-new questions.
// library-all runs open questions against the whole library; library-selected
// scopes every question to one chosen book. Neither set reuses a question
// from the earlier suites, and all-books cases carry no expected sources.
const LIBRARY_ALL_CASES=[
 {id:'library-all-hobbes-rousseau-nature',discipline:'philosophy',evaluation_scope:'all-books',question:'How do Hobbes and Rousseau differ in their accounts of human beings in the state of nature, and what follows from that difference for their views of political authority?',selected_book_ids:[],planner_queries:['How do Hobbes and Rousseau differ in their accounts of human beings in the state of nature, and what follows from that difference for their views of political authority?'],required_source_groups:[],review_focus:[]},
 {id:'library-all-suffering-responses',discipline:'philosophy',evaluation_scope:'all-books',question:'How do different authors in the library understand suffering, and what responses to it do they propose?',selected_book_ids:[],planner_queries:['How do different authors in the library understand suffering, and what responses to it do they propose?'],required_source_groups:[],review_focus:[]},
 {id:'library-all-narrators-judgment',discipline:'literature',evaluation_scope:'all-books',question:'Many works in the library reach the reader through a first-person narrator. How do narrators such as Dostoevsky’s Underground Man and Conrad’s Marlow shape — and limit — what the reader can conclude about the events they describe?',selected_book_ids:[],planner_queries:['Many works in the library reach the reader through a first-person narrator. How do narrators such as Dostoevsky’s Underground Man and Conrad’s Marlow shape — and limit — what the reader can conclude about the events they describe?'],required_source_groups:[],review_focus:[]},
 {id:'library-all-progress-idea',discipline:'history',evaluation_scope:'all-books',question:'How did the idea of progress change as it passed from ancient and medieval writers through Enlightenment thinkers to its nineteenth-century critics?',selected_book_ids:[],planner_queries:['How did the idea of progress change as it passed from ancient and medieval writers through Enlightenment thinkers to its nineteenth-century critics?'],required_source_groups:[],review_focus:[]},
 {id:'library-all-science-certainty',discipline:'science',evaluation_scope:'all-books',question:'How do authors in the library differ over how certain scientific knowledge can be, and where do they locate its limits?',selected_book_ids:[],planner_queries:['How do authors in the library differ over how certain scientific knowledge can be, and where do they locate its limits?'],required_source_groups:[],review_focus:[]},
 {id:'library-all-empires-decline',discipline:'history',evaluation_scope:'all-books',question:'How have writers explained the decline of empires and commonwealths, and do they place more weight on internal decay, external pressure, or failures of leadership?',selected_book_ids:[],planner_queries:['How have writers explained the decline of empires and commonwealths, and do they place more weight on internal decay, external pressure, or failures of leadership?'],required_source_groups:[],review_focus:[]},
 {id:'library-all-ambition-novels',discipline:'literature',evaluation_scope:'all-books',question:'How do novelists in the library portray ambition, and what does it tend to cost the characters who pursue it?',selected_book_ids:[],planner_queries:['How do novelists in the library portray ambition, and what does it tend to cost the characters who pursue it?'],required_source_groups:[],review_focus:[]},
 {id:'library-all-wealth-luxury',discipline:'society',evaluation_scope:'all-books',question:'What do authors in the library say about the effects of wealth and luxury on character and on society?',selected_book_ids:[],planner_queries:['What do authors in the library say about the effects of wealth and luxury on character and on society?'],required_source_groups:[],review_focus:[]},
];
const LIBRARY_SELECTED_CASES=[
 {id:'library-selected-conrad-marlow-kurtz',discipline:'literature',evaluation_scope:'selected-books',question:'In Heart of Darkness, how does Marlow’s picture of Kurtz take shape, and which parts of it rest on what Marlow sees himself as opposed to what others tell him or what Kurtz leaves in writing?',selected_book_ids:['315'],planner_queries:['In Heart of Darkness, how does Marlow’s picture of Kurtz take shape, and which parts of it rest on what Marlow sees himself as opposed to what others tell him or what Kurtz leaves in writing?'],required_source_groups:[{label:'Joseph Conrad, Heart of Darkness',book_ids:['315']}],review_focus:[]},
 {id:'library-selected-machiavelli-prince-limits',discipline:'politics',evaluation_scope:'selected-books',question:'What is the central argument of The Prince about how a ruler acquires and keeps power, and where does Machiavelli acknowledge limits to what a ruler’s skill can control?',selected_book_ids:['241'],planner_queries:['What is the central argument of The Prince about how a ruler acquires and keeps power, and where does Machiavelli acknowledge limits to what a ruler’s skill can control?'],required_source_groups:[{label:'Niccolò Machiavelli, The Prince',book_ids:['241']}],review_focus:[]},
 {id:'library-selected-plato-republic-images',discipline:'philosophy',evaluation_scope:'selected-books',question:'In the Republic, how do the allegory of the cave and the analogy between the city and the soul each connect knowledge with ruling, and how do the two images differ in what they claim?',selected_book_ids:['74'],planner_queries:['In the Republic, how do the allegory of the cave and the analogy between the city and the soul each connect knowledge with ruling, and how do the two images differ in what they claim?'],required_source_groups:[{label:'Plato, The Republic',book_ids:['74']}],review_focus:[]},
 {id:'library-selected-dostoevsky-grand-inquisitor',discipline:'literature',evaluation_scope:'selected-books',question:'In The Brothers Karamazov, how does the “Grand Inquisitor” episode, as Ivan tells it to Alyosha, challenge the faith Alyosha represents, and how does the novel complicate Ivan’s challenge?',selected_book_ids:['103'],planner_queries:['In The Brothers Karamazov, how does the “Grand Inquisitor” episode, as Ivan tells it to Alyosha, challenge the faith Alyosha represents, and how does the novel complicate Ivan’s challenge?'],required_source_groups:[{label:'Fyodor Dostoevsky, The Brothers Karamazov',book_ids:['103']}],review_focus:[]},
 {id:'library-selected-kierkegaard-silentio-speaker',discipline:'philosophy',evaluation_scope:'selected-books',question:'Fear and Trembling is presented by Johannes de Silentio, a speaker who says he cannot himself make the movement of faith. How does that declared limitation shape the book’s portrayal of Abraham, and why does it matter who is speaking?',selected_book_ids:['140'],planner_queries:['Fear and Trembling is presented by Johannes de Silentio, a speaker who says he cannot himself make the movement of faith. How does that declared limitation shape the book’s portrayal of Abraham, and why does it matter who is speaking?'],required_source_groups:[{label:'Søren Kierkegaard, Fear and Trembling',book_ids:['140']}],review_focus:[]},
 {id:'library-selected-smith-division-of-labor',discipline:'society',evaluation_scope:'selected-books',question:'How does Adam Smith explain the gains in productivity that come from the division of labor, and what concerns does he raise about what the division of labor does to workers themselves?',selected_book_ids:['260'],planner_queries:['How does Adam Smith explain the gains in productivity that come from the division of labor, and what concerns does he raise about what the division of labor does to workers themselves?'],required_source_groups:[{label:'Adam Smith, An Inquiry into the Nature and Causes of the Wealth of Nations',book_ids:['260']}],review_focus:[]},
 {id:'library-selected-orwell-newspeak',discipline:'literature',evaluation_scope:'selected-books',question:'How does Orwell connect language with political power in 1984, through both Newspeak and the Party’s control of the historical record, and how does Winston’s job illustrate that connection?',selected_book_ids:['89'],planner_queries:['How does Orwell connect language with political power in 1984, through both Newspeak and the Party’s control of the historical record, and how does Winston’s job illustrate that connection?'],required_source_groups:[{label:'George Orwell, 1984',book_ids:['89']}],review_focus:[]},
 {id:'library-selected-aurelius-meditations-others',discipline:'philosophy',evaluation_scope:'selected-books',question:'In the Meditations, how does Marcus Aurelius instruct himself to respond to other people’s faults and offenses, and what view of himself and of the whole does he rely on in giving that instruction?',selected_book_ids:['18'],planner_queries:['In the Meditations, how does Marcus Aurelius instruct himself to respond to other people’s faults and offenses, and what view of himself and of the whole does he rely on in giving that instruction?'],required_source_groups:[{label:'Marcus Aurelius, Meditations',book_ids:['18']}],review_focus:[]},
];
// One-run handoff validation: two observed regressions plus three fresh,
// open-ended controls. These cases test retrieval and question coverage, not
// predetermined answer text or a required source for all-books questions.
const HANDOFF_CASES=[
 {id:'handoff-all-technology-change',discipline:'society',evaluation_scope:'all-books',question:'How have writers described the effects of technological change on the ways people live?',selected_book_ids:[],planner_queries:['How have writers described the effects of technological change on the ways people live?'],required_source_groups:[],review_focus:[]},
 {id:'handoff-all-conscience-authority',discipline:'philosophy',evaluation_scope:'all-books',question:'How do writers explain the tension between conscience and obedience to authority, and when do they consider resistance justified?',selected_book_ids:[],planner_queries:['How do writers explain the tension between conscience and obedience to authority, and when do they consider resistance justified?'],required_source_groups:[],review_focus:[]},
 {id:'handoff-all-memory-identity',discipline:'philosophy',evaluation_scope:'all-books',question:'How does memory contribute to personal identity, and what limits do writers place on what memory can tell us about who we are?',selected_book_ids:[],planner_queries:['How does memory contribute to personal identity, and what limits do writers place on what memory can tell us about who we are?'],required_source_groups:[],review_focus:[]},
 {id:'handoff-selected-odyssey-homecoming',discipline:'literature',evaluation_scope:'selected-books',question:'How does Odysseus’s desire to return home shape his choices and the poem’s picture of heroism?',selected_book_ids:['186'],planner_queries:['How does Odysseus’s desire to return home shape his choices and the poem’s picture of heroism?'],required_source_groups:[{label:'Homer, The Odyssey',book_ids:['186']}],review_focus:[]},
 {id:'handoff-selected-mill-liberty',discipline:'philosophy',evaluation_scope:'selected-books',question:'How does Mill defend freedom of thought, and what limits does he place on individual liberty?',selected_book_ids:['51'],planner_queries:['John Stuart Mill On Liberty defense of freedom of thought discussion and publication','Mill On Liberty limits of individual liberty harm to others'],required_source_groups:[{label:'Mill, On Liberty',book_ids:['51']}],review_focus:[]},
];
// This second fresh set changes topic and genre after the first five-case baseline.
// All-books prompts have no expected author groups; selected-book cases check only
// that evidence comes from the chosen work, leaving the answer itself open-ended.
// Focused diagnostics stay selectable without changing the stable seven-case
// quality baseline. This case targets the live user's question and asks the
// reviewer to judge source sufficiency and highlight relevance qualitatively.
const FOCUSED_CASES=[
 {id:'focused-kant-transcendental-idealism',discipline:'philosophy',question:'What is transcendental idealism?',selected_book_ids:['40','44'],planner_queries:['Kant transcendental idealism definition appearances things in themselves space time','Kant Prolegomena transcendental idealism empirical reality appearances things in themselves','Kant Critique of Pure Reason transcendental idealism phenomena noumena space time'],required_source_groups:[{label:'Kant on transcendental idealism',book_ids:['40','44']}],review_focus:['Explain the core operation of transcendental idealism: space and time are forms of human sensibility that structure appearances, while things in themselves are not known through those forms. Avoid implying that Kant simply denies the empirical reality of external objects.','Assess whether the answer cites enough distinct, relevant passages to establish both the definition and the appearance/thing-in-itself distinction. Judge adequacy by coverage and support, not by an arbitrary citation count.','For every displayed highlight, compare the exact passage text with the claim or question part it is linked to. Exact quote location alone is not evidence of semantic support; flag irrelevant, overly broad, fragmentary, or weakly connected highlights.']},
 {id:'focused-kierkegaard-faith',discipline:'philosophy',question:'What did Kierkegaard have to say about faith?',selected_book_ids:['140','192','253'],planner_queries:['Kierkegaard faith Fear and Trembling Abraham paradox individual relation to God','Kierkegaard faith Philosophical Fragments leap historical knowledge contemporary follower','Kierkegaard faith Sickness Unto Death self before God'],required_source_groups:[],review_focus:['Explain Kierkegaard’s account of faith using passages from his works, while distinguishing the works’ speakers and argumentative contexts.','Avoid reducing faith to generic belief or treating one famous formulation as a complete summary of Kierkegaard’s authorship.','For selected-books scope, keep conclusions within Fear and Trembling, Philosophical Fragments, and The Sickness Unto Death.','Check that citations and highlights support the specific account given and represent the relevant passage in context.']},
 {id:'focused-nietzsche-christianity',discipline:'philosophy',question:'What did Nietzsche think about Christianity?',selected_book_ids:['54','144','239'],planner_queries:['Nietzsche critique Christianity morality ressentiment life affirmation Genealogy of Morals','Nietzsche The Antichrist Christianity life denial priestly morality','Nietzsche Christianity historical psychological critique works'],required_source_groups:[],review_focus:['Present Nietzsche’s critique of Christianity in his own terms and support the main claims with relevant passages.','Do not flatten different works or arguments into one slogan; distinguish moral, psychological, and historical claims where the evidence allows.','For selected-books scope, keep conclusions within Thus Spake Zarathustra, On the Genealogy of Morals, and the primary Nietzsche texts in The Portable Nietzsche; identify Kaufmann commentary as commentary.','Check that each cited passage and highlight supports the attached claim rather than merely mentioning Christianity.']},
 {id:'focused-sunyata',discipline:'philosophy',question:'What is sunyata?',selected_book_ids:['178','23','158'],planner_queries:['śūnyatā sunyata emptiness lack inherent existence Madhyamaka Buddhism','Nagarjuna emptiness dependent origination Mulamadhyamakakarika','Buddhist sunyata not nihilism conventional truth dependent arising'],required_source_groups:[],review_focus:['Explain śūnyatā in its Buddhist philosophical context, using the retrieved texts’ own distinctions and terminology.','Avoid equating emptiness with absolute nonexistence or nihilism; clarify dependence or lack of inherent existence only where the cited text supports it.','The selected scope is Nāgārjuna’s Mūlamadhyamakakārikā, the Diamond Sutra, and D. T. Suzuki’s introduction; distinguish primary text from commentary.','Check whether the passages establish a definition and its implications, and whether displayed highlights semantically support the linked claims.']},
 {id:'focused-nietzsche-kierkegaard',discipline:'philosophy',question:'What would Nietzsche think about the thought of Kierkegaard?',selected_book_ids:['144','140','253'],planner_queries:['Nietzsche Kierkegaard faith Christianity individual religious commitment','Nietzsche critique Christianity morality faith priestly psychology','Kierkegaard faith Christianity subjectivity individual God'],required_source_groups:[],review_focus:['Do not invent a direct exchange or claim Nietzsche wrote about Kierkegaard unless the sources establish that fact.','Separate textual evidence for Nietzsche’s views from any explicitly labeled, cautious inference about how he might respond to Kierkegaard.','In selected-books scope, limit the inference to Nietzsche’s On the Genealogy of Morals and Kierkegaard’s Fear and Trembling and The Sickness Unto Death; do not generalize to Kierkegaard’s entire thought.','Use evidence from both thinkers where available and make the inference traceable to the cited passages.']},
];
// A separate, paired-scope suite tests new material without replacing the
// five-question focused baseline. Each case uses one all-books planner result
// for both modes, then restricts selected-books retrieval and plan IDs to that
// case's explicit books. This isolates the scope change while preserving the
// real planner path and the same answer/review budget in both modes.
const PAIRED_CASES=[
 {id:'paired-hume-kant-causal-inference',discipline:'philosophy',question:'In Hume’s An Enquiry Concerning Human Understanding, what does he say about our inference from cause to effect, and in Kant’s Critique of Pure Reason, what role does causality play in experience? How do their accounts differ?',selected_book_ids:['35','40'],planner_queries:['Hume Enquiry cause effect custom constant conjunction inference experience','Kant Critique of Pure Reason causality objective succession rule condition experience'],required_source_groups:[{label:'Hume, Enquiry Concerning Human Understanding',book_ids:['35']},{label:'Kant, Critique of Pure Reason',book_ids:['40']}],required_part_source_groups:[{partIncludes:'Hume',book_ids:['35']},{partIncludes:'Kant',book_ids:['40']}],review_focus:['Explain Hume’s account of causal inference from experience and custom, then Kant’s claim about causality as a condition of objective experience.','Keep the authors’ positions distinct and label the comparison as a synthesis of their texts, not a direct exchange.']},
 {id:'paired-wollstonecraft-education-reason',discipline:'society',question:'How does Wollstonecraft connect women’s education with their capacity to reason and their social position?',selected_book_ids:['87'],planner_queries:['Wollstonecraft Vindication education women reason cultivate understanding independence','Wollstonecraft women social position education reason virtue dependence'],required_source_groups:[{label:'Wollstonecraft, A Vindication of the Rights of Woman',book_ids:['87']}],review_focus:['Explain the connection she argues between education, reason, and women’s social position.','Keep Wollstonecraft’s claims and examples in their historical context; do not turn them into unsupported modern generalizations.']},
 {id:'paired-dubois-double-consciousness',discipline:'society',question:'What does Du Bois mean by double consciousness, and how does he connect it to the color line?',selected_book_ids:['454'],planner_queries:['Du Bois double consciousness two souls veil seeing oneself through others','Du Bois color line double consciousness self understanding Souls of Black Folk'],required_source_groups:[{label:'Du Bois, The Souls of Black Folk',book_ids:['454']}],review_focus:['Explain the concept through Du Bois’s own description of the divided self and the veil.','Show how the passage connects the experience to the color line without reducing it to a generic identity conflict.']},
 {id:'paired-boethius-fortune-wheel',discipline:'philosophy',question:'How does Lady Philosophy explain why Fortune cannot be stable, and what do her gifts reveal about happiness?',selected_book_ids:['21'],planner_queries:['Boethius Consolation of Philosophy Fortune wheel unstable gifts happiness Lady Philosophy','Boethius fortune gifts cannot secure happiness true good instability'],required_source_groups:[{label:'Boethius, Consolation of Philosophy',book_ids:['21']}],review_focus:['Attribute the argument to Lady Philosophy within the dialogue.','Explain why changing external gifts cannot provide stable happiness, using the text’s reasoning.']},
 {id:'paired-hamlet-conscience',discipline:'literature',question:'In Hamlet’s “To be, or not to be” soliloquy, what does he mean when he says that conscience makes cowards of us all?',selected_book_ids:['212'],planner_queries:['Hamlet to be or not to be conscience makes cowards of us all native hue resolution','Hamlet soliloquy thought fear of death unknown country action resolution'],required_source_groups:[{label:'Shakespeare, Hamlet',book_ids:['212']}],review_focus:['Explain the line in the soliloquy’s reasoning about thought, fear, and action.','Keep the passage attributed to Hamlet and avoid treating the speech as the play’s settled doctrine. Check that the highlighted passage contains the line and supports the explanati…33255 tokens truncated…n;
 try{plan=await callJson(fetcher,API+'/api/pilot-plan',token,{question:item.question,
  bookId:plannerBookId,history:[],turnstileToken:'evaluation-runner-token'},beforeCall,'planner',timing.timedProgressEvent);}
 catch(error){timing.record('planner','failed',timing.requestStageMs.planner);
  timing.attach(error);throw error;}
 if(!validSearchPlan(plan?.queries)){
  timing.record('planner','failed',timing.requestStageMs.planner);
  const invalidPlan=attachRequestFailure(new Error('Planner returned an invalid search plan.'),'planner',{
   httpStatus:200,failureCode:'invalid-response',workerFailure:false,
   workerVersionId:plan?.workerVersionId,workerSourceBuild:plan?.workerSourceBuild,workerSourceRevision:plan?.workerSourceRevision});
  timing.attach(invalidPlan);
  throw invalidPlan;
 }
 timing.record('planner','completed',timing.requestStageMs.planner);
 let loaded;
 const retrievalStarted=Date.now();
 const partFacets=partFacetsFromPlan(plan?.plan?.parts);
 const {partQueries,partQuestions}=partFacets;
 await progress('retrieval','started',`Searching ${new Set([...plan.queries,...partQueries.map(value=>value.query)]).size} planner and part facets.`,
  {queryCount:plan.queries.length,partFacetCount:partQueries.length,partFacetWarnings:partFacets.warnings});
 try{loaded=await loadSources(item,plan.queries,{library,manifest,allowed,partQueries,partQuestions});}
 catch(error){
  const wrapped=attachRequestFailure(error,'retrieval',{failureCode:'retrieval-failed',workerFailure:false,
   workerVersionId:plan.workerVersionId,workerSourceBuild:plan.workerSourceBuild,workerSourceRevision:plan.workerSourceRevision});
  wrapped.requestFailure.plannerSkipped=false;
  timing.record('retrieval','failed',Date.now()-retrievalStarted);
  timing.attach(wrapped);
  throw wrapped;
 }
 timing.record('retrieval','completed',Date.now()-retrievalStarted);
 const {selected,searches,retrievalCandidates}=loaded;
 const retrievalFallbackCount=searches.filter(value=>value.fallbackFrom).length;
 await progress('retrieval','completed',`Retrieved ${searches.reduce((sum,value)=>sum+(Number(value.resultCount)||0),0)} indexed matches; selected ${selected.length} verified pages.`+
  (retrievalFallbackCount?` Recovered ${retrievalFallbackCount} empty source-side search using the counterpart topic within the planned source scope.`:''),
  {searchCount:searches.length,retrievalFallbackCount,candidatePages:retrievalCandidates.map(source=>({bookId:source.bookId,page:source.page})),
   selectedPages:selected.map(source=>({bookId:source.bookId,page:source.page}))});
 const candidateBookIds=[...new Set(retrievalCandidates.map(source=>String(source.bookId)))];
 const selectedBookIdsInPacket=[...new Set(selected.map(source=>String(source.bookId)))];
 const sourceGroups=(item.required_source_groups||[]).map(group=>{
  const expectedBookIds=group.book_ids.map(String);
  const candidateGroupBookIds=candidateBookIds.filter(id=>expectedBookIds.includes(id));
  const selectedGroupBookIds=selectedBookIdsInPacket.filter(id=>expectedBookIds.includes(id));
  const candidateFound=candidateGroupBookIds.length>0;
  const selectedForComposition=selectedGroupBookIds.length>0;
  return {label:group.label,expectedBookIds,candidateBookIds:candidateGroupBookIds,candidateFound,
   selectedBookIds:selectedGroupBookIds,selectedForComposition,
   // Preserve the older names for report consumers; they mean packet selection here.
   retrievedBookIds:selectedGroupBookIds,retrieved:selectedForComposition,
   citedBookIds:[],foundBookIds:[],cited:false,found:false};
 });
 const passed=sourceGroups.every(group=>group.retrieved);
 return {id:item.id,question:item.question,discipline:item.discipline||'',selectedBookIds,
  reviewFocus:Array.isArray(item.review_focus)?item.review_focus:[],plannerSkipped:false,
  plannerQueries:plan.queries,plannerFallback:false,partFacetWarnings:partFacets.warnings,
  plannerWorkerVersionId:plan.workerVersionId||null,plannerWorkerSourceBuild:plan.workerSourceBuild||null,plannerWorkerSourceRevision:plan.workerSourceRevision||null,
  answerWorkerVersionId:null,answerWorkerSourceBuild:null,searches,retrievalCandidates,
  positionCoverage:loaded.positionCoverage,
  submittedSources:selected.map(({bookId,title,page,globalPageId,preview,candidatePartIds})=>({bookId,title,page,globalPageId,candidatePartIds,
   excerpt:String(preview||'').slice(0,1200)})),
  submittedSourceCount:selected.length,sourceGroups,passed,
  outcome:passed?'planner-retrieval-ready':'planner-retrieval-miss',
  coverage:'not-evaluated',reviewStatus:'planner-only',answerText:'',missing:'',citationCount:0,
  citationBookIds:[],citationSources:[],inlineCitationCount:0,inlineIdsWithoutSource:[],
  evidenceHighlightCount:0,evidenceHighlights:[],questionParts:[],
  questionPartCoverage:{total:0,supported:0,partial:0,unsupported:0},evidenceMap:[],
  stageTimings:timing.stageTimings,
  elapsedMs:Date.now()-startTime};
}
function failedCaseResult(item,error){
 const failure=error?.requestFailure||{stage:'evaluation',httpStatus:null,failureCode:'evaluation-failed',
  message:String(error?.message||error||'Evaluation failed').slice(0,240),workerFailure:false};
 return {id:item.id,question:item.question,discipline:item.discipline||'',evaluationScope:item.evaluation_scope||(item.selected_book_ids?.length?'selected-books':'all-books'),selectedBookIds:Array.isArray(item.selected_book_ids)?item.selected_book_ids:[],
  reviewFocus:Array.isArray(item.review_focus)?item.review_focus:[],requestFailure:failure,plannerQueries:[],plannerSkipped:failure.plannerSkipped===true,
  plannerWorkerVersionId:failure.plannerWorkerVersionId|| (failure.stage==='planner'?failure.workerVersionId:null),
  plannerWorkerSourceBuild:failure.plannerWorkerSourceBuild|| (failure.stage==='planner'?failure.workerSourceBuild:null),
  plannerWorkerSourceRevision:failure.plannerWorkerSourceRevision|| (failure.stage==='planner'?failure.workerSourceRevision:null),
  answerWorkerVersionId:failure.stage==='answer'?failure.workerVersionId:null,
  answerWorkerSourceBuild:failure.stage==='answer'?failure.workerSourceBuild:null,
  answerWorkerSourceRevision:failure.stage==='answer'?failure.workerSourceRevision:null,
  missing:'',
  plannerFallback:failure.plannerFallback===true,gapPlannerAttempted:failure.gapPlannerAttempted===true,
  ...(failure.gapPlannerFailure?{gapPlannerFailure:failure.gapPlannerFailure}:{}),
  ...(failure.plannerFailure?{plannerFailure:failure.plannerFailure}:{}),
  stageTimings:Array.isArray(failure.stageTimings)?failure.stageTimings:[],searches:[],
  submittedSources:[],outcome:'request-failed',coverage:'none',reviewStatus:'request-failed',noAnswerFailure:true,
  answerText:'',citationCount:0,citationBookIds:[],citationSources:[],inlineCitationCount:0,
  inlineIdsWithoutSource:[],submittedSourceCount:0,
  sourceGroups:(item.required_source_groups||[]).map(group=>({label:group.label,
   expectedBookIds:group.book_ids.map(String),foundBookIds:[],found:false})),
  evidenceHighlightCount:0,evidenceHighlights:[],passed:false,elapsedMs:0};
}
const TERMINAL_PROVIDER_FAILURES=new Set([
 'ai-daily-limit-reached','ai-capacity-unavailable','ai-rate-limited',
]);
export async function runLiveCases(cases,{evaluateCase=evaluateLiveCase,evaluateOptions={},onResult=async()=>{},maxConsecutiveWorkerFailures=2}={}){
 const results=[];let consecutiveWorkerFailures=0,stopReason='';
 for(const item of cases){
  let result;
  try{result=await evaluateCase(item,evaluateOptions);}
  catch(error){result=failedCaseResult(item,error);}
  results.push(result);
  await onResult(result,results);
  if(result.requestFailure?.workerFailure){
   if(TERMINAL_PROVIDER_FAILURES.has(result.requestFailure.failureCode)){
    stopReason='provider-limit-or-capacity';
    break;
   }
   consecutiveWorkerFailures++;
   if(consecutiveWorkerFailures>=maxConsecutiveWorkerFailures){stopReason='consecutive-worker-failures';break;}
  }else consecutiveWorkerFailures=0;
 }
 return {results,stopReason};
}
export async function runPairedScopeCases(cases,{evaluateCase=evaluateLiveCase,evaluateOptions={},onResult=async()=>{},maxConsecutiveWorkerFailures=2}={}){
 const results=[];let consecutiveWorkerFailures=0,stopReason='';
 const record=async(result)=>{
  results.push(result);await onResult(result,results);
  if(result.requestFailure?.workerFailure){
   if(TERMINAL_PROVIDER_FAILURES.has(result.requestFailure.failureCode))stopReason='provider-limit-or-capacity';
   else if(++consecutiveWorkerFailures>=maxConsecutiveWorkerFailures)stopReason='consecutive-worker-failures';
  }else consecutiveWorkerFailures=0;
 };
 for(const item of cases){
  const allItem={...item,selected_book_ids:[]};
  let all;
  try{all=await evaluateCase(allItem,{...evaluateOptions,useFixedQueries:false,
   onProgress:event=>evaluateOptions.onProgress?.({...event,pairedCaseId:item.id,scope:'all-books'})});}
  catch(error){all=failedCaseResult(allItem,error);}
  await record({...all,id:item.id+'::all-books',pairedCaseId:item.id,scope:'all-books',plannerReused:false});
  if(stopReason)break;

  let selected;
  if(all.requestFailure){
   selected={...failedCaseResult(item,new Error('Selected-books scope was not run because the shared all-books planner result is unavailable.')),
    requestFailure:{stage:'paired-evaluation',httpStatus:null,failureCode:'shared-planner-unavailable',
     message:'The all-books scope did not produce a reusable planner result; selected-books scope was not run.',workerFailure:false}};
  }else{
   const preparedPlan={plan:all.plannerPlan||null,
    queries:all.plannerFallback?[item.question]:all.plannerQueries,
    plannerFallback:all.plannerFallback===true,
    workerVersionId:all.plannerWorkerVersionId||null,
    workerSourceBuild:all.plannerWorkerSourceBuild||null,
    workerSourceRevision:all.plannerWorkerSourceRevision||null};
   try{selected=await evaluateCase(item,{...evaluateOptions,useFixedQueries:false,preparedPlan,
    onProgress:event=>evaluateOptions.onProgress?.({...event,pairedCaseId:item.id,scope:'selected-books'})});}
   catch(error){selected=failedCaseResult(item,error);}
  }
  await record({...selected,id:item.id+'::selected-books',pairedCaseId:item.id,scope:'selected-books',
   plannerReused:!all.requestFailure});
  if(stopReason)break;
 }
 return {results,stopReason};
}
function parseArgs(argv){const out={mode:process.env.LIVE_EVAL_MODE||'smoke',scope:process.env.LIVE_EVAL_SCOPE||'selected-books',caseId:process.env.LIVE_EVAL_CASE_ID||'',answerVariant:process.env.LIVE_EVAL_ANSWER_VARIANT||'with-review',retrievalProfile:process.env.LIVE_EVAL_RETRIEVAL_PROFILE||'baseline',repeatCount:Number(process.env.LIVE_EVAL_REPEAT_COUNT||1),reportOnly:process.env.LIVE_EVAL_REPORT_ONLY==='true',output:process.env.LIVE_EVAL_OUTPUT||'',confirm:process.env.CONFIRM_LIVE_AI==='true'};
 for(let i=0;i<argv.length;i++){const [flag,inline]=argv[i].split('=',2),key=flag.replace(/^--/,'');if(flag==='--help'||flag==='-h'){out.help=true;continue;}
  if(!['mode','scope','case','answer-variant','retrieval-profile','repeat','report-only','output','confirm-live-ai'].includes(key))throw Error('Unknown option '+flag);const value=inline??argv[++i];if(value===undefined)throw Error('Missing value for '+flag);
  if(key==='mode')out.mode=value;else if(key==='scope')out.scope=value;else if(key==='case')out.caseId=value;else if(key==='answer-variant')out.answerVariant=value;else if(key==='retrieval-profile')out.retrievalProfile=value;else if(key==='repeat')out.repeatCount=Number(value);else if(key==='report-only')out.reportOnly=value==='true';else if(key==='output')out.output=value;else out.confirm=value==='true';}
 return out;}
const PHASE2_SCORE_TARGETS={protocol:'phase-2 rubric v2; claim audit precedes scoring; each dimension 0–2',
 answer:{dimensions:{accuracy:{batch16Mean:1.72,registeredFloor:1.55,target:1.72},
  questionCoverage:{batch16Mean:1.69,registeredFloor:1.65,target:1.69},
  explanationQuality:{batch16Mean:1.72,registeredFloor:1.80,target:1.80},
  citationSupport:{batch16Mean:1.62,registeredFloor:1.50,target:1.62},
  citationCompleteness:{batch16Mean:1.55,registeredFloor:1.70,target:1.70}},
  producedMeanOutOf10:8.2,completionAdjustedMeanReported:true},
 highlights:{dimensions:{fidelity:{batch16Mean:1.72,registeredFloor:1.80,target:1.80},
  coverage:{batch16Mean:1.69,registeredFloor:1.55,target:1.69},
  context:{batch16Mean:1.72,registeredFloor:1.85,target:1.85},
  claimRelevance:{batch16Mean:1.72,registeredFloor:1.70,target:1.72},
  completeness:{batch16Mean:1.90,registeredFloor:1.95,target:1.95}},
  producedMeanOutOf10:8.85,completionAdjustedMeanReported:true},
  latency:{metric:'real-work stage sum per transport; shared planner/retrieval/selection stages plus that answer request; excludes harness pacing',
  medianMaximumSeconds:95,p90MaximumSeconds:145}};
function summarizeInferenceTransport(cases){
 const values=(cases||[]).flatMap(item=>(item.answerVariantComparison?.variants||[]).filter(variant=>
  ['default','streaming'].includes(variant.inferenceTransport)).map(variant=>({caseId:item.id,
   attemptNumber:item.attemptNumber||item.repeatAttempt||null,...variant})));
 const percentile=(sorted,p)=>sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null;
 return Object.fromEntries(['default','streaming'].map(transport=>{
  const rows=values.filter(row=>row.inferenceTransport===transport);
  const durations=rows.map(row=>row.realWorkStageSumMs).filter(Number.isFinite).sort((a,b)=>a-b);
  const median=durations.length?(durations.length%2?durations[(durations.length-1)/2]:
   (durations[durations.length/2-1]+durations[durations.length/2])/2):null;
  const p90=percentile(durations,.9);
  return [transport,{attempts:rows.length,successfulAnswers:rows.filter(row=>!row.noAnswerFailure).length,
   structuralPasses:rows.filter(row=>row.structuralPassed===true).length,
   structuralFailures:rows.filter(row=>row.structuralPassed===false).length,
   requestFailures:rows.filter(row=>row.noAnswerFailure).length,realWorkStageSumMs:{sampleCount:durations.length,
    median:median===null?null:Number(median.toFixed(1)),p90:p90===null?null:Number(p90.toFixed(1)),
    mean:durations.length?Number((durations.reduce((sum,value)=>sum+value,0)/durations.length).toFixed(1)):null,
    goalMedianMs:PHASE2_SCORE_TARGETS.latency.medianMaximumSeconds*1000,
    goalP90Ms:PHASE2_SCORE_TARGETS.latency.p90MaximumSeconds*1000,
    goalStatus:{medianMet:median!==null&&median<=PHASE2_SCORE_TARGETS.latency.medianMaximumSeconds*1000,
     p90Met:p90!==null&&p90<=PHASE2_SCORE_TARGETS.latency.p90MaximumSeconds*1000}},
   timerRaceCases:rows.filter(row=>(row.evidenceTrace?.inferenceCalls||[]).some(call=>call.timeoutClassification==='timer-race-no-cancel')).length,
   acknowledgedStreamCancels:rows.filter(row=>(row.evidenceTrace?.inferenceCalls||[]).some(call=>call.timeoutClassification==='stream-cancel-acknowledged')).length,
   unconfirmedProviderTerminations:rows.filter(row=>(row.evidenceTrace?.inferenceCalls||[]).some(call=>
    call.timeoutFired===true&&call.providerInferenceCancellation==='unconfirmed')).length,
   requestFailuresByCode:Object.fromEntries([...new Set(rows.filter(row=>row.noAnswerFailure)
    .map(row=>row.requestFailure?.failureCode||'unknown'))].map(code=>[code,rows.filter(row=>
      row.noAnswerFailure&&(row.requestFailure?.failureCode||'unknown')===code).length]))}];
 }));
}
export {summarizeInferenceTransport};
async function main(){
 const args=parseArgs(process.argv.slice(2));if(args.help){console.log('Usage: PILOT_EVALUATION_TOKEN=... node reading-companion/live-answer-evaluation.mjs --confirm-live-ai true [--mode planner|smoke|quality|focused|paired|holdout|acceptance|fresh|fresh3|handoff|philosophy3|library-all|library-selected|transport-ab|full] [--scope selected-books|all-books|case-default|paired] [--answer-variant with-review|compose-only|paired-review-ablation|paired-expansion-ablation|paired-selection-ablation|transport-ab] [--retrieval-profile baseline|expanded] [--case case-id] [--repeat 1..3] [--report-only true] [--output report.json]');return 0;}
 if(!args.confirm)throw Error('Live AI calls are disabled unless --confirm-live-ai true is provided.');
 if(!['with-review','compose-only','paired-review-ablation','paired-expansion-ablation','paired-selection-ablation','transport-ab'].includes(args.answerVariant))throw Error('Unsupported answer variant.');
 if(!Object.hasOwn(RETRIEVAL_PROFILES,args.retrievalProfile))throw Error('Unknown retrieval profile.');
 const usesEvaluationMode=['quality','focused','paired','holdout','acceptance','fresh','fresh3','handoff','philosophy3','library-all','library-selected','transport-ab','batch18-acceptance','batch19-acceptance','batch21-compact-acceptance'].includes(args.mode);
 if(args.mode==='paired'&&args.scope!=='paired')throw Error('The paired suite must use paired scope.');
 if(!usesEvaluationMode&&args.scope!=='selected-books')throw Error('The all-books scope is available only in a supported evaluation suite.');
 if(usesEvaluationMode&&args.mode!=='paired'&&args.mode!=='fresh'&&args.mode!=='fresh3'&&args.mode!=='handoff'&&args.mode!=='philosophy3'&&args.mode!=='library-all'&&args.mode!=='library-selected'&&args.mode!=='transport-ab'&&args.mode!=='batch18-acceptance'&&args.mode!=='batch19-acceptance'&&args.mode!=='batch21-compact-acceptance'&&!['selected-books','all-books'].includes(args.scope))throw Error('Evaluation scope must be selected-books or all-books.');
 if((args.mode==='fresh'||args.mode==='fresh3'||args.mode==='handoff'||args.mode==='philosophy3'||args.mode==='library-all'||args.mode==='library-selected'||args.mode==='transport-ab'||args.mode==='batch18-acceptance'||args.mode==='batch19-acceptance'||args.mode==='batch21-compact-acceptance')&&args.scope!=='case-default')throw Error('Fresh, handoff and phase-2 library question suites must use case-default scope.');
 if(args.mode==='acceptance'&&args.scope!=='all-books')throw Error('The acceptance suite must run in all-books mode.');
 if(!Number.isInteger(args.repeatCount)||args.repeatCount<1||args.repeatCount>3)
  throw Error('Repeat count must be an integer from 1 to 3.');
 const repeatableFreshSelection=(args.mode==='fresh'&&(args.caseId==='all'||FRESH_CASES.some(item=>item.id===args.caseId)))||
  (args.mode==='transport-ab'&&(args.caseId===''||args.caseId==='all'))||
  (args.mode==='fresh3'&&(args.caseId==='all'||FRESH3_CASES.some(item=>item.id===args.caseId)));
 const repeatableAcceptanceSelection=args.mode==='acceptance'&&(
  ['repeatable-calibration','quality-calibration'].includes(args.caseId)||
  ACCEPTANCE_CASES.some(item=>item.id===args.caseId));
 if(args.repeatCount!==1&&!repeatableAcceptanceSelection&&!repeatableFreshSelection)
  throw Error('Repeated runs require a calibration suite, fresh question set, or one selected case.');
 const token=process.env.PILOT_EVALUATION_TOKEN;if(typeof token!=='string'||token.length<32)throw Error('PILOT_EVALUATION_TOKEN must be set to the configured evaluation secret.');
 if(args.mode==='full'&&process.env.CONFIRM_FULL_30!=='true')throw Error('The full 30-question live run also requires CONFIRM_FULL_30=true.');
 const suite=JSON.parse(await readFile(SUITE_PATH,'utf8'));
 const selectedCases=selectLiveCases(suite,args.mode,args.caseId);
 const baseCases=args.mode==='paired'?selectedCases:usesEvaluationMode?applyQualityScope(selectedCases,args.scope):selectedCases;
 // Interleave repetitions so service or corpus changes do not affect all
 // attempts of one question before the other question is evaluated.
 const cases=args.repeatCount>1?Array.from({length:args.repeatCount},(_,index)=>
  baseCases.map(item=>({...item,repeatAttempt:index+1}))).flat():baseCases;
 const evaluationUsesPlanner=evaluationUsesLivePlanner(args.mode,args.scope);
 const plannerCalls=args.mode==='paired'?cases.length:usesEvaluationMode&&!evaluationUsesPlanner?0:cases.length;
 const answerCallsPerCase=args.answerVariant==='transport-ab'?5:args.answerVariant==='paired-review-ablation'?5:
  args.answerVariant==='paired-expansion-ablation'?7:
  args.answerVariant==='paired-selection-ablation'?6:
  args.answerVariant==='compose-only'?2:3;
 const estimatedWorkerAiCalls=args.mode==='planner'?cases.length:args.mode==='paired'?
  plannerCalls+cases.length*2*answerCallsPerCase:plannerCalls+cases.length*answerCallsPerCase;
 const reportCaseCount=args.mode==='paired'?cases.length*2:cases.length;
 const conditionalGapPlannerCallAllowance=args.mode==='planner'?0:reportCaseCount;
 const report={schema:'antilogicalism-reading-companion-live-answer-eval-v2',generatedAt:new Date().toISOString(),mode:args.mode,searchScope:usesEvaluationMode?args.scope:null,selectedCaseId:args.caseId&&args.caseId!=='all'?args.caseId:null,
  evaluationRun:evaluationRunContext(),
  ...(['batch18-acceptance','batch19-acceptance'].includes(args.mode)?{experiment:args.mode==='batch19-acceptance'?'batch-19-compact-review-acceptance':'batch-18-configured-streaming-default-acceptance',
   protocol:'One with-review answer pass over four registered questions. The answer request omits inferenceTransport so the Worker applies its deployed default; artifact records the transport confirmed by the Worker.',
   phase2ScoringTargets:PHASE2_SCORE_TARGETS,
   qualityProtocolStatus:'semantic scoring pending; complete the phase-2 rubric-v2 claim audit, then score answer and highlights for all five dimensions',
   acceptanceThresholds:{answerProducedMeanMinimum:8.2,highlightProducedMeanMinimum:8.85,
    latencyMedianMaximumMs:95000,latencyP90MaximumMs:145000,
    registeredDimensionFloorsAndBatch16Means:PHASE2_SCORE_TARGETS,
    transport:'all four completed cases must confirm streaming as configured default unless environment rollback is intentionally set to default',
    reviewCompletion:'4/4 cases must complete the final review contract; review-format-failed and review-contract-incomplete count as misses',
    internalIdLeaksMaximum:0,
    safeguards:'no request failures or structural failures; standard with-review and existing citation/review checks remain enabled',
    sampleLimit:'four cases are a diagnostic screen; latency percentiles are descriptive and cannot certify the registered production P90'} }:{}),
  ...(args.mode==='batch21-compact-acceptance'?{experiment:'batch-21-compact-safeguard-diagnostic',
   protocol:'One with-review pass over eight registered Phase 2 cases: four All Books and four selected-book cases. Claim audit precedes rubric-v2 semantic scoring.',
   phase2ScoringTargets:PHASE2_SCORE_TARGETS,
   qualityProtocolStatus:'semantic scoring pending; complete claim audit, then score answer and highlights across all five rubric-v2 dimensions',
   acceptanceThresholds:{answerProducedMeanMinimum:8.2,highlightProducedMeanMinimum:8.85,
    registeredDimensionFloorsAndBatch16Means:PHASE2_SCORE_TARGETS,
    internalIdLeaksMaximum:0,reviewCompletion:'all eight final review contracts must complete; no unverified-source-draft shipments or misattributions',
    sampleLimit:'eight cases and one pass provide a compact diagnostic only; the registered 32-case phase-2 run remains the full acceptance evaluation and this sample cannot certify production latency percentiles'} }:{}),
  ...(args.mode==='transport-ab'?{experiment:'batch-17-inference-transport-ab',phase2ScoringTargets:PHASE2_SCORE_TARGETS,
   qualityProtocolStatus:'semantic scoring pending; score each answer and highlight for both transports with the phase-2 rubric v2 after claim audit'}:{}),
  answerVariant:args.answerVariant,retrievalProfile:args.retrievalProfile,
  retrievalConfig:{...RETRIEVAL_PROFILES[args.retrievalProfile]},caseCount:reportCaseCount,
  pairedQuestionCount:['paired','transport-ab'].includes(args.mode)?cases.length:undefined,
  repeatCount:args.repeatCount>1?args.repeatCount:undefined,
  repeatedCaseIds:args.repeatCount>1?baseCases.map(item=>item.id):undefined,
  estimatedWorkerAiCalls,conditionalGapPlannerCallAllowance,
  callsPerCase:args.mode==='transport-ab'?'1 shared planner + 1 shared evidence-selection call + two with-review answer generations and reviews (default and buffered streaming); optional conditional gap planning is shared':['batch18-acceptance','batch19-acceptance','batch21-compact-acceptance'].includes(args.mode)?'one with-review answer pipeline per case; planning, selection, composition, and review each run once; optional conditional gap planning may add one planner request per case':args.mode==='planner'?'1 planner inference + local retrieval per case; answer generation is skipped':args.mode==='paired'?
   (args.answerVariant==='paired-selection-ablation'?'1 shared planner + 6 Worker selection/composition/review calls for each scope; selected-books reuses the plan and query set; retrieval may add one conditional gap-planner call per scope':
    '1 shared planner + answer pipeline calls for each scope; selected-books reuses the plan and query set; retrieval may add one conditional gap-planner call per scope'):
   (evaluationUsesPlanner?'1 planner + ':'0 planner + ')+answerCallsPerCase+' answer/selection calls per case'+
   (args.answerVariant==='paired-selection-ablation'?' (each answer run performs Worker selection, composition and review)':'')+
   ', including one Worker evidence-selection call before composition; plus up to one conditional gap-planner call when page text weakly covers a requested part',
  answerQualityNote:args.mode==='transport-ab'?'Structural checks are reported per transport. Semantic quality remains pending the phase-2 rubric-v2 claim audit and five answer/five highlight dimensions. Report produced and completion-adjusted means separately; no-answer transport failures count as zero only in adjusted means.':args.mode==='planner'?'Planner queries and expected-book retrieval are checked; answer generation and answer quality are not evaluated.':
   'Structural checks cover source identity and citation linkage. Answer quality remains pending until a human scores accuracy, question coverage, explanation quality, citation support, and citation completeness from 0 (fail) to 2 (strong). A structural pass is not a quality pass.',
  qualityStatus:args.mode==='planner'?'not-assessed':'pending-human-review',
  executionStatus:'initializing',completedCases:0,notRunCases:cases.length,requestFailureCases:0,plannerFallbackCases:0,plannerSkippedCases:0,workerVersionIds:[],workerSourceRevisions:[],stopReason:'',cases:[]};
 const outputPath=args.output?resolve(args.output):'';
 let activeLibrary=null;
 const saveReport=async()=>{
  if(activeLibrary&&report.reproducibility?.corpus)
   report.reproducibility.corpus.indexFiles=Object.fromEntries(activeLibrary.contentDigests);
  if(outputPath){
   await writeFile(outputPath,JSON.stringify(report,null,2)+'\n');
   const scorecardPath=/\.json$/i.test(outputPath)?outputPath.replace(/\.json$/i,'.scorecard.json'):
    outputPath+'.scorecard.json';
   await writeFile(scorecardPath,JSON.stringify(createHumanScorecardTemplate(report),null,2)+'\n');
  }
 };
 await saveReport();
 console.log('Initializing '+args.mode+' evaluation for '+(args.repeatCount>1?
  args.repeatCount+' attempts each for '+baseCases.length+' selected questions ('+cases.length+' answers)':
  args.mode==='paired'?cases.length+' paired questions ('+reportCaseCount+' scope results)':
  cases.length+' question'+(cases.length===1?'':'s'))+
  '; loading the published fingerprint coverage and corpus manifest before retrieval.');
 const startupHeartbeat=setInterval(()=>console.log('['+new Date().toISOString()+
  '] SETUP WAIT: still loading the published fingerprint coverage and corpus manifest.'),15_000);
 try{
  const results=await Promise.all([fetchJson(FINGERPRINT_ROOT+'coverage-v3.json'),new RemoteLibrary(DEFAULT_INDEX_ROOT,makeCachedFetch(DEFAULT_INDEX_ROOT)).manifest()]);
  clearInterval(startupHeartbeat);
  const coverage=results[0],manifest=results[1];
  const allowed=validatePublishedCorpus(coverage,manifest);
  validateEvaluationBookScopes(cases,allowed,manifest);
  const library=new RemoteLibrary(DEFAULT_INDEX_ROOT,makeCachedFetch(DEFAULT_INDEX_ROOT));
  activeLibrary=library;
  report.reproducibility={clientSourceRevision:sourceRevision(),corpus:{libraryVersion:manifest.version,
   indexRoot:DEFAULT_INDEX_ROOT,fingerprintRoot:FINGERPRINT_ROOT,
   coverageSha256:jsonDigest(coverage),manifestSha256:jsonDigest(manifest),indexFiles:{}}};
  console.log('Starting explicitly confirmed '+args.mode+' live evaluation: '+cases.length+' questions; estimated at least '+report.estimatedWorkerAiCalls+' Worker inference calls, plus conditional repairs.');
  report.executionStatus='running';await saveReport();
  let previousCall=0;
  const beforeCall=async()=>{if(previousCall){const due=Math.max(0,CALL_GAP_MS-(Date.now()-previousCall));if(due)await new Promise(resolve=>setTimeout(resolve,due));}previousCall=Date.now();};
  let activeRepeatAttempt=0;
  const printProgress=event=>{
   const details=[];
   if(activeRepeatAttempt)details.push('attempt='+activeRepeatAttempt);
   if(event.variant)details.push('variant='+event.variant);
   if(event.scope)details.push('scope='+event.scope);
   if(Number.isFinite(event.queryCount))details.push('queries='+event.queryCount);
   if(Number.isFinite(event.searchCount))details.push('searches='+event.searchCount);
   if(Number.isFinite(event.retrievalFallbackCount)&&event.retrievalFallbackCount)
    details.push('retrieval-fallbacks='+event.retrievalFallbackCount);
   if(Number.isFinite(event.sourceCount))details.push('pages='+event.sourceCount);
   if(Number.isFinite(event.citations))details.push('citations='+event.citations);
   if(event.usage&&Number.isFinite(event.usage.calls))details.push('worker-calls='+event.usage.calls);
   if(event.usage&&Number.isFinite(event.usage.neurons))details.push('neurons='+event.usage.neurons);
   if(Array.isArray(event.candidatePages))details.push('candidates='+event.candidatePages.map(page=>page.bookId+':'+page.page).join(','));
   if(Array.isArray(event.selectedPages))details.push('selected='+event.selectedPages.map(page=>page.bookId+':'+page.page).join(','));
   console.log('['+new Date().toISOString()+'] ['+String(event.caseId||'case')+'] '+
    String(event.stage||'progress').toUpperCase()+' '+String(event.status||'update').toUpperCase()+': '+
    String(event.message||'')+(details.length?' ('+details.join('; ')+')':''));
  };
  const onResult=async(result,results)=>{
   const scheduledCase=cases[results.length-1];
   if(scheduledCase?.repeatAttempt)result.attemptNumber=scheduledCase.repeatAttempt;
   report.cases=results;report.completedCases=results.length;
   report.notRunCases=report.caseCount-results.length;
   report.requestFailureCases=results.filter(item=>item.requestFailure).length;
   report.plannerFallbackCases=results.filter(item=>item.plannerFallback).length;
   report.plannerSkippedCases=results.filter(item=>item.plannerSkipped).length;
   report.plannerReusedCases=results.filter(item=>item.plannerReused).length;
   report.humanReview=summarizeManualReviews(results);
   report.highlightReview=summarizeHighlightReviews(results);
   report.answerVariants=summarizeAnswerVariants(results);
   if(args.mode==='transport-ab')report.transportComparison=summarizeInferenceTransport(results);
   report.selectionVariants=summarizeSelectionVariants(results);
   if(args.repeatCount>1){
    report.repeatSummary=Object.fromEntries(baseCases.map(item=>{
     const attempts=results.filter(value=>value.id===item.id);
     const wordCounts=attempts.map(value=>(String(value.answerText||'').match(/\S+/gu)||[]).length);
     return [item.id,{completedAttempts:attempts.length,structuralPasses:attempts.filter(value=>value.passed===true).length,
      structuralFailures:attempts.filter(value=>value.passed===false).length,requestFailures:attempts.filter(value=>value.requestFailure).length,
      answerWordCounts:attempts.map(value=>({attempt:value.attemptNumber,words:(String(value.answerText||'').match(/\S+/gu)||[]).length,
       citedSources:Number(value.citationCount)||0,distinctCitedBooks:[...new Set((value.citationBookIds||[]).map(String))].length})),
      meanAnswerWords:wordCounts.length?Math.round(wordCounts.reduce((sum,count)=>sum+count,0)/wordCounts.length):0}];
    }));
   }
   report.workerVersionIds=[...new Set(results.flatMap(item=>[item.plannerWorkerVersionId,item.answerWorkerVersionId,
    ...(item.answerVariantComparison?.variants||[]).map(variant=>variant.workerVersionId)].filter(value=>typeof value==='string'&&value)))];
   report.workerSourceRevisions=[...new Set(results.flatMap(item=>[item.plannerWorkerSourceRevision,item.answerWorkerSourceRevision,
    ...(item.answerVariantComparison?.variants||[]).map(variant=>variant.workerSourceRevision)]).filter(value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)))];
   report.scopeSummary=Object.fromEntries(['all-books','selected-books'].map(scope=>{
    const scoped=results.filter(item=>{
    // Current answer records use evaluationScope; scope remains for older/paired rows.
    const recordedScope=item.evaluationScope||item.scope||
     (Array.isArray(item.selectedBookIds)&&item.selectedBookIds.length?'selected-books':'all-books');
    return recordedScope===scope;
   });
    return [scope,{cases:scoped.length,passed:scoped.filter(item=>item.passed===true).length,
     failed:scoped.filter(item=>item.passed===false).length,requestFailures:scoped.filter(item=>item.requestFailure).length,
     questionPartCoverage:scoped.reduce((totals,item)=>{const count=item.questionPartCoverage||{};
      for(const key of ['supported','partial','unsupported','total'])totals[key]+=Number(count[key])||0;return totals;},
      {total:0,supported:0,partial:0,unsupported:0})}];
   }));
   await saveReport();
   const label=args.mode==='planner'?'PLANNER':'STRUCTURAL';
   console.log((result.passed===true?label+'-PASS':result.passed===null?'UNSCORED':result.requestFailure?'REQUEST-FAIL':label+'-MISS')+' '+result.id+': '+(result.outcome||result.requestFailure?.failureCode||'no outcome'));
  };
  const evaluateWithAttempt=async(item,options)=>{
   activeRepeatAttempt=item.repeatAttempt||0;
   return (args.mode==='planner'?evaluatePlannerCase:evaluateLiveCase)(item,{
    ...options,onProgress:event=>printProgress(event)
   });
  };
  const run=await (args.mode==='paired'?runPairedScopeCases(cases,{evaluateCase:evaluateLiveCase,
   evaluateOptions:{library,manifest,allowed,token,beforeCall,answerVariant:args.answerVariant,retrievalProfile:args.retrievalProfile,onProgress:printProgress},onResult}):
   runLiveCases(cases,{evaluateCase:evaluateWithAttempt,maxConsecutiveWorkerFailures:args.repeatCount>1?6:2,
  evaluateOptions:{library,manifest,allowed,token,beforeCall,useFixedQueries:usesEvaluationMode&&!evaluationUsesPlanner,
   answerVariant:args.answerVariant,retrievalProfile:args.retrievalProfile,onProgress:printProgress},onResult}));
  report.cases=run.results;report.stopReason=run.stopReason;
  report.completedCases=run.results.length;report.notRunCases=report.caseCount-run.results.length;
  report.requestFailureCases=run.results.filter(item=>item.requestFailure).length;
  report.plannerFallbackCases=run.results.filter(item=>item.plannerFallback).length;
  report.executionStatus=report.requestFailureCases?'completed-with-request-failures':'completed';
  report.summary={passedCases:report.cases.filter(item=>item.passed===true).length,
   failedCases:report.cases.filter(item=>item.passed===false).length,
   unscoredCases:report.cases.filter(item=>item.passed===null||item.passed===undefined).length,
   structuralPassedCases:report.cases.filter(item=>item.structuralPassed===true).length,
   structuralFailedCases:report.cases.filter(item=>item.structuralPassed===false).length,
   answerQualityStatus:args.mode==='planner'?'not-assessed':'pending-human-review',
   pipelineFailures:summarizePipelineFailures(report.cases),
   requestFailureCases:report.requestFailureCases,
   plannerFallbackCases:report.plannerFallbackCases,
   reviewerLabels:summarizeReviewerLabels(report.cases),
   evidenceContinuity:summarizeEvidenceContinuity(report.cases),
   humanReview:summarizeManualReviews(report.cases),
   highlightReview:summarizeHighlightReviews(report.cases),
   answerVariants:summarizeAnswerVariants(report.cases),
   selectionVariants:summarizeSelectionVariants(report.cases),
   ...(args.mode==='transport-ab'?{
    transportComparison:summarizeInferenceTransport(report.cases),
    caseProjectionNote:'The generic case totals above count one representative result per paired attempt. They are not pooled A/B totals; use transportComparison for per-transport counts and latency.'}:{}),
   questionPartStatusCounts:report.cases.reduce((totals,item)=>{
    const counts=item.questionPartCoverage||{};
    for(const status of ['supported','partial','unsupported'])
     totals[status]+=Number(counts[status])||0;
    totals.total+=Number(counts.total)||0;
    return totals;
   },{total:0,supported:0,partial:0,unsupported:0}),
   ...(args.mode==='planner'?{}:{answerCompletenessCounts:report.cases.reduce((totals,item)=>{
    const status=item.answerCompleteness;
    if(status==='full')totals.full++;
    else if(status==='partial')totals.partial++;
    else if(status==='none')totals.none++;
    else totals.unknown++;
    return totals;
   },{full:0,partial:0,none:0,unknown:0})})};
  await saveReport();
  if(args.mode==='transport-ab'){
   const comparisons=report.summary.transportComparison;
   const pathSummary=transport=>{
    const value=comparisons[transport],latency=value.realWorkStageSumMs;
    return `${transport}: ${value.structuralPasses}/${value.attempts} structural passes, `+
     `median ${(latency.median/1000).toFixed(1)}s, p90 ${(latency.p90/1000).toFixed(1)}s`;
   };
   console.log('Done paired transport A/B — '+pathSummary('default')+'; '+pathSummary('streaming')+
    '. Semantic answer quality still requires the separate human rubric.');
  }else console.log(args.mode==='planner'?
   'Done: '+report.summary.passedCases+'/'+report.caseCount+' planner plans retrieved at least one expected book; no answers were generated.':
   (args.mode==='paired'?'Done: '+report.summary.passedCases+'/'+report.caseCount+' scope results met structural gates; paired scope totals are in scopeSummary. ':'Done: '+report.summary.passedCases+'/'+report.caseCount+' reviewed answers met structural gates; ')+report.summary.failedCases+' failed and '+report.summary.unscoredCases+' are unscored. Semantic answer quality requires the separate human rubric.');
  if(args.mode!=='planner'){
   const completeness=report.summary.answerCompletenessCounts;
   console.log('Answer completeness: '+completeness.full+' full, '+completeness.partial+
    ' partial, '+completeness.none+' none, '+completeness.unknown+' unknown; library-evidence coverage remains reported separately.');
   const labels=report.summary.reviewerLabels;
   console.log('Reviewer labels: '+labels.reviewerPartStatusCounts.answered+' answered, '+
    labels.reviewerPartStatusCounts.partial+' partial, '+labels.reviewerPartStatusCounts.unanswered+
    ' unanswered parts; '+labels.reviewContractCases.complete+' complete and '+
    labels.reviewContractCases.incomplete+' incomplete review contracts. Human quality scores remain separate.');
  }
  return report.requestFailureCases||(args.mode==='planner'&&report.summary.failedCases)||
   (usesEvaluationMode&&report.summary.failedCases>0&&!args.reportOnly)?1:0;
 }catch(error){
  clearInterval(startupHeartbeat);
  report.executionStatus=report.cases.length?'interrupted':'setup-failed';
  report.setupFailure={message:String(error?.message||error).slice(0,240)};
  report.completedCases=report.cases.length;report.notRunCases=cases.length-report.cases.length;
  await saveReport();throw error;
 }
}
if(import.meta.url===`file://${process.argv[1]}`)main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});

