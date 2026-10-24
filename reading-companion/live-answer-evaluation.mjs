#!/usr/bin/env node
/* Explicit, metered end-to-end evaluation against the public Reading Companion
 * Worker. This is never run by the PR or scheduled retrieval-only workflow.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {RemoteLibrary,DEFAULT_INDEX_ROOT,PRODUCTION_PAGES_PER_BOOK} from './remote-library.mjs';
import {validSearchPlan,selectAnswerSources,canFallbackToDirectSearch,retrieveEvidence} from './evidence-search.mjs';
import {auditCitationIds} from './diagnostic-report.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SUITE_PATH=resolve(ROOT,'benchmarks/reading-companion-public-v1.json');
const FINGERPRINT_ROOT='https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v1/';
const API='https://antilogicalism-companion-public.jsynon.workers.dev';
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
const HOLDOUT_CASES=[
 {id:'holdout-history-herodotus-helen',discipline:'history',question:'When Herodotus recounts the story of Helen’s journey to Troy, what do the Egyptian priests tell him, and how does he explain why he finds their account more credible?',selected_book_ids:['149'],planner_queries:['Herodotus Histories Helen Egypt priests account Troy credibility','Herodotus Helen Paris Egypt Egyptian priests story judgment'],required_source_groups:[{label:'Herodotus, Histories',book_ids:['149']}],review_focus:['Keep the Egyptian priests’ account distinct from Herodotus’s own reasoning and reported Greek traditions.','Explain the basis he gives for preferring one account without turning his inference into a directly witnessed fact.']},
 {id:'holdout-literature-hamlet-soliloquy',discipline:'literature',question:'In Hamlet’s “To be, or not to be” soliloquy, what alternatives does he weigh, and how does uncertainty about what follows death affect his reasoning?',selected_book_ids:['212'],planner_queries:['Hamlet to be or not to be soliloquy sleep death fear unknown country','Hamlet soliloquy conscience makes cowards of us all after death'],required_source_groups:[{label:'Shakespeare, Hamlet',book_ids:['212','564']}],review_focus:['Describe Hamlet’s alternatives and reasoning in the soliloquy without treating them as the play’s settled doctrine.','Connect the fear of the unknown after death to his hesitation, citing the soliloquy.']},
 {id:'holdout-philosophy-aristotle-soul-body',discipline:'philosophy',question:'According to Aristotle’s De Anima, how is the soul related to a living body, and how does the form-and-matter comparison clarify that relation?',selected_book_ids:['4'],planner_queries:['Aristotle De Anima soul actuality form natural body organ life','De Anima soul form matter body first actuality Aristotle'],required_source_groups:[{label:'Aristotle, De Anima',book_ids:['4']}],review_focus:['Explain the soul as the actuality or form of a natural body with life potentially.','Use the form-and-matter comparison without reducing soul to a separate bodily part.']},
 {id:'holdout-religion-james-faith-works',discipline:'religion',question:'According to James 2:14–26, how does James relate faith to works, and what do Abraham and Rahab illustrate in his argument?',selected_book_ids:['335'],planner_queries:['James 2:14-26 faith without works Abraham Rahab justified works','James faith works body without spirit Abraham offered Isaac Rahab received messengers'],required_source_groups:[{label:'James 2:14–26',book_ids:['335']}],review_focus:['Explain James’s argument about living faith and works using the passage’s examples.','Represent Abraham and Rahab as distinct illustrations and avoid importing a broader doctrinal resolution not stated in the passage.']},
 {id:'holdout-all-books-hume-kant-causation',discipline:'philosophy',question:'How do Hume’s Enquiry and Kant’s Critique of Pure Reason differ over how we can know causal necessity?',selected_book_ids:[],planner_queries:['Hume Enquiry cause effect necessary connection constant conjunction custom','Kant Critique Pure Reason causality category understanding a priori experience'],required_source_groups:[{label:'Hume, Enquiry Concerning Human Understanding',book_ids:['35']},{label:'Kant, Critique of Pure Reason',book_ids:['40']}],required_part_source_groups:[{partIncludes:'Hume',book_ids:['35']},{partIncludes:'Kant',book_ids:['40']}],review_focus:['Explain each author’s account on its own terms and distinguish Hume’s account of experience and habit from Kant’s account of a priori understanding.','Cite evidence from both books and avoid presenting the comparison as a direct exchange between the authors.']},
 {id:'holdout-all-books-plato-rousseau-order',discipline:'politics',question:'How do Plato’s Republic and Rousseau’s Social Contract explain what makes political order legitimate, and how does each connect it to the common good?',selected_book_ids:[],planner_queries:['Plato Republic justice city common good political order rulers knowledge','Rousseau Social Contract general will common good legitimate political authority'],required_source_groups:[{label:'Plato, Republic',book_ids:['74']},{label:'Rousseau, Social Contract',book_ids:['245']}],required_part_source_groups:[{partIncludes:'Plato',book_ids:['74']},{partIncludes:'Rousseau',book_ids:['245']}],review_focus:['Identify the basis of political order in each work, keeping Plato’s and Rousseau’s concepts distinct.','Explain how each account relates to collective good using passages from both works.']},
 {id:'holdout-all-books-wollstonecraft-dubois',discipline:'society',question:'How do Wollstonecraft’s Vindication of the Rights of Woman and Du Bois’s Souls of Black Folk describe the effects of unequal social conditions on people’s development and self-understanding?',selected_book_ids:[],planner_queries:['Wollstonecraft Vindication education dependence reason virtue women social conditions','Du Bois Souls of Black Folk veil double consciousness self understanding social conditions'],required_source_groups:[{label:'Wollstonecraft, Vindication of the Rights of Woman',book_ids:['87']},{label:'Du Bois, The Souls of Black Folk',book_ids:['454']}],required_part_source_groups:[{partIncludes:'Wollstonecraft',book_ids:['87']},{partIncludes:'Du Bois',book_ids:['454']}],review_focus:['Explain each author’s account of how social conditions shape development or self-understanding without flattening their distinct historical arguments.','Use evidence from both works and mark any comparative synthesis as a reader’s synthesis.']},
];
// This untouched suite is reserved for acceptance after changes have been
// frozen. Do not use it while tuning prompts or retrieval.
const ACCEPTANCE_CASES=[
 {id:'acceptance-descartes-cogito',discipline:'philosophy',question:'In Meditations on First Philosophy, what does Descartes conclude about his existence while doubting, and why does the act of doubting establish it?',selected_book_ids:[],planner_queries:['Descartes Meditations on First Philosophy doubt cogito existence thinking deceiver','Descartes I am I exist whenever thought conceived meditation certainty'],required_source_groups:[{label:'Descartes, Meditations on First Philosophy',book_ids:['25']}],review_focus:['Explain the cogito as established in the act of thinking or doubting, not as an inference from a trusted sense.','Keep the demon hypothesis and the certainty of the thinking self in their proper relation.']},
 {id:'acceptance-mill-harm-principle',discipline:'politics',question:'What principle does Mill use to limit society’s power over an individual, and what condition does he place on coercion to prevent harm?',selected_book_ids:[],planner_queries:['John Stuart Mill On Liberty harm to others only purpose power rightfully exercised','Mill On Liberty self regarding conduct society coercion harm prevention'],required_source_groups:[{label:'Mill, On Liberty',book_ids:['51']}],review_focus:['State the harm principle and distinguish harm to others from the person’s own good.','Preserve Mill’s qualifications about the maturity or capacity of the person governed.']},
 {id:'acceptance-epictetus-freedom',discipline:'philosophy',question:'What distinction does Epictetus draw between what is up to us and what is not, and how does he connect that distinction with freedom?',selected_book_ids:[],planner_queries:['Epictetus Enchiridion what is up to us judgment impulse desire aversion','Epictetus freedom depends on choice opinions external things'],required_source_groups:[{label:'Epictetus, Enchiridion',book_ids:['28']}],review_focus:['Identify judgment, impulse, desire, and aversion as within our control and external things as not.','Explain how freedom depends on governing one’s own choices rather than controlling externals.']},
 {id:'acceptance-augustine-memory',discipline:'religion',question:'In the Confessions, how does Augustine search for God through memory, and what limits of memory does he encounter?',selected_book_ids:[],planner_queries:['Augustine Confessions Book X memory search for God vast palace memory','Augustine Confessions memory limits God not contained in memory'],required_source_groups:[{label:'Augustine, Confessions',book_ids:['17']}],review_focus:['Explain why Augustine turns to memory in seeking God.','Do not claim that God is simply one remembered object or contained within memory.']},
 {id:'acceptance-aristotle-tragedy-plot',discipline:'literature',question:'In the Poetics, why does Aristotle treat plot as the chief element of tragedy, and how do reversal and recognition contribute to its structure?',selected_book_ids:[],planner_queries:['Aristotle Poetics plot chief element tragedy action unity','Aristotle Poetics reversal recognition change to opposite events plot'],required_source_groups:[{label:'Aristotle, Poetics',book_ids:['11']}],review_focus:['Explain plot as the organization of action and why tragedy imitates action rather than people alone.','Describe reversal and recognition as developments within the plot, not as independent decorations.']},
 {id:'acceptance-boethius-fortune',discipline:'philosophy',question:'Why does Boethius argue that Fortune’s gifts cannot secure happiness, and what does their instability reveal?',selected_book_ids:[],planner_queries:['Boethius Consolation of Philosophy Fortune gifts cannot make happy unstable','Boethius Fortune wheel prosperity adversity true good happiness'],required_source_groups:[{label:'Boethius, Consolation of Philosophy',book_ids:['21']}],review_focus:['Distinguish external goods that Fortune can take away from the stable good Boethius associates with happiness.','Attribute the argument to the dialogue’s reasoning and preserve its qualifications.']},
 {id:'acceptance-locke-political-authority',discipline:'politics',question:'According to Locke’s Second Treatise of Government, what makes political authority legitimate, and under what conditions may the people resist or replace it?',selected_book_ids:[],planner_queries:['John Locke Second Treatise political power consent governed legitimate authority','Locke Second Treatise dissolution government breach trust people resistance replacement'],required_source_groups:[{label:'Locke, Second Treatise of Government',book_ids:['49']}],review_focus:['Ground legitimacy in consent and explain the role of the community’s political power.','Distinguish ordinary disagreement from a breach of trust that dissolves government.']},
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
 const evaluationCases=mode==='holdout'?HOLDOUT_CASES:mode==='acceptance'?ACCEPTANCE_CASES:QUALITY_CASES;
 if(caseId&&caseId!=='all'){
  if(!['quality','holdout','acceptance'].includes(mode))throw Error('A specific case can be selected only in quality, holdout or acceptance mode.');
  const selected=evaluationCases.find(item=>item.id===caseId);
  if(!selected)throw Error('Unknown '+mode+' case: '+caseId);
  return [copyEvaluationCase(selected)];
 }
 if(mode==='quality')return QUALITY_CASES.map(copyEvaluationCase);
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
 throw Error('Mode must be smoke, planner, quality, holdout, acceptance, or full.');
}
export function applyQualityScope(cases,scope='selected-books'){
 if(!['selected-books','all-books'].includes(scope))
  throw Error('Evaluation scope must be selected-books or all-books.');
 if(scope==='selected-books')return cases;
 return cases.map(item=>({...item,selected_book_ids:[]}));
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
function answerDeniesSupportedComparison(part,answer){
 if(part?.status!=='supported'||!/\b(?:compare|comparison|contrast|differ|difference|different|distinguish)\b/i.test(String(part?.part||'')))return false;
 const text=String(answer||'');
 const explicitGap=/(?:\b(?:cannot|can't|does not|doesn't|do not|don't|unable to|fails? to)\b.{0,90}\b(?:establish|demonstrate|support|show|provide|contain|identify|determine|compare|distinguish)\b.{0,70}\b(?:comparison|contrast|difference|distinction)\b|\b(?:no|not enough|insufficient)\s+(?:direct\s+)?(?:evidence|support|basis|comparison|contrast|difference|distinction)\b|\b(?:comparison|contrast|difference|distinction)\s+(?:is\s+)?(?:not directly stated|cannot be established|is not established)\b|\b(?:texts?|passages?|excerpts?|evidence)\b.{0,80}\b(?:do not|don't|does not|doesn't|cannot|can't)\b.{0,50}\b(?:contain|establish|support|show|provide)\b.{0,40}\b(?:comparison|contrast|difference|distinction)\b)/i.test(text);
 const givesContrast=/\b(?:whereas|by contrast|in contrast|unlike|differs? from|different from|the difference is|differ in|contrasts? with)\b/i.test(text);
 return explicitGap&&!givesContrast;
}
export function auditLiveAnswer(data,submitted,requiredGroups,requiredPartSources=[]){
 const citations=Array.isArray(data?.citations)?data.citations:[];
 const workerVersionId=typeof data?.workerVersionId==='string'&&data.workerVersionId.length<=128?data.workerVersionId:null;
 const workerSourceBuild=typeof data?.workerSourceBuild==='string'&&data.workerSourceBuild.length<=128?data.workerSourceBuild:null;
 const answer=String(data?.answer||'');
 const citationIds=new Set(citations.map(source=>String(source?.id||'')));
 const citationAudit=auditCitationIds(answer,citations);
 const inline=citationAudit.inlineIds;
 const missingInline=citationAudit.inlineIdsWithoutSource;
 const citationBookIds=[...new Set(citations.map(source=>String(source?.bookId||'')))];
 const submittedBookIds=[...new Set(submitted.map(source=>String(source?.bookId||'')))];
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
   evidenceIds.length>0&&mappedEvidenceIdsForPart.length===evidenceIds.length&&
   citedEvidenceIds.length===evidenceIds.length&&submittedEvidenceIds.length===evidenceIds.length;
  return {part:String(part?.part||''),status:String(part?.status||''),evidenceIds,
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
  const retrievedBookIds=submittedBookIds.filter(id=>expectedBookIds.includes(id));
  const citedBookIds=citationBookIds.filter(id=>expectedBookIds.includes(id));
  const retrieved=submitted.some(source=>expectedBookIds.includes(String(source?.bookId||'')));
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
  return {label:group.label,expectedBookIds,retrievedBookIds,citedBookIds,foundBookIds:citedBookIds,
   retrieved,cited,found:cited,supportedPartLabels,partialPartLabels,
   linkedToSupportedEvidence:questionParts.length?supportedPartLabels.length>0:null,
   linkedToPartialEvidence:questionParts.length?partialPartLabels.length>0:null};
 });
 const highlights=Array.isArray(data?.evidenceHighlights)?data.evidenceHighlights:[];
 const citationSources=citations.map(source=>({id:String(source?.id||''),bookId:String(source?.bookId||''),
  title:String(source?.title||''),page:Number.isSafeInteger(source?.page)?source.page:null,
  globalPageId:Number.isSafeInteger(source?.globalPageId)?source.globalPageId:null,
  url:typeof source?.url==='string'?source.url:''}));
 const questionPartCoverage={total:questionParts.length,
  supported:questionParts.filter(item=>item?.status==='supported').length,
  partial:questionParts.filter(item=>item?.status==='partial').length,
  unsupported:questionParts.filter(item=>item?.status==='unsupported').length};
 const sourcePartAlignment=(requiredPartSources||[]).map(expected=>{
  const needle=normalizeDiagnosticExcerpt(expected.partIncludes);
  const part=questionParts.find(item=>normalizeDiagnosticExcerpt(item?.part).includes(needle));
  const allowedBookIds=expected.book_ids.map(String);
  if(!part)return {partIncludes:expected.partIncludes,allowedBookIds,aligned:false,reason:'expected-part-not-found'};
  const evidenceIds=Array.isArray(part.evidenceIds)?part.evidenceIds.map(String):[];
  const linkedBooks=[...new Set(citations.filter(source=>evidenceIds.includes(String(source?.id||'')))
   .map(source=>String(source?.bookId||'')))];
  const misalignedBookIds=linkedBooks.filter(id=>!allowedBookIds.includes(id));
  const hasExpectedBook=linkedBooks.some(id=>allowedBookIds.includes(id));
  const aligned=misalignedBookIds.length===0&&
   (part.status==='unsupported'||hasExpectedBook);
  return {partIncludes:expected.partIncludes,part:String(part.part||''),status:String(part.status||''),
   allowedBookIds,linkedBookIds:linkedBooks,misalignedBookIds,aligned,
   reason:aligned?'':'evidence-does-not-match-expected-part-source'};
 });
 const evidenceHighlights=highlights.map(item=>({sourceId:String(item?.source_id||item?.sourceId||''),
  title:String(item?.title||''),page:Number.isSafeInteger(item?.page)?item.page:null,
  quote:typeof item?.quote==='string'?item.quote:'',
  quoteLocated:typeof item?.quoteLocated==='boolean'?item.quoteLocated:
   locateHighlightInSubmittedPage(item,citations,submitted)}));
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
 const evidenceAuditScope='Evidence IDs are checked for consistent linkage across question parts, the reviewed evidence map, cited sources, and submitted pages. This is a structural check, not a semantic judge of whether a passage truly supports a claim; review the answer and source text.';
 const outcome=String(data?.outcome||'');
 const reviewStatus=String(data?.reviewStatus||'');
 const failureCode=typeof data?.failureCode==='string'?data.failureCode:'';
 const failureStage=typeof data?.failureStage==='string'?data.failureStage:'';
 const manualReview={status:'not-reviewed',scale:{min:0,max:2},scores:{
  accuracy:null,questionCoverage:null,explanationQuality:null,citationSupport:null,citationCompleteness:null},notes:''};
 const structuralPassed=coverage==='full'&&sourceGroups.every(group=>group.found&&group.linkedToSupportedEvidence!==false)&&
  missingInline.length===0&&citations.length>0&&answerCoverageConsistent!==false&&partEvidenceComplete!==false&&
  sourcePartAlignment.every(item=>item.aligned)&&!failureCode&&reviewStatus!=='pipeline-failed'&&
  reviewStatus!=='generation-format-failed'&&reviewStatus!=='review-format-failed';
 return {workerVersionId,workerSourceBuild,outcome,coverage,reviewStatus,failureCode,failureStage,
  answerText:answer,citationCount:citations.length,citationBookIds,citationSources,inlineCitationCount:inline.length,
  inlineIds:inline,
  inlineIdsWithoutSource:missingInline,submittedSourceCount:submitted.length,
  sourceGroups,questionParts,questionPartCoverage,partEvidenceAudit,partEvidenceComplete,
  sourcePartAlignment,
  answerCoverageConsistent,coverageContradictions:proseContradictions,evidenceMap,evidenceAuditScope,
  evidenceHighlightCount:highlights.length,evidenceHighlights,
  manualReview,structuralPassed,
  passed:reviewStatus==='answer-draft-unverified'?null:structuralPassed};
}
const MANUAL_REVIEW_DIMENSIONS=['accuracy','questionCoverage','explanationQuality','citationSupport','citationCompleteness'];
export function summarizeManualReviews(cases){
 const entries=(cases||[]).flatMap(item=>Array.isArray(item?.reviewAblation?.variants)?
  item.reviewAblation.variants.map(variant=>({id:item.id,answerVariant:variant.answerVariant,review:variant.manualReview})):
  [{id:item.id,answerVariant:item.answerVariant||'with-review',review:item.manualReview}]);
 const completed=entries.filter(entry=>MANUAL_REVIEW_DIMENSIONS.every(key=>
  Number.isInteger(entry.review?.scores?.[key])&&entry.review.scores[key]>=0&&entry.review.scores[key]<=2));
 const averageScores=Object.fromEntries(MANUAL_REVIEW_DIMENSIONS.map(key=>[key,completed.length?
  Number((completed.reduce((sum,entry)=>sum+entry.review.scores[key],0)/completed.length).toFixed(2)):null]));
 return {scale:{min:0,max:2},dimensions:MANUAL_REVIEW_DIMENSIONS,reviewed:completed.length,
  pending:entries.length-completed.length,entries:entries.map(entry=>({id:entry.id,
   answerVariant:entry.answerVariant,status:MANUAL_REVIEW_DIMENSIONS.every(key=>
    Number.isInteger(entry.review?.scores?.[key])&&entry.review.scores[key]>=0&&entry.review.scores[key]<=2)?'complete':'pending'})),
  averageScores,qualityPass:null,
  note:'Human scores are independent of automated structural pass/fail. No semantic score is inferred from model review.'};
}
export function summarizeAnswerVariants(cases){
 const entries=(cases||[]).flatMap(item=>Array.isArray(item?.reviewAblation?.variants)?
  item.reviewAblation.variants.map(variant=>({id:item.id,...variant})):
  [{id:item.id,answerVariant:item.answerVariant||'with-review',structuralPassed:item.structuralPassed}]);
 return Object.fromEntries(['with-review','compose-only'].map(answerVariant=>{
  const selected=entries.filter(item=>item.answerVariant===answerVariant);
  return [answerVariant,{cases:selected.length,
   structuralPassed:selected.filter(item=>item.structuralPassed===true).length,
   structuralFailed:selected.filter(item=>item.structuralPassed===false).length,
   structuralUnknown:selected.filter(item=>typeof item.structuralPassed!=='boolean').length,
   humanScores:summarizeManualReviews(selected.map(item=>({id:item.id,answerVariant:item.answerVariant,manualReview:item.manualReview}))) }];
 }));
}
export function recheckQualityReport(report){
 if(!report||!Array.isArray(report.cases))throw Error('Input is not a live answer evaluation report.');
 const definitions=new Map([...QUALITY_CASES,...HOLDOUT_CASES,...ACCEPTANCE_CASES].map(item=>[item.id,item]));
 const cases=report.cases.map(item=>{
  const definition=definitions.get(String(item?.id||''));
  if(!definition)return {...item,offlineRecheck:null};
  const audit=auditLiveAnswer({
   answer:item.answerText,coverage:item.coverage,citations:item.citationSources,
   questionParts:item.questionParts,evidenceMap:item.evidenceMap,
   evidenceHighlights:item.evidenceHighlights,workerVersionId:item.answerWorkerVersionId,
   workerSourceBuild:item.answerWorkerSourceBuild
  },Array.isArray(item.submittedSources)?item.submittedSources:[],definition.required_source_groups,
   definition.required_part_source_groups||[]);
  const reviewAblation=Array.isArray(item.reviewAblation?.variants)?{...item.reviewAblation,
   variants:item.reviewAblation.variants.map(variant=>{
    const variantAudit=auditLiveAnswer({answer:variant.answerText,coverage:variant.coverage,
     citations:variant.citationSources,questionParts:variant.questionParts,evidenceMap:variant.evidenceMap,
     evidenceHighlights:variant.evidenceHighlights,workerVersionId:variant.workerVersionId,
     workerSourceBuild:variant.workerSourceBuild},Array.isArray(item.submittedSources)?item.submittedSources:[],
     definition.required_source_groups,definition.required_part_source_groups||[]);
    return {...variant,...variantAudit,manualReview:variant.manualReview};
   })}:item.reviewAblation;
  return {...item,...(reviewAblation?{reviewAblation}:{}),offlineRecheck:{passed:audit.passed,sourceGroups:audit.sourceGroups,
   questionPartCoverage:audit.questionPartCoverage,partEvidenceAudit:audit.partEvidenceAudit,
   partEvidenceComplete:audit.partEvidenceComplete,
   answerCoverageConsistent:audit.answerCoverageConsistent,
   coverageContradictions:audit.coverageContradictions,
   inlineIdsWithoutSource:audit.inlineIdsWithoutSource}};
 });
 const checked=cases.filter(item=>item.offlineRecheck);
 return {...report,cases,humanReview:summarizeManualReviews(cases),answerVariants:summarizeAnswerVariants(cases),offlineRecheck:{checkedAt:new Date().toISOString(),
  evaluator:'local-structural-recheck-v1',networkCalls:0,aiCalls:0,
  checkedCases:checked.length,
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
  workerVersionId:typeof details.workerVersionId==='string'&&details.workerVersionId.length<=128?details.workerVersionId:null,
  workerSourceBuild:typeof details.workerSourceBuild==='string'&&details.workerSourceBuild.length<=128?details.workerSourceBuild:null};
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
  failureDetail:data?.failureDetail,workerFailure:true,
  workerVersionId:data?.workerVersionId,workerSourceBuild:data?.workerSourceBuild});
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
 partQueries=[],partQuestions=[]}){
 const bookCatalog=Object.entries(manifest.books).map(([id,book])=>({id,title:book.title}));
 const selectedBookIds=Array.isArray(item.selected_book_ids)?item.selected_book_ids.map(String):[];
 const retrieval=await retrieveEvidence({question:item.question,queries,partQueries,directFallback,
  library,books:bookCatalog,allowedBookIds:allowed,selectedBookIds,
  maxCandidates:12,maxBooks:3,pagesPerBook:PRODUCTION_PAGES_PER_BOOK,
  pageLoader:async source=>{
   const shard=await library.jsonGzip('book-'+String(source.bookId)+'.json');
   const pages=shard.pages?.filter(page=>page.id===source.globalPageId&&page.page===source.page)||[];
   return pages.length===1&&typeof pages[0].text==='string'?{text:pages[0].text}:null;
  }});
 const populated=retrieval.candidates;
 if(!populated.length)throw Error('Retrieval returned no fingerprint-eligible source pages.');
 // Match the public companion's answer packet limits. A four-page / 30 KB
 // evaluation can omit a strong passage that the website itself would send,
 // especially when an all-books question needs evidence from several facets.
 const selected=selectAnswerSources(populated,item.question,'evaluation-runner-token',{
  maxSources:6,maxBytes:39_000,maxSourceBytes:35_000,history:[],
  plannedFacetCount:Math.max(0,retrieval.searchQueries.length-1),
  partQuestions});
 if(!selected.length)throw Error('No source pages fit the Worker request limit.');
 for(const source of selected){
  const book=manifest.books[String(source.bookId)];
  if(!book)throw Error('A selected source is absent from the published manifest.');
 }
 return {selected,searches:retrieval.searches};
}
export async function evaluateLiveCase(item,{library,manifest,allowed,token,fetcher=fetch,beforeCall=async()=>{},useFixedQueries=false,answerVariant='with-review',onProgress=async()=>{}}){
 if(!['with-review','compose-only','paired-review-ablation'].includes(answerVariant))
  throw Error('Answer variant must be with-review, compose-only, or paired-review-ablation.');
 const startTime=Date.now();
 const progressEvent=async event=>onProgress({caseId:item.id,...event});
 const progress=async(stage,status,message,details={})=>progressEvent({stage,status,message,...details});
 await progress('case','started',`Starting ${answerVariant} evaluation for this question.`);
 const selectedBookIds=Array.isArray(item.selected_book_ids)?item.selected_book_ids.map(String):[];
 const plannerBookId=selectedBookIds.length===1?selectedBookIds[0]:'';
 let plan,queries,plannerFallback=false,plannerFailure=null,plannerSkipped=false,
  plannerWorkerVersionId=null,plannerWorkerSourceBuild=null;
 if(useFixedQueries&&validSearchPlan(item.planner_queries)){
  queries=item.planner_queries;
  plannerSkipped=true;
  await progress('planner','skipped','Using the fixed evaluation queries; no planner request is needed.',{queryCount:queries.length});
 }else try{
  plan=await callJson(fetcher,API+'/api/pilot-plan',token,{question:item.question,bookId:plannerBookId,history:[],turnstileToken:'evaluation-runner-token'},beforeCall,'planner',progressEvent);
  if(!validSearchPlan(plan?.queries)){
   const error=attachRequestFailure(new Error('Planner returned an invalid search plan.'),'planner',{httpStatus:200,failureCode:'invalid-response',workerFailure:false});
   throw error;
  }
  queries=plan.queries;
  plannerWorkerVersionId=plan.workerVersionId||null;
  plannerWorkerSourceBuild=plan.workerSourceBuild||null;
 }catch(error){
  if(!error.requestFailure)error.requestFailure={stage:'planner',httpStatus:null,failureCode:'planner-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  const failure=error.requestFailure;
  plannerWorkerVersionId=failure.workerVersionId||null;
  plannerWorkerSourceBuild=failure.workerSourceBuild||null;
  if(!canFallbackToDirectSearch(failure.httpStatus,failure.failureCode))throw error;
  plannerFallback=true;
  plannerFailure={httpStatus:failure.httpStatus,failureCode:failure.failureCode};
  queries=[item.question];
  await progress('planner','fallback','Planner was unavailable; continuing with the reader’s exact question.',{failureCode:failure.failureCode});
 }
 const partQueries=!plannerFallback&&Array.isArray(plan?.plan?.parts)?plan.plan.parts.flatMap(part=>
  (Array.isArray(part.searchQueries)&&part.searchQueries.length?part.searchQueries:[part.question])
   .map(query=>({partId:part.id,query}))):[];
 let loaded;
 await progress('retrieval','started',`Searching ${new Set([...queries,...partQueries.map(value=>value.query)]).size} distinct facets and assembling source pages.`,
  {queryCount:queries.length,partFacetCount:partQueries.length});
 const partQuestions=!plannerFallback&&Array.isArray(plan?.plan?.parts)?plan.plan.parts.map(part=>
  ({partId:part.id,question:part.question})):[];
 try{loaded=await loadSources(item,queries,{library,manifest,allowed,directFallback:plannerFallback,
  partQueries,partQuestions});}
 catch(error){error.requestFailure={stage:'retrieval',httpStatus:null,failureCode:'retrieval-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  error.requestFailure.plannerFallback=plannerFallback;
  error.requestFailure.plannerSkipped=plannerSkipped;
  error.requestFailure.plannerWorkerVersionId=plannerWorkerVersionId;
  error.requestFailure.plannerWorkerSourceBuild=plannerWorkerSourceBuild;
  if(plannerFailure)error.requestFailure.plannerFailure=plannerFailure;throw error;}
 const {selected,searches}=loaded;
 await progress('retrieval','completed',`Retrieved ${searches.reduce((sum,value)=>sum+(Number(value.resultCount)||0),0)} indexed matches; selected ${selected.length} verified pages.`,
  {searchCount:searches.length,selectedPages:selected.map(source=>({bookId:source.bookId,page:source.page,partIds:source.candidatePartIds||[]}))});
 const variants=answerVariant==='paired-review-ablation'?['with-review','compose-only']:[answerVariant];
 const variantResults=[];
 try{
  for(const variant of variants){
   await progress('answer','started',`Submitting ${variant} answer request with ${selected.length} verified pages; waiting for the Worker’s compose/review pipeline.`,
    {variant,sourceCount:selected.length});
   const data=await callJson(fetcher,API+'/api/pilot-answer',token,{question:item.question,
    bookId:plannerBookId,plan:plan?.plan||undefined,history:[],turnstileToken:'evaluation-runner-token',
    answerVariant:variant==='compose-only'?'compose-only':'with-review',
    sources:selected.map(({bookId,page,text,candidatePartIds})=>({bookId,page,text,candidatePartIds}))},beforeCall,'answer',progressEvent);
   const audit=auditLiveAnswer(data,selected,item.required_source_groups,
    item.required_part_source_groups||[]);
   variantResults.push({answerVariant:variant,pipeline:data.pipeline||null,...audit,usage:data.usage||null,
    ...(data.trace?{evidenceTrace:data.trace}:{})});
   await progress('answer','completed',`${variant} returned ${audit.outcome||'no outcome'} with ${audit.coverage} coverage and ${audit.citationCount} citations.`,
    {variant,outcome:audit.outcome,coverage:audit.coverage,citations:audit.citationCount,usage:data.usage||null});
  }
 }catch(error){if(!error.requestFailure)error.requestFailure={stage:'answer',httpStatus:null,failureCode:'answer-failed',message:String(error.message||error).slice(0,240),workerFailure:false};
  error.requestFailure.plannerFallback=plannerFallback;
  error.requestFailure.plannerSkipped=plannerSkipped;
  error.requestFailure.plannerWorkerVersionId=plannerWorkerVersionId;
  error.requestFailure.plannerWorkerSourceBuild=plannerWorkerSourceBuild;
  if(plannerFailure)error.requestFailure.plannerFailure=plannerFailure;throw error;}
 const primary=variantResults.find(result=>result.answerVariant==='with-review')||variantResults[0];
 const reviewAblation=answerVariant==='paired-review-ablation'?{
  comparison:'same resolved question, planner result and submitted source pages; only the final model-review call is omitted in compose-only',
  variants:variantResults
 }:null;
 return {id:item.id,question:item.question,discipline:item.discipline||'',selectedBookIds:Array.isArray(item.selected_book_ids)?item.selected_book_ids:[],
  reviewFocus:Array.isArray(item.review_focus)?item.review_focus:[],plannerSkipped,plannerQueries:plannerFallback?[]:queries,plannerFallback,
  plannerWorkerVersionId,plannerWorkerSourceBuild,answerWorkerVersionId:primary.workerVersionId,answerWorkerSourceBuild:primary.workerSourceBuild,
  ...(plannerFailure?{plannerFailure}:{}),plannerPlan:plan?.plan||null,searches,
  submittedSources:selected.map(({bookId,title,page,globalPageId,preview,candidatePartIds})=>({bookId,title,page,globalPageId,candidatePartIds,
   excerpt:String(preview||'').slice(0,1200)})),
  ...primary,answerWorkerVersionId:primary.workerVersionId,answerWorkerSourceBuild:primary.workerSourceBuild,
  pipeline:variantResults.map(result=>result.pipeline).find(Boolean)||null,
  answerVariant,...(answerVariant==='paired-review-ablation'?{reviewAblation}:{}),
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
   workerVersionId:plan?.workerVersionId,workerSourceBuild:plan?.workerSourceBuild});
 let loaded;
 await progress('retrieval','started',`Searching ${plan.queries.length} planner queries against the library.`,{queryCount:plan.queries.length});
 const partQueries=Array.isArray(plan?.plan?.parts)?plan.plan.parts.flatMap(part=>
  (Array.isArray(part.searchQueries)&&part.searchQueries.length?part.searchQueries:[part.question])
   .map(query=>({partId:part.id,query}))):[];
 const partQuestions=Array.isArray(plan?.plan?.parts)?plan.plan.parts.map(part=>
  ({partId:part.id,question:part.question})):[];
 try{loaded=await loadSources(item,plan.queries,{library,manifest,allowed,partQueries,partQuestions});}
 catch(error){
  const wrapped=attachRequestFailure(error,'retrieval',{failureCode:'retrieval-failed',workerFailure:false,
   workerVersionId:plan.workerVersionId,workerSourceBuild:plan.workerSourceBuild});
  wrapped.requestFailure.plannerSkipped=false;
  throw wrapped;
 }
 const {selected,searches}=loaded;
 await progress('retrieval','completed',`Retrieved ${searches.reduce((sum,value)=>sum+(Number(value.resultCount)||0),0)} indexed matches; selected ${selected.length} verified pages.`,
  {searchCount:searches.length,selectedPages:selected.map(source=>({bookId:source.bookId,page:source.page}))});
 const retrievedBookIds=[...new Set(selected.map(source=>String(source.bookId)))];
 const sourceGroups=(item.required_source_groups||[]).map(group=>{
  const expectedBookIds=group.book_ids.map(String);
  const groupBookIds=retrievedBookIds.filter(id=>expectedBookIds.includes(id));
  const retrieved=groupBookIds.length>0;
  return {label:group.label,expectedBookIds,retrievedBookIds:groupBookIds,
   citedBookIds:[],foundBookIds:[],retrieved,cited:false,found:false};
 });
 const passed=sourceGroups.every(group=>group.retrieved);
 return {id:item.id,question:item.question,discipline:item.discipline||'',selectedBookIds,
  reviewFocus:Array.isArray(item.review_focus)?item.review_focus:[],plannerSkipped:false,
  plannerQueries:plan.queries,plannerFallback:false,
  plannerWorkerVersionId:plan.workerVersionId||null,plannerWorkerSourceBuild:plan.workerSourceBuild||null,
  answerWorkerVersionId:null,answerWorkerSourceBuild:null,searches,
  submittedSources:selected.map(({bookId,title,page,globalPageId,preview})=>({bookId,title,page,globalPageId,
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
  answerWorkerVersionId:failure.stage==='answer'?failure.workerVersionId:null,
  answerWorkerSourceBuild:failure.stage==='answer'?failure.workerSourceBuild:null,
  plannerFallback:failure.plannerFallback===true,...(failure.plannerFailure?{plannerFailure:failure.plannerFailure}:{}),searches:[],
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
function parseArgs(argv){const out={mode:process.env.LIVE_EVAL_MODE||'smoke',scope:process.env.LIVE_EVAL_SCOPE||'selected-books',caseId:process.env.LIVE_EVAL_CASE_ID||'',answerVariant:process.env.LIVE_EVAL_ANSWER_VARIANT||'with-review',output:process.env.LIVE_EVAL_OUTPUT||'',confirm:process.env.CONFIRM_LIVE_AI==='true'};
 for(let i=0;i<argv.length;i++){const [flag,inline]=argv[i].split('=',2),key=flag.replace(/^--/,'');if(flag==='--help'||flag==='-h'){out.help=true;continue;}
  if(!['mode','scope','case','answer-variant','output','confirm-live-ai'].includes(key))throw Error('Unknown option '+flag);const value=inline??argv[++i];if(value===undefined)throw Error('Missing value for '+flag);
  if(key==='mode')out.mode=value;else if(key==='scope')out.scope=value;else if(key==='case')out.caseId=value;else if(key==='answer-variant')out.answerVariant=value;else if(key==='output')out.output=value;else out.confirm=value==='true';}
 return out;}
async function main(){
 const args=parseArgs(process.argv.slice(2));if(args.help){console.log('Usage: PILOT_EVALUATION_TOKEN=... node reading-companion/live-answer-evaluation.mjs --confirm-live-ai true [--mode planner|smoke|quality|holdout|acceptance|full] [--scope selected-books|all-books] [--answer-variant with-review|compose-only|paired-review-ablation] [--case case-id] [--output report.json]');return 0;}
 if(!args.confirm)throw Error('Live AI calls are disabled unless --confirm-live-ai true is provided.');
 if(!['with-review','compose-only','paired-review-ablation'].includes(args.answerVariant))throw Error('Answer variant must be with-review, compose-only, or paired-review-ablation.');
 const usesEvaluationMode=['quality','holdout','acceptance'].includes(args.mode);
 if(!usesEvaluationMode&&args.scope!=='selected-books')throw Error('The all-books scope is available only in quality, holdout or acceptance mode.');
 if(usesEvaluationMode&&!['selected-books','all-books'].includes(args.scope))throw Error('Evaluation scope must be selected-books or all-books.');
 if(args.mode==='acceptance'&&args.scope!=='all-books')throw Error('The untouched acceptance suite must run in all-books mode.');
 const token=process.env.PILOT_EVALUATION_TOKEN;if(typeof token!=='string'||token.length<32)throw Error('PILOT_EVALUATION_TOKEN must be set to the configured evaluation secret.');
 if(args.mode==='full'&&process.env.CONFIRM_FULL_30!=='true')throw Error('The full 30-question live run also requires CONFIRM_FULL_30=true.');
 const suite=JSON.parse(await readFile(SUITE_PATH,'utf8'));
 const selectedCases=selectLiveCases(suite,args.mode,args.caseId);
 const cases=usesEvaluationMode?applyQualityScope(selectedCases,args.scope):selectedCases;
 const evaluationUsesPlanner=usesEvaluationMode&&args.scope==='all-books';
 const plannerCalls=usesEvaluationMode&&!evaluationUsesPlanner?0:cases.length;
 const answerCallsPerCase=args.answerVariant==='paired-review-ablation'?3:
  args.answerVariant==='compose-only'?1:2;
 const estimatedWorkerAiCalls=args.mode==='planner'?cases.length:plannerCalls+cases.length*answerCallsPerCase;
 const report={schema:'antilogicalism-reading-companion-live-answer-eval-v2',generatedAt:new Date().toISOString(),mode:args.mode,searchScope:usesEvaluationMode?args.scope:null,selectedCaseId:args.caseId&&args.caseId!=='all'?args.caseId:null,
  answerVariant:args.answerVariant,caseCount:cases.length,estimatedWorkerAiCalls,
  callsPerCase:args.mode==='planner'?'1 planner inference + local retrieval per case; answer generation is skipped':
   (evaluationUsesPlanner?'1 planner + ':'0 planner + ')+answerCallsPerCase+' answer pipeline calls per case; the simplified answer path has no automatic composer regeneration',
  answerQualityNote:args.mode==='planner'?'Planner queries and expected-book retrieval are checked; answer generation and answer quality are not evaluated.':
   'Automated checks cover source identity, per-part citation linkage, named-work-to-question-part alignment, and coverage consistency. They do not judge factual truth or whether cited passages semantically support the prose. Each answer includes a blank human rubric: rate accuracy, question coverage, explanation quality, citation support, and citation completeness from 0 (fail) to 2 (strong).',
  executionStatus:'initializing',completedCases:0,notRunCases:cases.length,requestFailureCases:0,plannerFallbackCases:0,plannerSkippedCases:0,workerVersionIds:[],stopReason:'',cases:[]};
 const outputPath=args.output?resolve(args.output):'';
 let activeLibrary=null;
 const saveReport=async()=>{
  if(activeLibrary&&report.reproducibility?.corpus)
   report.reproducibility.corpus.indexFiles=Object.fromEntries(activeLibrary.contentDigests);
  if(outputPath)await writeFile(outputPath,JSON.stringify(report,null,2)+'\n');
 };
 await saveReport();
 console.log('Initializing '+args.mode+' evaluation for '+cases.length+' question'+(cases.length===1?'':'s')+
  '; loading the published fingerprint coverage and corpus manifest before retrieval.');
 const startupHeartbeat=setInterval(()=>console.log('['+new Date().toISOString()+
  '] SETUP WAIT: still loading the published fingerprint coverage and corpus manifest.'),15_000);
 try{
  const results=await Promise.all([fetchJson(FINGERPRINT_ROOT+'coverage-v1.json'),new RemoteLibrary(DEFAULT_INDEX_ROOT,makeCachedFetch(DEFAULT_INDEX_ROOT)).manifest()]);
  clearInterval(startupHeartbeat);
  const coverage=results[0],manifest=results[1];
  if(coverage?.schema!=='antilogicalism-reader-coverage-v1'||coverage?.libraryVersion!==47||manifest.version!==47)throw Error('Published v47 coverage or corpus is incompatible.');
  const allowed=new Set(Object.keys(coverage.books));
  for(const item of cases)for(const group of item.required_source_groups)if(!group.book_ids.some(id=>allowed.has(String(id))))throw Error(item.id+': no expected source book is fingerprint-covered.');
  const library=new RemoteLibrary(DEFAULT_INDEX_ROOT,makeCachedFetch(DEFAULT_INDEX_ROOT));
  activeLibrary=library;
  report.reproducibility={clientSourceRevision:sourceRevision(),corpus:{libraryVersion:manifest.version,
   indexRoot:DEFAULT_INDEX_ROOT,fingerprintRoot:FINGERPRINT_ROOT,
   coverageSha256:jsonDigest(coverage),manifestSha256:jsonDigest(manifest),indexFiles:{}}};
  console.log('Starting explicitly confirmed '+args.mode+' live evaluation: '+cases.length+' questions; estimated at least '+report.estimatedWorkerAiCalls+' Worker inference calls, plus conditional repairs.');
  report.executionStatus='running';await saveReport();
  let previousCall=0;
  const beforeCall=async()=>{if(previousCall){const due=Math.max(0,CALL_GAP_MS-(Date.now()-previousCall));if(due)await new Promise(resolve=>setTimeout(resolve,due));}previousCall=Date.now();};
  const printProgress=event=>{
   const details=[];
   if(event.variant)details.push('variant='+event.variant);
   if(Number.isFinite(event.queryCount))details.push('queries='+event.queryCount);
   if(Number.isFinite(event.searchCount))details.push('searches='+event.searchCount);
   if(Number.isFinite(event.sourceCount))details.push('pages='+event.sourceCount);
   if(Number.isFinite(event.citations))details.push('citations='+event.citations);
   if(event.usage&&Number.isFinite(event.usage.calls))details.push('worker-calls='+event.usage.calls);
   if(event.usage&&Number.isFinite(event.usage.neurons))details.push('neurons='+event.usage.neurons);
   if(Array.isArray(event.selectedPages))details.push('selected='+event.selectedPages.map(page=>page.bookId+':'+page.page).join(','));
   console.log('['+new Date().toISOString()+'] ['+String(event.caseId||'case')+'] '+
    String(event.stage||'progress').toUpperCase()+' '+String(event.status||'update').toUpperCase()+': '+
    String(event.message||'')+(details.length?' ('+details.join('; ')+')':''));
  };
  const run=await runLiveCases(cases,{evaluateCase:args.mode==='planner'?evaluatePlannerCase:evaluateLiveCase,
  evaluateOptions:{library,manifest,allowed,token,beforeCall,useFixedQueries:usesEvaluationMode&&!evaluationUsesPlanner,
   answerVariant:args.answerVariant,onProgress:printProgress},onResult:async(result,results)=>{
   report.cases=results;report.completedCases=results.length;
   report.notRunCases=cases.length-results.length;
   report.requestFailureCases=results.filter(item=>item.requestFailure).length;
   report.plannerFallbackCases=results.filter(item=>item.plannerFallback).length;
   report.plannerSkippedCases=results.filter(item=>item.plannerSkipped).length;
   report.humanReview=summarizeManualReviews(results);
   report.answerVariants=summarizeAnswerVariants(results);
   report.workerVersionIds=[...new Set(results.flatMap(item=>[item.plannerWorkerVersionId,item.answerWorkerVersionId]).filter(value=>typeof value==='string'&&value))];
   await saveReport();
   const label=args.mode==='planner'?'PLANNER':'STRUCTURAL';
   console.log((result.passed===true?label+'-PASS':result.passed===null?'UNSCORED':result.requestFailure?'REQUEST-FAIL':label+'-MISS')+' '+result.id+': '+(result.outcome||result.requestFailure?.failureCode||'no outcome'));
  }});
  report.cases=run.results;report.stopReason=run.stopReason;
  report.notRunCases=cases.length-run.results.length;
  report.requestFailureCases=run.results.filter(item=>item.requestFailure).length;
  report.plannerFallbackCases=run.results.filter(item=>item.plannerFallback).length;
  report.executionStatus=report.requestFailureCases?'completed-with-request-failures':'completed';
  report.summary={passedCases:report.cases.filter(item=>item.passed===true).length,
   failedCases:report.cases.filter(item=>item.passed===false).length,
   unscoredCases:report.cases.filter(item=>item.passed===null||item.passed===undefined).length,
   requestFailureCases:report.requestFailureCases,
   plannerFallbackCases:report.plannerFallbackCases,
   humanReview:summarizeManualReviews(report.cases),
   answerVariants:summarizeAnswerVariants(report.cases),
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
   'Done: '+report.summary.passedCases+'/'+report.caseCount+' reviewed answers met structural gates; '+report.summary.failedCases+' failed and '+report.summary.unscoredCases+' are unscored. Semantic answer quality requires the separate human rubric.');
  return report.requestFailureCases||(args.mode==='planner'&&report.summary.failedCases)||
   (usesEvaluationMode&&report.summary.failedCases>0)?1:0;
 }catch(error){
  clearInterval(startupHeartbeat);
  report.executionStatus=report.cases.length?'interrupted':'setup-failed';
  report.setupFailure={message:String(error?.message||error).slice(0,240)};
  report.completedCases=report.cases.length;report.notRunCases=cases.length-report.cases.length;
  await saveReport();throw error;
 }
}
if(import.meta.url===`file://${process.argv[1]}`)main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});

