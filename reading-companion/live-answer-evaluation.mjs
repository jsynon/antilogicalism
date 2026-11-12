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
// Phase-3 suites: two further dedicated, single-scope sets of brand-new
// questions, disjoint from every earlier suite. library-all-3 runs open
// questions against the whole library; library-selected-3 scopes every
// question to one chosen book. Neither set reuses a phase-2 question, and
// all-books cases carry no expected sources.
const LIBRARY_ALL3_CASES=[
 {id:'library-all3-forgiveness-mercy',discipline:'philosophy',evaluation_scope:'all-books',question:'How do writers in the library treat forgiveness and mercy, and do they present them as duties owed, gifts freely given, or weaknesses to be overcome?',selected_book_ids:[],planner_queries:['How do writers in the library treat forgiveness and mercy, and do they present them as duties owed, gifts freely given, or weaknesses to be overcome?'],required_source_groups:[],review_focus:[]},
 {id:'library-all3-education-formation',discipline:'society',evaluation_scope:'all-books',question:'How do writers in the library describe the education and formation of a young person, and do they place more trust in schools and teachers or in experience and hardship?',selected_book_ids:[],planner_queries:['How do writers in the library describe the education and formation of a young person, and do they place more trust in schools and teachers or in experience and hardship?'],required_source_groups:[],review_focus:[]},
 {id:'library-all3-war-causes-effects',discipline:'history',evaluation_scope:'all-books',question:'How do writers in the library explain why wars happen and what war does to the people caught up in it, and do they place more weight on leaders’ choices, on nations and their interests, or on forces beyond anyone’s control?',selected_book_ids:[],planner_queries:['How do writers in the library explain why wars happen and what war does to the people caught up in it, and do they place more weight on leaders’ choices, on nations and their interests, or on forces beyond anyone’s control?'],required_source_groups:[],review_focus:[]},
 {id:'library-all3-guilt-conscience',discipline:'philosophy',evaluation_scope:'all-books',question:'How do writers in the library portray guilt and conscience, and do they treat conscience as a trustworthy guide, a torment to be escaped, or something that upbringing and habit can shape or silence?',selected_book_ids:[],planner_queries:['How do writers in the library portray guilt and conscience, and do they treat conscience as a trustworthy guide, a torment to be escaped, or something that upbringing and habit can shape or silence?'],required_source_groups:[],review_focus:[]},
 {id:'library-all3-parents-children',discipline:'society',evaluation_scope:'all-books',question:'How do writers in the library portray the influence of parents on their children, and do they present children mainly as formed by their parents, as defined by rebellion against them, or as independent of them?',selected_book_ids:[],planner_queries:['How do writers in the library portray the influence of parents on their children, and do they present children mainly as formed by their parents, as defined by rebellion against them, or as independent of them?'],required_source_groups:[],review_focus:[]},
 {id:'library-all3-love-marriage',discipline:'literature',evaluation_scope:'all-books',question:'How do writers in the library judge love and marriage, and do they present marriage more as love’s fulfillment, as a practical compromise, or as a trap?',selected_book_ids:[],planner_queries:['How do writers in the library judge love and marriage, and do they present marriage more as love’s fulfillment, as a practical compromise, or as a trap?'],required_source_groups:[],review_focus:[]},
 {id:'library-all3-death-mortality',discipline:'philosophy',evaluation_scope:'all-books',question:'How do writers in the library face death and human mortality, and do they offer consolation, defiance, or acceptance in response to it?',selected_book_ids:[],planner_queries:['How do writers in the library face death and human mortality, and do they offer consolation, defiance, or acceptance in response to it?'],required_source_groups:[],review_focus:[]},
 {id:'library-all3-solitude-society',discipline:'philosophy',evaluation_scope:'all-books',question:'How do writers in the library weigh solitude against life in society, and do they treat withdrawal from other people as wisdom, as failure, or as a necessity for certain work?',selected_book_ids:[],planner_queries:['How do writers in the library weigh solitude against life in society, and do they treat withdrawal from other people as wisdom, as failure, or as a necessity for certain work?'],required_source_groups:[],review_focus:[]},
];
const LIBRARY_SELECTED3_CASES=[
 {id:'library-selected3-gatsby-nick-picture',discipline:'literature',evaluation_scope:'selected-books',question:'In The Great Gatsby, how does Nick Carraway’s narration build up his picture of Jay Gatsby, and which parts of that picture rest on what Nick witnesses himself as opposed to what he is told or reconstructs afterward?',selected_book_ids:['313'],planner_queries:['In The Great Gatsby, how does Nick Carraway’s narration build up his picture of Jay Gatsby, and which parts of that picture rest on what Nick witnesses himself as opposed to what he is told or reconstructs afterward?'],required_source_groups:[{label:'F. Scott Fitzgerald, The Great Gatsby',book_ids:['313']}],review_focus:[]},
 {id:'library-selected3-great-expectations-pip',discipline:'literature',evaluation_scope:'selected-books',question:'In Great Expectations, how does Dickens present Pip’s ambition and his shame about his origins, and how does the older Pip who narrates the story judge the younger Pip he describes?',selected_book_ids:['312'],planner_queries:['In Great Expectations, how does Dickens present Pip’s ambition and his shame about his origins, and how does the older Pip who narrates the story judge the younger Pip he describes?'],required_source_groups:[{label:'Charles Dickens, Great Expectations',book_ids:['312']}],review_focus:[]},
 {id:'library-selected3-pride-prejudice-judgment',discipline:'literature',evaluation_scope:'selected-books',question:'In Pride and Prejudice, how does Elizabeth Bennet’s judgment of Mr. Darcy and of Mr. Wickham change over the course of the novel, and what part do Darcy’s letter and Elizabeth’s examination of her own prejudice play in that change?',selected_book_ids:['341'],planner_queries:['In Pride and Prejudice, how does Elizabeth Bennet’s judgment of Mr. Darcy and of Mr. Wickham change over the course of the novel, and what part do Darcy’s letter and Elizabeth’s examination of her own prejudice play in that change?'],required_source_groups:[{label:'Jane Austen, Pride and Prejudice',book_ids:['341']}],review_focus:[]},
 {id:'library-selected3-war-and-peace-history',discipline:'history',evaluation_scope:'selected-books',question:'In War and Peace, how does Tolstoy explain the movement of nations and the real influence of so-called great men on events, and how do the battlefield experiences of Prince Andrei and Pierre bear on that explanation?',selected_book_ids:['258'],planner_queries:['In War and Peace, how does Tolstoy explain the movement of nations and the real influence of so-called great men on events, and how do the battlefield experiences of Prince Andrei and Pierre bear on that explanation?'],required_source_groups:[{label:'Leo Tolstoy, War and Peace',book_ids:['258']}],review_focus:[]},
 {id:'library-selected3-don-quixote-manuscript',discipline:'literature',evaluation_scope:'selected-books',question:'In Don Quixote, how does Cervantes’ fiction of an Arabic manuscript by Cide Hamete Benengeli, reaching the reader through translators and editors, shape the telling of Don Quixote’s adventures, and how does it affect the reader’s judgment of his madness and his nobility?',selected_book_ids:['124'],planner_queries:['In Don Quixote, how does Cervantes’ fiction of an Arabic manuscript by Cide Hamete Benengeli, reaching the reader through translators and editors, shape the telling of Don Quixote’s adventures, and how does it affect the reader’s judgment of his madness and his nobility?'],required_source_groups:[{label:'Miguel de Cervantes, Don Quixote',book_ids:['124']}],review_focus:[]},
 {id:'library-selected3-wuthering-heights-narrators',discipline:'literature',evaluation_scope:'selected-books',question:'In Wuthering Heights, how do Nelly Dean’s narration and Lockwood’s framing of it shape what the reader learns about Heathcliff and Catherine, and where does the novel give the reader reason to doubt Nelly’s version of events?',selected_book_ids:['362'],planner_queries:['In Wuthering Heights, how do Nelly Dean’s narration and Lockwood’s framing of it shape what the reader learns about Heathcliff and Catherine, and where does the novel give the reader reason to doubt Nelly’s version of events?'],required_source_groups:[{label:'Emily Brontë, Wuthering Heights',book_ids:['362']}],review_focus:[]},
 {id:'library-selected3-faust-striving-wager',discipline:'literature',evaluation_scope:'selected-books',question:'In Faust, what does Faust’s striving consist in, and why does his learning leave him dissatisfied at the outset, and how does the wager with Mephistopheles define what would count as Faust’s defeat?',selected_book_ids:['139'],planner_queries:['In Faust, what does Faust’s striving consist in, and why does his learning leave him dissatisfied at the outset, and how does the wager with Mephistopheles define what would count as Faust’s defeat?'],required_source_groups:[{label:'Johann Wolfgang von Goethe, Faust',book_ids:['139']}],review_focus:[]},
 {id:'library-selected3-crime-punishment-theory',discipline:'literature',evaluation_scope:'selected-books',question:'In Crime and Punishment, how does Raskolnikov’s theory of extraordinary men set out to justify his crime, and how do his exchanges with Porfiry and with Sonya challenge that theory?',selected_book_ids:['114'],planner_queries:['In Crime and Punishment, how does Raskolnikov’s theory of extraordinary men set out to justify his crime, and how do his exchanges with Porfiry and with Sonya challenge that theory?'],required_source_groups:[{label:'Fyodor Dostoevsky, Crime and Punishment',book_ids:['114']}],review_focus:[]},
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
 {id:'paired-hamlet-conscience',discipline:'literature',question:'In Hamlet’s “To be, or not to be” soliloquy, what does he mean when he says that conscience makes cowards of us all?',selected_book_ids:['212'],planner_queries:['Hamlet to be or not to be conscience makes cowards of us all native hue resolution','Hamlet soliloquy thought fear of death unknown country action resolution'],required_source_groups:[{label:'Shakespeare, Hamlet',book_ids:['212']}],review_focus:['Explain the line in the soliloquy’s reasoning about thought, fear, and action.','Keep the passage attributed to Hamlet and avoid treating the speech as the play’s settled doctrine. Check that the highlighted passage contains the line and supports the explanation.']},
 {id:'paired-nietzsche-good-evil',discipline:'philosophy',question:'In On the Genealogy of Morals, how does Nietzsche explain the origins of the contrast between “good” and “evil”?',selected_book_ids:['144'],planner_queries:['Nietzsche Genealogy of Morals first essay noble morality good bad slave morality good evil origins','Nietzsche Genealogy of Morals noble valuation good bad ressentiment slave revolt morality'],required_source_groups:[{label:'Nietzsche, On the Genealogy of Morals',book_ids:['144']}],review_focus:['Explain the contrast Nietzsche draws between the noble valuation of “good/bad” and the later slave-moral valuation of “good/evil.”','Attribute the historical-psychological account to Nietzsche’s argument and avoid presenting the terms as timeless definitions.']},
 {id:'paired-diamond-sutra-giving',discipline:'religion',question:'In the Diamond Sutra, what does it mean for a bodhisattva to give without abiding in forms, and how does that shape the practice of giving?',selected_book_ids:['23'],planner_queries:['Diamond Sutra bodhisattva give without abiding in forms no attachment signs','Diamond Sutra practice giving without dwelling in objects of mind bodhisattva'],required_source_groups:[{label:'Diamond Sutra',book_ids:['23']}],review_focus:['Explain “giving without abiding in forms” in the text’s context rather than as ordinary generosity alone.','Keep claims about nonattachment tied to the passage and do not turn the teaching into nihilism or a denial of conventional practice.']},
];
const HOLDOUT_CASES=[
 {id:'holdout-history-herodotus-helen',discipline:'history',question:'When Herodotus recounts the story of Helen’s journey to Troy, what do the Egyptian priests tell him, and how does he explain why he finds their account more credible?',selected_book_ids:['149'],planner_queries:['Herodotus Histories Helen Egypt priests account Troy credibility','Herodotus Helen Paris Egypt Egyptian priests story judgment'],required_source_groups:[{label:'Herodotus, Histories',book_ids:['149']}],review_focus:['Keep the Egyptian priests’ account distinct from Herodotus’s own reasoning and reported Greek traditions.','Explain the basis he gives for preferring one account without turning his inference into a directly witnessed fact.']},
 {id:'holdout-literature-hamlet-soliloquy',discipline:'literature',question:'In Hamlet’s “To be, or not to be” soliloquy, what alternatives does he weigh, and how does uncertainty about what follows death affect his reasoning?',selected_book_ids:['212'],planner_queries:['Hamlet to be or not to be soliloquy sleep death fear unknown country','Hamlet soliloquy conscience makes cowards of us all after death'],required_source_groups:[{label:'Shakespeare, Hamlet',book_ids:['212','564']}],review_focus:['Describe Hamlet’s alternatives and reasoning in the soliloquy without treating them as the play’s settled doctrine.','Connect the fear of the unknown after death to his hesitation, citing the soliloquy.']},
 {id:'holdout-philosophy-aristotle-soul-body',discipline:'philosophy',question:'According to Aristotle’s De Anima, how is the soul related to a living body, and how does the form-and-matter comparison clarify that relation?',selected_book_ids:['4'],planner_queries:['Aristotle De Anima soul actuality form natural body organ life','De Anima soul form matter body first actuality Aristotle'],required_source_groups:[{label:'Aristotle, De Anima',book_ids:['4']}],review_focus:['Explain the soul as the actuality or form of a natural body with life potentially.','Use the form-and-matter comparison without reducing soul to a separate bodily part.']},
 {id:'holdout-religion-james-faith-works',discipline:'religion',question:'According to James 2:14–26, how does James relate faith to works, and what do Abraham and Rahab illustrate in his argument?',selected_book_ids:['335'],planner_queries:['James 2:14-26 faith without works Abraham Rahab justified works','James faith works body without spirit Abraham offered Isaac Rahab received messengers'],required_source_groups:[{label:'James 2:14–26',book_ids:['335']}],review_focus:['Explain James’s argument about living faith and works using the passage’s examples.','Represent Abraham and Rahab as distinct illustrations and avoid importing a broader doctrinal resolution not stated in the passage.']},
 {id:'holdout-all-books-hume-kant-causation',discipline:'philosophy',question:'How do Hume’s Enquiry and Kant’s Critique of Pure Reason differ over how we can know causal necessity?',selected_book_ids:[],planner_queries:['Hume Enquiry cause effect necessary connection constant conjunction custom','Kant Critique Pure Reason causality category understanding a priori experience'],required_source_groups:[{label:'Hume, Enquiry Concerning Human Understanding',book_ids:['35']},{label:'Kant, Critique of Pure Reason',book_ids:['40']}],required_part_source_groups:[{partIncludes:'Hume',book_ids:['35']},{partIncludes:'Kant',book_ids:['40']}],review_focus:['Explain each author’s account on its own terms and distinguish Hume’s account of experience and habit from Kant’s account of a priori understanding.','Cite evidence from both books and avoid presenting the comparison as a direct exchange between the authors.']},
 {id:'holdout-all-books-plato-rousseau-order',discipline:'politics',question:'How do Plato’s Republic and Rousseau’s Social Contract explain what makes political order legitimate, and how does each connect it to the common good?',selected_book_ids:[],planner_queries:['Plato Republic justice city common good political order rulers knowledge','Rousseau Social Contract general will common good legitimate political authority'],required_source_groups:[{label:'Plato, Republic',book_ids:['74']},{label:'Rousseau, Social Contract',book_ids:['245']}],required_part_source_groups:[{partIncludes:'Plato',book_ids:['74']},{partIncludes:'Rousseau',book_ids:['245']}],review_focus:['Identify the basis of political order in each work, keeping Plato’s and Rousseau’s concepts distinct.','Explain how each account relates to collective good using passages from both works.']},
 {id:'holdout-all-books-wollstonecraft-dubois',discipline:'society',question:'How do Wollstonecraft’s Vindication of the Rights of Woman and Du Bois’s Souls of Black Folk describe the effects of unequal social conditions on people’s development and self-understanding?',selected_book_ids:[],planner_queries:['Wollstonecraft Vindication education dependence reason virtue women social conditions','Du Bois Souls of Black Folk veil double consciousness self understanding social conditions'],required_source_groups:[{label:'Wollstonecraft, Vindication of the Rights of Woman',book_ids:['87']},{label:'Du Bois, The Souls of Black Folk',book_ids:['454']}],required_part_source_groups:[{partIncludes:'Wollstonecraft',book_ids:['87']},{partIncludes:'Du Bois',book_ids:['454']}],review_focus:['Explain each author’s account of how social conditions shape development or self-understanding without flattening their distinct historical arguments.','Use evidence from both works and mark any comparative synthesis as a reader’s synthesis.']},
];
// This suite is reserved for acceptance after changes have been frozen.
// Keep the original seven baseline cases unchanged; add calibration cases only
// when explicitly approved, and diagnose a single case by its exact ID.
const ACCEPTANCE_CASES=[
 {id:'acceptance-descartes-cogito',discipline:'philosophy',question:'In Meditations on First Philosophy, what does Descartes conclude about his existence while doubting, and why does the act of doubting establish it?',selected_book_ids:[],planner_queries:['Descartes Meditations on First Philosophy doubt cogito existence thinking deceiver','Descartes I am I exist whenever thought conceived meditation certainty'],required_source_groups:[{label:'Descartes, Meditations on First Philosophy',book_ids:['25']}],review_focus:['Explain the cogito as established in the act of thinking or doubting, not as an inference from a trusted sense.','Keep the demon hypothesis and the certainty of the thinking self in their proper relation.']},
 {id:'acceptance-mill-harm-principle',discipline:'politics',question:'What principle does Mill use to limit society’s power over an individual, and what condition does he place on coercion to prevent harm?',selected_book_ids:[],planner_queries:['John Stuart Mill On Liberty harm to others only purpose power rightfully exercised','Mill On Liberty self regarding conduct society coercion harm prevention'],required_source_groups:[{label:'Mill, On Liberty',book_ids:['51']}],review_focus:['State the harm principle and distinguish harm to others from the person’s own good.','Preserve Mill’s qualifications about the maturity or capacity of the person governed.']},
 {id:'acceptance-epictetus-freedom',discipline:'philosophy',question:'What distinction does Epictetus draw between what is up to us and what is not, and how does he connect that distinction with freedom?',selected_book_ids:[],planner_queries:['Epictetus Enchiridion what is up to us judgment impulse desire aversion','Epictetus freedom depends on choice opinions external things'],required_source_groups:[{label:'Epictetus, Enchiridion',book_ids:['28']}],review_focus:['Identify judgment, impulse, desire, and aversion as within our control and external things as not.','Explain how freedom depends on governing one’s own choices rather than controlling externals.']},
 {id:'acceptance-augustine-memory',discipline:'religion',question:'In the Confessions, how does Augustine search for God through memory, and what limits of memory does he encounter?',selected_book_ids:[],planner_queries:['Augustine Confessions Book X memory search for God vast palace memory','Augustine Confessions memory limits God not contained in memory'],required_source_groups:[{label:'Augustine, Confessions',book_ids:['17']}],review_focus:['Explain why Augustine turns to memory in seeking God.','Do not claim that God is simply one remembered object or contained within memory.']},
 {id:'acceptance-aristotle-tragedy-plot',discipline:'literature',question:'In the Poetics, why does Aristotle treat plot as the chief element of tragedy, and how do reversal and recognition contribute to its structure?',selected_book_ids:[],planner_queries:['Aristotle Poetics plot chief element tragedy action unity','Aristotle Poetics reversal recognition change to opposite events plot'],required_source_groups:[{label:'Aristotle, Poetics',book_ids:['11']}],review_focus:['Explain plot as the organization of action and why tragedy imitates action rather than people alone.','Describe reversal and recognition as developments within the plot, not as independent decorations.']},
 {id:'acceptance-boethius-fortune',discipline:'philosophy',question:'Why does Boethius argue that Fortune’s gifts cannot secure happiness, and what does their instability reveal?',selected_book_ids:[],planner_queries:['Boethius Consolation of Philosophy Fortune gifts cannot make happy unstable','Boethius Fortune wheel prosperity adversity true good happiness'],required_source_groups:[{label:'Boethius, Consolation of Philosophy',book_ids:['21']}],review_focus:['Distinguish external goods that Fortune can take away from the stable good Boethius associates with happiness.','Attribute the argument to the dialogue’s reasoning and preserve its qualifications.']},
 {id:'acceptance-locke-political-authority',discipline:'politics',question:'According to Locke’s Second Treatise of Government, what makes political authority legitimate, and under what conditions may the people resist or replace it?',selected_book_ids:[],planner_queries:['John Locke Second Treatise political power consent governed legitimate authority','Locke Second Treatise dissolution government breach trust people resistance replacement'],required_source_groups:[{label:'Locke, Second Treatise of Government',book_ids:['49']}],review_focus:['Ground legitimacy in consent and explain the role of the community’s political power.','Distinguish ordinary disagreement from a breach of trust that dissolves government.']},
 {id:'acceptance-god-is-love',discipline:'religion',question:'What does “God is love” mean?',selected_book_ids:[],planner_queries:['1 John 4:7–12 God is love God sent his Son love one another meaning','Simone Weil love of God love neighbor attention Gravity and Grace Waiting for God'],required_source_groups:[{label:'Bible on God is love',book_ids:['335','638','646']}],review_focus:['Explain the phrase first in its biblical context, including how 1 John connects God’s love with love of one another; a Bible source is required for this case.','A relevant Simone Weil text may add a distinct perspective, but it is optional and must not replace or be blended into the biblical claim.','If Weil is cited, check that the passage actually bears on divine love and supports the sentence attached to it.','Do not present a synthesis as either author’s own wording.']},
 // This open-ended diagnostic checks whether the answer addresses the reader's
 // question and calibrates what the retrieved texts can establish. It has no
 // fixed planner queries or philosopher requirements: those would turn a
 // retrieval-quality test into a hand-authored route.
 {id:'acceptance-simulation-hypothesis',discipline:'philosophy',question:'Are we living in a simulation?',selected_book_ids:[],planner_queries:[],required_source_groups:[],review_focus:['Answer the question directly and distinguish a general skeptical possibility from evidence for a computational simulation.','Use only passages that genuinely clarify the question; no particular author, school, or source is required. Explain the connection and its limits in plain language.','If the library passages do not establish whether the world is computationally simulated, say that clearly without presenting a related philosophical view as proof.']},
 {id:'acceptance-buddha-on-death',discipline:'religion',question:'What did Buddha say about death?',selected_book_ids:[],planner_queries:['Buddhist teaching on death dying rebirth and liberation','Buddha final days death impermanence and parinirvana'],required_source_groups:[{label:'Buddhist primary or teaching texts',book_ids:['22','23','104','225']}],review_focus:['Answer the question directly and center the account in Buddhist teaching texts that actually address death, dying, impermanence, rebirth, or liberation.','When more than one distinct work offers relevant support, synthesize their contributions and explain how they relate; do not add a citation merely to increase the count.','Distinguish a compiled teaching text or later interpretation from a verified verbatim historical statement by the Buddha. Attribute each source voice carefully.','Use later scholarship or interpretation only as clearly labeled context, and do not let it replace the Buddhist texts that ground the answer.']},
 // This broad comparison case has no author-specific search plan or required
 // works. It tests whether all-books retrieval can discover relevant voices
 // and whether the answer synthesizes them without mistaking topical overlap
 // for an account of life's meaning.
 {id:'acceptance-life-meaning-authors',discipline:'philosophy',question:'How do different authors in the library approach the question of life\'s meaning?',selected_book_ids:[],planner_queries:[],required_source_groups:[],review_focus:['Answer how the cited authors approach life’s meaning, rather than listing works that merely touch education, religion, science, ethics, or other adjacent topics.','When the evidence supports multiple distinct approaches, identify each source voice, explain the meaningful difference, and connect that difference directly to the question.','Do not infer that an author addresses life’s meaning from a shared keyword or broad subject label alone. If the retrieved passages do not support a direct comparison, say so clearly.']},
];
const PLANNER_CASE_IDS=[
 'quality-philosophy-aristotle-practical-wisdom',
 'quality-all-books-cross-work-science',
];
const CALL_GAP_MS=30_500;
const BATCH18_ACCEPTANCE_CASE_IDS=['library-all-hobbes-rousseau-nature',
 'library-all-progress-idea','library-selected-conrad-marlow-kurtz',
 'library-selected-kierkegaard-silentio-speaker'];
// Batch 21 compact diagnostic: eight distinct Phase 2 cases, one pass, split
// evenly between all-books discovery and selected-book attribution controls.
const BATCH21_COMPACT_CASE_IDS=['library-all-hobbes-rousseau-nature',
 'library-all-suffering-responses','library-all-narrators-judgment','library-all-science-certainty',
 'library-selected-conrad-marlow-kurtz','library-selected-dostoevsky-grand-inquisitor',
 'library-selected-kierkegaard-silentio-speaker','library-selected-aurelius-meditations-others'];

function copyEvaluationCase(item){
 return {...item,selected_book_ids:[...item.selected_book_ids],planner_queries:[...item.planner_queries],
  required_source_groups:item.required_source_groups.map(group=>({...group,book_ids:[...group.book_ids]})),
  required_part_source_groups:(item.required_part_source_groups||[]).map(group=>({...group,book_ids:[...group.book_ids]})),
  review_focus:[...item.review_focus]};
}

function sourceRevision(){
 try{return execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim()||null;}
 catch{return null;}
}
function jsonDigest(value){return createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');}
export function selectLiveCases(suite,mode='smoke',caseId=''){
 const evaluationCases=mode==='transport-ab'||mode==='batch18-acceptance'||mode==='batch19-acceptance'||mode==='batch21-compact-acceptance'?[...LIBRARY_ALL_CASES,...LIBRARY_SELECTED_CASES]:mode==='philosophy3'?PHILOSOPHY3_CASES:mode==='handoff'?HANDOFF_CASES:mode==='fresh3'?FRESH3_CASES:mode==='fresh'?FRESH_CASES:mode==='library-all'?LIBRARY_ALL_CASES:mode==='library-selected'?LIBRARY_SELECTED_CASES:mode==='library-all-3'?LIBRARY_ALL3_CASES:mode==='library-selected-3'?LIBRARY_SELECTED3_CASES:mode==='holdout'?HOLDOUT_CASES:mode==='acceptance'?ACCEPTANCE_CASES:
  mode==='quality'&&caseId&&caseId!=='all'?[...QUALITY_CASES,...FOCUSED_CASES]:
  mode==='focused'?FOCUSED_CASES:mode==='paired'?PAIRED_CASES:QUALITY_CASES;
 if(mode==='transport-ab'&&caseId==='stage-profile-4'){
  const ids=['library-all-hobbes-rousseau-nature','library-all-progress-idea',
   'library-selected-conrad-marlow-kurtz','library-selected-kierkegaard-silentio-speaker'];
  const byId=new Map(evaluationCases.map(item=>[item.id,item]));
  const selected=ids.map(id=>byId.get(id));
  if(selected.some(item=>!item))throw Error('The four registered stage-profile questions are missing from the transport A/B suite.');
  return selected.map(copyEvaluationCase);
 }
 if((mode==='batch18-acceptance'||mode==='batch19-acceptance')&&['all','stage-profile-4'].includes(caseId)){
  const byId=new Map(evaluationCases.map(item=>[item.id,item]));
  const selected=BATCH18_ACCEPTANCE_CASE_IDS.map(id=>byId.get(id));
  if(selected.some(item=>!item))throw Error('A registered Batch 18 acceptance question is missing.');
  return selected.map(copyEvaluationCase);
 }
 if(mode==='batch21-compact-acceptance'&&['all','compact-8'].includes(caseId)){
  const byId=new Map(evaluationCases.map(item=>[item.id,item]));
  const selected=BATCH21_COMPACT_CASE_IDS.map(id=>byId.get(id));
  if(selected.some(item=>!item))throw Error('A registered Batch 21 compact acceptance question is missing.');
  return selected.map(copyEvaluationCase);
 }
 if(mode==='acceptance'&&caseId==='repeatable-calibration'){
  const ids=new Set(['acceptance-simulation-hypothesis','acceptance-buddha-on-death']);
  const selected=ACCEPTANCE_CASES.filter(item=>ids.has(item.id));
  if(selected.length!==ids.size)throw Error('The repeated calibration cases are missing from the acceptance suite.');
  return selected.map(copyEvaluationCase);
 }
 if(mode==='acceptance'&&caseId==='quality-calibration'){
  const ids=new Set(['acceptance-god-is-love','acceptance-simulation-hypothesis','acceptance-buddha-on-death','acceptance-life-meaning-authors']);
  const selected=ACCEPTANCE_CASES.filter(item=>ids.has(item.id));
  if(selected.length!==ids.size)throw Error('The quality calibration cases are missing from the acceptance suite.');
  return selected.map(copyEvaluationCase);
 }
 if(caseId&&caseId!=='all'){
  if(!['quality','focused','paired','holdout','acceptance','fresh','fresh3','handoff','philosophy3','library-all','library-selected','library-all-3','library-selected-3','transport-ab','batch18-acceptance','batch19-acceptance','batch21-compact-acceptance'].includes(mode))throw Error('A specific case can be selected only in quality, focused, paired, holdout or acceptance mode; fresh, fresh3, handoff, philosophy3, library-all, library-selected, library-all-3, library-selected-3, transport-ab and batch acceptance cases can be selected in their respective suites.');
  const selected=evaluationCases.find(item=>item.id===caseId);
  if(!selected)throw Error('Unknown '+mode+' case: '+caseId);
  return [copyEvaluationCase(selected)];
 }
 if(mode==='quality')return QUALITY_CASES.map(copyEvaluationCase);
 if(mode==='focused')return FOCUSED_CASES.map(copyEvaluationCase);
 if(mode==='paired')return PAIRED_CASES.map(copyEvaluationCase);
 if(mode==='holdout')return HOLDOUT_CASES.map(copyEvaluationCase);
 if(mode==='acceptance')return ACCEPTANCE_CASES.map(copyEvaluationCase);
 if(mode==='fresh')return FRESH_CASES.map(copyEvaluationCase);
 if(mode==='fresh3')return FRESH3_CASES.map(copyEvaluationCase);
 if(mode==='handoff')return HANDOFF_CASES.map(copyEvaluationCase);
 if(mode==='philosophy3')return PHILOSOPHY3_CASES.map(copyEvaluationCase);
 if(mode==='library-all')return LIBRARY_ALL_CASES.map(copyEvaluationCase);
 if(mode==='library-selected')return LIBRARY_SELECTED_CASES.map(copyEvaluationCase);
 if(mode==='library-all-3')return LIBRARY_ALL3_CASES.map(copyEvaluationCase);
 if(mode==='library-selected-3')return LIBRARY_SELECTED3_CASES.map(copyEvaluationCase);
 if(mode==='transport-ab')return [...LIBRARY_ALL_CASES,...LIBRARY_SELECTED_CASES].map(copyEvaluationCase);
 if(mode==='batch21-compact-acceptance')return BATCH21_COMPACT_CASE_IDS.map(id=>{
  const item=evaluationCases.find(value=>value.id===id);
  if(!item)throw Error('A registered Batch 21 compact acceptance question is missing.');
  return copyEvaluationCase(item);
 });
 if(mode==='planner')return PLANNER_CASE_IDS.map(id=>{
  const item=QUALITY_CASES.find(value=>value.id===id);
  if(!item)throw Error('The planner-only cases are missing from the quality suite.');
  return copyEvaluationCase(item);
 });
 if(mode==='smoke'){
  const selected=SMOKE_CASE_IDS.map(id=>suite.cases.find(item=>item.id===id));
  if(selected.some(item=>!item))throw Error('The live smoke cases are missing from the retrieval suite.');
  return [...LIVE_CASES,...selected];
 }
 if(mode==='full')return [...suite.cases];
 if(mode==='batch18-acceptance'||mode==='batch19-acceptance')return BATCH18_ACCEPTANCE_CASE_IDS.map(id=>{
  const item=evaluationCases.find(value=>value.id===id);
  if(!item)throw Error('A registered Batch 18 acceptance question is missing.');
  return copyEvaluationCase(item);
 });
 throw Error('Mode must be smoke, planner, quality, focused, paired, holdout, acceptance, fresh, fresh3, handoff, philosophy3, library-all, library-selected, library-all-3, library-selected-3, transport-ab, batch18-acceptance, batch19-acceptance, batch21-compact-acceptance or full.');
}
export function applyQualityScope(cases,scope='selected-books'){
 if(scope==='case-default')return cases.map(item=>({...item,selected_book_ids:item.evaluation_scope==='all-books'?[]:[...item.selected_book_ids]}));
 if(!['selected-books','all-books'].includes(scope))
  throw Error('Evaluation scope must be selected-books, all-books or case-default.');
 if(scope==='selected-books')return cases;
 return cases.map(item=>({...item,selected_book_ids:[]}));
}
export function evaluationUsesLivePlanner(mode,scope){
 if(mode==='fresh'||mode==='fresh3'||mode==='handoff'||mode==='philosophy3'||mode==='library-all'||mode==='library-selected'||mode==='library-all-3'||mode==='library-selected-3'||mode==='transport-ab'||mode==='batch18-acceptance'||mode==='batch19-acceptance'||mode==='batch21-compact-acceptance')return true;
 return ['quality','focused','paired','holdout','acceptance'].includes(mode)&&
  (mode==='paired'||scope==='all-books');
}
export function restrictPlanToSelectedBooks(plan,selectedBookIds){
 if(!plan||typeof plan!=='object'||!Array.isArray(selectedBookIds)||!selectedBookIds.length)
  return plan||null;
 const allowed=new Set(selectedBookIds.map(String));
 const sources=(Array.isArray(plan.sources)?plan.sources:[]).map(source=>({
  ...source,bookIds:(Array.isArray(source.bookIds)?source.bookIds:[]).map(String)
   .filter(id=>allowed.has(id))
 })).filter(source=>source.bookIds.length);
 const parts=(Array.isArray(plan.parts)?plan.parts:[]).map(part=>({
  ...part,...(Array.isArray(part.sourceBookIds)?{sourceBookIds:part.sourceBookIds.map(String)
   .filter(id=>allowed.has(id))}:{}),
  ...(Array.isArray(part.candidateSourceIds)?{candidateSourceIds:[...part.candidateSourceIds]}:{})
 }));
 return {...plan,sources,parts};
}
function normalizeDiagnosticExcerpt(value){
 return String(value||'').normalize('NFKC')
  .replace(/[’‘]/g,"'").replace(/[“”]/g,'"')
  .replace(/…|\.\.\./g,' ')
  .replace(/\s+/g,' ').trim().toLocaleLowerCase();
}
function locateHighlightInSubmittedPage(item,citations,submitted){
 const sourceId=String(item?.source_id||item?.sourceId||'');
 const page=Number(item?.page);
 const citation=citations.find(value=>String(value?.id||'')===sourceId&&
  Number(value?.page)===page);
 const original=citation&&submitted.find(value=>
  String(value?.bookId||'')===String(citation.bookId||'')&&
  Number(value?.page)===page);
 if(typeof original?.text!=='string'||typeof item?.quote!=='string')return null;
 const quote=item.quote.replace(/^(?:…|\.\.\.)\s*/,'')
  .replace(/\s*(?:…|\.\.\.)$/,'').trim();
 const normalizedQuote=normalizeDiagnosticExcerpt(quote);
 if(normalizedQuote.length<24)return null;
 return normalizeDiagnosticExcerpt(original.text).includes(normalizedQuote);
}
function highlightRelevanceAudit(answer,citations,evidenceHighlights){
 // Match the reviewer claim note to answer wording within the same cited
 // source. Citation identity alone is too broad when one page supports several
 // claims; unmatched cases remain visible for human inspection.
 const answerSentences=String(answer||'')
  .split(/(?<=[.!?])\s+(?=[\p{Lu}"“‘(])/u)
  .map(text=>text.trim()).filter(Boolean)
  .map((text,index)=>({index:index+1,text,
   normalized:normalizeClaimForMatch(text),sourceIds:auditCitationIds(text,citations).inlineIds}));
 const stopWords=new Set(['and','are','but','for','from','has','have','into','its','not','that','the','their','this','was','with']);
 const terms=value=>new Set((normalizeClaimForMatch(value).match(/[\p{L}\p{N}]{3,}/gu)||[])
  .map(term=>term.replace(/(?:ing|ed|es|s)$/u,'')).filter(term=>!stopWords.has(term)));
 const excerpts=(Array.isArray(evidenceHighlights)?evidenceHighlights:[]).flatMap(item=>{
  const sourceId=String(item?.sourceId||'');
  const quotes=Array.isArray(item?.quotes)&&item.quotes.length?item.quotes:[item];
  return quotes.map(quote=>{
   const sourceId=String(item?.sourceId||'');
   const point=String(quote?.point||item?.point||'');
   const pointTerms=terms(point);
   const matched=pointTerms.size>=3?answerSentences.filter(sentence=>{
    if(!sentence.sourceIds.includes(sourceId))return false;
    const sentenceTerms=terms(sentence.text);let shared=0;
    for(const term of pointTerms)if(sentenceTerms.has(term))shared++;
    return shared/Math.min(pointTerms.size,sentenceTerms.size||1)>=0.67;
   }):[];
   return {sourceId,page:Number.isSafeInteger(item?.page)?item.page:null,
   claimId:String(quote?.claimId||item?.claimId||''),
   partId:String(quote?.partId||''),point,
   quote:String(quote?.quote||item?.quote||''),
   quoteLocated:typeof quote?.quoteLocated==='boolean'?quote.quoteLocated:
    typeof item?.quoteLocated==='boolean'?item.quoteLocated:null,
   answerSentenceIndexes:matched.map(sentence=>sentence.index),
   linkStatus:matched.length?'matched-claim-wording':'unresolved-claim-link'};
  });
 }).filter(item=>item.sourceId&&item.quote);
 return {method:'inspection-only',linkage:'same-source-and-claim-point-wording',
  semanticRelevanceScored:false,
  limitation:'Point wording is matched conservatively to answer sentences; unmatched links require inspection. Neither a match nor exact quote location proves semantic support.',
  answerSentences,excerpts};
}
function answerDeniesSupportedComparison(part,answer){
 if(part?.status!=='supported'||!/\b(?:compare|comparison|contrast|differ|difference|different|distinguish)\b/i.test(String(part?.part||'')))return false;
 const text=String(answer||'');
 const explicitGap=/(?:\b(?:cannot|can't|does not|doesn't|do not|don't|unable to|fails? to)\b.{0,90}\b(?:establish|demonstrate|support|show|provide|contain|identify|determine|compare|distinguish)\b.{0,70}\b(?:comparison|contrast|difference|distinction)\b|\b(?:no|not enough|insufficient)\s+(?:direct\s+)?(?:evidence|support|basis|comparison|contrast|difference|distinction)\b|\b(?:comparison|contrast|difference|distinction)\s+(?:is\s+)?(?:not directly stated|cannot be established|is not established)\b|\b(?:texts?|passages?|excerpts?|evidence)\b.{0,80}\b(?:do not|don't|does not|doesn't|cannot|can't)\b.{0,50}\b(?:contain|establish|support|show|provide)\b.{0,40}\b(?:comparison|contrast|difference|distinction)\b)/i.test(text);
 const givesContrast=/\b(?:whereas|by contrast|in contrast|unlike|differs? from|different from|the difference is|differ in|contrasts? with)\b/i.test(text);
 return explicitGap&&!givesContrast;
}
function normalizeClaimForMatch(value){
 return String(value||'').normalize('NFKC').toLocaleLowerCase()
  .replace(/\[\s*s\d+(?:\s*,\s*s\d+)*\s*\]/giu,' ')
  .replace(/[*_`#]/gu,' ').replace(/\s+/gu,' ').trim();
}
function supportIssueDispositions(item,supportIssues,reviewDecisions,partDecisions){
 const answer=normalizeClaimForMatch(item?.answerText||item?.answer||
  item?.evidenceTrace?.final?.answer||item?.trace?.final?.answer||'');
 const counts={finalAnswer:0,rejectedBeforeFinal:0,rejectedAlternateSource:0,unresolved:0};
 for(const issue of supportIssues){
  const claimId=String(issue?.claimId||'');
  const sourceId=String(issue?.sourceId||'');
  if(!claimId){
   const part=partDecisions.find(decision=>decision?.partId===issue?.partId);
   if(issue?.partId&&part&&part.finalStatus!=='answered')counts.finalAnswer++;
   else counts.unresolved++;
   continue;
  }
  const claimRows=reviewDecisions.filter(decision=>decision?.claimId===claimId&&
   (!sourceId||!decision?.sourceId||decision.sourceId===sourceId));
  const claimText=claimRows.find(decision=>typeof decision?.claimText==='string')?.claimText||'';
  const normalizedClaim=normalizeClaimForMatch(claimText);
  const appearsInFinal=normalizedClaim.length>=24&&answer.includes(normalizedClaim);
  const rejected=claimRows.some(decision=>decision?.accepted===false);
  const acceptedAlternative=reviewDecisions.some(decision=>decision?.claimId===claimId&&
   decision?.accepted===true&&decision?.sourceId&&decision.sourceId!==sourceId);
  if(appearsInFinal&&!acceptedAlternative)counts.finalAnswer++;
  else if(rejected&&acceptedAlternative)counts.rejectedAlternateSource++;
  else if(rejected&&!appearsInFinal)counts.rejectedBeforeFinal++;
  else counts.unresolved++;
 }
 return counts;
}
function summarizeCaseReviewerLabels(item){
 // The live Worker response exposes its trace as `trace`; saved benchmark
 // rows normalize that same object to `evidenceTrace`. Read either shape so
 // labels are captured before and after the response is written to the case.
 const trace=item?.evidenceTrace||item?.trace;
 const contract=trace?.reviewContract||item?.reviewContract;
 if(!contract||typeof contract!=='object')return {available:false};
 const supportIssues=Array.isArray(contract.supportIssues)?contract.supportIssues:[];
 const incompleteReasons=new Set(['missing-claim-source-decision','missing-claim-source-span']);
 const partDecisions=Array.isArray(contract.partDecisions)?contract.partDecisions:[];
 const reviewDecisions=Array.isArray(contract.reviewDecisions)?contract.reviewDecisions:[];
 const issueDispositions=supportIssueDispositions(item,supportIssues,reviewDecisions,partDecisions);
 const contractIncomplete=contract.valid!==true||!Array.isArray(contract.partDecisions)||
  !Array.isArray(contract.reviewDecisions)||supportIssues.some(issue=>
   incompleteReasons.has(String(issue?.reason||'')));
 const statusCounts=values=>values.reduce((counts,status)=>{
  if(Object.hasOwn(counts,status))counts[status]++;
  return counts;
 },{answered:0,partial:0,unanswered:0});
 const claimStatuses=new Map();
 for(const decision of reviewDecisions){
  const claimId=String(decision?.claimId||'');
  const status=String(decision?.claimStatus||'');
  if(!claimId||!['answered','partial','unanswered'].includes(status))continue;
  const previous=claimStatuses.get(claimId);
  // Source-linked claims can have one trace row per cited source. Count each
  // claim once and retain the weakest status if those rows disagree.
  const order={answered:0,partial:1,unanswered:2};
  if(!previous||order[status]>order[previous])claimStatuses.set(claimId,status);
 }
 return {available:true,contractStatus:contractIncomplete?'incomplete':'complete',
  reviewerPartStatusCounts:statusCounts(partDecisions.map(item=>String(item?.reviewerStatus||''))),
  validatedPartStatusCounts:statusCounts(partDecisions.map(item=>String(item?.finalStatus||''))),
  claimStatusCounts:statusCounts([...claimStatuses.values()]),
  supportIssueCount:supportIssues.length,
  supportIssueDispositions:issueDispositions,
  incompleteSupportIssueCount:supportIssues.filter(issue=>
   incompleteReasons.has(String(issue?.reason||''))).length};
}
export function summarizeReviewerLabels(cases){
 const entries=(cases||[]).map(item=>{
  // Older rows can contain an explicit `{available:false}` placeholder even
  // though their preserved trace has the review contract needed for a fresh
  // summary. Prefer stored labels only when they actually contain a summary.
  // Older artifacts stored only the aggregate support-issue count. Rebuild
  // those summaries from their trace so a rejected draft claim is separated
  // from a support problem that survived into the answer.
  const hasCurrentDisposition=labels=>labels?.available===true&&
   labels.supportIssueDispositions&&typeof labels.supportIssueDispositions==='object';
  const storedLabels=hasCurrentDisposition(item?.reviewerLabels)?item.reviewerLabels:
   hasCurrentDisposition(item?.offlineRecheck?.reviewerLabels)?item.offlineRecheck.reviewerLabels:null;
  return {id:String(item?.id||''),
   attemptNumber:Number.isInteger(item?.attemptNumber)?item.attemptNumber:null,
   reviewStatus:String(item?.reviewStatus||''),
   labels:storedLabels||summarizeCaseReviewerLabels(item)};
 });
 const available=entries.filter(item=>item.labels?.available);
 const aggregate=key=>available.reduce((counts,item)=>{
  for(const status of Object.keys(counts))
   counts[status]+=Number(item.labels?.[key]?.[status])||0;
  return counts;
 },{answered:0,partial:0,unanswered:0});
 return {caseCount:entries.length,
  reviewContractCases:{complete:available.filter(item=>item.labels.contractStatus==='complete').length,
   incomplete:available.filter(item=>item.labels.contractStatus==='incomplete').length,
   unavailable:entries.length-available.length},
  reviewerPartStatusCounts:aggregate('reviewerPartStatusCounts'),
  validatedPartStatusCounts:aggregate('validatedPartStatusCounts'),
  claimStatusCounts:aggregate('claimStatusCounts'),
  supportIssueCount:available.reduce((sum,item)=>sum+Number(item.labels.supportIssueCount||0),0),
  supportIssueDispositions:Object.fromEntries(['finalAnswer','rejectedBeforeFinal',
   'rejectedAlternateSource','unresolved'].map(key=>[key,available.reduce((sum,item)=>
    sum+Number(item.labels.supportIssueDispositions?.[key]||0),0)])),
  incompleteSupportIssueCount:available.reduce((sum,item)=>sum+
   Number(item.labels.incompleteSupportIssueCount||0),0),
  entries};
}
export function auditSelectionHandoff(trace){
 const stage=Array.isArray(trace?.stages)?trace.stages.find(item=>item?.stage==='evidence-selection'):null;
 if(!stage)return {status:'unavailable',checkedRelations:0,issues:[]};
 if(stage.status!=='selected'||!stage.decision||!Array.isArray(stage.decision.parts))
  return {status:'not-applicable',selectionStatus:String(stage.status||'unknown'),
   checkedRelations:0,issues:[]};
 const selectedRows=(Array.isArray(stage.selected)?stage.selected:[])
  .filter(item=>typeof item?.candidateId==='string');
 // Older authenticated traces predate candidate-to-part links. Leave those
 // records recheckable without treating an absent field as a broken handoff.
 if(!selectedRows.length||selectedRows.some(item=>!Array.isArray(item.candidatePartIds)))
  return {status:'unavailable',reason:'selection-part-links-not-recorded',checkedRelations:0,issues:[]};
 const selected=new Map(selectedRows.map(item=>[item.candidateId,item]));
 const issues=[];let checkedRelations=0;
 const supportRelations={direct:0,context:0};
 let partsWithDirectEvidence=0,contextOnlyParts=0;
 for(const part of stage.decision.parts){
  const partId=String(part?.partId||'');
  const evidence=Array.isArray(part?.evidence)?part.evidence:[];
  const selectedEvidence=evidence.filter(item=>{
   const source=selected.get(String(item?.candidateId||''));
   return Array.isArray(source?.candidatePartIds)&&source.candidatePartIds.includes(partId);
  });
  if(selectedEvidence.some(item=>item?.support==='direct'))partsWithDirectEvidence++;
  else if(selectedEvidence.some(item=>item?.support==='context'))contextOnlyParts++;
  const partCandidateIds=Array.isArray(part?.candidateIds)?part.candidateIds:[];
  for(const item of evidence){
   const candidateId=String(item?.candidateId||'');
   const source=selected.get(candidateId);
   if(!source){
    issues.push({code:'decision-evidence-not-in-packet',partId,candidateId,
     support:String(item?.support||'')});
    continue;
   }
   checkedRelations++;
   if(!Array.isArray(source.candidatePartIds)||!source.candidatePartIds.includes(partId))
    issues.push({code:'selected-evidence-part-link-missing',partId,candidateId,
     support:String(item?.support||'')});
   else if(item?.support==='direct'||item?.support==='context')supportRelations[item.support]++;
  }
  for(const candidateId of partCandidateIds){
   if(!selected.has(String(candidateId)))
    issues.push({code:'part-link-source-not-selected',partId,candidateId:String(candidateId)});
  }
  if(part?.coverage==='supported'&&!evidence.some(item=>item?.support==='direct'&&
    selected.has(String(item?.candidateId||''))))
   issues.push({code:'supported-part-has-no-selected-direct-evidence',partId});
 }
 const recoveredPartLinks=Array.isArray(stage.recoveredPartLinks)?stage.recoveredPartLinks:[];
 for(const link of recoveredPartLinks){
  const partId=String(link?.partId||''),candidateId=String(link?.candidateId||'');
  const source=selected.get(candidateId);
  if(!partId||!candidateId||!source){
   issues.push({code:'recovered-part-link-source-not-selected',partId,candidateId});
   continue;
  }
  checkedRelations++;
  if(!source.candidatePartIds.includes(partId))
   issues.push({code:'recovered-part-link-missing',partId,candidateId});
 }
 return {status:issues.length?'mismatch':'consistent',checkedRelations,supportRelations,
  partsWithDirectEvidence,contextOnlyParts,issues};
}
function tracePayload(stage){
 const text=stage?.messages?.find(message=>message?.role==='user')?.content;
 if(typeof text!=='string')return null;
 try{return JSON.parse(text);}catch{return null;}
}
export function auditEvidenceContinuity(trace){
 const planParts=Array.isArray(trace?.plan?.parts)?trace.plan.parts:[];
 if(!planParts.length)return {status:'unavailable',parts:[],reviewWorkload:null};
 const stages=Array.isArray(trace?.stages)?trace.stages:[];
 const selection=stages.find(stage=>stage?.stage==='evidence-selection');
 const compose=stages.find(stage=>stage?.stage==='compose');
 const composePayload=tracePayload(compose);
 const review=stages.find(stage=>stage?.stage==='review');
 const reviewStage=review||stages.find(stage=>String(stage?.stage||'').startsWith('review'));
 const selectionParts=new Map((selection?.decision?.parts||[]).map(part=>[String(part?.partId||''),part]));
 const selectedRows=Array.isArray(selection?.selected)?selection.selected:[];
 const composerParts=new Map((composePayload?.parts||[]).map(part=>[String(part?.partId||''),part]));
 const finalParts=Array.isArray(trace?.final?.questionParts)?trace.final.questionParts:[];
 const reviewDecisions=Array.isArray(trace?.reviewContract?.reviewDecisions)?trace.reviewContract.reviewDecisions:[];
 const partDecisions=Array.isArray(trace?.reviewContract?.partDecisions)?trace.reviewContract.partDecisions:[];
 const parts=planParts.map(part=>{
  const partId=String(part?.id||'');
  const selectedDecision=selectionParts.get(partId);
  const selectedCandidateIds=[...new Set((selectedDecision?.candidateIds||[]).map(String))];
  const selectedSourceIds=[...new Set(selectedRows.filter(row=>
   row?.candidatePartIds?.includes(partId)).map(row=>String(row?.id||'')).filter(Boolean))];
  const composerPart=composerParts.get(partId);
  const composerSourceIds=[...new Set((composerPart?.candidateSourceIds||[]).map(String))];
  const composerEvidenceIds=[...new Set((composePayload?.evidence||[]).filter(source=>
   source?.selectionSupport?.some(item=>item?.partId===partId)).map(source=>String(source?.id||'')).filter(Boolean))];
  const finalPart=finalParts.find(item=>String(item?.part||'')===String(part?.question||''));
  const finalCitationIds=[...new Set((finalPart?.evidenceIds||[]).map(String))];
  const decisionRows=reviewDecisions.filter(row=>row?.partId===partId&&!row?.contextOnly);
  const reviewedClaimIds=[...new Set(decisionRows.map(row=>String(row?.claimId||'')).filter(Boolean))];
  const acceptedClaimIds=[...new Set(decisionRows.filter(row=>row?.accepted===true&&row?.claimStatus==='answered')
   .map(row=>String(row?.claimId||'')).filter(Boolean))];
  const partialClaimIds=[...new Set(decisionRows.filter(row=>row?.claimStatus==='partial')
   .map(row=>String(row?.claimId||'')).filter(Boolean))];
  const partDecision=partDecisions.find(row=>row?.partId===partId);
  const answerStatus=String(finalPart?.answerStatus||partDecision?.outputAnswerStatus||'');
  let continuity='unavailable';
  if(composerSourceIds.length||composerEvidenceIds.length){
   continuity=finalCitationIds.length?'source-evidence-retained':
    reviewStage?.failureCode==='inference-deadline-exceeded'?'review-timed-out':
    partialClaimIds.length||partDecision?.outputStatus==='partial'?'review-left-source-evidence-partial':
    'composer-evidence-not-retained';
  }else if(answerStatus==='answered')continuity='general-context-answer';
  else if(!selectedSourceIds.length)continuity='no-selected-evidence';
  return {partId,question:String(part?.question||''),
   selectorCandidateIds:selectedCandidateIds,selectedSourceIds,composerSourceIds,composerEvidenceIds,
   reviewedClaimCount:reviewedClaimIds.length,acceptedClaimCount:acceptedClaimIds.length,
   partialClaimCount:partialClaimIds.length,finalCitationIds,answerStatus,continuity};
 });
 const payloadMetrics=reviewStage?.payloadMetrics;
 const reviewWorkload=reviewStage?{elapsedMs:Number.isFinite(reviewStage.elapsedMs)?reviewStage.elapsedMs:null,
  status:String(reviewStage.status||'completed'),failureCode:String(reviewStage.failureCode||''),
  ...(payloadMetrics?{payloadMetrics:{partCount:Number(payloadMetrics.partCount)||0,
   claimCount:Number(payloadMetrics.claimCount)||0,sourceCount:Number(payloadMetrics.sourceCount)||0,
   spanCount:Number(payloadMetrics.spanCount)||0,spanReferenceCount:Number(payloadMetrics.spanReferenceCount)||0,
   serializedCharacters:Number(payloadMetrics.serializedCharacters)||0}}:{})}:null;
 return {status:parts.some(part=>part.continuity==='unavailable')?'partial':'available',parts,reviewWorkload};
}
export function summarizeEvidenceContinuity(cases){
 const audits=(cases||[]).map(item=>item?.evidenceContinuityAudit).filter(audit=>audit?.status==='available');
 const parts=audits.flatMap(audit=>audit.parts||[]);
 const statusCounts={};
 for(const part of parts)statusCounts[part.continuity]=(statusCounts[part.continuity]||0)+1;
 const workloads=audits.map(audit=>audit.reviewWorkload).filter(Boolean);
 const withMetrics=workloads.filter(item=>item.payloadMetrics);
 const avg=key=>withMetrics.length?Math.round(withMetrics.reduce((sum,item)=>sum+item.payloadMetrics[key],0)/withMetrics.length):null;
 return {caseCount:audits.length,partCount:parts.length,continuityStatusCounts:statusCounts,
  reviewWorkload:{measuredCases:withMetrics.length,
   timeoutCases:workloads.filter(item=>item.failureCode==='inference-deadline-exceeded').length,
   averageClaimCount:avg('claimCount'),averageSourceCount:avg('sourceCount'),
   averageSpanCount:avg('spanCount'),averageSpanReferenceCount:avg('spanReferenceCount'),
   averageSerializedCharacters:avg('serializedCharacters')}};
}
export function auditHighlightClaimCoverage(evidenceMap,evidenceHighlights,inlineIds){
 const inline=new Set(Array.isArray(inlineIds)?inlineIds.map(String):[]);
 const citedSourcesByClaim=new Map();
 for(const entry of Array.isArray(evidenceMap)?evidenceMap:[]){
  const claimId=String(entry?.claimId||'');
  const sourceId=String(entry?.id||'');
  if(!claimId||!sourceId||!inline.has(sourceId))continue;
  if(!citedSourcesByClaim.has(claimId))citedSourcesByClaim.set(claimId,new Set());
  citedSourcesByClaim.get(claimId).add(sourceId);
 }
 const citedClaimIds=new Set(citedSourcesByClaim.keys());
 const linkedClaimIds=new Set();
 for(const item of Array.isArray(evidenceHighlights)?evidenceHighlights:[]){
  const sourceId=String(item?.sourceId||item?.source_id||'');
  if(!sourceId)continue;
  const quotes=Array.isArray(item?.quotes)&&item.quotes.length?item.quotes:[item];
  for(const quote of quotes){
   const located=typeof quote?.quoteLocated==='boolean'?
    quote.quoteLocated:item?.quoteLocated===true;
   if(!located)continue;
   const claimIds=[quote?.claimId,quote?.claim_id,
    ...(Array.isArray(quote?.claimIds)?quote.claimIds:[]),
    ...(Array.isArray(quote?.claim_ids)?quote.claim_ids:[])].map(String).filter(Boolean);
   for(const claimId of claimIds){
    if(citedClaimIds.has(claimId)&&citedSourcesByClaim.get(claimId)?.has(sourceId))
     linkedClaimIds.add(claimId);
   }
  }
 }
 const unlinkedClaimIds=[...citedClaimIds].filter(claimId=>!linkedClaimIds.has(claimId));
 const citedClaimCount=citedClaimIds.size;
 const linkedClaimCount=linkedClaimIds.size;
 return {method:'located-highlight-claim-source-intersection',citedClaimCount,linkedClaimCount,
  ratio:citedClaimCount?Number((linkedClaimCount/citedClaimCount).toFixed(4)):null,
  unlinkedClaimIds};
}
export function auditLiveAnswer(data,submitted,requiredGroups,requiredPartSources=[],options={}){
 const citations=Array.isArray(data?.citations)?data.citations:[];
 const workerVersionId=typeof data?.workerVersionId==='string'&&data.workerVersionId.length<=128?data.workerVersionId:null;
 const workerSourceBuild=typeof data?.workerSourceBuild==='string'&&data.workerSourceBuild.length<=128?data.workerSourceBuild:null;
 const workerSourceRevision=typeof data?.workerSourceRevision==='string'&&/^[a-f0-9]{40}$/i.test(data.workerSourceRevision)?data.workerSourceRevision.toLowerCase():null;
 const answer=String(data?.answer||'');
 const coverage=String(data?.coverage||'');
 const answerCompleteness=['full','partial','none'].includes(data?.answerCompleteness)?
  data.answerCompleteness:'unknown';
 const citationIds=new Set(citations.map(source=>String(source?.id||'')));
 const citationAudit=auditCitationIds(answer,citations);
 const inline=citationAudit.inlineIds;
 const missingInline=citationAudit.inlineIdsWithoutSource;
 const outcome=String(data?.outcome||'');
 const reviewStatus=String(data?.reviewStatus||'');
 // The gateway reports whether its depth-repair pass fired for this answer
 // (batch 9, B9-1c). Carry a normalized copy into the case record so a
 // validation run can measure the firing rate; older gateways omit it.
 const depthRepair=data?.depthRepair&&typeof data.depthRepair==='object'?
  {triggered:data.depthRepair.triggered===true,
   reasons:Array.isArray(data.depthRepair.reasons)?
    data.depthRepair.reasons.map(reason=>String(reason)):[],
   applied:data.depthRepair.applied===true}:null;
 const selectionHandoffAudit=auditSelectionHandoff(data?.trace||data?.evidenceTrace);
 const evidenceContinuityAudit=auditEvidenceContinuity(data?.trace||data?.evidenceTrace);
 // A reviewed source-free answer is structurally valid only when the Worker
 // explicitly classifies it as general context and the case asks for no
 // library source groups. This keeps evidence-free answers distinct from
 // missing or failed source review.
 const generalContextOnly=outcome==='general-context-answer'&&
  reviewStatus==='general-context-review'&&
  (answerCompleteness==='full'||(answerCompleteness==='unknown'&&coverage==='full'))&&
  citations.length===0&&inline.length===0&&missingInline.length===0&&
  requiredGroups.length===0&&requiredPartSources.length===0;
 const citationBookIds=[...new Set(citations.map(source=>String(source?.bookId||'')))];
 const submittedBookIds=[...new Set(submitted.map(source=>String(source?.bookId||'')))];
 const candidateSources=Array.isArray(options.candidateSources)?options.candidateSources:null;
 const candidateBookIds=candidateSources?
  [...new Set(candidateSources.map(source=>String(source?.bookId||'')).filter(Boolean))]:null;
 const questionParts=Array.isArray(data?.questionParts)?data.questionParts:[];
 const evidenceMap=Array.isArray(data?.evidenceMap)?data.evidenceMap:[];
 // The answer endpoint accepts locators in order and the Worker assigns the
 // trusted IDs S1, S2, ... in that same order. The local report's submitted
 // source summaries intentionally omit those temporary IDs, so reconstruct
 // the exact positional mapping here.
 const submittedIds=new Set(submitted.map((_source,index)=>'S'+(index+1)));
 const mappedEvidenceIds=new Set(evidenceMap.map(item=>String(item?.id||'')));
 const partEvidenceAudit=questionParts.map(part=>{
  const evidenceIds=[...new Set(Array.isArray(part?.evidenceIds)?part.evidenceIds.map(String):[])];
  const sourceRequired=part?.sourceRequired===true;
  const shipped=part?.answerStatus!=='unanswered'&&part?.status!=='unsupported';
  const sourceRequiredUncited=sourceRequired&&shipped&&evidenceIds.length===0;
  const mappedEvidenceIdsForPart=evidenceIds.filter(id=>mappedEvidenceIds.has(id));
  const citedEvidenceIds=evidenceIds.filter(id=>citationIds.has(id));
  const submittedEvidenceIds=evidenceIds.filter(id=>submittedIds.has(id));
  const structurallyComplete=part?.status==='unsupported'?null:
   sourceRequiredUncited?false:
   evidenceIds.length===0?null:
   evidenceIds.length>0&&mappedEvidenceIdsForPart.length===evidenceIds.length&&
   citedEvidenceIds.length===evidenceIds.length&&submittedEvidenceIds.length===evidenceIds.length;
  return {part:String(part?.part||''),partId:String(part?.partId||''),sourceRequired,
   sourceRequiredUncited,status:String(part?.status||''),
   answerStatus:String(part?.answerStatus||''),evidenceIds,
   evidenceApplicability:sourceRequired||evidenceIds.length>0?'required':'not-applicable',
   mappedEvidenceIds:mappedEvidenceIdsForPart,citedEvidenceIds,submittedEvidenceIds,structurallyComplete};
 });
 const completeSupportedEvidenceIds=new Set(partEvidenceAudit
  .filter(part=>part.status==='supported'&&part.structurallyComplete===true)
  .flatMap(part=>part.citedEvidenceIds));
 const completePartialEvidenceIds=new Set(partEvidenceAudit
  .filter(part=>part.status==='partial'&&part.structurallyComplete===true)
  .flatMap(part=>part.citedEvidenceIds));
 const sourceGroups=requiredGroups.map(group=>{
  const expectedBookIds=group.book_ids.map(String);
  const candidateGroupBookIds=candidateBookIds?
   candidateBookIds.filter(id=>expectedBookIds.includes(id)):null;
  const selectedBookIds=submittedBookIds.filter(id=>expectedBookIds.includes(id));
  const citedBookIds=citationBookIds.filter(id=>expectedBookIds.includes(id));
  const selectedForComposition=submitted.some(source=>expectedBookIds.includes(String(source?.bookId||'')));
  const cited=citations.some(source=>expectedBookIds.includes(String(source?.bookId||'')));
  const supportedPartLabels=questionParts.filter(part=>part?.status==='supported'&&
   (Array.isArray(part?.evidenceIds)?part.evidenceIds:[]).some(id=>citations.some(source=>
    String(source?.id||'')===String(id)&&completeSupportedEvidenceIds.has(String(id))&&
     expectedBookIds.includes(String(source?.bookId||''))))
  ).map(part=>String(part?.part||''));
  const partialPartLabels=questionParts.filter(part=>part?.status==='partial'&&
   (Array.isArray(part?.evidenceIds)?part.evidenceIds:[]).some(id=>citations.some(source=>
    String(source?.id||'')===String(id)&&completePartialEvidenceIds.has(String(id))&&
     expectedBookIds.includes(String(source?.bookId||''))))
  ).map(part=>String(part?.part||''));
  return {label:group.label,expectedBookIds,
   candidateBookIds:candidateGroupBookIds,candidateFound:candidateGroupBookIds===null?null:candidateGroupBookIds.length>0,
   selectedBookIds,selectedForComposition,
   // Keep these established field names for existing reports and scripts;
   // new consumers should use candidateFound and selectedForComposition.
   retrievedBookIds:selectedBookIds,retrieved:selectedForComposition,
   citedBookIds,foundBookIds:citedBookIds,cited,found:cited,supportedPartLabels,partialPartLabels,
   linkedToSupportedEvidence:questionParts.length?supportedPartLabels.length>0:null,
   linkedToPartialEvidence:questionParts.length?partialPartLabels.length>0:null};
 });
 const highlights=Array.isArray(data?.evidenceHighlights)?data.evidenceHighlights:[];
 const citationSources=citations.map(source=>({id:String(source?.id||''),bookId:String(source?.bookId||''),
  title:String(source?.title||''),page:Number.isSafeInteger(source?.page)?source.page:null,
  globalPageId:Number.isSafeInteger(source?.globalPageId)?source.globalPageId:null,
  url:typeof source?.url==='string'?source.url:'',
  ...(reportProvenance(source?.provenance)?{provenance:reportProvenance(source.provenance)}:{})}));
 const questionPartCoverage={total:questionParts.length,
  supported:questionParts.filter(item=>item?.status==='supported').length,
  partial:questionParts.filter(item=>item?.status==='partial').length,
  unsupported:questionParts.filter(item=>item?.status==='unsupported').length};
 const questionPartAnswerCompleteness={total:questionParts.length,
  answered:questionParts.filter(item=>item?.answerStatus==='answered').length,
  partial:questionParts.filter(item=>item?.answerStatus==='partial').length,
  unanswered:questionParts.filter(item=>item?.answerStatus==='unanswered').length,
  unknown:questionParts.filter(item=>!['answered','partial','unanswered'].includes(item?.answerStatus)).length};
 const evaluationScope=options.scope==='all-books'?'all-books':
  options.scope==='selected-books'?'selected-books':'';
 const plannerParts=Array.isArray(options.plannerPlan?.parts)?options.plannerPlan.parts:[];
 const sourcePartAlignment=(requiredPartSources||[]).map(expected=>{
  const needle=normalizeDiagnosticExcerpt(expected.partIncludes);
  const part=questionParts.find(item=>normalizeDiagnosticExcerpt(item?.part).includes(needle));
  const allowedBookIds=expected.book_ids.map(String);
  if(!part)return {partIncludes:expected.partIncludes,allowedBookIds,aligned:false,reason:'expected-part-not-found'};
  const plannerPart=plannerParts.find(item=>
   normalizeDiagnosticExcerpt(item?.question).includes(normalizeDiagnosticExcerpt(part.part))||
   normalizeDiagnosticExcerpt(part.part).includes(normalizeDiagnosticExcerpt(item?.question)));
  const plannerBookIds=Array.isArray(plannerPart?.sourceBookIds)?
   [...new Set(plannerPart.sourceBookIds.map(String))]:[];
  const eligibilityKnown=evaluationScope==='all-books'&&plannerBookIds.length>0;
  const eligibleBookIds=eligibilityKnown?plannerBookIds:allowedBookIds;
  const evidenceIds=Array.isArray(part.evidenceIds)?part.evidenceIds.map(String):[];
  const linkedBooks=[...new Set(citations.filter(source=>evidenceIds.includes(String(source?.id||'')))
   .map(source=>String(source?.bookId||'')))];
  const misalignedBookIds=linkedBooks.filter(id=>!eligibleBookIds.includes(id));
  const additionalEligibleBookIds=eligibilityKnown?
   linkedBooks.filter(id=>!allowedBookIds.includes(id)&&eligibleBookIds.includes(id)):[];
  const hasExpectedBook=linkedBooks.some(id=>allowedBookIds.includes(id));
  const aligned=misalignedBookIds.length===0&&
   (part.status==='unsupported'||hasExpectedBook);
  return {partIncludes:expected.partIncludes,part:String(part.part||''),status:String(part.status||''),
   scope:evaluationScope||'unspecified',allowedBookIds,eligibleBookIds,eligibilityKnown,
   linkedBookIds:linkedBooks,additionalEligibleBookIds,misalignedBookIds,aligned,
   reason:aligned?'':'evidence-does-not-match-expected-part-source'};
 });
 const evidenceHighlights=highlights.map(item=>{
  // Record every claim-linked quote the gateway returned. The cap is a
  // recording bound, not a linkage limit: it sits well above the gateway's
  // per-source claim cap so no claim ranked past the first few on its source
  // is dropped from the report (the old 3-quote truncation understated
  // claim-level highlight linkage).
  const quotes=(Array.isArray(item?.quotes)?item.quotes:[]).slice(0,12).map(quote=>({
   claimId:String(quote?.claim_id||''),partId:String(quote?.part_id||''),
   point:typeof quote?.point==='string'?quote.point:'',
   quote:typeof quote?.quote==='string'?quote.quote:'',
   quoteLocated:typeof quote?.quoteLocated==='boolean'?quote.quoteLocated:
    locateHighlightInSubmittedPage({...item,quote:quote?.quote},citations,submitted),
   partialMatch:quote?.partialMatch===true,
   // Batch 10 (B10-5): keep the gateway's display-box keying in the record
   // so passage dedupe is measurable from evaluation reports (batch 9
   // shipped the fields but the recorder dropped them here).
   box:Number.isSafeInteger(quote?.box)?quote.box:null,
   claimIds:Array.isArray(quote?.claim_ids)?quote.claim_ids.map(String):[]
  }));
  const nestedLocated=quotes.some(quote=>quote.quoteLocated===true)?true:
   quotes.some(quote=>typeof quote.quoteLocated==='boolean')?false:null;
  const quoteLocated=typeof item?.quoteLocated==='boolean'?item.quoteLocated:
   (quotes.length?nestedLocated:locateHighlightInSubmittedPage(item,citations,submitted));
  return {sourceId:String(item?.source_id||item?.sourceId||''),
   title:String(item?.title||''),page:Number.isSafeInteger(item?.page)?item.page:null,
   quote:typeof item?.quote==='string'?item.quote:'',
   claimId:String(item?.claim_id||''),point:typeof item?.point==='string'?item.point:'',
   quoteLocated,quotes};
 });
 const highlightedSourceIds=new Set(evidenceHighlights.filter(item=>item.quoteLocated===true)
  .map(item=>item.sourceId));
 const citedSourceIds=[...new Set(inline)].filter(id=>citationIds.has(id));
 const citationHighlightAudit={citedSourceCount:citedSourceIds.length,
  highlightedSourceCount:citedSourceIds.filter(id=>highlightedSourceIds.has(id)).length,
  citedSourcesWithoutLocatedHighlight:citedSourceIds.filter(id=>!highlightedSourceIds.has(id))};
 const locatedHighlightPartIds=new Set(evidenceHighlights.flatMap(item=>item.quotes)
  .filter(item=>item.quoteLocated===true&&/^P[1-4]$/.test(item.partId))
  .map(item=>item.partId));
 const highlightPartCoverage={total:questionParts.length,
  withLocatedHighlight:questionParts.filter((_part,index)=>locatedHighlightPartIds.has('P'+(index+1))).length,
  withoutLocatedHighlight:questionParts.map((part,index)=>({part:String(part?.part||''),partId:'P'+(index+1)}))
   .filter(item=>!locatedHighlightPartIds.has(item.partId))};
 const highlightClaimCoverage=auditHighlightClaimCoverage(evidenceMap,evidenceHighlights,inline);
 const highlightRelevance=highlightRelevanceAudit(answer,citations,evidenceHighlights);
 const evidencePartsConsistent=questionParts.length===0?null:
  coverage==='full'?questionParts.every(part=>part?.status==='supported'):
   coverage==='partial'?questionParts.some(part=>part?.status!=='supported'):
    coverage==='none'?questionParts.every(part=>part?.status==='unsupported'):false;
 const answerPartsConsistent=questionParts.length===0||answerCompleteness==='unknown'?null:
  answerCompleteness==='full'?questionParts.every(part=>part?.answerStatus==='answered'):
   answerCompleteness==='partial'?questionParts.some(part=>
    ['partial','unanswered'].includes(part?.answerStatus)):
    answerCompleteness==='none'?questionParts.every(part=>part?.answerStatus==='unanswered'):false;
 const partStatusesConsistent=questionParts.length===0?null:
  generalContextOnly?answerPartsConsistent!==false:
  evidencePartsConsistent;
 const proseContradictions=questionParts.filter(part=>answerDeniesSupportedComparison(part,answer))
  .map(part=>String(part?.part||''));
 const answerCoverageConsistent=questionParts.length===0?null:
  partStatusesConsistent===null?null:partStatusesConsistent&&!proseContradictions.length;
 const answerCompletenessConsistent=questionParts.length===0||answerPartsConsistent===null?null:
  answerPartsConsistent;
 const partEvidenceComplete=questionParts.length===0?null:
  partEvidenceAudit.every(part=>part.structurallyComplete!==false);
 const reviewerLabels=summarizeCaseReviewerLabels(data);
 const evidenceAuditScope='Evidence IDs are checked for consistent linkage across question parts, the reviewed evidence map, cited sources, and submitted pages. This is a structural check, not a semantic judge of whether a passage truly supports a claim; review the answer and source text.';
 const failureCode=typeof data?.failureCode==='string'?data.failureCode:'';
 const failureStage=typeof data?.failureStage==='string'?data.failureStage:'';
 const answerInternalIdLeaks=[...new Set(answer.match(/\bP\d+-(?:C|R)\d+\b/giu)||[])];
 const noAnswerFailure=(!answer.trim()&&Boolean(failureCode||data?.requestFailure||
  outcome==='request-failed'||reviewStatus==='pipeline-failed'))||
  ['generation-failed','request-failed','shared-selection-failed'].includes(String(outcome||''));
 const manualReview={status:'not-reviewed',scale:{min:0,max:2},scores:{
  accuracy:null,questionCoverage:null,explanationQuality:null,citationSupport:null,citationCompleteness:null},notes:''};
 // Keep evidence-excerpt quality independent from answer prose quality.
 // Highlights use their own rubric dimensions and are scored from the excerpts
 // and claim links rather than from the generated answer.
 const highlightHumanReview={status:'not-reviewed',scale:{min:0,max:2},scores:{
  fidelity:null,coverage:null,context:null,claimRelevance:null,completeness:null},notes:''};
 const completenessContractSatisfied=answerCompleteness==='full'||
  (answerCompleteness==='unknown'&&coverage==='full');
 const structuralPassed=(completenessContractSatisfied||generalContextOnly)&&sourceGroups.every(group=>group.found&&group.linkedToSupportedEvidence!==false)&&
  missingInline.length===0&&(citations.length>0||generalContextOnly)&&answerCoverageConsistent!==false&&partEvidenceComplete!==false&&
  sourcePartAlignment.every(item=>item.aligned)&&reviewerLabels.contractStatus!=='incomplete'&&
  !failureCode&&!answerInternalIdLeaks.length&&reviewStatus!=='pipeline-failed'&&
  reviewStatus!=='review-contract-incomplete'&&
  reviewStatus!=='generation-format-failed'&&reviewStatus!=='review-format-failed'&&
  selectionHandoffAudit.status!=='mismatch'&&!noAnswerFailure;
 return {workerVersionId,workerSourceBuild,workerSourceRevision,outcome,coverage,answerCompleteness,reviewStatus,
  // The Worker currently returns this reader-facing disclosure as a string.
  // Preserve that field in each evaluation record so uncited packet-linked
  // parts can be checked against the actual wording shown to readers.
  missing:typeof data?.missing==='string'?data.missing:'',
  reviewerLabels,failureCode,failureStage,noAnswerFailure,
  answerText:answer,answerInternalIdLeaks,internalIdLeakCount:answerInternalIdLeaks.length,
  citationCount:citations.length,citationBookIds,citationSources,inlineCitationCount:inline.length,
  inlineIds:inline,
  inlineIdsWithoutSource:missingInline,submittedSourceCount:submitted.length,
  sourceGroups,questionParts,questionPartCoverage,questionPartAnswerCompleteness,partEvidenceAudit,partEvidenceComplete,
  selectionHandoffAudit,evidenceContinuityAudit,
  evidenceApplicability:generalContextOnly?'not-applicable':'required',
  sourcePartAlignment,
  answerCoverageConsistent,evidenceCoverageConsistent:answerCoverageConsistent,
  answerCompletenessConsistent,coverageContradictions:proseContradictions,evidenceMap,evidenceAuditScope,
  evidenceHighlightCount:highlights.length,evidenceHighlights,citationHighlightAudit,highlightPartCoverage,
  highlightClaimCoverage,
  depthRepair,
  highlightRelevance,
  manualReview,highlightHumanReview,structuralPassed,
  answerQualityStatus:'pending-human-review',answerQualityPass:null,
  passed:reviewStatus==='answer-draft-unverified'?null:structuralPassed};
}
// Display-only: name WHICH structural conditions failed, derived from
// the same result fields auditLiveAnswer's structuralPassed conjunction
// consumed. The per-case console line used to print STRUCTURAL-MISS with
// only the outcome, leaving a watcher no way to tell a missing citation
// from a dropped part. Returns [] unless the case actually missed.
export function structuralFailureReasons(result){
 if(!result||result.passed!==false||result.requestFailure)return [];
 const reasons=[];
 const generalContextOnly=result.evidenceApplicability==='not-applicable';
 const completenessContractSatisfied=result.answerCompleteness==='full'||
  (result.answerCompleteness==='unknown'&&result.coverage==='full');
 if(!completenessContractSatisfied&&!generalContextOnly)reasons.push('completeness-contract');
 const sourceGroups=Array.isArray(result.sourceGroups)?result.sourceGroups:[];
 if(sourceGroups.some(group=>!group.found))reasons.push('source-group-not-found');
 if(sourceGroups.some(group=>group.linkedToSupportedEvidence===false))reasons.push('source-group-not-linked');
 if((result.inlineIdsWithoutSource||[]).length)reasons.push('missing-inline-citation');
 if(!(Number(result.citationCount)>0)&&!generalContextOnly)reasons.push('no-citations');
 if(result.answerCoverageConsistent===false)reasons.push('coverage-inconsistent');
 if(result.partEvidenceComplete===false)reasons.push('part-evidence-incomplete');
 if((result.sourcePartAlignment||[]).some(item=>!item.aligned))reasons.push('source-part-misaligned');
 if(result.reviewerLabels?.contractStatus==='incomplete'||
  result.reviewStatus==='review-contract-incomplete')reasons.push('review-contract-incomplete');
 if(result.failureCode)reasons.push('failure-code');
 if((result.answerInternalIdLeaks||[]).length||Number(result.internalIdLeakCount)>0)
  reasons.push('internal-id-leak');
 if(result.reviewStatus==='pipeline-failed')reasons.push('pipeline-failed');
 if(result.reviewStatus==='generation-format-failed'||result.reviewStatus==='review-format-failed')
  reasons.push('review-format-failed');
 if(result.selectionHandoffAudit?.status==='mismatch')reasons.push('selection-handoff-mismatch');
 if(result.noAnswerFailure===true)reasons.push('no-answer');
 return reasons;
}
// Display-only: one-line summary of the batch-33/34 trace machinery that
// fired for a case, so a watcher sees labels shipped, antecedent-guard
// actions, assembly loss, selection diversity, and timeouts live instead
// of only in the artifact. Drawn from production trace shapes: guard and
// loss entries are arrays on the trace, labels ride trace.final, and
// B34-4's selection records ride the selection stage entry in
// trace.stages. assemblyDisclosureDropped must always be empty; a
// non-empty value is flagged loudly.
export function traceSummaryParts(evidenceTrace,result){
 const trace=evidenceTrace||result?.evidenceTrace||result?.trace||{};
 const parts=[];
 const guard=trace.assemblyAntecedentGuard;
 if(guard){
  const counts=[['restored',guard.restored],['rewritten',guard.rewritten],['removed',guard.removed]]
   .map(([name,entries])=>[name,Array.isArray(entries)?entries.length:0])
   .filter(([,count])=>count>0);
  if(counts.length)parts.push('antecedent-guard: '+counts.map(([name,count])=>name+' '+count).join(', '));
 }
 const final=trace.final||{};
 if(Array.isArray(final.absentPartLabelsInAnswer)&&final.absentPartLabelsInAnswer.length)
  parts.push('absent-part-labels: '+final.absentPartLabelsInAnswer.join(', '));
 if(Array.isArray(final.uncitedPartLabelsInAnswer)&&final.uncitedPartLabelsInAnswer.length)
  parts.push('uncited-part-labels: '+final.uncitedPartLabelsInAnswer.join(', '));
 if(Array.isArray(final.claimLevelUncitedLabels)&&final.claimLevelUncitedLabels.length)
  parts.push('claim-level-uncited-labels: '+final.claimLevelUncitedLabels
   .flatMap(entry=>Array.isArray(entry?.claimIds)&&entry.claimIds.length?entry.claimIds:
    [entry?.partId].filter(Boolean)).join(', '));
 const dropped=trace.assemblyDisclosureDropped;
 if(Array.isArray(dropped)&&dropped.length)
  parts.push('DISCLOSURE-DROPPED: '+dropped.length+' (must always be empty)');
 const loss=Array.isArray(trace.assemblyLoss)?trace.assemblyLoss:[];
 if(loss.length){
  const byReason=new Map();
  for(const entry of loss){
   const reason=String(entry?.reason||'unknown');
   byReason.set(reason,(byReason.get(reason)||0)+1);
  }
  parts.push('assembly-loss: '+loss.length+' ('+
   [...byReason].map(([reason,count])=>reason+' '+count).join(', ')+')');
  const unexplained=byReason.get('unexplained')||0;
  if(unexplained)parts.push('UNEXPLAINED-LOSS: '+unexplained);
 }
 const timeouts=new Map();
 for(const call of Array.isArray(trace.inferenceCalls)?trace.inferenceCalls:[]){
  if(!call?.timeoutFired)continue;
  const stage=String(call.stage||'unknown');
  timeouts.set(stage,(timeouts.get(stage)||0)+1);
 }
 if(timeouts.size)parts.push('timeouts: '+[...timeouts].map(([stage,count])=>stage+' '+count).join(', '));
 const containment=trace.sourceRequiredContainment;
 if(containment?.disposition&&containment.disposition!=='all-shipped-source-parts-cited'){
  const uncited=Array.isArray(containment.uncitedPartIds)&&containment.uncitedPartIds.length?
   ' (uncited: '+containment.uncitedPartIds.join(', ')+')':'';
  parts.push('containment: '+containment.disposition+uncited);
 }
 let inserted=0,deferred=0;const droppedFacets=[];
 for(const stage of Array.isArray(trace.stages)?trace.stages:[]){
  const diversity=stage?.selectionDiversity;
  if(diversity){
   inserted+=Array.isArray(diversity.inserted)?diversity.inserted.length:0;
   deferred+=Array.isArray(diversity.deferred)?diversity.deferred.length:0;
  }
  if(Array.isArray(stage?.selectionDroppedFacets))
   for(const facet of stage.selectionDroppedFacets)droppedFacets.push(facet);
 }
 if(inserted||deferred)parts.push('selection-diversity: inserted '+inserted+', deferred '+deferred);
 if(droppedFacets.length)
  parts.push('dropped-facets: '+droppedFacets.map(facet=>String(facet?.partId||'?')).join(', '));
 return parts;
}
// Batch 35 (B35-4): the production-firing ledger, harness side. Three
// batch items in a row (B33-9, B34-2's claim-level test, B34-7) passed
// fixture pilots and then never fired in production, discovered only by
// scorers reading artifacts by hand. This registry names the trace
// records that prove a mechanism fired; the end-of-run census below
// counts them per pass file and flags any field that fired in zero
// cases as NEVER FIRED, so an inert mechanism announces itself in the
// run log and in the artifact (report.firingCensus) instead of hiding.
// Seeded from the batch-34 artifact key census (32 phase-2 cases) and,
// for the region record, the Worker source: B34-7's checks ride
// reviewContract.apparatusFramingChecks, spread into the trace only
// when non-empty — which is precisely why no batch-34 artifact ever
// showed the key. The Worker registers its own field list on its side;
// this list is the harness-side consumer and is finalized against it at
// integration. "Fired" means the record is present AND non-empty in the
// sense noted per field; assemblyDisclosureDropped is an alarm field —
// it must always be empty, so its "fired" count is the number of cases
// where a disclosure was actually dropped, and its silence is correct.
const nonEmptyArray=value=>Array.isArray(value)&&value.length>0;
const arrayLength=value=>Array.isArray(value)?value.length:0;
export const FIRING_FIELDS=[
 {field:'evidenceTrace.assemblyAntecedentGuard',
  fired:trace=>{const guard=trace.assemblyAntecedentGuard;
   return Boolean(guard)&&['restored','rewritten','removed'].some(key=>nonEmptyArray(guard[key]));}},
 {field:'evidenceTrace.final.claimLevelUncitedLabels',
  fired:trace=>nonEmptyArray(trace.final?.claimLevelUncitedLabels)},
 {field:'evidenceTrace.assemblyDisclosureDropped',alarm:true,
  fired:trace=>nonEmptyArray(trace.assemblyDisclosureDropped)},
 {field:'evidenceTrace.stages[].selectionDiversity',
  fired:trace=>(Array.isArray(trace.stages)?trace.stages:[]).some(stage=>{
   const diversity=stage?.selectionDiversity;
   return Boolean(diversity)&&(arrayLength(diversity.inserted)+arrayLength(diversity.deferred))>0;})},
 {field:'evidenceTrace.stages[].selectionDroppedFacets',
  fired:trace=>(Array.isArray(trace.stages)?trace.stages:[]).some(stage=>
   nonEmptyArray(stage?.selectionDroppedFacets))},
 {field:'evidenceTrace.assemblyLoss',
  fired:trace=>nonEmptyArray(trace.assemblyLoss)},
 {field:'evidenceTrace.reviewContract.boundarySubjectChecks',
  fired:trace=>nonEmptyArray(trace.reviewContract?.boundarySubjectChecks)},
 {field:'evidenceTrace.reviewContract.apparatusFramingChecks',
  fired:trace=>nonEmptyArray(trace.reviewContract?.apparatusFramingChecks)},
 {field:'evidenceTrace.vetoCensus',
  fired:trace=>nonEmptyArray(trace.vetoCensus)||
   nonEmptyArray(trace.reviewContract?.vetoCensus)},
 // Batch 35 (integration): the Worker side's BATCH35_FIRING_FIELDS
 // registry, consumed here so a batch-35 mechanism that never fires
 // in production flags NEVER FIRED in the run's own census.
 {field:'evidenceTrace.reviewContract.spanRegionClassifications',
  fired:trace=>nonEmptyArray(trace.reviewContract?.spanRegionClassifications)},
 {field:'evidenceTrace.reviewContract.gateDemotionsSuppressed',
  fired:trace=>nonEmptyArray(trace.reviewContract?.gateDemotionsSuppressed)},
 {field:'evidenceTrace.final.unansweredRequirementLabels',
  fired:trace=>nonEmptyArray(trace.final?.unansweredRequirementLabels)},
 {field:'evidenceTrace.synthesisProvenanceDropped',
  fired:trace=>nonEmptyArray(trace.synthesisProvenanceDropped)},
 {field:'selectionTrace.diversityFinal',
  fired:(trace,item)=>Boolean(item?.selectionTrace?.diversityFinal)||
   Boolean(trace.selectionTrace?.diversityFinal)}
];
export function firingCensusForCases(cases){
 const rows=Array.isArray(cases)?cases:[];
 const fields={};
 for(const entry of FIRING_FIELDS){
  const count=rows.filter(item=>entry.fired(item?.evidenceTrace||item?.trace||{},item)).length;
  fields[entry.field]={cases:count,neverFired:count===0,
   ...(entry.alarm?{alarm:true}:{})};
 }
 return {totalCases:rows.length,fields};
}
export function firingCensusLines(census){
 const total=Number(census?.totalCases)||0;
 const lines=['FIRING CENSUS ('+total+' cases):'];
 for(const entry of FIRING_FIELDS){
  const record=census?.fields?.[entry.field]||{cases:0,neverFired:true};
  let line=' '+entry.field+': fired in '+record.cases+'/'+total+' cases';
  if(record.neverFired)line+=' — NEVER FIRED'+
   (entry.alarm?' (alarm field: silence is the correct state)':'');
  lines.push(line);
 }
 return lines;
}
const MANUAL_REVIEW_DIMENSIONS=['accuracy','questionCoverage','explanationQuality','citationSupport','citationCompleteness'];
const HIGHLIGHT_REVIEW_DIMENSIONS=['fidelity','coverage','context','claimRelevance','completeness'];
const NON_PRODUCED_OUTCOMES=new Set(['generation-failed','request-failed','shared-selection-failed']);
function isNonProducedRecord(item){
 return item?.noAnswerFailure===true||NON_PRODUCED_OUTCOMES.has(String(item?.outcome||''));
}
export function hasProducedAnswer(item){
 return !isNonProducedRecord(item)&&
  Boolean(String(item?.answerText||'').trim());
}
export function summarizeBatch22Metrics(cases){
 const rows=Array.isArray(cases)?cases:[];
 const produced=rows.filter(hasProducedAnswer).length;
 const durations=rows.map(item=>Array.isArray(item?.stageTimings)?
  item.stageTimings.reduce((sum,timing)=>sum+
   (Number.isFinite(timing?.elapsedMs)&&timing.elapsedMs>=0?timing.elapsedMs:0),0):null)
  .filter(Number.isFinite).sort((a,b)=>a-b);
 const percentile=p=>durations.length?durations[Math.max(0,Math.ceil(durations.length*p)-1)]:null;
 const median=durations.length?(durations.length%2?
  durations[(durations.length-1)/2]:
  (durations[durations.length/2-1]+durations[durations.length/2])/2):null;
 const p90=percentile(.9);
 return {capture:{producedCases:produced,totalCases:rows.length,
   rate:rows.length?Number((produced/rows.length).toFixed(4)):null},
  stageSumLatencyMs:{sampleCount:durations.length,
   median:median===null?null:Number(median.toFixed(1)),
   p90:p90===null?null:Number(p90.toFixed(1)),
   goalMedianMs:BATCH22_ACCEPTANCE_THRESHOLDS.stageSumLatencyMedianMaximumMs,
   goalP90Ms:145000,
   goalStatus:{medianMet:median!==null&&median<=BATCH22_ACCEPTANCE_THRESHOLDS.stageSumLatencyMedianMaximumMs,
    p90Met:p90!==null&&p90<=145000}}};
}
export function summarizeManualReviews(cases){
 const entries=(cases||[]).flatMap(item=>Array.isArray((item?.answerVariantComparison||item?.reviewAblation)?.variants)?
  (item.answerVariantComparison||item.reviewAblation).variants.map(variant=>({id:item.id,attemptNumber:item.attemptNumber,
   answerVariant:variant.answerVariant,selectionVariant:variant.selectionVariant,review:variant.manualReview,
   noAnswerFailure:isNonProducedRecord(variant)||(item.noAnswerFailure===true&&
    !String(variant.answerText||'').trim())})):
  [{id:item.id,attemptNumber:item.attemptNumber,answerVariant:item.answerVariant||'with-review',
   review:item.manualReview,noAnswerFailure:isNonProducedRecord(item)}]);
 const completed=entries.filter(entry=>MANUAL_REVIEW_DIMENSIONS.every(key=>
  Number.isInteger(entry.review?.scores?.[key])&&entry.review.scores[key]>=0&&entry.review.scores[key]<=2));
 const averageScores=Object.fromEntries(MANUAL_REVIEW_DIMENSIONS.map(key=>[key,completed.length?
  Number((completed.reduce((sum,entry)=>sum+entry.review.scores[key],0)/completed.length).toFixed(2)):null]));
 const adjustedReady=entries.every(entry=>entry.noAnswerFailure||completed.includes(entry));
 const completionAdjustedAverageScores=Object.fromEntries(MANUAL_REVIEW_DIMENSIONS.map(key=>[key,
  entries.length&&adjustedReady?Number((entries.reduce((sum,entry)=>sum+
   (entry.noAnswerFailure?0:entry.review.scores[key]),0)/entries.length).toFixed(2)):null]));
 const scoreable=entries.filter(entry=>!entry.noAnswerFailure);
 const averageTotalScoreOutOf10=scoreable.length&&scoreable.every(entry=>completed.includes(entry))?
  Number((completed.reduce((sum,entry)=>sum+MANUAL_REVIEW_DIMENSIONS.reduce((total,key)=>
   total+entry.review.scores[key],0),0)/scoreable.length).toFixed(2)):null;
 const completionAdjustedTotalScoreOutOf10=adjustedReady&&entries.length?
  Number((entries.reduce((sum,entry)=>sum+(entry.noAnswerFailure?0:MANUAL_REVIEW_DIMENSIONS.reduce((total,key)=>
   total+entry.review.scores[key],0)),0)/entries.length).toFixed(2)):null;
 return {scale:{min:0,max:2},dimensions:MANUAL_REVIEW_DIMENSIONS,reviewed:completed.length,
  pending:scoreable.filter(entry=>!completed.includes(entry)).length,noAnswerFailures:entries.filter(entry=>entry.noAnswerFailure).length,
  averageTotalScoreOutOf10,completionAdjustedAverageScores,completionAdjustedTotalScoreOutOf10,
  completionAdjustedPending:adjustedReady?0:entries.filter(entry=>!entry.noAnswerFailure&&!completed.includes(entry)).length,
  entries:entries.map(entry=>({id:entry.id,
   ...(Number.isInteger(entry.attemptNumber)?{attemptNumber:entry.attemptNumber}:{}),
   answerVariant:entry.answerVariant,...(entry.selectionVariant?{selectionVariant:entry.selectionVariant}:{}),
   ...(entry.noAnswerFailure?{noAnswerFailure:true}:{}),status:entry.noAnswerFailure?'failed-zero':MANUAL_REVIEW_DIMENSIONS.every(key=>
    Number.isInteger(entry.review?.scores?.[key])&&entry.review.scores[key]>=0&&entry.review.scores[key]<=2)?'complete':'pending'})),
  averageScores,qualityPass:null,
  note:'Human scores are independent of automated structural pass/fail. No semantic score is inferred from model review.'};
}
export function summarizeHighlightReviews(cases){
 const entries=(cases||[]).flatMap(item=>Array.isArray((item?.answerVariantComparison||item?.reviewAblation)?.variants)?
  (item.answerVariantComparison||item.reviewAblation).variants.map(variant=>({id:item.id,
   attemptNumber:item.attemptNumber,answerVariant:variant.answerVariant,selectionVariant:variant.selectionVariant,
   review:variant.highlightHumanReview,noAnswerFailure:isNonProducedRecord(variant)||
    (item.noAnswerFailure===true&&!String(variant.answerText||'').trim())})):
  [{id:item.id,attemptNumber:item.attemptNumber,answerVariant:item.answerVariant||'with-review',
   selectionVariant:item.selectionVariant,review:item.highlightHumanReview,
   noAnswerFailure:isNonProducedRecord(item)}]);
 const complete=entry=>HIGHLIGHT_REVIEW_DIMENSIONS.every(key=>
  Number.isInteger(entry.review?.scores?.[key])&&entry.review.scores[key]>=0&&entry.review.scores[key]<=2);
 const reviewed=entries.filter(complete);
 const averageScores=Object.fromEntries(HIGHLIGHT_REVIEW_DIMENSIONS.map(key=>[key,reviewed.length?
  Number((reviewed.reduce((sum,entry)=>sum+entry.review.scores[key],0)/reviewed.length).toFixed(2)):null]));
 const adjustedReady=entries.every(entry=>entry.noAnswerFailure||complete(entry));
 const completionAdjustedAverageScores=Object.fromEntries(HIGHLIGHT_REVIEW_DIMENSIONS.map(key=>[key,
  entries.length&&adjustedReady?Number((entries.reduce((sum,entry)=>sum+
   (entry.noAnswerFailure?0:entry.review.scores[key]),0)/entries.length).toFixed(2)):null]));
 const scoreable=entries.filter(entry=>!entry.noAnswerFailure);
 const averageTotalScoreOutOf10=scoreable.length&&scoreable.every(entry=>reviewed.includes(entry))?
  Number((reviewed.reduce((sum,entry)=>sum+HIGHLIGHT_REVIEW_DIMENSIONS.reduce((total,key)=>
   total+entry.review.scores[key],0),0)/scoreable.length).toFixed(2)):null;
 const completionAdjustedTotalScoreOutOf10=adjustedReady&&entries.length?
  Number((entries.reduce((sum,entry)=>sum+(entry.noAnswerFailure?0:HIGHLIGHT_REVIEW_DIMENSIONS.reduce((total,key)=>
   total+entry.review.scores[key],0)),0)/entries.length).toFixed(2)):null;
 return {scale:{min:0,max:2},dimensions:HIGHLIGHT_REVIEW_DIMENSIONS,reviewed:reviewed.length,
  pending:scoreable.filter(entry=>!complete(entry)).length,noAnswerFailures:entries.filter(entry=>entry.noAnswerFailure).length,
  averageTotalScoreOutOf10,completionAdjustedAverageScores,completionAdjustedTotalScoreOutOf10,
  completionAdjustedPending:adjustedReady?0:entries.filter(entry=>!entry.noAnswerFailure&&!complete(entry)).length,
  entries:entries.map(entry=>({id:entry.id,
   ...(Number.isInteger(entry.attemptNumber)?{attemptNumber:entry.attemptNumber}:{}),
   answerVariant:entry.answerVariant,...(entry.selectionVariant?{selectionVariant:entry.selectionVariant}:{}),
   ...(entry.noAnswerFailure?{noAnswerFailure:true}:{}),status:entry.noAnswerFailure?'failed-zero':complete(entry)?'complete':'pending'})),averageScores,qualityPass:null,
  note:'Score the displayed excerpts and their claim links separately from answer prose. Exact location is not a semantic relevance score.'};
}
function normalizeHumanScore(review,kind){
 const label=kind==='answer'?'answer':'highlights';
 const dimensions=kind==='answer'?MANUAL_REVIEW_DIMENSIONS:HIGHLIGHT_REVIEW_DIMENSIONS;
 if(!review||typeof review!=='object'||Array.isArray(review)||
   !review.scores||typeof review.scores!=='object'||Array.isArray(review.scores))
  throw Error(label+' must contain a scores object.');
 const keys=Object.keys(review.scores);
 if(keys.length!==dimensions.length||keys.some(key=>!dimensions.includes(key))||
   dimensions.some(key=>!Number.isInteger(review.scores[key])||
    review.scores[key]<0||review.scores[key]>2))
  throw Error(label+' scores must include each dimension exactly once with an integer from 0 to 2.');
 if(review.notes!==undefined&&(typeof review.notes!=='string'||review.notes.length>2000))
  throw Error(label+' notes must be text of at most 2000 characters.');
 const scores=Object.fromEntries(dimensions.map(key=>[key,review.scores[key]]));
 return {status:'complete',scale:{min:0,max:2},scores,
  notes:review.notes||''};
}
function scorecardEvaluationIdentity(report){
 const run=report.evaluationRun||{};
 const revisions=[...(Array.isArray(report.workerSourceRevisions)?report.workerSourceRevisions:[])].sort();
 const cases=(Array.isArray(report.cases)?report.cases:[]).map(item=>({caseId:String(item.id||''),
  ...(Number.isInteger(item.attemptNumber)?{attemptNumber:item.attemptNumber}:{})}));
 return {repository:run.repository||null,runId:run.runId||null,runAttempt:run.runAttempt||null,
  workflow:run.workflow||null,workflowRef:run.workflowRef||null,workflowSha:run.workflowSha||null,
  mode:report.mode||null,searchScope:report.searchScope||null,
  clientSourceRevision:report.reproducibility?.clientSourceRevision||null,
  workerSourceRevisions:revisions,cases};
}
function emptyManualScores(kind='answer'){
 const dimensions=kind==='highlights'?HIGHLIGHT_REVIEW_DIMENSIONS:MANUAL_REVIEW_DIMENSIONS;
 return Object.fromEntries(dimensions.map(key=>[key,null]));
}
function completenessBand(ratio){
 if(ratio===null)return 2;
 return ratio>=0.9?2:ratio>=0.5?1:0;
}
function splitAnswerAuditUnits(answerText){
 const text=String(answerText||'');
 const rawUnits=text.split(/\n+/u).flatMap(line=>{
  const cleaned=line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/u,'').trim();
  if(!cleaned||/^\*{1,2}[^*]+\*{1,2}:?$/u.test(cleaned))return [];
  return cleaned.split(/(?<=[.!?])\s+/u)
   .map(unit=>unit.trim()).filter(Boolean);
 });
 // A citation cluster that follows sentence-ending punctuation ("Claim. [S1]
 // Next sentence.") is split into the following unit by the punctuation split
 // above, but it belongs to the sentence it trails. Reattach a leading
 // citation cluster (and any bare punctuation trailing it) to the previous
 // unit; a citation-only fragment at the very start stays its own unit.
 const units=[];
 for(const raw of rawUnits){
  const leading=/^((?:\[\s*S\d+(?:\s*,\s*S\d+)*\s*\]\s*)+)([\s\S]*)$/u.exec(raw);
  if(leading&&units.length){
   const rest=leading[2].trim();
   if(!rest||/^[.!?,;:]+$/u.test(rest)){
    units[units.length-1]+=` ${leading[1].trim()}${rest}`;
    continue;
   }
   units[units.length-1]+=` ${leading[1].trim()}`;
   units.push(rest);
   continue;
  }
  units.push(raw);
 }
 return units;
}
function citationIdsInAnswerUnit(answerClaim){
 return [...new Set([...String(answerClaim||'').matchAll(/\[\s*(S\d+(?:\s*,\s*S\d+)*)\s*\]/gu)]
  .flatMap(match=>match[1].split(/\s*,\s*/u)))];
}
function citationAuditCompleteness(rows){
 const classified=rows.filter(row=>row.claimClassification==='source-required');
 const cited=classified.filter(row=>Array.isArray(row.citationIds)&&row.citationIds.length>0);
 const ratio=classified.length?cited.length/classified.length:null;
 return {numerator:cited.length,denominator:classified.length,
  ratio:ratio===null?null:Number(ratio.toFixed(4)),score:completenessBand(ratio),
  method:'audited-source-required-answer-units-with-inline-citations'};
}
export function deriveLinkageCompleteness(item){
 const parts=Array.isArray(item?.questionParts)?item.questionParts:[];
 const shippedClaimIds=new Set(parts.flatMap(part=>Array.isArray(part?.claimIds)?part.claimIds.map(String):[]));
 const partByClaim=new Map(parts.flatMap(part=>(Array.isArray(part?.claimIds)?part.claimIds:[])
  .map(id=>[String(id),String(part.partId||'')])));
 const decisions=Array.isArray(item?.evidenceTrace?.reviewContract?.reviewDecisions)?
  item.evidenceTrace.reviewContract.reviewDecisions:[];
 const evidenceMap=Array.isArray(item?.evidenceMap)?item.evidenceMap:[];
 const inline=new Set(Array.isArray(item?.inlineIds)?item.inlineIds.map(String):[]);
 const sourceClaimKeys=new Set(decisions.filter(decision=>decision?.sourceId&&
  shippedClaimIds.has(String(decision.claimId))).map(decision=>String(decision.claimId)));
 const linkedClaimKeys=new Set();
 for(const decision of decisions){
  const claimId=String(decision?.claimId||''),sourceId=String(decision?.sourceId||'');
  if(!sourceClaimKeys.has(claimId)||!sourceId||!inline.has(sourceId))continue;
  if(evidenceMap.some(entry=>String(entry?.claimId||'')===claimId&&
    String(entry?.partId||'')===String(decision.partId||partByClaim.get(claimId)||'')&&
    String(entry?.id||'')===sourceId))linkedClaimKeys.add(claimId);
 }
 const sourceClaimCount=sourceClaimKeys.size;
 const hasCitationMarker=inline.size>0||/\[\s*S\d+(?:\s*,\s*S\d+)*\s*\]/u.test(String(item?.answerText||''));
 const citationRatio=sourceClaimCount?linkedClaimKeys.size/sourceClaimCount:hasCitationMarker?0:null;
 const highlightRatio=Number.isFinite(item?.highlightClaimCoverage?.ratio)?
  item.highlightClaimCoverage.ratio:null;
 return {citation:{numerator:linkedClaimKeys.size,denominator:sourceClaimCount,
   ratio:citationRatio===null?null:Number(citationRatio.toFixed(4)),
   score:completenessBand(citationRatio),method:'shipped-source-claims-with-inline-citation-and-evidence-link'},
  highlights:{numerator:Number(item?.highlightClaimCoverage?.linkedClaimCount)||0,
   denominator:Number(item?.highlightClaimCoverage?.citedClaimCount)||0,
   ratio:highlightRatio,score:completenessBand(highlightRatio),
   method:'located-highlight-claim-source-intersection'}};
}
function scoredTotal(review,kind='answer'){
 const dimensions=kind==='highlights'?HIGHLIGHT_REVIEW_DIMENSIONS:MANUAL_REVIEW_DIMENSIONS;
 if(review?.status!=='complete'||!review.scores||
   !dimensions.every(key=>Number.isInteger(review.scores[key])&&
    review.scores[key]>=0&&review.scores[key]<=2))return null;
 return dimensions.reduce((sum,key)=>sum+review.scores[key],0);
}
function qualityFailureStage(item){
 const explicitStage=String(item?.failureStage||item?.requestFailure?.stage||'').trim();
 if(explicitStage)return {stage:explicitStage,basis:'explicit-trace'};
 if(item?.selectionHandoffAudit?.status==='mismatch')
  return {stage:'evidence-selection-handoff',basis:'selection-handoff-audit'};
 if(item?.evidenceApplicability!=='not-applicable'&&Array.isArray(item?.partEvidenceAudit)&&
   item.partEvidenceAudit.some(part=>part?.status==='partial'||part?.status==='unsupported'||
    part?.structurallyComplete===false))
  return {stage:'evidence-alignment',basis:'part-evidence-audit'};
 if(item?.noAnswerFailure===true||!String(item?.answerText||'').trim())
  return {stage:'unclassified-no-answer',basis:'no-answer-without-stage'};
 if(item?.answerCompleteness&&item.answerCompleteness!=='full')
  return {stage:'unlocalized-answer-gap',basis:'answer-completeness'};
 return {stage:'no-recorded-failure',basis:'no-stage-failure-in-trace'};
}
/** Summarize human scores alongside explicit or inferred trace failure stages.
 * This is descriptive correlation, not evidence that a stage caused a score. */
export function summarizeQualityByFailureStage(cases){
 const groups=new Map();
 const entries=(cases||[]).flatMap(item=>{
  const variants=item?.answerVariantComparison||item?.reviewAblation;
  return Array.isArray(variants?.variants)?variants.variants.map(variant=>({...item,...variant,id:item.id})):[item];
 });
 for(const item of entries){
  const classification=qualityFailureStage(item);
  const key=classification.stage+'|'+classification.basis;
  const group=groups.get(key)||{stage:classification.stage,basis:classification.basis,
   caseCount:0,noAnswerFailures:0,answerProducedScores:[],answerAdjustedScores:[],
   highlightProducedScores:[],highlightAdjustedScores:[],answerPending:0,highlightPending:0};
  group.caseCount++;
  const noAnswer=item?.noAnswerFailure===true||!String(item?.answerText||'').trim();
  if(noAnswer)group.noAnswerFailures++;
  const answerScore=noAnswer?0:scoredTotal(item?.manualReview);
  const highlightScore=noAnswer?0:scoredTotal(item?.highlightHumanReview,'highlights');
  if(answerScore===null)group.answerPending++;
  else{group.answerAdjustedScores.push(answerScore);if(!noAnswer)group.answerProducedScores.push(answerScore);}
  if(highlightScore===null)group.highlightPending++;
  else{group.highlightAdjustedScores.push(highlightScore);if(!noAnswer)group.highlightProducedScores.push(highlightScore);}
  groups.set(key,group);
 }
 const summarize=(group,producedScores,adjustedScores,pending)=>{
  const produced=group.caseCount-group.noAnswerFailures;
  const mean=values=>values.length?Number((values.reduce((sum,value)=>sum+value,0)/values.length).toFixed(2)):null;
  return {scored:producedScores.length,produced,
   producedOnlyAverageOutOf10:produced>0&&pending===0?mean(producedScores):null,
   completionAdjustedAverageOutOf10:pending===0?mean(adjustedScores):null};
 };
 return [...groups.values()].map(group=>{
  const {answerProducedScores,answerAdjustedScores,highlightProducedScores,highlightAdjustedScores,
   answerPending,highlightPending,...summary}=group;
  return {...summary,answer:summarize(group,answerProducedScores,answerAdjustedScores,answerPending),
   highlights:summarize(group,highlightProducedScores,highlightAdjustedScores,highlightPending)};
 }).sort((left,right)=>right.caseCount-left.caseCount||left.stage.localeCompare(right.stage));
}
/** Batch 34 (B34-8): the claims scoring must be able to see beyond the
 * initial review decisions — every claim that reached rescue review or a
 * flip veto, keyed partId+claimId. Sources: the trace's rescueReview parts
 * (per-claim rescue verdicts, flip outcomes, and veto records) and the veto
 * census (entries whose outcome is a flip veto). reviewDecisions alone miss
 * claims the gate demoted without a decision row: in batch 33, Wuthering
 * Heights SP1's vetoed flip P2-C10 existed only in the rescue record, so the
 * scorecard carried no row for it and a supported-but-vetoed claim was
 * invisible to the flip-acceptance denominator. Values are merged per
 * partId+claimId across the claim's per-source rescue records: a supported
 * verdict on any paired source stands, and the flip record comes from
 * whichever paired record carries one. */
export function rescueOrVetoClaims(item){
 const trace=item?.evidenceTrace||{};
 const merged=new Map();
 const record=(partId,claimId)=> {
  const key=partId+'|'+claimId;
  if(!merged.has(key))merged.set(key,{partId,claimId,sourceId:'',rescueVerdict:'',
   flipOutcome:null,flipVeto:null,fragment:'',claimElements:[]});
  return merged.get(key);
 };
 const parts=Array.isArray(trace.rescueReview?.parts)?trace.rescueReview.parts:[];
 for(const part of parts){
  const partId=typeof part?.partId==='string'?part.partId:'';
  if(!partId||!Array.isArray(part.claims))continue;
  for(const claim of part.claims){
   if(!claim||typeof claim.claimId!=='string')continue;
   const entry=record(partId,claim.claimId);
   if(!entry.sourceId&&typeof claim.sourceId==='string')entry.sourceId=claim.sourceId;
   if(claim.verdict==='supported')entry.rescueVerdict='supported';
   else if(claim.verdict==='not-supported'&&!entry.rescueVerdict)entry.rescueVerdict='not-supported';
   if(typeof claim.flipOutcome==='string'&&claim.flipOutcome){
    entry.flipOutcome=claim.flipOutcome;
    if(typeof claim.sourceId==='string'&&claim.sourceId)entry.sourceId=claim.sourceId;
    if(claim.flipVeto&&typeof claim.flipVeto==='object')
     entry.flipVeto={reason:String(claim.flipVeto.reason||''),layer:String(claim.flipVeto.layer||'')};
   }
   if(!entry.fragment&&typeof claim.fragment==='string')entry.fragment=claim.fragment;
   if(!entry.claimElements.length&&Array.isArray(claim.elements))
    entry.claimElements=claim.elements.map(element=>element?.element).filter(text=>typeof text==='string'&&text);
  }
 }
 const censuses=[trace.vetoCensus,trace.reviewContract?.vetoCensus];
 for(const census of censuses){
  if(!Array.isArray(census))continue;
  for(const entry of census){
   if(!entry||entry.outcome!=='vetoed'||typeof entry.claimId!=='string'||
    typeof entry.partId!=='string'||!entry.partId)continue;
   const claim=record(entry.partId,entry.claimId);
   if(!claim.flipOutcome)claim.flipOutcome='vetoed';
   if(!claim.flipVeto)claim.flipVeto={reason:String(entry.ground||''),layer:String(entry.layer||'')};
   if(!claim.sourceId&&typeof entry.sourceId==='string')claim.sourceId=entry.sourceId;
  }
 }
 return merged;
}
/** Batch 34 (B34-8): completeness check for the scorecard claim audit —
 * the rescue-reviewed / flip-vetoed claims of a report that have no
 * claimAudit row. Returns one entry per missing claim; an empty result
 * means the audit covers the full rescue-review denominator. */
export function claimAuditCompletenessGaps(report,claimAudit){
 const rows=Array.isArray(claimAudit)?claimAudit:[];
 const audited=new Set(rows.map(row=>row&&row.caseId+'|'+row.partId+'|'+row.claimId));
 const gaps=[];
 for(const item of report?.cases||[]){
  for(const claim of rescueOrVetoClaims(item).values()){
   if(!audited.has(item.id+'|'+claim.partId+'|'+claim.claimId))
    gaps.push({caseId:item.id,partId:claim.partId,claimId:claim.claimId});
  }
 }
 return gaps;
}
/** Create a blank answer/highlight scorecard bound to this exact saved evaluation. */
export function createHumanScorecardTemplate(report){
 if(!report||!Array.isArray(report.cases))throw Error('Input is not a live answer evaluation report.');
 if(report.mode==='transport-ab'){
  const answerDimensions=Object.keys(PHASE2_SCORE_TARGETS.answer.dimensions);
  const highlightDimensions=Object.keys(PHASE2_SCORE_TARGETS.highlights.dimensions);
  const empty=dimensions=>Object.fromEntries(dimensions.map(key=>[key,null]));
  const scoreRows=report.cases.flatMap(item=>(item.answerVariantComparison?.variants||[]).map(variant=>{
   const linkageCompleteness=deriveLinkageCompleteness(variant);
   return {caseId:item.id,...(Number.isInteger(item.attemptNumber)?{attemptNumber:item.attemptNumber}:{}),
    inferenceTransport:variant.inferenceTransport,
    noAnswerFailure:variant.noAnswerFailure===true,
    linkageCompleteness,
    answer:{scores:{...empty(answerDimensions),citationCompleteness:linkageCompleteness.citation.score},notes:''},
    highlights:{scores:{...empty(highlightDimensions),completeness:linkageCompleteness.highlights.score},notes:''}};
  }));
  return {schema:'antilogicalism-reading-companion-phase2-rubric-v2-transport-scorecard',
   evaluationIdentity:scorecardEvaluationIdentity(report),scale:{min:0,max:2},
   protocol:PHASE2_SCORE_TARGETS,
   instructions:'Complete claim audit first. Score answer and highlights independently for each transport. citationCompleteness and highlight completeness are script-derived from the linkage data and must not be edited. Keep produced means separate from completion-adjusted means; failed/no-answer variants are zero only in completion-adjusted means.',
   cases:report.cases.map(item=>({caseId:item.id,attemptNumber:item.attemptNumber||item.repeatAttempt||null,
    question:item.question,variants:(item.answerVariantComparison?.variants||[]).map(variant=>({
    inferenceTransport:variant.inferenceTransport,noAnswerFailure:variant.noAnswerFailure===true||!hasProducedAnswer(variant),
    answerPresent:hasProducedAnswer(variant),highlightCount:Array.isArray(variant.evidenceHighlights)?variant.evidenceHighlights.length:0}))})),
   scores:scoreRows};
 }
 const scores=report.cases.filter(hasProducedAnswer)
  .map(item=>{
   const linkageCompleteness=deriveLinkageCompleteness(item);
   return {caseId:item.id,
   ...(Number.isInteger(item.attemptNumber)?{attemptNumber:item.attemptNumber}:{}),
   ...(typeof item.answerVariant==='string'?{answerVariant:item.answerVariant}:{}),
   ...(typeof item.selectionVariant==='string'?{selectionVariant:item.selectionVariant}:{}),
   linkageCompleteness:{...linkageCompleteness,citation:splitAnswerAuditUnits(item.answerText).length?
    {numerator:null,denominator:null,ratio:null,score:null,method:'pending-manual-claim-classification'}:
    linkageCompleteness.citation},
   answer:{scores:{...emptyManualScores(),citationCompleteness:splitAnswerAuditUnits(item.answerText).length?null:linkageCompleteness.citation.score},notes:''},
   highlights:{scores:{...emptyManualScores('highlights'),completeness:linkageCompleteness.highlights.score},notes:''}};
  });
 const answerUnits=report.cases.flatMap(item=>splitAnswerAuditUnits(item.answerText).map((answerClaim,index)=>({
  caseId:item.id,attemptNumber:item.attemptNumber||item.repeatAttempt||null,
  answerUnitId:`${item.id}-A${item.attemptNumber||item.repeatAttempt||0}-U${index+1}`,answerClaim,
  citationIds:citationIdsInAnswerUnit(answerClaim),
  claimClassification:null,auditorVerdict:null,auditorNotes:''})));
 const claimAudit=report.cases.flatMap(item=>{
  const trace=item.evidenceTrace||{};
  const decisions=Array.isArray(trace.reviewContract?.reviewDecisions)?trace.reviewContract.reviewDecisions:[];
  const map=Array.isArray(item.evidenceMap)?item.evidenceMap:[];
  return decisions.filter(decision=>decision&&typeof decision.claimId==='string').map(decision=>{
   const sourceId=String(decision.sourceId||'');
   const linked=map.filter(entry=>entry.claimId===decision.claimId&&entry.partId===decision.partId&&
    (!sourceId||entry.id===sourceId));
   return {caseId:item.id,attemptNumber:item.attemptNumber||item.repeatAttempt||null,
    partId:decision.partId||'',claimId:decision.claimId,answerClaim:decision.claimText||'',
    sourceId,exactQuotes:linked.map(entry=>entry.quote||'').filter(Boolean),
    reviewerStatus:decision.sourceStatus||decision.claimStatus||'',
    reviewerAccepted:decision.accepted===true,evidenceRole:decision.evidenceRole||'',
    supportBoundary:decision.supportBoundary||'',auditorVerdict:null,auditorNotes:''};
  });
 });
 // Batch 34 (B34-8): claims that reached rescue review or a flip veto but
 // never appeared in reviewDecisions still get a claimAudit row, carrying
 // their rescue record, whether or not they shipped. Decision-derived rows
 // are left untouched; only the missing claims are appended.
 for(const item of report.cases){
  const map=Array.isArray(item.evidenceMap)?item.evidenceMap:[];
  for(const claim of rescueOrVetoClaims(item).values()){
   if(claimAudit.some(row=>row.caseId===item.id&&row.partId===claim.partId&&row.claimId===claim.claimId))continue;
   const linked=map.filter(entry=>entry.claimId===claim.claimId&&entry.partId===claim.partId&&
    (!claim.sourceId||entry.id===claim.sourceId));
   const linkedQuotes=linked.map(entry=>entry.quote||'').filter(Boolean);
   claimAudit.push({caseId:item.id,attemptNumber:item.attemptNumber||item.repeatAttempt||null,
    partId:claim.partId,claimId:claim.claimId,answerClaim:claim.claimElements.join(' '),
    sourceId:claim.sourceId,exactQuotes:linkedQuotes.length?linkedQuotes:(claim.fragment?[claim.fragment]:[]),
    reviewerStatus:claim.rescueVerdict,reviewerAccepted:claim.flipOutcome==='accepted',
    evidenceRole:'',supportBoundary:'',auditorVerdict:null,auditorNotes:'',
    auditSource:'rescue-review',rescueOnly:true,rescueVerdict:claim.rescueVerdict,
    flipOutcome:claim.flipOutcome,flipVeto:claim.flipVeto});
  }
 }
 const auditGaps=claimAuditCompletenessGaps(report,claimAudit);
 if(auditGaps.length)throw Error('claimAudit is missing rows for rescue-reviewed or flip-vetoed claims: '+
  auditGaps.map(gap=>gap.caseId+' '+gap.partId+' '+gap.claimId).join(', '));
 return {schema:'antilogicalism-reading-companion-human-scorecard-v1',
  evaluationIdentity:scorecardEvaluationIdentity(report),
  scale:{min:0,max:2},dimensions:{answer:MANUAL_REVIEW_DIMENSIONS,highlights:HIGHLIGHT_REVIEW_DIMENSIONS},
  instructions:'Complete answerUnits first: classify every final answer sentence as source-required or general-connective. Source-required includes substantive claims about a specific text, author, position, event, or quotation, including synthesis and comparison; general-connective covers framing and non-text-specific background. Then complete claimAudit by checking reviewer claims against answer text, exact quotes, sources, status, role, and support boundary. citationCompleteness is derived from the classified answerUnits: cited source-required units divided by all source-required units. Then fill the other answer and highlights dimensions. Leave the case manifest intact.',
  cases:report.cases.map(item=>({caseId:item.id,
   ...(Number.isInteger(item.attemptNumber)?{attemptNumber:item.attemptNumber}:{}),
   noAnswerFailure:item.noAnswerFailure===true||!hasProducedAnswer(item),answerPresent:hasProducedAnswer(item),
   highlightCount:Array.isArray(item.evidenceHighlights)?item.evidenceHighlights.length:0,
   linkageCompleteness:{...deriveLinkageCompleteness(item),
    citation:splitAnswerAuditUnits(item.answerText).length?
     {numerator:null,denominator:null,ratio:null,score:null,method:'pending-manual-claim-classification'}:
     deriveLinkageCompleteness(item).citation}})),
  answerUnits,claimAudit,scores};
}
export function evaluationRunContext(env=process.env){
 return {repository:env.GITHUB_REPOSITORY||null,
  runId:/^\d+$/.test(env.GITHUB_RUN_ID||'')?env.GITHUB_RUN_ID:null,
  runAttempt:/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||'')?Number(env.GITHUB_RUN_ATTEMPT):null,
  workflow:env.GITHUB_WORKFLOW||null,workflowRef:env.GITHUB_REF||null,
  workflowSha:/^[a-f0-9]{40}$/i.test(env.GITHUB_SHA||'')?env.GITHUB_SHA:null};
}
/** Apply explicit human scores to a saved report. This is pure offline work. */
export function applyHumanScorecard(report,scorecard){
 if(!report||!Array.isArray(report.cases))throw Error('Input is not a live answer evaluation report.');
 if(!scorecard||typeof scorecard!=='object'||Array.isArray(scorecard)||
   !Array.isArray(scorecard.scores))throw Error('Scorecard must contain a scores array.');
 if(scorecard.evaluationIdentity&&JSON.stringify(scorecard.evaluationIdentity)!==
    JSON.stringify(scorecardEvaluationIdentity(report)))
  throw Error('Scorecard evaluation identity does not match this report.');
 const answerUnits=Array.isArray(scorecard.answerUnits)?scorecard.answerUnits:[];
 const validClassifications=new Set(['source-required','general-connective']);
 const expectedUnits=report.cases.flatMap(item=>splitAnswerAuditUnits(item.answerText).map((answerClaim,index)=>({
  caseId:item.id,attemptNumber:item.attemptNumber||item.repeatAttempt||null,
  answerUnitId:`${item.id}-A${item.attemptNumber||item.repeatAttempt||0}-U${index+1}`,answerClaim,
  citationIds:citationIdsInAnswerUnit(answerClaim)})));
 const answerScoresIncluded=scorecard.scores.some(row=>row?.answer!==undefined);
 if(answerScoresIncluded&&expectedUnits.length&&answerUnits.length!==expectedUnits.length)
  throw Error('Citation audit must include every final answer unit exactly once.');
 for(const expected of answerScoresIncluded?expectedUnits:[]){
  const matches=answerUnits.filter(row=>row?.answerUnitId===expected.answerUnitId&&
   row?.caseId===expected.caseId&&(row?.attemptNumber??null)===expected.attemptNumber);
  if(matches.length!==1||matches[0].answerClaim!==expected.answerClaim||
    JSON.stringify(matches[0].citationIds)!==JSON.stringify(expected.citationIds)||
    !validClassifications.has(matches[0].claimClassification))
   throw Error('Citation audit is incomplete or does not match final answer text: '+expected.answerUnitId);
 }
 const cases=report.cases.map(item=>({...item}));
 const applied=new Set();
 for(const [index,row] of scorecard.scores.entries()){
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.caseId!=='string'||!row.caseId.trim())
   throw Error('Scorecard row '+(index+1)+' needs a caseId.');
  if(!row.answer&&!row.highlights)throw Error('Scorecard row '+(index+1)+' needs answer and/or highlights scores.');
  const matches=cases.filter(item=>String(item.id)===row.caseId&&
   (row.attemptNumber===undefined||item.attemptNumber===row.attemptNumber));
  if(matches.length!==1)throw Error('Scorecard caseId is unknown or ambiguous: '+row.caseId);
  const target=matches[0];
  const variantsContainer=target.answerVariantComparison||target.reviewAblation;
  let scoredTarget=target;
  if(Array.isArray(variantsContainer?.variants)){
   const variants=variantsContainer.variants;
   const matched=variants.filter(variant=>variant.answerVariant===row.answerVariant&&
    (!row.selectionVariant||variant.selectionVariant===row.selectionVariant));
   if(!row.answerVariant||matched.length!==1)
    throw Error('Scorecard row '+(index+1)+' must identify one answerVariant'+
     (variants.some(variant=>variant.selectionVariant)?' and selectionVariant':'')+'.');
   scoredTarget={...matched[0]};
   const variantIndex=variants.indexOf(matched[0]);
   const updated={...variantsContainer,variants:variants.map((variant,i)=>i===variantIndex?scoredTarget:variant)};
   if(target.answerVariantComparison)target.answerVariantComparison=updated;
   if(target.reviewAblation)target.reviewAblation=updated;
  }else if((row.answerVariant&&row.answerVariant!==target.answerVariant)||
    (row.selectionVariant&&row.selectionVariant!==target.selectionVariant)){
   throw Error('Scorecard row '+(index+1)+' does not match the case answer/selection variant.');
  }
  for(const kind of ['answer','highlights']){
   if(row[kind]===undefined)continue;
   const key=JSON.stringify([row.caseId,row.attemptNumber??'',row.answerVariant||'',row.selectionVariant||'',kind]);
   if(applied.has(key))throw Error('Duplicate scorecard scores for '+row.caseId+' '+kind+'.');
   applied.add(key);
   const linkageCompleteness=deriveLinkageCompleteness(scoredTarget);
   const dimension=kind==='answer'?'citationCompleteness':'completeness';
   const auditedRows=answerUnits.filter(unit=>unit.caseId===row.caseId&&
    (unit.attemptNumber??null)===(row.attemptNumber??null));
   const computed=kind==='answer'?citationAuditCompleteness(auditedRows).score:linkageCompleteness.highlights.score;
   const supplied=row[kind]?.scores?.[dimension];
   if(supplied!==undefined&&supplied!==null&&supplied!==computed)
    throw Error(dimension+' is script-derived from its audit inputs and cannot be overridden.');
   const normalizedInput={...row[kind],scores:{...(row[kind]?.scores||{}),[dimension]:computed}};
   scoredTarget[kind==='answer'?'manualReview':'highlightHumanReview']=
    normalizeHumanScore(normalizedInput,kind==='answer'?'answer':'highlights');
  }
 }
 return {...report,cases,humanReview:summarizeManualReviews(cases),
  highlightReview:summarizeHighlightReviews(cases),
  qualityByFailureStage:summarizeQualityByFailureStage(cases),
  answerVariants:summarizeAnswerVariants(cases),selectionVariants:summarizeSelectionVariants(cases)};
}
export function summarizeAnswerVariants(cases){
 const entries=(cases||[]).flatMap(item=>Array.isArray((item?.answerVariantComparison||item?.reviewAblation)?.variants)?
  (item.answerVariantComparison||item.reviewAblation).variants.map(variant=>({id:item.id,...variant})):
  [{id:item.id,answerVariant:item.answerVariant||'with-review',structuralPassed:item.structuralPassed}]);
 return Object.fromEntries(['with-review','compose-only','with-expansion'].map(answerVariant=>{
  const selected=entries.filter(item=>item.answerVariant===answerVariant);
  return [answerVariant,{cases:selected.length,
   structuralPassed:selected.filter(item=>item.structuralPassed===true).length,
   structuralFailed:selected.filter(item=>item.structuralPassed===false).length,
   structuralUnknown:selected.filter(item=>typeof item.structuralPassed!=='boolean').length,
   humanScores:summarizeManualReviews(selected.map(item=>({id:item.id,answerVariant:item.answerVariant,
    answerText:item.answerText,noAnswerFailure:item.noAnswerFailure,manualReview:item.manualReview}))) }];
 }));
}
export function summarizeSelectionVariants(cases){
 const entries=(cases||[]).flatMap(item=>Array.isArray(item?.answerVariantComparison?.variants)?
  item.answerVariantComparison.variants.filter(variant=>variant.selectionVariant).map(variant=>({id:item.id,...variant})):[]);
 return Object.fromEntries(['narrow-retrieval-pool','full-retrieval-pool'].map(selectionVariant=>{
  const selected=entries.filter(item=>item.selectionVariant===selectionVariant);
  return [selectionVariant,{cases:selected.length,
   structuralPassed:selected.filter(item=>item.structuralPassed===true).length,
   structuralFailed:selected.filter(item=>item.structuralPassed===false).length,
   structuralUnknown:selected.filter(item=>typeof item.structuralPassed!=='boolean').length,
   humanScores:summarizeManualReviews(selected.map(item=>({id:item.id,answerVariant:item.answerVariant,
    answerText:item.answerText,noAnswerFailure:item.noAnswerFailure,manualReview:item.manualReview})))}];
 }));
}
export function summarizePipelineFailures(cases){
 const failed=(cases||[]).filter(item=>item?.requestFailure||item?.noAnswerFailure||
  item?.failureCode||item?.outcome==='request-failed'||item?.outcome==='pipeline-failed');
 const groups=new Map();
 for(const item of failed){
  const stage=String(item?.failureStage||item?.requestFailure?.stage||'unknown').slice(0,80);
  const code=String(item?.failureCode||item?.requestFailure?.failureCode||'pipeline-failed').slice(0,80);
  const key=stage+'|'+code;
  const group=groups.get(key)||{stage,code,count:0,noAnswerCount:0};
  group.count++;
  if(item?.noAnswerFailure||!String(item?.answerText||'').trim())group.noAnswerCount++;
  groups.set(key,group);
 }
 return {failedCases:failed.length,noAnswerFailures:failed.filter(item=>item?.noAnswerFailure||
  !String(item?.answerText||'').trim()).length,byStageAndCode:[...groups.values()]};
}
export function summarizeCitationGateIntegrity(cases){
 const totals={casesWithGateTrace:0,firings:0,adoptions:0,
  outcomes:{adopted:0,repairRefused:0,repairThrew:0,reReviewRefused:0},
  sourceRequiredParts:0,sourceRequiredPartsShippedUncited:0,
  sourceRequiredPartsDropped:0,uncitedPartIds:[],droppedPartIds:[]};
 for(const item of cases||[]){
  const trace=item?.evidenceTrace||{};
  const gate=trace.citationGateSummary;
  if(gate&&typeof gate==='object'){
   totals.casesWithGateTrace++;
   totals.firings+=Number(gate.firings)||0;
   totals.adoptions+=Number(gate.adoptions)||0;
   for(const key of Object.keys(totals.outcomes))
    totals.outcomes[key]+=Number(gate.outcomes?.[key])||0;
  }else if(Array.isArray(trace.citationGate)){
   totals.casesWithGateTrace++;
   for(const entry of trace.citationGate){
    totals.firings++;
    const adopted=entry?.action==='repair-applied';
    if(adopted){totals.adoptions++;totals.outcomes.adopted++;}
    else if(entry?.action==='repair-refused')totals.outcomes.repairRefused++;
    else if(entry?.action==='repair-threw')totals.outcomes.repairThrew++;
    if(entry?.refusal?.stage==='re-review')totals.outcomes.reReviewRefused++;
   }
  }
  const partAudit=Array.isArray(item?.partEvidenceAudit)?item.partEvidenceAudit:[];
  for(const part of partAudit){
   if(part?.sourceRequired!==true)continue;
   totals.sourceRequiredParts++;
   if(part.sourceRequiredUncited===true){
    totals.sourceRequiredPartsShippedUncited++;
    totals.uncitedPartIds.push({caseId:item.id,part:part.part,partId:part.partId||''});
   }
  }
  const containment=trace.sourceRequiredContainment;
  if(Array.isArray(containment?.droppedPartIds)){
   totals.sourceRequiredPartsDropped+=containment.droppedPartIds.length;
   for(const partId of containment.droppedPartIds)
    totals.droppedPartIds.push({caseId:item.id,partId});
  }
 }
 return totals;
}
export function recheckQualityReport(report){
 if(!report||!Array.isArray(report.cases))throw Error('Input is not a live answer evaluation report.');
 const definitions=new Map([...QUALITY_CASES,...FOCUSED_CASES,...PAIRED_CASES,...HOLDOUT_CASES,...ACCEPTANCE_CASES].map(item=>[item.id,item]));
 const cases=report.cases.map(item=>{
  const definition=definitions.get(String(item?.pairedCaseId||item?.id||'').replace(/::(?:all-books|selected-books)$/,''));
  if(!definition)return {...item,offlineRecheck:null};
  const audit=auditLiveAnswer({
   answer:item.answerText,coverage:item.coverage,answerCompleteness:item.answerCompleteness,
   outcome:item.outcome,reviewStatus:item.reviewStatus,
   citations:item.citationSources,
   questionParts:item.questionParts,evidenceMap:item.evidenceMap,
   evidenceHighlights:item.evidenceHighlights,evidenceTrace:item.evidenceTrace,
   workerVersionId:item.answerWorkerVersionId,
   workerSourceBuild:item.answerWorkerSourceBuild,workerSourceRevision:item.answerWorkerSourceRevision,
   evidenceTrace:item.evidenceTrace
  },Array.isArray(item.submittedSources)?item.submittedSources:[],definition.required_source_groups,
   definition.required_part_source_groups||[],{scope:item.scope||
    (Array.isArray(item.selectedBookIds)&&item.selectedBookIds.length?'selected-books':'all-books'),
    plannerPlan:item.plannerPlan||item.evidenceTrace?.plan||null,
    candidateSources:Array.isArray(item.retrievalCandidates)?item.retrievalCandidates:null});
  const previousComparison=item.answerVariantComparison||item.reviewAblation;
  const answerVariantComparison=Array.isArray(previousComparison?.variants)?{...previousComparison,
   variants:previousComparison.variants.map(variant=>{
    const variantAudit=auditLiveAnswer({answer:variant.answerText,coverage:variant.coverage,
     answerCompleteness:variant.answerCompleteness,
     outcome:variant.outcome,reviewStatus:variant.reviewStatus,
     citations:variant.citationSources,questionParts:variant.questionParts,evidenceMap:variant.evidenceMap,
     evidenceHighlights:variant.evidenceHighlights,evidenceTrace:variant.evidenceTrace,
     depthRepair:variant.depthRepair,
     workerVersionId:variant.workerVersionId,
     workerSourceBuild:variant.workerSourceBuild,workerSourceRevision:variant.workerSourceRevision},
     Array.isArray(variant.submittedSources)?variant.submittedSources:Array.isArray(item.submittedSources)?item.submittedSources:[],
     definition.required_source_groups,definition.required_part_source_groups||[],{scope:item.scope||
      (Array.isArray(item.selectedBookIds)&&item.selectedBookIds.length?'selected-books':'all-books'),
      plannerPlan:item.plannerPlan||item.evidenceTrace?.plan||null,
      candidateSources:Array.isArray(item.retrievalCandidates)?item.retrievalCandidates:null});
    return {...variant,...variantAudit,manualReview:variant.manualReview,
     highlightHumanReview:variant.highlightHumanReview};
   })}:previousComparison;
  return {...item,...(answerVariantComparison?{answerVariantComparison}:{}),
   ...(item.reviewAblation&&answerVariantComparison?{reviewAblation:answerVariantComparison}:{}),
   offlineRecheck:{passed:audit.passed,answerCompleteness:audit.answerCompleteness,
   questionPartAnswerCompleteness:audit.questionPartAnswerCompleteness,sourceGroups:audit.sourceGroups,
   sourcePartAlignment:audit.sourcePartAlignment,
   questionPartCoverage:audit.questionPartCoverage,
   partEvidenceAudit:audit.partEvidenceAudit,
   partEvidenceComplete:audit.partEvidenceComplete,
   selectionHandoffAudit:audit.selectionHandoffAudit,
   evidenceContinuityAudit:audit.evidenceContinuityAudit,
   reviewWorkload:audit.evidenceContinuityAudit.reviewWorkload,
   answerCoverageConsistent:audit.answerCoverageConsistent,
   answerCompletenessConsistent:audit.answerCompletenessConsistent,
   coverageContradictions:audit.coverageContradictions,
   inlineIdsWithoutSource:audit.inlineIdsWithoutSource,
   citationHighlightAudit:audit.citationHighlightAudit,
   highlightPartCoverage:audit.highlightPartCoverage,
   highlightRelevance:audit.highlightRelevance,
   highlightHumanReview:audit.highlightHumanReview}};
 });
 const checked=cases.filter(item=>item.offlineRecheck);
 return {...report,cases,humanReview:summarizeManualReviews(cases),
  highlightReview:summarizeHighlightReviews(cases),
  reviewerLabels:summarizeReviewerLabels(cases),answerVariants:summarizeAnswerVariants(cases),
  selectionVariants:summarizeSelectionVariants(cases),offlineRecheck:{checkedAt:new Date().toISOString(),
  evaluator:'local-structural-recheck-v1',networkCalls:0,aiCalls:0,
  checkedCases:checked.length,reviewerLabels:summarizeReviewerLabels(checked),
  passedCases:checked.filter(item=>item.offlineRecheck.passed).length,
  failedCases:checked.filter(item=>!item.offlineRecheck.passed).length,
  questionPartStatusCounts:checked.reduce((totals,item)=>{
   const counts=item.offlineRecheck.questionPartCoverage||{};
   for(const status of ['supported','partial','unsupported'])totals[status]+=Number(counts[status])||0;
   totals.total+=Number(counts.total)||0;return totals;
  },{total:0,supported:0,partial:0,unsupported:0}),
  evidenceContinuity:summarizeEvidenceContinuity(checked),
  answerCompletenessCounts:checked.reduce((totals,item)=>{
   const status=item.offlineRecheck.answerCompleteness;
   if(status==='full')totals.full++;
   else if(status==='partial')totals.partial++;
   else if(status==='none')totals.none++;
   else totals.unknown++;
   return totals;
  },{full:0,partial:0,none:0,unknown:0})}};
}
function safeHeaders(token){return {authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json',origin:'https://jsynon.github.io'};}
function attachRequestFailure(error,stage,details={}){
 const wrapped=error instanceof Error?error:new Error(String(error));
 wrapped.requestFailure={stage,httpStatus:Number.isSafeInteger(details.httpStatus)?details.httpStatus:null,
  failureCode:String(details.failureCode||'request-failed').slice(0,80),
  message:String(details.message||wrapped.message||'Request failed').replace(/(?:bearer\s+)[^\s]+/ig,'Bearer [redacted]').slice(0,240),
  workerFailure:details.workerFailure===true,
  ...(typeof details.failureDetail==='string'&&/^[a-z_]{1,48}$/.test(details.failureDetail)?
   {failureDetail:details.failureDetail}:{}),
  ...(typeof details.workerFailureStage==='string'&&
   ['planning','gap-planning'].includes(details.workerFailureStage)?
   {workerFailureStage:details.workerFailureStage}:{}),
  ...(Array.isArray(details.transportDiagnostics)?{transportDiagnostics:details.transportDiagnostics.slice(0,12).map(value=>{
   const safe={};for(const key of ['transport','stage','timeoutClassification','cancelOutcome','providerInferenceCancellation'])
    if(typeof value?.[key]==='string'&&value[key].length<=48)safe[key]=value[key];
   for(const key of ['timeoutMs','elapsedMs','timeoutAtMs','firstChunkMs','cancelElapsedMs'])
    if(Number.isSafeInteger(value?.[key])&&value[key]>=0)safe[key]=value[key];
   for(const key of ['timeoutFired','cancelRequested','cancelSettled','retrySafe','providerSettled','settledAfterDeadline'])
    if(typeof value?.[key]==='boolean')safe[key]=value[key];
   return safe;
  })}:{}),
  ...(Array.isArray(details.selectionSnapshot)?{selectionSnapshot:details.selectionSnapshot.slice(0,6).map(value=>({
   bookId:String(value?.bookId||'').slice(0,32),page:Number.isInteger(value?.page)?value.page:null,
   ...(typeof value?.candidateId==='string'&&/^C\d{1,3}$/.test(value.candidateId)?{candidateId:value.candidateId}:{}),
   candidatePartIds:Array.isArray(value?.candidatePartIds)?value.candidatePartIds.filter(id=>typeof id==='string'&&/^P[1-9]\d*$/.test(id)).slice(0,12):[],
   candidatePartSupport:Array.isArray(value?.candidatePartSupport)?value.candidatePartSupport.filter(entry=>
    entry&&typeof entry.partId==='string'&&/^P[1-9]\d*$/.test(entry.partId)&&typeof entry.support==='string'&&
    entry.support.length<=100).slice(0,24).map(entry=>({partId:entry.partId,support:entry.support,
     ...(typeof entry.excerpt==='string'&&entry.excerpt.length<=500?{excerpt:entry.excerpt}:{})})):[]}))}:{}),
  workerVersionId:typeof details.workerVersionId==='string'&&details.workerVersionId.length<=128?details.workerVersionId:null,
  workerSourceBuild:typeof details.workerSourceBuild==='string'&&details.workerSourceBuild.length<=128?details.workerSourceBuild:null,
  workerSourceRevision:typeof details.workerSourceRevision==='string'&&/^[a-f0-9]{40}$/i.test(details.workerSourceRevision)?details.workerSourceRevision.toLowerCase():null};
 return wrapped;
}
async function callJson(fetcher,url,token,body,beforeCall=async()=>{},stage='worker-request',onProgress=async()=>{}){
 await beforeCall();
 const started=Date.now();
 await onProgress({stage,status:'started',message:stage==='planner'?
  'Sending the planning request to the Worker.':
  'Sending the answer request; the Worker may compose, recover, and review before it responds.'});
 let response;
 const heartbeat=setInterval(()=>{void Promise.resolve(onProgress({stage,status:'waiting',elapsedMs:Date.now()-started,
  message:`Worker request is still running (${Math.floor((Date.now()-started)/1000)}s elapsed).`}))
  .catch(()=>{});},15_000);
 heartbeat.unref?.();
 try{response=await fetcher(url,{method:'POST',headers:safeHeaders(token),body:JSON.stringify(body)});}
 catch(error){
  await onProgress({stage,status:'failed',elapsedMs:Date.now()-started,message:'The Worker request failed before a response.'});
  throw attachRequestFailure(error,stage,{failureCode:'network-error',workerFailure:true});}
 finally{clearInterval(heartbeat);}
 let data;try{data=await response.json();}catch{
  await onProgress({stage,status:'failed',elapsedMs:Date.now()-started,
   message:'The Worker returned a response that was not valid JSON.'});
  throw attachRequestFailure(new Error('Worker returned invalid JSON.'),stage,{httpStatus:response.status,failureCode:'invalid-json',workerFailure:true});
 }
 if(!response.ok){
  await onProgress({stage,status:'failed',elapsedMs:Date.now()-started,
   message:`The Worker returned HTTP ${response.status} (${String(data?.failureCode||'request-failed')}).`});
  throw attachRequestFailure(new Error(String(data?.failureCode||data?.error||'Worker request failed').slice(0,240)),stage,{
  httpStatus:response.status,failureCode:String(data?.failureCode||'http-error'),
  failureDetail:data?.failureDetail,workerFailure:true,workerFailureStage:data?.failureStage,
  transportDiagnostics:data?.inferenceTransportDiagnostics,selectionSnapshot:data?.selectionSnapshot,
  workerVersionId:data?.workerVersionId,workerSourceBuild:data?.workerSourceBuild,workerSourceRevision:data?.workerSourceRevision});
 }
 await onProgress({stage,status:'completed',elapsedMs:Date.now()-started,
  message:`Worker response received in ${((Date.now()-started)/1000).toFixed(1)}s.`});
 return data;
}
function makeCachedFetch(root){
 const cache=new Map();
 return async(url,options)=>{
  const key=String(url);if(cache.has(key))return new Response(cache.get(key).slice(),{status:200});
  const response=await fetch(url,options);
  if(response.ok&&key.startsWith(root)){const bytes=new Uint8Array(await response.clone().arrayBuffer());cache.set(key,bytes);}
  return response;
 };
}
async function fetchJson(url){const response=await fetch(url,{headers:{accept:'application/json'},cache:'no-store'});if(!response.ok)throw Error(url+' returned HTTP '+response.status);return response.json();}
async function loadSources(item,queries,{library,manifest,allowed,directFallback=false,
 partQueries=[],partQuestions=[],gapQueries=[],gapQueryPartLinks=[],retrievalConfig=LIVE_RETRIEVAL_CONFIG}){
 const bookCatalog=Object.entries(manifest.books).map(([id,book])=>({id,title:book.title}));
 const selectedBookIds=Array.isArray(item.selected_book_ids)?item.selected_book_ids.map(String):[];
 const retrieval=await retrieveEvidence({question:item.question,queries,partQueries,partQuestions,gapQueries,gapQueryPartLinks,directFallback,
  library,books:bookCatalog,allowedBookIds:allowed,selectedBookIds,
  ...retrievalConfig,
  pageLoader:async source=>{
   const shard=await library.jsonGzip('book-'+String(source.bookId)+'.json');
   const pages=shard.pages?.filter(page=>page.id===source.globalPageId&&page.page===source.page)||[];
   return pages.length===1&&typeof pages[0].text==='string'?{text:pages[0].text}:null;
  }});
 const populated=retrieval.candidates;
 // Match the public companion's answer packet limits. A four-page / 30 KB
 // evaluation can omit a strong passage that the website itself would send,
 // especially when an all-books question needs evidence from several facets.
 const selected=selectAnswerSources(populated,item.question,'evaluation-runner-token',{
  maxSources:6,maxBytes:39_000,maxSourceBytes:35_000,history:[],
  plannedFacetCount:Math.max(0,retrieval.searchQueries.length-1),
  partQuestions});
 for(const source of selected){
  const book=manifest.books[String(source.bookId)];
  if(!book)throw Error('A selected source is absent from the published manifest.');
 }
 const answerCandidates=prepareAnswerCandidates(populated);
 // Keep expanded retrieval comparable to the browser: the Worker may receive
 // up to 48 candidates, but transport stays bounded before fingerprint checks.
 const candidatePacket=[];let candidateTextBytes=0;
 for(const source of answerCandidates){
  const bytes=new TextEncoder().encode(source.text||'').byteLength;
  if(candidatePacket.length>=retrievalConfig.maxCandidates)break;
  if(bytes<25||bytes>14000||candidateTextBytes+bytes>250000)continue;
  candidatePacket.push(source);candidateTextBytes+=bytes;
 }
 const selectionAudit=auditEvidencePacketSelection(answerCandidates,selected,item.question,partQuestions);
 const retrievalCandidates=populated.map(({bookId,title,page,globalPageId,score,facet,facetRanks,
  matchedFacets,candidatePartIds,preview,text})=>({bookId,title,page,globalPageId,score,facet,facetRanks,
  matchedFacets,candidatePartIds,excerpt:String(preview||text||'').slice(0,1200)}));
 return {selected,candidates:answerCandidates,candidatePacket,searches:retrieval.searches,
  positionCoverage:retrieval.positionCoverage,retrievalCandidates,
  selectionCoverage:auditSelectionCoverage(answerCandidates,selected,partQuestions),selectionAudit};
}
export function sourcesUsedForWorkerSelection(selection,workerSelected,submittedPool){
 // A valid no-evidence decision deliberately has no Worker-selected pages.
 // Preserve that empty set in quality audits instead of silently substituting
 // the broader retrieval packet and making it look like answer evidence.
 if(selection?.status==='no-relevant-evidence')return [];
 return workerSelected.length?workerSelected:submittedPool;
}

// Observational per-case stage timings for evaluation reports, mirroring
// the Worker trace's {stage, elapsedMs, status} stage entries. Worker
// request durations are captured from callJson's own progress events,
// which are measured after the inter-call pacing wait; local retrieval
// stages are timed around the existing calls. Recording never changes
// request flow, ordering, concurrency, or results.
function createStageTimingRecorder(progressEvent){
 const stageTimings=[];
 const requestStageMs={planner:0,'gap-planner':0,selection:0,answer:0};
 const timedProgressEvent=async event=>{
  if((event.status==='completed'||event.status==='failed')&&
   Object.hasOwn(requestStageMs,event.stage)&&Number.isFinite(event.elapsedMs))
   requestStageMs[event.stage]+=event.elapsedMs;
  return progressEvent(event);
 };
 return {stageTimings,requestStageMs,timedProgressEvent,
  record:(stage,status,elapsedMs)=>stageTimings.push({stage,elapsedMs,status}),
  attach:error=>{if(error&&typeof error==='object'&&error.requestFailure)
   error.requestFailure.stageTimings=stageTimings;}};
}
export async function evaluateLiveCase(item,{library,manifest,allowed,token,fetcher=fetch,beforeCall=async()=>{},useFixedQueries=false,preparedPlan=null,answerVariant='with-review',retrievalProfile='baseline',onProgress=async()=>{}}){
 if(!['with-review','compose-only','paired-review-ablation','with-expansion','paired-expansion-ablation','paired-selection-ablation','transport-ab'].includes(answerVariant))
  throw Error('Unsupported answer variant.');
 if(!Object.hasOwn(RETRIEVAL_PROFILES,retrievalProfile))throw Error('Unknown retrieval profile.');
 const startTime=Date.now();
 const progressEvent=async event=>onProgress({caseId:item.id,...event});
 const progress=async(stage,status,message,details={})=>progressEvent({stage,status,message,...details});
 await progress('case','started',`Starting ${answerVariant} evaluation for this question.`);
 const timing=createStageTimingRecorder(progressEvent);
 const stageTimings=timing.stageTimings;
 const selectedBookIds=Array.isArray(item.selected_book_ids)?item.selected_book_ids.map(String):[];
 const plannerBookId=selectedBookIds.length===1?selectedBookIds[0]:'';
 let plan,queries,plannerFallback=false,plannerFailure=null,plannerFailureDiagnostics=null,plannerSkipped=false,plannerReused=false,
  plannerWorkerVersionId=null,plannerWorkerSourceBuild=null,plannerWorkerSourceRevision=null;
 if(preparedPlan&&(validSearchPlan(preparedPlan.queries)||
   (preparedPlan.plannerFallback===true&&Array.isArray(preparedPlan.queries)&&
    preparedPlan.queries.length===1&&preparedPlan.queries[0]===item.question))){
  const restricted=restrictPlanToSelectedBooks(preparedPlan.plan,selectedBookIds);
  plan={...preparedPlan,plan:restricted};
  queries=preparedPlan.queries;
  plannerFallback=preparedPlan.plannerFallback===true;
  plannerReused=true;
  plannerWorkerVersionId=preparedPlan.workerVersionId||null;
  plannerWorkerSourceBuild=preparedPlan.workerSourceBuild||null;
  plannerWorkerSourceRevision=preparedPlan.workerSourceRevision||null;
  await progress('planner','reused','Reusing the paired all-books plan and queries; only the selected-book scope changes.',
   {queryCount:queries.length});
  timing.record('planner','reused',0);
 }else if(useFixedQueries&&validSearchPlan(item.planner_queries)){
  queries=item.planner_queries;
  plannerSkipped=true;
  await progress('planner','skipped','Using the fixed evaluation queries; no planner request is needed.',{queryCount:queries.length});
  timing.record('planner','skipped',0);
 }else try{
  plan=await callJson(fetcher,API+'/api/pilot-plan',token,{question:item.question,bookId:plannerBookId,history:[],turnstileToken:'evaluation-runner-token'},beforeCall,'planner',timing.timedProgressEvent);
  if(!validSearchPlan(plan?.queries)){
   const error=attachRequestFailure(new Error('Planner returned an invalid search plan.'),'planner',{httpStatus:200,failureCode:'invalid-response',failureDetail:'invalid_output',workerFailure:false});
   throw error;
  }
  queries=plan.queries;
  timing.record('planner','completed',timing.requestStageMs.planner);
  plannerWorkerVersionId=plan.workerVersionId||null;
  plannerWorkerSourceBuild=plan.workerSourceBuild||null;
  plannerWorkerSourceRevision=plan.workerSourceRevision||null;
 }catch(error){
  if(!error.requestFailure)error.requestFailure={stage:'planner',httpStatus:null,failureCode:'planner-failed',failureDetail:'unknown',message:String(error.message||error).slice(0,240),workerFailure:false};
  const failure=error.requestFailure;
  plannerWorkerVersionId=failure.workerVersionId||null;
  plannerWorkerSourceBuild=failure.workerSourceBuild||null;
  plannerWorkerSourceRevision=failure.workerSourceRevision||null;
  if(!canFallbackToDirectSearch(failure.httpStatus,failure.failureCode)){
   timing.record('planner','failed',timing.requestStageMs.planner);
   timing.attach(error);
   throw error;
  }
  timing.record('planner','fallback',timing.requestStageMs.planner);
  plannerFallback=true;
  plannerFailure={httpStatus:failure.httpStatus,failureCode:failure.failureCode};
  // Keep the established compact field stable for existing artifact readers;
  // richer safe stage/class details live beside it in a versionable field.
  plannerFailureDiagnostics={stage:'planner',workerFailureStage:failure.workerFailureStage||'planning',
   httpStatus:failure.httpStatus,failureCode:failure.failureCode,
   failureDetail:failure.failureDetail||'unknown',workerFailure:failure.workerFailure===true};
  queries=[item.question];
  await progress('planner','fallback','Planner was unavailable; continuing with the reader’s exact question.',{failureCode:failure.failureCode});
 }
 const partFacets=!plannerFallback?partFacetsFromPlan(plan?.plan?.parts):
  {partQueries:[],partQuestions:[],warnings:[]};
 const {partQueries,partQuestions}=partFacets;
 let loaded;
 await progress('retrieval','started',`Searching ${new Set([...queries,...partQueries.map(value=>value.query)]).size} distinct facets and assembling source pages.`,
  {queryCount:queries.length,partFacetCount:partQueries.length,partFacetWarnings:partFacets.warnings});
 const retrievalStarted=Date.now();
 try{loaded=await loadSources(item,queries,{library,manifest,allowed,directFallback:plannerFallback,
  partQueries,partQuestions,retrievalConfig:RETRIEVAL_PROFILES[retrievalProfile]});
  timing.record('retrieval','completed',Date.now()-retrievalStarted);}
 catch(error){error.requestFailure={stage:'retrieval',httpStatus:null,failureCode:'retrieval-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  error.requestFailure.plannerFallback=plannerFallback;
  error.requestFailure.plannerSkipped=plannerSkipped;
  error.requestFailure.plannerWorkerVersionId=plannerWorkerVersionId;
  error.requestFailure.plannerWorkerSourceBuild=plannerWorkerSourceBuild;
  error.requestFailure.plannerWorkerSourceRevision=plannerWorkerSourceRevision;
  if(plannerFailure)error.requestFailure.plannerFailure=plannerFailure;
   if(plannerFailureDiagnostics)error.requestFailure.plannerFailureDiagnostics=plannerFailureDiagnostics;
  timing.record('retrieval','failed',Date.now()-retrievalStarted);
  timing.attach(error);throw error;}
 let gapQueries=[],gapQueryPartLinks=[],gapPlannerFailure=null,gapPlannerFailureDiagnostics=null;
 const initialSearches=loaded.searches;
 const initialPositionCoverage=loaded.positionCoverage;
 const initialRetrievalCandidates=loaded.retrievalCandidates;
 const initialRetrievalCoverage=assessEvidenceCoverage(initialRetrievalCandidates,item.question,partQuestions);
 let retrievalCoverage=initialRetrievalCoverage;
 const gapSearchTriggered=initialRetrievalCoverage.shouldSearch;
 let gapRetrievalRerun=false;
 if(retrievalCoverage.shouldSearch){
  await progress('gap-planner','started','Retrieved passages leave at least one question part weakly covered; asking the librarian for optional alternate search terms.',
   {weakPartCount:retrievalCoverage.weakParts.length});
  try{
   const gap=await callJson(fetcher,API+'/api/pilot-plan',token,{question:item.question,
    bookId:plannerBookId,history:[],turnstileToken:'evaluation-runner-token',retrievalGap:{
     weakParts:retrievalCoverage.weakParts.slice(0,6).map(part=>({partId:part.partId,part:part.question,
      ...(Array.isArray(part.sourceBookIds)?{sourceBookIds:part.sourceBookIds.slice(0,16)}:{}),
      overlap:part.overlap,matchedTerms:part.matchedTerms,
      distinctiveTerms:part.distinctiveTerms,matchedDistinctiveTerms:part.matchedDistinctiveTerms,
      sharedMatchedTerms:part.sharedMatchedTerms,
      coverageReason:part.coverageReason,coverageSource:part.coverageSource})),
     originalQueries:[...queries,...partQueries.map(value=>value.query)].slice(0,7),
     candidates:loaded.retrievalCandidates.slice(0,6).map(source=>({title:source.title,excerpt:source.excerpt.slice(0,420)}))
    }},beforeCall,'gap-planner',timing.timedProgressEvent);
   if(!Array.isArray(gap?.queries)||gap.queries.length>3||gap.queries.some(value=>
     typeof value!=='string'||value.trim().length<8||value.trim().length>160))
    throw attachRequestFailure(new Error('Conditional retrieval planner returned invalid queries.'),
     'gap-planner',{httpStatus:200,failureCode:'invalid-response',failureDetail:'invalid_output',workerFailure:false});
   gapQueries=[...new Set(gap.queries.map(value=>value.trim()))];
   const weakPartIds=new Set(retrievalCoverage.weakParts.slice(0,6).map(part=>part.partId));
   gapQueryPartLinks=Array.isArray(gap.queryPartLinks)?gap.queryPartLinks.filter(link=>
    link&&typeof link.query==='string'&&gapQueries.some(query=>
      query.toLocaleLowerCase()===link.query.trim().toLocaleLowerCase())&&
    Array.isArray(link.partIds)&&link.partIds.length>0&&
    link.partIds.every(id=>weakPartIds.has(id))):[];
   if(!gapQueryPartLinks.length&&weakPartIds.size===1)
    gapQueryPartLinks=gapQueries.map(query=>({query,partIds:[[...weakPartIds][0]]}));
   await progress('gap-planner','completed',`Conditional retrieval returned ${gapQueries.length} optional search terms.`,
    {queryCount:gapQueries.length,usage:gap.usage||null});
   timing.record('gap-planner','completed',timing.requestStageMs['gap-planner']);
   if(gapQueries.length){
    const gapRetrievalStarted=Date.now();
    try{
     loaded=await loadSources(item,queries,{library,manifest,allowed,directFallback:plannerFallback,
      partQueries,partQuestions,gapQueries,gapQueryPartLinks,retrievalConfig:RETRIEVAL_PROFILES[retrievalProfile]});
     gapRetrievalRerun=true;
     retrievalCoverage=assessEvidenceCoverage(loaded.retrievalCandidates,item.question,partQuestions);
     timing.record('gap-retrieval','completed',Date.now()-gapRetrievalStarted);
    }catch(rerunError){
     timing.record('gap-retrieval','failed',Date.now()-gapRetrievalStarted);
     throw rerunError;
    }
   }
  }catch(error){
   const failure=error.requestFailure||{};
   const gapPlannerRecorded=stageTimings.some(entry=>entry.stage==='gap-planner');
   if(!canFallbackToDirectSearch(failure.httpStatus,failure.failureCode)){
    if(!gapPlannerRecorded)timing.record('gap-planner','failed',timing.requestStageMs['gap-planner']);
    failure.gapPlannerAttempted=true;error.requestFailure=failure;
    error.requestFailure.stageTimings=stageTimings;throw error;
   }
   if(!gapPlannerRecorded)timing.record('gap-planner','fallback',timing.requestStageMs['gap-planner']);
   gapPlannerFailure=failure.failureCode||'gap-planning-failed';
   gapPlannerFailureDiagnostics={stage:'gap-planner',workerFailureStage:failure.workerFailureStage||'gap-planning',
    httpStatus:failure.httpStatus,failureCode:gapPlannerFailure,
    failureDetail:failure.failureDetail||'unknown',workerFailure:failure.workerFailure===true};
   await progress('gap-planner','recovered','Conditional search planning failed; continuing with the original verified retrieval packet.',
    {failureCode:gapPlannerFailure,failureDetail:gapPlannerFailureDiagnostics.failureDetail});
  }
 }
 if(!loaded.candidatePacket.length){
  const error=attachRequestFailure(new Error('Retrieval produced no fingerprint-eligible candidate pages.'),
   'retrieval',{failureCode:'no-eligible-sources',workerFailure:false});
  error.requestFailure.gapPlannerAttempted=gapSearchTriggered;
  if(gapPlannerFailure)error.requestFailure.gapPlannerFailure=gapPlannerFailure;
  error.requestFailure.stageTimings=stageTimings;
  throw error;
 }
 const {selected,searches,retrievalCandidates}=loaded;
 const retrievalFallbackCount=searches.filter(value=>value.fallbackFrom).length;
 await progress('retrieval','completed',`Retrieved ${searches.reduce((sum,value)=>sum+(Number(value.resultCount)||0),0)} indexed matches; assembled ${loaded.candidatePacket.length} verified candidate pages for Worker selection.`+
  (retrievalFallbackCount?` Recovered ${retrievalFallbackCount} empty source-side search using the counterpart topic within the planned source scope.`:''),
  {searchCount:searches.length,retrievalFallbackCount,candidatePages:retrievalCandidates.map(source=>({bookId:source.bookId,page:source.page,partIds:source.candidatePartIds||[]})),
   selectedPages:selected.map(source=>({bookId:source.bookId,page:source.page,partIds:source.candidatePartIds||[]}))});
 let selectionComparison=null;
 if(answerVariant==='paired-selection-ablation')selectionComparison={
  status:'candidate-pool-comparison',candidateCount:loaded.candidatePacket.length,
  selectionMethod:'Worker semantic selector after fingerprint verification',
  narrowPool:loaded.selected.map(candidate=>({bookId:candidate.bookId,title:candidate.title,page:candidate.page})),
  fullPool:loaded.candidatePacket.map(candidate=>({bookId:candidate.bookId,title:candidate.title,page:candidate.page}))};
 const transportOrder=(Array.from(String(item.id)).reduce((sum,char)=>sum+char.charCodeAt(0),Number(item.repeatAttempt)||0)%2)===1?['streaming','default']:['default','streaming'];
 const variants=answerVariant==='transport-ab'?transportOrder:
  answerVariant==='paired-review-ablation'?['with-review','compose-only']:
  answerVariant==='paired-expansion-ablation'?['with-review','with-expansion']:
  answerVariant==='paired-selection-ablation'?['narrow-retrieval-pool','full-retrieval-pool']:[answerVariant];
 const variantResults=[];
 let selectionSnapshot=null;
 let sharedSelectionResult=null,sharedSelectionFailure=null,sharedSelectionElapsedMs=0;
 if(answerVariant==='transport-ab'){
  await progress('selection','started','Selecting and verifying one evidence packet for both answer transports.');
  await beforeCall();
  const selectionStarted=Date.now();
  try{
   sharedSelectionResult=await callJson(fetcher,API+'/api/pilot-answer',token,{question:item.question,
    bookId:plannerBookId,plan:plan?.plan||undefined,history:[],turnstileToken:'evaluation-runner-token',
    answerVariant:'with-review',selectionOnly:true,
    sources:loaded.candidatePacket.map(({bookId,page,text,candidatePartIds})=>({bookId,page,text,
     ...(Array.isArray(candidatePartIds)?{candidatePartIds}:{}),libraryVersion:49}))},async()=>{},'selection',timing.timedProgressEvent);
   sharedSelectionElapsedMs=Date.now()-selectionStarted;
   if(sharedSelectionResult.selectionOnly!==true||!Array.isArray(sharedSelectionResult.selectionSnapshot))
    throw attachRequestFailure(new Error('Worker did not confirm shared evaluation evidence selection.'),'selection',
     {httpStatus:200,failureCode:'selection-snapshot-invalid',workerFailure:false});
   selectionSnapshot=sharedSelectionResult.selectionSnapshot;
   timing.record('selection','completed',sharedSelectionElapsedMs);
   await progress('selection','completed','One verified evidence packet is ready for both transport paths.',
    {sourceCount:selectionSnapshot.length,requestElapsedMs:sharedSelectionElapsedMs,
     usage:sharedSelectionResult.sourceSelection?.usage||null});
  }catch(error){
   sharedSelectionElapsedMs=Date.now()-selectionStarted;
   sharedSelectionFailure=error.requestFailure||{stage:'selection',httpStatus:null,
    failureCode:'selection-request-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
   if(Array.isArray(sharedSelectionFailure.selectionSnapshot))selectionSnapshot=sharedSelectionFailure.selectionSnapshot;
   timing.record('selection','failed',sharedSelectionElapsedMs);
   await progress('selection','failed','Shared evidence selection failed; both transport answers are recorded as unavailable.',
    {requestElapsedMs:sharedSelectionElapsedMs,failureCode:sharedSelectionFailure.failureCode});
  }
 }
 const sharedRealWorkStageSumMs=stageTimings.filter(entry=>entry.stage!=='answer'&&Number.isFinite(entry.elapsedMs))
  .reduce((sum,entry)=>sum+entry.elapsedMs,0);
 try{
  for(const variant of variants){
   if(answerVariant==='transport-ab'){
    const inferenceTransport=variant;
    if(sharedSelectionFailure){
     timing.record(`answer-${inferenceTransport}`,'skipped',0);
     variantResults.push({answerVariant:'with-review',inferenceTransport,requestElapsedMs:0,
      realWorkStageSumMs:sharedRealWorkStageSumMs,noAnswerFailure:true,answerText:'',outcome:'shared-selection-failed',
      structuralPassed:false,passed:false,requestFailure:sharedSelectionFailure,
      ...(Array.isArray(sharedSelectionFailure.transportDiagnostics)?{evidenceTrace:{inferenceCalls:sharedSelectionFailure.transportDiagnostics}}:{})});
     continue;
    }
    const answerSources=loaded.candidatePacket;
    await progress('answer','started',`Submitting ${answerSources.length} verified candidates using ${inferenceTransport} inference transport.`,
     {variant:inferenceTransport,sourceCount:answerSources.length});
    await beforeCall();
    const requestStarted=Date.now();
    try{
     const data=await callJson(fetcher,API+'/api/pilot-answer',token,{question:item.question,
      bookId:plannerBookId,plan:plan?.plan||undefined,history:[],turnstileToken:'evaluation-runner-token',
      answerVariant:'with-review',inferenceTransport,
      ...(selectionSnapshot!==null?{selectionSnapshot}:{}),
      sources:answerSources.map(({bookId,page,text,candidatePartIds})=>({bookId,page,text,
       ...(Array.isArray(candidatePartIds)?{candidatePartIds}:{}),libraryVersion:49}))},async()=>{},'answer',timing.timedProgressEvent);
     const requestElapsedMs=Date.now()-requestStarted;
     if(Array.isArray(data.selectionSnapshot))selectionSnapshot=data.selectionSnapshot;
     if(data.inferenceTransport!==inferenceTransport)
      throw attachRequestFailure(new Error('Worker did not confirm the requested inference transport.'),'answer',
       {httpStatus:200,failureCode:'transport-mismatch',failureDetail:'unconfirmed-transport',workerFailure:false});
     const candidateByLocator=new Map(loaded.candidates.map(source=>[String(source.bookId)+':'+source.page,source]));
     const workerSelected=(Array.isArray(data.sourceSelection?.pages)?data.sourceSelection.pages:[])
      .map(source=>{const candidate=candidateByLocator.get(String(source.bookId)+':'+source.page);
       return candidate?{...candidate,id:source.id,candidatePartIds:source.candidatePartIds||[]}:null;}).filter(Boolean);
     const submitted=sourcesUsedForWorkerSelection(data.sourceSelection,workerSelected,answerSources);
     const audit=auditLiveAnswer(data,submitted,item.required_source_groups,item.required_part_source_groups||[],
      {scope:item.selected_book_ids?.length?'selected-books':'all-books',plannerPlan:plan?.plan||null,candidateSources:retrievalCandidates});
     timing.record(`answer-${inferenceTransport}`,'completed',requestElapsedMs);
     variantResults.push({answerVariant:'with-review',inferenceTransport,requestElapsedMs,
      realWorkStageSumMs:sharedRealWorkStageSumMs+requestElapsedMs,
      selectionStatus:data.sourceSelection?.status||null,
      selectionCoverage:auditSelectionCoverage(loaded.candidates,submitted,partQuestions),
      selectionAudit:auditEvidencePacketSelection(loaded.candidates,submitted,item.question,partQuestions),
      submittedSources:submitted.map(({bookId,title,page,globalPageId,preview,candidatePartIds})=>({bookId,title,page,globalPageId,candidatePartIds,excerpt:String(preview||'').slice(0,1200)})),
      pipeline:data.pipeline||null,...audit,usage:data.usage||null,
      ...(data.trace?{evidenceTrace:data.trace}:{})});
     await progress('answer','completed',`${inferenceTransport} returned ${audit.outcome||'no outcome'} with ${audit.coverage} coverage and ${audit.citationCount} citations.`,
      {variant:inferenceTransport,outcome:audit.outcome,coverage:audit.coverage,citations:audit.citationCount,
       requestElapsedMs,usage:data.usage||null});
     const transportTraceParts=traceSummaryParts(data.trace,audit);
     if(transportTraceParts.length)
      await progress('trace','summary',transportTraceParts.join('; '),{variant:inferenceTransport});
    }catch(error){
     const requestElapsedMs=Date.now()-requestStarted;
     timing.record(`answer-${inferenceTransport}`,'failed',requestElapsedMs);
     const failure=error.requestFailure||{stage:'answer',httpStatus:null,failureCode:'answer-failed',
      message:String(error.message||error).slice(0,240),workerFailure:false};
     if(Array.isArray(failure.selectionSnapshot))selectionSnapshot=failure.selectionSnapshot;
     variantResults.push({answerVariant:'with-review',inferenceTransport,requestElapsedMs,
      realWorkStageSumMs:sharedRealWorkStageSumMs+requestElapsedMs,noAnswerFailure:true,answerText:'',
      outcome:'request-failed',structuralPassed:false,passed:false,requestFailure:failure,
      ...(Array.isArray(failure.transportDiagnostics)?{evidenceTrace:{inferenceCalls:failure.transportDiagnostics}}:{})});
     await progress('answer','failed',`${inferenceTransport} request failed (${failure.failureCode||'answer-failed'}).`,
      {variant:inferenceTransport,requestElapsedMs,failureCode:failure.failureCode||'answer-failed'});
    }
    continue;
   }
   const answerSources=variant==='narrow-retrieval-pool'?selected:loaded.candidatePacket;
   await progress('answer','started',`Submitting ${answerSources.length} verified retrieval candidates; the Worker will select evidence before composition.`,
    {variant,sourceCount:answerSources.length});
   const data=await callJson(fetcher,API+'/api/pilot-answer',token,{question:item.question,
    bookId:plannerBookId,plan:plan?.plan||undefined,history:[],turnstileToken:'evaluation-runner-token',
    answerVariant:variant==='compose-only'?'compose-only':variant==='with-expansion'?'with-expansion':'with-review',
    // The evaluator loads v49 text; the Worker defaults omitted versions to v48.
    // Match the live client handoff so offline acceptance runs exercise the
    // same part-linked evidence packet that the Worker receives in production.
    sources:answerSources.map(({bookId,page,text,candidatePartIds})=>({bookId,page,text,
     ...(Array.isArray(candidatePartIds)?{candidatePartIds}:{}),libraryVersion:49}))},beforeCall,'answer',timing.timedProgressEvent);
   const candidateByLocator=new Map(loaded.candidates.map(source=>[String(source.bookId)+':'+source.page,source]));
   const workerSelected=(Array.isArray(data.sourceSelection?.pages)?data.sourceSelection.pages:[])
    .map(source=>{
     const candidate=candidateByLocator.get(String(source.bookId)+':'+source.page);
     return candidate?{...candidate,id:source.id,candidatePartIds:source.candidatePartIds||[]}:null;
    }).filter(Boolean);
   const submitted=sourcesUsedForWorkerSelection(data.sourceSelection,workerSelected,answerSources);
   const audit=auditLiveAnswer(data,submitted,item.required_source_groups,
    item.required_part_source_groups||[],{scope:item.selected_book_ids?.length?'selected-books':'all-books',
     plannerPlan:plan?.plan||null,candidateSources:retrievalCandidates});
   variantResults.push({answerVariant:answerVariant==='paired-selection-ablation'?'with-review':variant,
    selectionVariant:answerVariant==='paired-selection-ablation'?variant:null,
    inferenceTransport:data.inferenceTransport||null,
    selectionStatus:data.sourceSelection?.status||null,
    selectionCoverage:auditSelectionCoverage(loaded.candidates,submitted,partQuestions),
    selectionAudit:auditEvidencePacketSelection(loaded.candidates,submitted,item.question,partQuestions),
    submittedSources:submitted.map(({bookId,title,page,globalPageId,preview,candidatePartIds})=>({bookId,title,page,globalPageId,candidatePartIds,excerpt:String(preview||'').slice(0,1200)})),
    pipeline:data.pipeline||null,...audit,usage:data.usage||null,
    ...(data.trace?{evidenceTrace:data.trace}:{})});
   await progress('answer','completed',`${variant} returned ${audit.outcome||'no outcome'} with ${audit.coverage} coverage and ${audit.citationCount} citations.`,
    {variant,outcome:audit.outcome,coverage:audit.coverage,citations:audit.citationCount,usage:data.usage||null});
   const traceParts=traceSummaryParts(data.trace,audit);
   if(traceParts.length)
    await progress('trace','summary',traceParts.join('; '),{variant});
  }
  if(answerVariant!=='transport-ab')timing.record('answer','completed',timing.requestStageMs.answer);
 }catch(error){if(!error.requestFailure)error.requestFailure={stage:'answer',httpStatus:null,failureCode:'answer-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  error.requestFailure.plannerFallback=plannerFallback;
  error.requestFailure.plannerSkipped=plannerSkipped;
  error.requestFailure.plannerWorkerVersionId=plannerWorkerVersionId;
  error.requestFailure.plannerWorkerSourceBuild=plannerWorkerSourceBuild;
  error.requestFailure.plannerWorkerSourceRevision=plannerWorkerSourceRevision;
  if(plannerFailure)error.requestFailure.plannerFailure=plannerFailure;
  timing.record('answer','failed',timing.requestStageMs.answer);
  timing.attach(error);throw error;}
 const primary=variantResults.find(result=>result.inferenceTransport==='default'&&!result.noAnswerFailure)||
  variantResults.find(result=>!result.noAnswerFailure)||variantResults.find(result=>result.inferenceTransport==='default')||
  variantResults.find(result=>result.answerVariant==='with-review')||variantResults[0];
 const answerVariantComparison=['transport-ab','paired-review-ablation','paired-expansion-ablation','paired-selection-ablation'].includes(answerVariant)?{
  ...(answerVariant==='transport-ab'?{protocol:'Same planner output, retrieval, selected candidates, answer variant and budgets; only inference transport differs.',
   transportOrder,sharedRealWorkStageSumMs,
   sharedSelection:{status:sharedSelectionFailure?'failed':sharedSelectionResult?'completed':'not-run',
    requestElapsedMs:sharedSelectionElapsedMs,sourceSelectionStatus:sharedSelectionResult?.sourceSelectionStatus||null,
    usage:sharedSelectionResult?.sourceSelection?.usage||null,
    ...(sharedSelectionFailure?{failureCode:sharedSelectionFailure.failureCode}:{}),
    selectionSnapshotPages:Array.isArray(selectionSnapshot)?selectionSnapshot.length:null},
   realWorkStageSumDefinition:'shared planner, retrieval, optional gap-planner/retrieval and one shared selection request plus this transport variant’s answer endpoint request duration; excludes harness pacing'}:{}),
  ...(answerVariant==='paired-selection-ablation'?{selectionComparison}:{}),
  comparison:answerVariant==='transport-ab'?
   'Paired transport test. Both paths buffer a complete answer before returning it; streaming is not expected to reduce successful generation time automatically. It tests stream cancellation behavior at the same deadline while recording complete-request latency.':
   answerVariant==='paired-expansion-ablation'?
   'Same resolved question and submitted pages; compare ordinary composition with post-composition expansion before the same evidence review.':
   answerVariant==='paired-selection-ablation'?
   'Both answers use the same verified Worker semantic selector, composer and reviewer; compare a six-page browser candidate pool with the full retrieved candidate pool.':
   'Same resolved question, planner result and submitted source pages; only the final model-review call is omitted in compose-only',
  variants:variantResults
 }:null;
 return {id:item.id,question:item.question,discipline:item.discipline||'',evaluationScope:item.evaluation_scope||(item.selected_book_ids?.length?'selected-books':'all-books'),selectedBookIds:Array.isArray(item.selected_book_ids)?item.selected_book_ids:[],
  reviewFocus:Array.isArray(item.review_focus)?item.review_focus:[],plannerSkipped,plannerReused,
  plannerQueries:plannerFallback?[]:queries,plannerFallback,
  plannerWorkerVersionId,plannerWorkerSourceBuild,plannerWorkerSourceRevision,answerWorkerVersionId:primary.workerVersionId,answerWorkerSourceBuild:primary.workerSourceBuild,answerWorkerSourceRevision:primary.workerSourceRevision,
  ...(plannerFailure?{plannerFailure}:{}),...(plannerFailureDiagnostics?{plannerFailureDiagnostics}:{}),plannerPlan:plan?.plan||null,
  searchesBeforeGap:initialSearches,retrievalCandidatesBeforeGap:initialRetrievalCandidates,
  searches,retrievalCandidates,
  positionCoverageBeforeGap:initialPositionCoverage,positionCoverage:loaded.positionCoverage,
  retrievalCoverage:{triggered:gapSearchTriggered,
   parts:initialRetrievalCoverage.parts,weakParts:initialRetrievalCoverage.weakParts},
  ...(gapRetrievalRerun?{retrievalCoverageAfterGap:{parts:retrievalCoverage.parts,
   weakParts:retrievalCoverage.weakParts}}:{}),
  gapPlannerAttempted:gapSearchTriggered,gapQueries,gapQueryPartLinks,
  retrievalBaselineSelectionCoverage:loaded.selectionCoverage,
  retrievalBaselineSelectionAudit:loaded.selectionAudit,
  ...(gapPlannerFailure?{gapPlannerFailure,gapPlannerFailureDiagnostics}:{}),
  submittedSources:primary.submittedSources||[],sourceSelectionStatus:primary.selectionStatus||null,
  deterministicBaselineSources:selected.map(({bookId,title,page,globalPageId,preview,candidatePartIds})=>({bookId,title,page,globalPageId,candidatePartIds,
   excerpt:String(preview||'').slice(0,1200)})),
  ...primary,answerWorkerVersionId:primary.workerVersionId,answerWorkerSourceBuild:primary.workerSourceBuild,answerWorkerSourceRevision:primary.workerSourceRevision,
  pipeline:variantResults.map(result=>result.pipeline).find(Boolean)||null,
  partFacetWarnings:partFacets.warnings,
  answerVariant,retrievalProfile,...(answerVariantComparison?{answerVariantComparison}:{}),
  ...(answerVariant==='paired-review-ablation'?{reviewAblation:answerVariantComparison}:{}),
  stageTimings,
  elapsedMs:Date.now()-startTime};
}
export async function evaluatePlannerCase(item,{library,manifest,allowed,token,fetcher=fetch,beforeCall=async()=>{},onProgress=async()=>{}}={}){
 const startTime=Date.now();
 const progressEvent=async event=>onProgress({caseId:item.id,...event});
 const progress=async(stage,status,message,details={})=>progressEvent({stage,status,message,...details});
 const timing=createStageTimingRecorder(progressEvent);
 await progress('case','started','Starting planner-only retrieval evaluation.');
 const selectedBookIds=Array.isArray(item.selected_book_ids)?item.selected_book_ids.map(String):[];
 const plannerBookId=selectedBookIds.length===1?selectedBookIds[0]:'';
 let plan;
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
export const BATCH22_ACCEPTANCE_THRESHOLDS={
 answerProducedMeanMinimum:7.9,highlightProducedMeanMinimum:8.4,
 captureRateMinimum:0.92,citationSupportMeanMinimum:1.5,
 stageSumLatencyMedianMaximumMs:85000,
 unverifiedSourceDraftShipmentsMaximum:0,shippedMisattributionsMaximum:0,
 sourceRequiredPartsShippedUncitedMaximum:0,citationGateRepairThrowsMaximum:0,
 completeness:{citationBands:{two:'at least 90%',one:'50–89%',zero:'below 50%'},
  highlightBands:{two:'at least 90%',one:'50–89%',zero:'below 50%'},
  computation:'scripted from answer-to-citation and answer-to-highlight linkage'},
 scoringOrder:'claim audits first; then rubric-v2 answer and highlight scoring; report produced and completion-adjusted means',
 sample:'combine library-all and library-selected reports for passes 1 and 2 to score the registered 32 cases'
};
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
 const args=parseArgs(process.argv.slice(2));if(args.help){console.log('Usage: PILOT_EVALUATION_TOKEN=... node reading-companion/live-answer-evaluation.mjs --confirm-live-ai true [--mode planner|smoke|quality|focused|paired|holdout|acceptance|fresh|fresh3|handoff|philosophy3|library-all|library-selected|library-all-3|library-selected-3|transport-ab|full] [--scope selected-books|all-books|case-default|paired] [--answer-variant with-review|compose-only|paired-review-ablation|paired-expansion-ablation|paired-selection-ablation|transport-ab] [--retrieval-profile baseline|expanded] [--case case-id] [--repeat 1..3] [--report-only true] [--output report.json]');return 0;}
 if(!args.confirm)throw Error('Live AI calls are disabled unless --confirm-live-ai true is provided.');
 if(!['with-review','compose-only','paired-review-ablation','paired-expansion-ablation','paired-selection-ablation','transport-ab'].includes(args.answerVariant))throw Error('Unsupported answer variant.');
 if(!Object.hasOwn(RETRIEVAL_PROFILES,args.retrievalProfile))throw Error('Unknown retrieval profile.');
 const usesEvaluationMode=['quality','focused','paired','holdout','acceptance','fresh','fresh3','handoff','philosophy3','library-all','library-selected','library-all-3','library-selected-3','transport-ab','batch18-acceptance','batch19-acceptance','batch21-compact-acceptance'].includes(args.mode);
 if(args.mode==='paired'&&args.scope!=='paired')throw Error('The paired suite must use paired scope.');
 if(!usesEvaluationMode&&args.scope!=='selected-books')throw Error('The all-books scope is available only in a supported evaluation suite.');
 if(usesEvaluationMode&&args.mode!=='paired'&&args.mode!=='fresh'&&args.mode!=='fresh3'&&args.mode!=='handoff'&&args.mode!=='philosophy3'&&args.mode!=='library-all'&&args.mode!=='library-selected'&&args.mode!=='library-all-3'&&args.mode!=='library-selected-3'&&args.mode!=='transport-ab'&&args.mode!=='batch18-acceptance'&&args.mode!=='batch19-acceptance'&&args.mode!=='batch21-compact-acceptance'&&!['selected-books','all-books'].includes(args.scope))throw Error('Evaluation scope must be selected-books or all-books.');
 if((args.mode==='fresh'||args.mode==='fresh3'||args.mode==='handoff'||args.mode==='philosophy3'||args.mode==='library-all'||args.mode==='library-selected'||args.mode==='library-all-3'||args.mode==='library-selected-3'||args.mode==='transport-ab'||args.mode==='batch18-acceptance'||args.mode==='batch19-acceptance'||args.mode==='batch21-compact-acceptance')&&args.scope!=='case-default')throw Error('Fresh, handoff and phase-2/phase-3 library question suites must use case-default scope.');
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
  ...(['library-all','library-selected'].includes(args.mode)?{experiment:'batch-22-full-phase2-validation',
   protocol:'One of four report segments in the registered 32-case validation. Combine library-all and library-selected reports from passes 1 and 2. Claim audits precede rubric-v2 scoring.',
   phase2Rubric:{version:'v2',scale:{min:0,max:2},
    answerDimensions:MANUAL_REVIEW_DIMENSIONS,highlightDimensions:HIGHLIGHT_REVIEW_DIMENSIONS},
   qualityProtocolStatus:'semantic scoring pending; complete claim audits first, then score every produced answer and highlight set',
   acceptanceThresholds:BATCH22_ACCEPTANCE_THRESHOLDS}:{}),
  ...(['library-all-3','library-selected-3'].includes(args.mode)?{experiment:'phase3-new-suites-validation',
   protocol:'One of four report segments in the phase-3 validation. Combine library-all-3 and library-selected-3 reports from passes 1 and 2. Claim audits precede rubric-v2 scoring.',
   phase2Rubric:{version:'v2',scale:{min:0,max:2},
    answerDimensions:MANUAL_REVIEW_DIMENSIONS,highlightDimensions:HIGHLIGHT_REVIEW_DIMENSIONS},
   qualityProtocolStatus:'semantic scoring pending; complete claim audits first, then score every produced answer and highlight set',
   acceptanceThresholds:BATCH22_ACCEPTANCE_THRESHOLDS}:{}),
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
   const missReasons=result.passed===false&&!result.requestFailure?structuralFailureReasons(result):[];
   console.log((result.passed===true?label+'-PASS':result.passed===null?'UNSCORED':result.requestFailure?'REQUEST-FAIL':label+'-MISS')+' '+result.id+': '+(result.outcome||result.requestFailure?.failureCode||'no outcome')+(missReasons.length?' [failed: '+missReasons.join(', ')+']':''));
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
   citationGateIntegrity:summarizeCitationGateIntegrity(report.cases),
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
  if(['library-all','library-selected','library-all-3','library-selected-3'].includes(args.mode)){
   const shippedConflicts=report.cases.reduce((count,item)=>{
    const shipped=new Set((item.questionParts||[]).flatMap(part=>part.claimIds||[]));
    return count+(item.evidenceTrace?.reviewContract?.reviewDecisions||[]).filter(decision=>
     decision.accepted===true&&shipped.has(decision.claimId)&&
     ['conflict','unclear'].includes(decision.attributionStatus)||
     decision.accepted===true&&shipped.has(decision.claimId)&&
     ['conflict','unclear'].includes(decision.subjectAttributionStatus)).length;
   },0);
   report.summary.batch22Metrics={...summarizeBatch22Metrics(report.cases),
    unverifiedSourceDraftShipments:report.cases.filter(item=>item.outcome==='unverified-source-draft').length,
    reviewedShippedAttributionConflicts:shippedConflicts,
    citationGateIntegrity:report.summary.citationGateIntegrity};
  }
  // Batch 35 (B35-4): the firing census rides the pass result JSON as
  // an additive field and prints as one log block after the last case.
  // Planner mode records no answer traces by design, so it is skipped
  // there rather than reporting a wall of false NEVER FIRED flags.
  if(args.mode!=='planner')report.firingCensus=firingCensusForCases(report.cases);
  await saveReport();
  if(args.mode!=='planner')
   for(const line of firingCensusLines(report.firingCensus))console.log(line);
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

