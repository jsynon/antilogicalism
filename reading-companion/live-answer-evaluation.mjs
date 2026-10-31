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
 const partQueries=[],partQuestions=[],warnings=[];
 if(!Array.isArray(parts))return {partQueries,partQuestions,warnings};
 const seenQueries=new Set();
 for(const part of parts){
  const partId=typeof part?.id==='string'?part.id.trim():'';
  const question=part?.question;
  if(!PART_ID.test(partId)||!validPartText(question)){
   warnings.push('invalid-part');
   continue;
  }
  partQuestions.push({partId,question:question.trim(),
   sourceBookIds:Array.isArray(part.sourceBookIds)?part.sourceBookIds.map(String):null});
  const proposed=Array.isArray(part.searchQueries)&&part.searchQueries.length
   ?part.searchQueries:[question];
  let candidates=proposed.filter(validPartText).map(value=>value.trim());
  if(candidates.length!==proposed.length)warnings.push('invalid-part-query-dropped');
  if(!candidates.length){
   candidates=[question.trim()];
   warnings.push('invalid-part-query-fallback');
  }
  for(const query of candidates){
   const key=query.toLocaleLowerCase();
   if(seenQueries.has(key)){
    if(partQueries.length<12)partQueries.push({partId,query});
    else warnings.push('part-query-budget-exceeded');
    continue;
   }
   if(seenQueries.size>=6||partQueries.length>=12){
    warnings.push('part-query-budget-exceeded');
    continue;
   }
   seenQueries.add(key);
   partQueries.push({partId,query});
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
 const evaluationCases=mode==='holdout'?HOLDOUT_CASES:mode==='acceptance'?ACCEPTANCE_CASES:
  mode==='quality'&&caseId&&caseId!=='all'?[...QUALITY_CASES,...FOCUSED_CASES]:
  mode==='focused'?FOCUSED_CASES:mode==='paired'?PAIRED_CASES:QUALITY_CASES;
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
  if(!['quality','focused','paired','holdout','acceptance'].includes(mode))throw Error('A specific case can be selected only in quality, focused, paired, holdout or acceptance mode.');
  const selected=evaluationCases.find(item=>item.id===caseId);
  if(!selected)throw Error('Unknown '+mode+' case: '+caseId);
  return [copyEvaluationCase(selected)];
 }
 if(mode==='quality')return QUALITY_CASES.map(copyEvaluationCase);
 if(mode==='focused')return FOCUSED_CASES.map(copyEvaluationCase);
 if(mode==='paired')return PAIRED_CASES.map(copyEvaluationCase);
 if(mode==='holdout')return HOLDOUT_CASES.map(copyEvaluationCase);
 if(mode==='acceptance')return ACCEPTANCE_CASES.map(copyEvaluationCase);
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
 throw Error('Mode must be smoke, planner, quality, focused, paired, holdout, acceptance, or full.');
}
export function applyQualityScope(cases,scope='selected-books'){
 if(!['selected-books','all-books'].includes(scope))
  throw Error('Evaluation scope must be selected-books or all-books.');
 if(scope==='selected-books')return cases;
 return cases.map(item=>({...item,selected_book_ids:[]}));
}
export function evaluationUsesLivePlanner(mode,scope){
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
 // Keep this diagnostic inspection-only: shared source IDs connect a quote to
 // candidate answer sentences, but neither that link nor quote location proves
 // that the excerpt supports the sentence's meaning.
 const answerSentences=String(answer||'')
  .split(/(?<=[.!?])\s+(?=[\p{Lu}"“‘(])/u)
  .map(text=>text.trim()).filter(Boolean)
  .map((text,index)=>({index:index+1,text,
   sourceIds:auditCitationIds(text,citations).inlineIds}));
 const excerpts=(Array.isArray(evidenceHighlights)?evidenceHighlights:[]).flatMap(item=>{
  const sourceId=String(item?.sourceId||'');
  const quotes=Array.isArray(item?.quotes)&&item.quotes.length?item.quotes:[item];
  return quotes.map(quote=>({sourceId,page:Number.isSafeInteger(item?.page)?item.page:null,
   claimId:String(quote?.claimId||item?.claimId||''),
   partId:String(quote?.partId||''),point:String(quote?.point||item?.point||''),
   quote:String(quote?.quote||item?.quote||''),
   quoteLocated:typeof quote?.quoteLocated==='boolean'?quote.quoteLocated:
    typeof item?.quoteLocated==='boolean'?item.quoteLocated:null,
   answerSentenceIndexes:answerSentences.filter(sentence=>sentence.sourceIds.includes(sourceId))
    .map(sentence=>sentence.index)}));
 }).filter(item=>item.sourceId&&item.quote);
 return {method:'inspection-only',linkage:'shared-citation-source-id',
  semanticRelevanceScored:false,
  limitation:'A located quote and a shared citation identify a candidate link; inspect the answer sentence and passage to judge relevance.',
  answerSentences,excerpts};
}
function answerDeniesSupportedComparison(part,answer){
 if(part?.status!=='supported'||!/\b(?:compare|comparison|contrast|differ|difference|different|distinguish)\b/i.test(String(part?.part||'')))return false;
 const text=String(answer||'');
 const explicitGap=/(?:\b(?:cannot|can't|does not|doesn't|do not|don't|unable to|fails? to)\b.{0,90}\b(?:establish|demonstrate|support|show|provide|contain|identify|determine|compare|distinguish)\b.{0,70}\b(?:comparison|contrast|difference|distinction)\b|\b(?:no|not enough|insufficient)\s+(?:direct\s+)?(?:evidence|support|basis|comparison|contrast|difference|distinction)\b|\b(?:comparison|contrast|difference|distinction)\s+(?:is\s+)?(?:not directly stated|cannot be established|is not established)\b|\b(?:texts?|passages?|excerpts?|evidence)\b.{0,80}\b(?:do not|don't|does not|doesn't|cannot|can't)\b.{0,50}\b(?:contain|establish|support|show|provide)\b.{0,40}\b(?:comparison|contrast|difference|distinction)\b)/i.test(text);
 const givesContrast=/\b(?:whereas|by contrast|in contrast|unlike|differs? from|different from|the difference is|differ in|contrasts? with)\b/i.test(text);
 return explicitGap&&!givesContrast;
}
function summarizeCaseReviewerLabels(item){
 const contract=item?.evidenceTrace?.reviewContract;
 if(!contract||typeof contract!=='object')return {available:false};
 const supportIssues=Array.isArray(contract.supportIssues)?contract.supportIssues:[];
 const incompleteReasons=new Set(['missing-claim-source-decision','missing-claim-source-span']);
 const partDecisions=Array.isArray(contract.partDecisions)?contract.partDecisions:[];
 const reviewDecisions=Array.isArray(contract.reviewDecisions)?contract.reviewDecisions:[];
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
  incompleteSupportIssueCount:supportIssues.filter(issue=>
   incompleteReasons.has(String(issue?.reason||''))).length};
}
export function summarizeReviewerLabels(cases){
 const entries=(cases||[]).map(item=>({id:String(item?.id||''),
  attemptNumber:Number.isInteger(item?.attemptNumber)?item.attemptNumber:null,
  reviewStatus:String(item?.reviewStatus||''),
  labels:item?.reviewerLabels||item?.offlineRecheck?.reviewerLabels||summarizeCaseReviewerLabels(item)}));
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
  incompleteSupportIssueCount:available.reduce((sum,item)=>sum+
   Number(item.labels.incompleteSupportIssueCount||0),0),
  entries};
}
export function auditLiveAnswer(data,submitted,requiredGroups,requiredPartSources=[],options={}){
 const citations=Array.isArray(data?.citations)?data.citations:[];
 const workerVersionId=typeof data?.workerVersionId==='string'&&data.workerVersionId.length<=128?data.workerVersionId:null;
 const workerSourceBuild=typeof data?.workerSourceBuild==='string'&&data.workerSourceBuild.length<=128?data.workerSourceBuild:null;
 const workerSourceRevision=typeof data?.workerSourceRevision==='string'&&/^[a-f0-9]{40}$/i.test(data.workerSourceRevision)?data.workerSourceRevision.toLowerCase():null;
 const answer=String(data?.answer||'');
 const citationIds=new Set(citations.map(source=>String(source?.id||'')));
 const citationAudit=auditCitationIds(answer,citations);
 const inline=citationAudit.inlineIds;
 const missingInline=citationAudit.inlineIdsWithoutSource;
 const outcome=String(data?.outcome||'');
 const reviewStatus=String(data?.reviewStatus||'');
 // A reviewed source-free answer is structurally valid only when the Worker
 // explicitly classifies it as general context and the case asks for no
 // library source groups. This keeps evidence-free answers distinct from
 // missing or failed source review.
 const generalContextOnly=outcome==='general-context-answer'&&
  reviewStatus==='general-context-review'&&String(data?.coverage||'')==='full'&&
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
  const mappedEvidenceIdsForPart=evidenceIds.filter(id=>mappedEvidenceIds.has(id));
  const citedEvidenceIds=evidenceIds.filter(id=>citationIds.has(id));
  const submittedEvidenceIds=evidenceIds.filter(id=>submittedIds.has(id));
  const structurallyComplete=part?.status==='unsupported'?null:
   generalContextOnly&&evidenceIds.length===0?null:
   evidenceIds.length>0&&mappedEvidenceIdsForPart.length===evidenceIds.length&&
   citedEvidenceIds.length===evidenceIds.length&&submittedEvidenceIds.length===evidenceIds.length;
  return {part:String(part?.part||''),status:String(part?.status||''),evidenceIds,
   evidenceApplicability:generalContextOnly&&evidenceIds.length===0?'not-applicable':'required',
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
  const quotes=(Array.isArray(item?.quotes)?item.quotes:[]).slice(0,3).map(quote=>({
   claimId:String(quote?.claim_id||''),partId:String(quote?.part_id||''),
   point:typeof quote?.point==='string'?quote.point:'',
   quote:typeof quote?.quote==='string'?quote.quote:'',
   quoteLocated:typeof quote?.quoteLocated==='boolean'?quote.quoteLocated:
    locateHighlightInSubmittedPage({...item,quote:quote?.quote},citations,submitted),
   partialMatch:quote?.partialMatch===true
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
 const highlightRelevance=highlightRelevanceAudit(answer,citations,evidenceHighlights);
 const coverage=String(data?.coverage||'');
 const partStatusesConsistent=questionParts.length===0?null:
  (coverage==='full'?questionParts.every(part=>part?.status==='supported'):
   coverage==='partial'?questionParts.some(part=>part?.status!=='supported'):false);
 const proseContradictions=questionParts.filter(part=>answerDeniesSupportedComparison(part,answer))
  .map(part=>String(part?.part||''));
 const answerCoverageConsistent=questionParts.length===0?null:
  partStatusesConsistent&&!proseContradictions.length;
 const partEvidenceComplete=questionParts.length===0?null:
  partEvidenceAudit.every(part=>part.structurallyComplete!==false);
 const reviewerLabels=summarizeCaseReviewerLabels(data);
 const evidenceAuditScope='Evidence IDs are checked for consistent linkage across question parts, the reviewed evidence map, cited sources, and submitted pages. This is a structural check, not a semantic judge of whether a passage truly supports a claim; review the answer and source text.';
 const failureCode=typeof data?.failureCode==='string'?data.failureCode:'';
 const failureStage=typeof data?.failureStage==='string'?data.failureStage:'';
 const manualReview={status:'not-reviewed',scale:{min:0,max:2},scores:{
  accuracy:null,questionCoverage:null,explanationQuality:null,citationSupport:null,citationCompleteness:null},notes:''};
 const structuralPassed=coverage==='full'&&sourceGroups.every(group=>group.found&&group.linkedToSupportedEvidence!==false)&&
  missingInline.length===0&&(citations.length>0||generalContextOnly)&&answerCoverageConsistent!==false&&partEvidenceComplete!==false&&
  sourcePartAlignment.every(item=>item.aligned)&&reviewerLabels.contractStatus!=='incomplete'&&
  !failureCode&&reviewStatus!=='pipeline-failed'&&
  reviewStatus!=='review-contract-incomplete'&&
  reviewStatus!=='generation-format-failed'&&reviewStatus!=='review-format-failed';
 return {workerVersionId,workerSourceBuild,workerSourceRevision,outcome,coverage,reviewStatus,
  reviewerLabels,failureCode,failureStage,
  answerText:answer,citationCount:citations.length,citationBookIds,citationSources,inlineCitationCount:inline.length,
  inlineIds:inline,
  inlineIdsWithoutSource:missingInline,submittedSourceCount:submitted.length,
  sourceGroups,questionParts,questionPartCoverage,partEvidenceAudit,partEvidenceComplete,
  evidenceApplicability:generalContextOnly?'not-applicable':'required',
  sourcePartAlignment,
  answerCoverageConsistent,coverageContradictions:proseContradictions,evidenceMap,evidenceAuditScope,
  evidenceHighlightCount:highlights.length,evidenceHighlights,citationHighlightAudit,
  highlightRelevance,
  manualReview,structuralPassed,
  answerQualityStatus:'pending-human-review',answerQualityPass:null,
  passed:reviewStatus==='answer-draft-unverified'?null:structuralPassed};
}
const MANUAL_REVIEW_DIMENSIONS=['accuracy','questionCoverage','explanationQuality','citationSupport','citationCompleteness'];
export function summarizeManualReviews(cases){
 const entries=(cases||[]).flatMap(item=>Array.isArray((item?.answerVariantComparison||item?.reviewAblation)?.variants)?
  (item.answerVariantComparison||item.reviewAblation).variants.map(variant=>({id:item.id,attemptNumber:item.attemptNumber,
   answerVariant:variant.answerVariant,selectionVariant:variant.selectionVariant,review:variant.manualReview})):
  [{id:item.id,attemptNumber:item.attemptNumber,answerVariant:item.answerVariant||'with-review',review:item.manualReview}]);
 const completed=entries.filter(entry=>MANUAL_REVIEW_DIMENSIONS.every(key=>
  Number.isInteger(entry.review?.scores?.[key])&&entry.review.scores[key]>=0&&entry.review.scores[key]<=2));
 const averageScores=Object.fromEntries(MANUAL_REVIEW_DIMENSIONS.map(key=>[key,completed.length?
  Number((completed.reduce((sum,entry)=>sum+entry.review.scores[key],0)/completed.length).toFixed(2)):null]));
 return {scale:{min:0,max:2},dimensions:MANUAL_REVIEW_DIMENSIONS,reviewed:completed.length,
  pending:entries.length-completed.length,entries:entries.map(entry=>({id:entry.id,
   ...(Number.isInteger(entry.attemptNumber)?{attemptNumber:entry.attemptNumber}:{}),
   answerVariant:entry.answerVariant,...(entry.selectionVariant?{selectionVariant:entry.selectionVariant}:{}),status:MANUAL_REVIEW_DIMENSIONS.every(key=>
    Number.isInteger(entry.review?.scores?.[key])&&entry.review.scores[key]>=0&&entry.review.scores[key]<=2)?'complete':'pending'})),
  averageScores,qualityPass:null,
  note:'Human scores are independent of automated structural pass/fail. No semantic score is inferred from model review.'};
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
   humanScores:summarizeManualReviews(selected.map(item=>({id:item.id,answerVariant:item.answerVariant,manualReview:item.manualReview}))) }];
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
   humanScores:summarizeManualReviews(selected.map(item=>({id:item.id,answerVariant:item.answerVariant,manualReview:item.manualReview})))}];
 }));
}
export function recheckQualityReport(report){
 if(!report||!Array.isArray(report.cases))throw Error('Input is not a live answer evaluation report.');
 const definitions=new Map([...QUALITY_CASES,...FOCUSED_CASES,...PAIRED_CASES,...HOLDOUT_CASES,...ACCEPTANCE_CASES].map(item=>[item.id,item]));
 const cases=report.cases.map(item=>{
  const definition=definitions.get(String(item?.pairedCaseId||item?.id||'').replace(/::(?:all-books|selected-books)$/,''));
  if(!definition)return {...item,offlineRecheck:null};
  const audit=auditLiveAnswer({
   answer:item.answerText,coverage:item.coverage,citations:item.citationSources,
   questionParts:item.questionParts,evidenceMap:item.evidenceMap,
   evidenceHighlights:item.evidenceHighlights,workerVersionId:item.answerWorkerVersionId,
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
     citations:variant.citationSources,questionParts:variant.questionParts,evidenceMap:variant.evidenceMap,
     evidenceHighlights:variant.evidenceHighlights,workerVersionId:variant.workerVersionId,
     workerSourceBuild:variant.workerSourceBuild,workerSourceRevision:variant.workerSourceRevision},
     Array.isArray(variant.submittedSources)?variant.submittedSources:Array.isArray(item.submittedSources)?item.submittedSources:[],
     definition.required_source_groups,definition.required_part_source_groups||[],{scope:item.scope||
      (Array.isArray(item.selectedBookIds)&&item.selectedBookIds.length?'selected-books':'all-books'),
      plannerPlan:item.plannerPlan||item.evidenceTrace?.plan||null,
      candidateSources:Array.isArray(item.retrievalCandidates)?item.retrievalCandidates:null});
    return {...variant,...variantAudit,manualReview:variant.manualReview};
   })}:previousComparison;
  return {...item,...(answerVariantComparison?{answerVariantComparison}:{}),
   ...(item.reviewAblation&&answerVariantComparison?{reviewAblation:answerVariantComparison}:{}),
   offlineRecheck:{passed:audit.passed,sourceGroups:audit.sourceGroups,
   sourcePartAlignment:audit.sourcePartAlignment,
   questionPartCoverage:audit.questionPartCoverage,partEvidenceAudit:audit.partEvidenceAudit,
   partEvidenceComplete:audit.partEvidenceComplete,
   answerCoverageConsistent:audit.answerCoverageConsistent,
   coverageContradictions:audit.coverageContradictions,
   inlineIdsWithoutSource:audit.inlineIdsWithoutSource,
   citationHighlightAudit:audit.citationHighlightAudit,
   highlightRelevance:audit.highlightRelevance}};
 });
 const checked=cases.filter(item=>item.offlineRecheck);
 return {...report,cases,humanReview:summarizeManualReviews(cases),
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
  },{total:0,supported:0,partial:0,unsupported:0})}};
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
 return {selected,candidates:answerCandidates,candidatePacket,searches:retrieval.searches,retrievalCandidates,
  selectionCoverage:auditSelectionCoverage(answerCandidates,selected,partQuestions),selectionAudit};
}
export function sourcesUsedForWorkerSelection(selection,workerSelected,submittedPool){
 // A valid no-evidence decision deliberately has no Worker-selected pages.
 // Preserve that empty set in quality audits instead of silently substituting
 // the broader retrieval packet and making it look like answer evidence.
 if(selection?.status==='no-relevant-evidence')return [];
 return workerSelected.length?workerSelected:submittedPool;
}

export async function evaluateLiveCase(item,{library,manifest,allowed,token,fetcher=fetch,beforeCall=async()=>{},useFixedQueries=false,preparedPlan=null,answerVariant='with-review',retrievalProfile='baseline',onProgress=async()=>{}}){
 if(!['with-review','compose-only','paired-review-ablation','with-expansion','paired-expansion-ablation','paired-selection-ablation'].includes(answerVariant))
  throw Error('Unsupported answer variant.');
 if(!Object.hasOwn(RETRIEVAL_PROFILES,retrievalProfile))throw Error('Unknown retrieval profile.');
 const startTime=Date.now();
 const progressEvent=async event=>onProgress({caseId:item.id,...event});
 const progress=async(stage,status,message,details={})=>progressEvent({stage,status,message,...details});
 await progress('case','started',`Starting ${answerVariant} evaluation for this question.`);
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
 }else if(useFixedQueries&&validSearchPlan(item.planner_queries)){
  queries=item.planner_queries;
  plannerSkipped=true;
  await progress('planner','skipped','Using the fixed evaluation queries; no planner request is needed.',{queryCount:queries.length});
 }else try{
  plan=await callJson(fetcher,API+'/api/pilot-plan',token,{question:item.question,bookId:plannerBookId,history:[],turnstileToken:'evaluation-runner-token'},beforeCall,'planner',progressEvent);
  if(!validSearchPlan(plan?.queries)){
   const error=attachRequestFailure(new Error('Planner returned an invalid search plan.'),'planner',{httpStatus:200,failureCode:'invalid-response',failureDetail:'invalid_output',workerFailure:false});
   throw error;
  }
  queries=plan.queries;
  plannerWorkerVersionId=plan.workerVersionId||null;
  plannerWorkerSourceBuild=plan.workerSourceBuild||null;
  plannerWorkerSourceRevision=plan.workerSourceRevision||null;
 }catch(error){
  if(!error.requestFailure)error.requestFailure={stage:'planner',httpStatus:null,failureCode:'planner-failed',failureDetail:'unknown',message:String(error.message||error).slice(0,240),workerFailure:false};
  const failure=error.requestFailure;
  plannerWorkerVersionId=failure.workerVersionId||null;
  plannerWorkerSourceBuild=failure.workerSourceBuild||null;
  plannerWorkerSourceRevision=failure.workerSourceRevision||null;
  if(!canFallbackToDirectSearch(failure.httpStatus,failure.failureCode))throw error;
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
 try{loaded=await loadSources(item,queries,{library,manifest,allowed,directFallback:plannerFallback,
  partQueries,partQuestions,retrievalConfig:RETRIEVAL_PROFILES[retrievalProfile]});}
 catch(error){error.requestFailure={stage:'retrieval',httpStatus:null,failureCode:'retrieval-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  error.requestFailure.plannerFallback=plannerFallback;
  error.requestFailure.plannerSkipped=plannerSkipped;
  error.requestFailure.plannerWorkerVersionId=plannerWorkerVersionId;
  error.requestFailure.plannerWorkerSourceBuild=plannerWorkerSourceBuild;
  error.requestFailure.plannerWorkerSourceRevision=plannerWorkerSourceRevision;
  if(plannerFailure)error.requestFailure.plannerFailure=plannerFailure;
   if(plannerFailureDiagnostics)error.requestFailure.plannerFailureDiagnostics=plannerFailureDiagnostics;throw error;}
 let gapQueries=[],gapQueryPartLinks=[],gapPlannerFailure=null,gapPlannerFailureDiagnostics=null;
 const initialSearches=loaded.searches;
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
      overlap:part.overlap,matchedTerms:part.matchedTerms,
      coverageReason:part.coverageReason,coverageSource:part.coverageSource})),
     originalQueries:[...queries,...partQueries.map(value=>value.query)].slice(0,7),
     candidates:loaded.retrievalCandidates.slice(0,6).map(source=>({title:source.title,excerpt:source.excerpt.slice(0,420)}))
    }},beforeCall,'gap-planner',progressEvent);
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
   if(gapQueries.length){
    loaded=await loadSources(item,queries,{library,manifest,allowed,directFallback:plannerFallback,
     partQueries,partQuestions,gapQueries,gapQueryPartLinks,retrievalConfig:RETRIEVAL_PROFILES[retrievalProfile]});
    gapRetrievalRerun=true;
    retrievalCoverage=assessEvidenceCoverage(loaded.retrievalCandidates,item.question,partQuestions);
   }
  }catch(error){
   const failure=error.requestFailure||{};
   if(!canFallbackToDirectSearch(failure.httpStatus,failure.failureCode)){
    failure.gapPlannerAttempted=true;error.requestFailure=failure;throw error;
   }
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
 const variants=answerVariant==='paired-review-ablation'?['with-review','compose-only']:
  answerVariant==='paired-expansion-ablation'?['with-review','with-expansion']:
  answerVariant==='paired-selection-ablation'?['narrow-retrieval-pool','full-retrieval-pool']:[answerVariant];
 const variantResults=[];
 try{
  for(const variant of variants){
   const answerSources=variant==='narrow-retrieval-pool'?selected:loaded.candidatePacket;
   await progress('answer','started',`Submitting ${answerSources.length} verified retrieval candidates; the Worker will select evidence before composition.`,
    {variant,sourceCount:answerSources.length});
   const data=await callJson(fetcher,API+'/api/pilot-answer',token,{question:item.question,
    bookId:plannerBookId,plan:plan?.plan||undefined,history:[],turnstileToken:'evaluation-runner-token',
    answerVariant:variant==='compose-only'?'compose-only':variant==='with-expansion'?'with-expansion':'with-review',
    // The evaluator loads v49 text; the Worker defaults omitted versions to v48.
    sources:answerSources.map(({bookId,page,text})=>({bookId,page,text,libraryVersion:49}))},beforeCall,'answer',progressEvent);
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
    selectionStatus:data.sourceSelection?.status||null,
    selectionCoverage:auditSelectionCoverage(loaded.candidates,submitted,partQuestions),
    selectionAudit:auditEvidencePacketSelection(loaded.candidates,submitted,item.question,partQuestions),
    submittedSources:submitted.map(({bookId,title,page,globalPageId,preview,candidatePartIds})=>({bookId,title,page,globalPageId,candidatePartIds,excerpt:String(preview||'').slice(0,1200)})),
    pipeline:data.pipeline||null,...audit,usage:data.usage||null,
    ...(data.trace?{evidenceTrace:data.trace}:{})});
   await progress('answer','completed',`${variant} returned ${audit.outcome||'no outcome'} with ${audit.coverage} coverage and ${audit.citationCount} citations.`,
    {variant,outcome:audit.outcome,coverage:audit.coverage,citations:audit.citationCount,usage:data.usage||null});
  }
 }catch(error){if(!error.requestFailure)error.requestFailure={stage:'answer',httpStatus:null,failureCode:'answer-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  error.requestFailure.plannerFallback=plannerFallback;
  error.requestFailure.plannerSkipped=plannerSkipped;
  error.requestFailure.plannerWorkerVersionId=plannerWorkerVersionId;
  error.requestFailure.plannerWorkerSourceBuild=plannerWorkerSourceBuild;
  error.requestFailure.plannerWorkerSourceRevision=plannerWorkerSourceRevision;
  if(plannerFailure)error.requestFailure.plannerFailure=plannerFailure;throw error;}
 const primary=variantResults.find(result=>result.answerVariant==='with-review')||variantResults[0];
 const answerVariantComparison=['paired-review-ablation','paired-expansion-ablation','paired-selection-ablation'].includes(answerVariant)?{
  ...(answerVariant==='paired-selection-ablation'?{selectionComparison}:{}),
  comparison:answerVariant==='paired-expansion-ablation'?
   'Same resolved question and submitted pages; compare ordinary composition with post-composition expansion before the same evidence review.':
   answerVariant==='paired-selection-ablation'?
   'Both answers use the same verified Worker semantic selector, composer and reviewer; compare a six-page browser candidate pool with the full retrieved candidate pool.':
   'Same resolved question, planner result and submitted source pages; only the final model-review call is omitted in compose-only',
  variants:variantResults
 }:null;
 return {id:item.id,question:item.question,discipline:item.discipline||'',selectedBookIds:Array.isArray(item.selected_book_ids)?item.selected_book_ids:[],
  reviewFocus:Array.isArray(item.review_focus)?item.review_focus:[],plannerSkipped,plannerReused,
  plannerQueries:plannerFallback?[]:queries,plannerFallback,
  plannerWorkerVersionId,plannerWorkerSourceBuild,plannerWorkerSourceRevision,answerWorkerVersionId:primary.workerVersionId,answerWorkerSourceBuild:primary.workerSourceBuild,answerWorkerSourceRevision:primary.workerSourceRevision,
  ...(plannerFailure?{plannerFailure}:{}),...(plannerFailureDiagnostics?{plannerFailureDiagnostics}:{}),plannerPlan:plan?.plan||null,
  searchesBeforeGap:initialSearches,retrievalCandidatesBeforeGap:initialRetrievalCandidates,
  searches,retrievalCandidates,
  retrievalCoverage:{triggered:gapSearchTriggered,
   weakParts:initialRetrievalCoverage.weakParts},
  ...(gapRetrievalRerun?{retrievalCoverageAfterGap:{weakParts:retrievalCoverage.weakParts}}:{}),
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
  elapsedMs:Date.now()-startTime};
}
export async function evaluatePlannerCase(item,{library,manifest,allowed,token,fetcher=fetch,beforeCall=async()=>{},onProgress=async()=>{}}={}){
 const startTime=Date.now();
 const progressEvent=async event=>onProgress({caseId:item.id,...event});
 const progress=async(stage,status,message,details={})=>progressEvent({stage,status,message,...details});
 await progress('case','started','Starting planner-only retrieval evaluation.');
 const selectedBookIds=Array.isArray(item.selected_book_ids)?item.selected_book_ids.map(String):[];
 const plannerBookId=selectedBookIds.length===1?selectedBookIds[0]:'';
 const plan=await callJson(fetcher,API+'/api/pilot-plan',token,{question:item.question,
  bookId:plannerBookId,history:[],turnstileToken:'evaluation-runner-token'},beforeCall,'planner',progressEvent);
 if(!validSearchPlan(plan?.queries))
  throw attachRequestFailure(new Error('Planner returned an invalid search plan.'),'planner',{
   httpStatus:200,failureCode:'invalid-response',workerFailure:false,
   workerVersionId:plan?.workerVersionId,workerSourceBuild:plan?.workerSourceBuild,workerSourceRevision:plan?.workerSourceRevision});
 let loaded;
 const partFacets=partFacetsFromPlan(plan?.plan?.parts);
 const {partQueries,partQuestions}=partFacets;
 await progress('retrieval','started',`Searching ${new Set([...plan.queries,...partQueries.map(value=>value.query)]).size} planner and part facets.`,
  {queryCount:plan.queries.length,partFacetCount:partQueries.length,partFacetWarnings:partFacets.warnings});
 try{loaded=await loadSources(item,plan.queries,{library,manifest,allowed,partQueries,partQuestions});}
 catch(error){
  const wrapped=attachRequestFailure(error,'retrieval',{failureCode:'retrieval-failed',workerFailure:false,
   workerVersionId:plan.workerVersionId,workerSourceBuild:plan.workerSourceBuild,workerSourceRevision:plan.workerSourceRevision});
  wrapped.requestFailure.plannerSkipped=false;
  throw wrapped;
 }
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
  submittedSources:selected.map(({bookId,title,page,globalPageId,preview,candidatePartIds})=>({bookId,title,page,globalPageId,candidatePartIds,
   excerpt:String(preview||'').slice(0,1200)})),
  submittedSourceCount:selected.length,sourceGroups,passed,
  outcome:passed?'planner-retrieval-ready':'planner-retrieval-miss',
  coverage:'not-evaluated',reviewStatus:'planner-only',answerText:'',citationCount:0,
  citationBookIds:[],citationSources:[],inlineCitationCount:0,inlineIdsWithoutSource:[],
  evidenceHighlightCount:0,evidenceHighlights:[],questionParts:[],
  questionPartCoverage:{total:0,supported:0,partial:0,unsupported:0},evidenceMap:[],
  elapsedMs:Date.now()-startTime};
}
function failedCaseResult(item,error){
 const failure=error?.requestFailure||{stage:'evaluation',httpStatus:null,failureCode:'evaluation-failed',
  message:String(error?.message||error||'Evaluation failed').slice(0,240),workerFailure:false};
 return {id:item.id,question:item.question,discipline:item.discipline||'',selectedBookIds:Array.isArray(item.selected_book_ids)?item.selected_book_ids:[],
  reviewFocus:Array.isArray(item.review_focus)?item.review_focus:[],requestFailure:failure,plannerQueries:[],plannerSkipped:failure.plannerSkipped===true,
  plannerWorkerVersionId:failure.plannerWorkerVersionId|| (failure.stage==='planner'?failure.workerVersionId:null),
  plannerWorkerSourceBuild:failure.plannerWorkerSourceBuild|| (failure.stage==='planner'?failure.workerSourceBuild:null),
  plannerWorkerSourceRevision:failure.plannerWorkerSourceRevision|| (failure.stage==='planner'?failure.workerSourceRevision:null),
  answerWorkerVersionId:failure.stage==='answer'?failure.workerVersionId:null,
  answerWorkerSourceBuild:failure.stage==='answer'?failure.workerSourceBuild:null,
  answerWorkerSourceRevision:failure.stage==='answer'?failure.workerSourceRevision:null,
  plannerFallback:failure.plannerFallback===true,gapPlannerAttempted:failure.gapPlannerAttempted===true,
  ...(failure.gapPlannerFailure?{gapPlannerFailure:failure.gapPlannerFailure}:{}),
  ...(failure.plannerFailure?{plannerFailure:failure.plannerFailure}:{}),searches:[],
  submittedSources:[],outcome:'request-failed',coverage:'none',reviewStatus:'request-failed',
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
async function main(){
 const args=parseArgs(process.argv.slice(2));if(args.help){console.log('Usage: PILOT_EVALUATION_TOKEN=... node reading-companion/live-answer-evaluation.mjs --confirm-live-ai true [--mode planner|smoke|quality|focused|paired|holdout|acceptance|full] [--scope selected-books|all-books|paired] [--answer-variant with-review|compose-only|paired-review-ablation|paired-expansion-ablation|paired-selection-ablation] [--retrieval-profile baseline|expanded] [--case case-id] [--repeat 1..3] [--report-only true] [--output report.json]');return 0;}
 if(!args.confirm)throw Error('Live AI calls are disabled unless --confirm-live-ai true is provided.');
 if(!['with-review','compose-only','paired-review-ablation','paired-expansion-ablation','paired-selection-ablation'].includes(args.answerVariant))throw Error('Unsupported answer variant.');
 if(!Object.hasOwn(RETRIEVAL_PROFILES,args.retrievalProfile))throw Error('Unknown retrieval profile.');
 const usesEvaluationMode=['quality','focused','paired','holdout','acceptance'].includes(args.mode);
 if(args.mode==='paired'&&args.scope!=='paired')throw Error('The paired suite must use paired scope.');
 if(!usesEvaluationMode&&args.scope!=='selected-books')throw Error('The all-books scope is available only in quality, focused, paired, holdout or acceptance mode.');
 if(usesEvaluationMode&&args.mode!=='paired'&&!['selected-books','all-books'].includes(args.scope))throw Error('Evaluation scope must be selected-books or all-books.');
 if(args.mode==='acceptance'&&args.scope!=='all-books')throw Error('The acceptance suite must run in all-books mode.');
 if(!Number.isInteger(args.repeatCount)||args.repeatCount<1||args.repeatCount>3)
  throw Error('Repeat count must be an integer from 1 to 3.');
 if(args.repeatCount!==1&&!(args.mode==='acceptance'&&['repeatable-calibration','quality-calibration'].includes(args.caseId)))
  throw Error('Repeated runs are limited to the repeatable calibration case set.');
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
 const answerCallsPerCase=args.answerVariant==='paired-review-ablation'?5:
  args.answerVariant==='paired-expansion-ablation'?7:
  args.answerVariant==='paired-selection-ablation'?6:
  args.answerVariant==='compose-only'?2:3;
 const estimatedWorkerAiCalls=args.mode==='planner'?cases.length:args.mode==='paired'?
  plannerCalls+cases.length*2*answerCallsPerCase:plannerCalls+cases.length*answerCallsPerCase;
 const reportCaseCount=args.mode==='paired'?cases.length*2:cases.length;
 const conditionalGapPlannerCallAllowance=args.mode==='planner'?0:reportCaseCount;
 const report={schema:'antilogicalism-reading-companion-live-answer-eval-v2',generatedAt:new Date().toISOString(),mode:args.mode,searchScope:usesEvaluationMode?args.scope:null,selectedCaseId:args.caseId&&args.caseId!=='all'?args.caseId:null,
  answerVariant:args.answerVariant,retrievalProfile:args.retrievalProfile,
  retrievalConfig:{...RETRIEVAL_PROFILES[args.retrievalProfile]},caseCount:reportCaseCount,pairedQuestionCount:args.mode==='paired'?cases.length:undefined,
  repeatCount:args.repeatCount>1?args.repeatCount:undefined,
  repeatedCaseIds:args.repeatCount>1?baseCases.map(item=>item.id):undefined,
  estimatedWorkerAiCalls,conditionalGapPlannerCallAllowance,
  callsPerCase:args.mode==='planner'?'1 planner inference + local retrieval per case; answer generation is skipped':args.mode==='paired'?
   (args.answerVariant==='paired-selection-ablation'?'1 shared planner + 6 Worker selection/composition/review calls for each scope; selected-books reuses the plan and query set; retrieval may add one conditional gap-planner call per scope':
    '1 shared planner + answer pipeline calls for each scope; selected-books reuses the plan and query set; retrieval may add one conditional gap-planner call per scope'):
   (evaluationUsesPlanner?'1 planner + ':'0 planner + ')+answerCallsPerCase+' answer/selection calls per case'+
   (args.answerVariant==='paired-selection-ablation'?' (each answer run performs Worker selection, composition and review)':'')+
   ', including one Worker evidence-selection call before composition; plus up to one conditional gap-planner call when page text weakly covers a requested part',
  answerQualityNote:args.mode==='planner'?'Planner queries and expected-book retrieval are checked; answer generation and answer quality are not evaluated.':
   'Structural checks cover source identity and citation linkage. Answer quality remains pending until a human scores accuracy, question coverage, explanation quality, citation support, and citation completeness from 0 (fail) to 2 (strong). A structural pass is not a quality pass.',
  qualityStatus:args.mode==='planner'?'not-assessed':'pending-human-review',
  executionStatus:'initializing',completedCases:0,notRunCases:cases.length,requestFailureCases:0,plannerFallbackCases:0,plannerSkippedCases:0,workerVersionIds:[],workerSourceRevisions:[],stopReason:'',cases:[]};
 const outputPath=args.output?resolve(args.output):'';
 let activeLibrary=null;
 const saveReport=async()=>{
  if(activeLibrary&&report.reproducibility?.corpus)
   report.reproducibility.corpus.indexFiles=Object.fromEntries(activeLibrary.contentDigests);
  if(outputPath)await writeFile(outputPath,JSON.stringify(report,null,2)+'\n');
 };
 await saveReport();
 console.log('Initializing '+args.mode+' evaluation for '+(args.repeatCount>1?
  args.repeatCount+' attempts each for '+baseCases.length+' calibration questions ('+cases.length+' answers)':
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
   report.answerVariants=summarizeAnswerVariants(results);
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
   report.workerVersionIds=[...new Set(results.flatMap(item=>[item.plannerWorkerVersionId,item.answerWorkerVersionId]).filter(value=>typeof value==='string'&&value))];
   report.workerSourceRevisions=[...new Set(results.flatMap(item=>[item.plannerWorkerSourceRevision,item.answerWorkerSourceRevision]).filter(value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)))];
   report.scopeSummary=Object.fromEntries(['all-books','selected-books'].map(scope=>{
    const scoped=results.filter(item=>item.scope===scope);
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
   requestFailureCases:report.requestFailureCases,
   plannerFallbackCases:report.plannerFallbackCases,
   reviewerLabels:summarizeReviewerLabels(report.cases),
   humanReview:summarizeManualReviews(report.cases),
   answerVariants:summarizeAnswerVariants(report.cases),
   selectionVariants:summarizeSelectionVariants(report.cases),
   questionPartStatusCounts:report.cases.reduce((totals,item)=>{
    const counts=item.questionPartCoverage||{};
    for(const status of ['supported','partial','unsupported'])
     totals[status]+=Number(counts[status])||0;
    totals.total+=Number(counts.total)||0;
    return totals;
   },{total:0,supported:0,partial:0,unsupported:0})};
  await saveReport();
  console.log(args.mode==='planner'?
   'Done: '+report.summary.passedCases+'/'+report.caseCount+' planner plans retrieved at least one expected book; no answers were generated.':
   (args.mode==='paired'?'Done: '+report.summary.passedCases+'/'+report.caseCount+' scope results met structural gates; paired scope totals are in scopeSummary. ':'Done: '+report.summary.passedCases+'/'+report.caseCount+' reviewed answers met structural gates; ')+report.summary.failedCases+' failed and '+report.summary.unscoredCases+' are unscored. Semantic answer quality requires the separate human rubric.');
  if(args.mode!=='planner'){
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

