import {hasExplicitScriptureReference} from './remote-library.mjs';
import {catalogIdentity} from './reader-contract.mjs';

/* Merge two independently retrieved question facets, retaining alternatives
 * for source selection and manual inspection.
 * No generated claim or PDF locator is trusted by this component.
 */
export function mergeFacetSearches(results,limit=8){
 if(!Array.isArray(results))return [];
 const groups=results.map(r=>{
   const sources=Array.isArray(r?.sources)?r.sources:[];
   // Search ranks each passage within its book. Compare those passage scores
   // across the query facet before consuming the limited answer-source budget,
   // so a weak hit from a high-ranking book cannot hide stronger evidence in
   // another work by the same author. Keep the original order when scores are
   // absent (for older indexes and hand-built callers).
   return sources.map((entry,index)=>({entry,index})).sort((a,b)=>{
     const aScore=Number.isFinite(a.entry?.score)?a.entry.score:null;
     const bScore=Number.isFinite(b.entry?.score)?b.entry.score:null;
     if(aScore===null&&bScore===null)return a.index-b.index;
     if(aScore===null)return 1;
     if(bScore===null)return -1;
     return bScore-aScore||a.index-b.index;
   }).map(({entry})=>entry);
 });
 const valid=(entry)=>entry&&Number.isSafeInteger(entry.page)&&entry.page>=1&&
   /^[1-9]\d{0,3}$/.test(String(entry.bookId));
 const hasScores=groups.some(group=>group.some(entry=>Number.isFinite(entry?.score)));
 if(!hasScores){
   // Retain deterministic round-robin behavior for legacy callers without
   // evidence scores. Live retrieval results use the passage-level ranking
   // below so a strong hit later in one facet is not crowded out by weak
   // first hits from every other facet.
   const seen=new Map(),out=[];
   function add(entry,facet){
     if(!valid(entry))return false;
     const key=String(entry.bookId)+':'+entry.page;
     const rank=groups[facet].indexOf(entry)+1;
     if(seen.has(key)){
       const previous=seen.get(key);
       if(!previous.facetRanks.some(item=>item.facet===facet))
         previous.facetRanks.push({facet,rank});
       return false;
     }
     const value={...entry,facet,facetRanks:[{facet,rank}]};
     seen.set(key,value);out.push(value);return true;
   }
   for(let facet=0;facet<groups.length;facet++){
     for(const entry of groups[facet])if(add(entry,facet))break;
   }
   for(let i=0;i<15&&out.length<limit;i++){
     for(let f=0;f<groups.length&&out.length<limit;f++)
       if(groups[f][i])add(groups[f][i],f);
   }
   return out.slice(0,limit);
 }

 // Aggregate a page's reciprocal-rank evidence across query facets. This
 // compares each facet by its internal passage order instead of assuming raw
 // scores from differently worded queries share the same scale. A page found
 // by multiple facets gains corroboration; raw score breaks close ties.
 const RANK_OFFSET=4,byPage=new Map();
 let firstSeen=0;
 for(let facet=0;facet<groups.length;facet++){
   const group=groups[facet];
   for(let rank=0;rank<group.length;rank++){
     const entry=group[rank];
     if(!valid(entry))continue;
     const key=String(entry.bookId)+':'+entry.page;
     let record=byPage.get(key);
     if(!record){
       record={entry,facet,rankScore:0,bestScore:-Infinity,firstSeen:firstSeen++,
         facets:new Set(),facetRanks:[]};
       byPage.set(key,record);
     }
     record.rankScore+=1/(RANK_OFFSET+rank+1);
     record.facets.add(facet);
     record.facetRanks.push({facet,rank:rank+1});
     const score=Number.isFinite(entry.score)?entry.score:-Infinity;
     if(score>record.bestScore){
       record.entry=entry;
       record.facet=facet;
       record.bestScore=score;
     }
   }
 }
 return [...byPage.values()].sort((a,b)=>
   b.rankScore-a.rankScore||b.bestScore-a.bestScore||a.firstSeen-b.firstSeen)
   .slice(0,limit).map(({entry,facet,facets,facetRanks})=>({...entry,facet,
     matchedFacets:facets.size,facetRanks}));
}

/* Shared browser/evaluator retrieval assembly. Both callers search the same
 * facet pool, hydrate the same canonical page text, and hand the same candidate
 * ordering to selectAnswerSources. `pageLoader` is the only environment
 * difference (the browser has a shard cache; the evaluator reads the shard
 * through RemoteLibrary directly).
 */
export async function retrieveEvidence({question,queries,library,books,allowedBookIds,
 selectedBookIds=[],pageLoader,directFallback=false,allowedPage=()=>true,
 maxCandidates=12,maxBooks=3,pagesPerBook=4,pageLimit=14000}={}){
 const direct=String(question||'').trim();
 if(direct.length<5||direct.length>400)throw Error('Question must contain 5–400 characters.');
 if(!library||typeof library.search!=='function'||!Array.isArray(books)||
   !(allowedBookIds instanceof Set)||typeof pageLoader!=='function')
  throw Error('Retrieval requires the shared library, catalog, allowlist, and page loader.');
 const useDirect=directFallback||!Array.isArray(queries);
 if(useDirect){
  if(!Array.isArray(queries)||queries.length!==1||String(queries[0]||'').trim()!==direct)
   throw Error('Direct fallback must use the unchanged question.');
 }else if(!validSearchPlan(queries))throw Error('Planner returned an invalid search plan.');
 const searchQueries=buildSearchFacets(direct,useDirect?[direct]:queries);
 const selected=selectedBookIds.map(String);
 const selectedAllowed=new Set(selected.filter(id=>allowedBookIds.has(id)));
 if(selected.length&&selected.some(id=>!allowedBookIds.has(id)))
  throw Error('Selected book is not present in the published corpus.');
 const namedBookIds=selected.length?selected:matchExplicitBookIds(direct,books);
 const targetBookIds=namedBookIds.length?namedBookIds:[null];
 const retrievalAllowed=selected.length?selectedAllowed:allowedBookIds;
 const searchSets=await Promise.all(searchQueries.map(async query=>{
  const facetBookIds=targetBooksForFacet(query,books,targetBookIds[0]===null?null:targetBookIds);
  const targeted=await Promise.all(facetBookIds.map(bookId=>library.search(query,{
   ...(bookId?{bookId}:{}),allowedBookIds:retrievalAllowed,maxBooks,pagesPerBook
  })));
  return {sources:targeted.flatMap(set=>Array.isArray(set?.sources)?set.sources:[])
   .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0))};
 }));
 const results=searchSets.length>1?mergeFacetSearches(searchSets,maxCandidates):
  (searchSets[0]?.sources||[]);
 const filtered=results.filter(source=>allowedPage(source)&&
  allowedBookIds.has(String(source.bookId))&&
  (!selected.length||selectedAllowed.has(String(source.bookId))));
 const representatives=[],others=[],visited=new Set();
 for(const source of filtered){
  const group=searchQueries.length>1?String(source.facet):String(source.bookId);
  if(visited.has(group))others.push(source);
  else{visited.add(group);representatives.push(source);}
 }
 const populated=[];
 for(const source of [...representatives,...others]){
  const page=await pageLoader(source);
  if(!page||typeof page.text!=='string')continue;
  const byteLength=new TextEncoder().encode(page.text).byteLength;
  if(byteLength<25||byteLength>pageLimit)continue;
  populated.push({...source,text:page.text,byteLength});
  if(populated.length>=maxCandidates)break;
 }
 return {candidates:populated,searches:searchSets.map((set,index)=>({
  query:searchQueries[index]+(namedBookIds.length?' [named books: '+namedBookIds.join(', ')+']':''),
  resultCount:set.sources.length,sources:set.sources.slice(0,8)
 })),searchQueries,namedBookIds};
}
export function validSearchPlan(value){
 return Array.isArray(value)&&value.length>=2&&value.length<=4&&
   value.every(q=>typeof q==='string'&&q.trim().length>=12&&q.trim().length<=160)&&
   new Set(value.map(q=>q.trim().toLocaleLowerCase())).size===value.length;
}

/* Keep the reader's exact wording as a lexical facet alongside the planner's
 * rewrites. This lets retrieval recover source language the planner
 * paraphrases away. Search remains local to the published index and spends no
 * additional model calls. */
export function buildSearchFacets(question,plannedQueries,bookId=''){
 const planned=validSearchPlan(plannedQueries)?plannedQueries:[String(question||'')];
 const direct=String(question||'').trim();
 if(!direct||planned.some(query=>query.trim().toLowerCase()===direct.toLowerCase()))
  return [...planned];
 return [...planned,direct];
}

/* Resolve explicit work names and author mentions against the published
 * catalog. Exact work titles constrain retrieval; an author-only mention
 * searches that author's matching works so global book limits cannot crowd
 * them out before topical passage ranking. This adds no model calls.
 */
function normalizeCatalogText(value){
 return String(value||'').toLocaleLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function questionContainsPhrase(question,phrase){
 const q=' '+normalizeCatalogText(question)+' ';
 const p=normalizeCatalogText(phrase);
 return p.length>=4&&q.includes(' '+p+' ');
}
function catalogWorkTitles(title){
 return catalogIdentity(title).aliases.filter(value=>normalizeCatalogText(value).length>=4);
}
function catalogAuthorNames(title){
 return catalogIdentity(title).authors;
}
function explicitlyNamedAuthorGroups(question,candidates){
 const groups=new Map();
 for(const candidate of candidates){
  const bookId=String(candidate?.bookId||'');
  if(!bookId)continue;
  for(const name of catalogAuthorNames(candidate?.title)){
   const key=normalizeCatalogText(name);
   if(!key)continue;
   if(!groups.has(key))groups.set(key,{key,name,bookIds:new Set()});
   groups.get(key).bookIds.add(bookId);
  }
 }
 const surnameCounts=new Map();
 for(const group of groups.values()){
  const surname=group.key.split(' ').at(-1)||'';
  surnameCounts.set(surname,(surnameCounts.get(surname)||0)+1);
 }
 return [...groups.values()].filter(group=>{
  const surname=group.key.split(' ').at(-1)||'';
  return questionContainsPhrase(question,group.name)||
   (surname.length>=4&&surnameCounts.get(surname)===1&&
    questionContainsPhrase(question,surname));
 });
}
function comparisonAuthorOrder(question,candidates,facetBalanced,directFacet){
 const groups=explicitlyNamedAuthorGroups(question,candidates);
 if(groups.length<2)return null;
 const representatives=groups.map(group=>{
  const groupCandidates=candidates.filter(candidate=>
   group.bookIds.has(String(candidate?.bookId||'')));
  const direct=groupCandidates.filter(candidate=>
   Array.isArray(candidate?.facetRanks)&&candidate.facetRanks.some(item=>
    item.facet===directFacet));
  if(direct.length){
   return direct.sort((a,b)=>{
    const rank=source=>Math.min(...source.facetRanks.filter(item=>
     item.facet===directFacet).map(item=>item.rank));
    return rank(a)-rank(b)||(Number(b.score)||0)-(Number(a.score)||0);
   })[0];
  }
  return facetBalanced.find(candidate=>group.bookIds.has(String(candidate?.bookId||'')))||
   groupCandidates[0];
 });
 const ordered=[...representatives],used=new Set(representatives);
 // After ensuring one author-grounded page per side, alternate complementary
 // pages across the same author groups instead of filling by book ID.
 for(let depth=0;depth<candidates.length;depth++)for(const group of groups){
  const next=facetBalanced.find(candidate=>!used.has(candidate)&&
   group.bookIds.has(String(candidate?.bookId||'')));
  if(next){used.add(next);ordered.push(next);}
 }
 for(const candidate of facetBalanced)if(!used.has(candidate))ordered.push(candidate);
 return ordered;
}
export function matchExplicitBookIds(question,books){
 if(typeof question!=='string'||!Array.isArray(books))return [];
 // A canonical chapter-and-verse locator such as "James 2:14–26" is a
 // scripture reference, not an author-only mention of William James. Let the
 // library's scripture-aware ranking choose a Bible edition instead of
 // narrowing the all-books search to works by an author with that surname.
 if(hasExplicitScriptureReference(question))return [];
 const valid=books.filter(book=>/^[1-9]\d{0,3}$/.test(String(book?.id||''))&&
  typeof book?.title==='string');
 const titleMatches=valid.filter(book=>
  catalogWorkTitles(book.title).some(title=>questionContainsPhrase(question,title)));
 const authorGroups=new Map();
 for(const book of valid){
  for(const name of catalogAuthorNames(book.title)){
   const surname=normalizeCatalogText(name).split(' ').filter(Boolean).at(-1)||'';
   if(surname.length>=4&&questionContainsPhrase(question,surname)){
    if(!authorGroups.has(surname))authorGroups.set(surname,[]);
    authorGroups.get(surname).push(book);
   }
  }
 }
 // An author-only question searches across the matching catalog works.
 if(!titleMatches.length){
  // An author-only question still needs an author-only search. Letting the
  // global top-three book limit decide can crowd out the author's own works
  // with commentary or unrelated catalog entries. Search each matching work
  // and let passage-level evidence rank the resulting pages.
  return [...new Set([...authorGroups.values()].flatMap(group=>
   group.map(book=>String(book.id))))].slice(0,8);
 }
 if(!authorGroups.size)
  return [...new Set(titleMatches.map(book=>String(book.id)))].slice(0,8);
 const groups=[...authorGroups.values()].map(group=>{
  const titleIds=new Set(titleMatches.map(book=>String(book.id)));
  const exact=group.filter(book=>titleIds.has(String(book.id)));
  return (exact.length?exact:group).slice(0,2);
 });
 const selected=[];
 for(let i=0;i<2;i++)for(const group of groups)if(group[i])selected.push(String(group[i].id));
 return [...new Set(selected)].slice(0,8);
}

/* A planner facet that explicitly names a work or author should search that
 * work alone. Keep selected-book scope intact, and fall back to the caller's
 * broader scope when a facet does not identify a catalog source. */
export function targetBooksForFacet(query,books,allowedBookIds=null){
 const scoped=Array.isArray(allowedBookIds)&&allowedBookIds.length
  ?allowedBookIds.map(String):null;
 // Preserve a reader's explicit selected-book filter, but do not let a
 // canonical Bible locator become a false author-title constraint in an
 // all-books facet. RemoteLibrary.search recognizes the same locator and
 // boosts indexed Bible editions when it searches the full catalog.
 if(hasExplicitScriptureReference(String(query||'')))return scoped?.length?scoped:[null];
 const matches=matchExplicitBookIds(String(query||''),books)
  .filter(id=>!scoped||scoped.includes(String(id)));
 if(matches.length)return matches;
 return scoped?.length?scoped:[null];
}

/* Planning improves retrieval, but a temporary planner outage must not block
 * direct search with the reader's own wording. Keep explicit request denials
 * and rate limits fail-closed. */
export function canFallbackToDirectSearch(status,code=''){
 if(['ai-daily-limit-reached','ai-daily-free-allocation','ai-provider-usage-limit',
   'ai-credit-limit','ai-capacity-unavailable','ai-rate-limited'].includes(code))return false;
 if(status===null||status===undefined)return true;
 if(Number.isInteger(status)&&status>=500)return true;
 if(Number.isInteger(status)&&status>=400)return false;
 return ['invalid-response','search-planning-failed','network-error'].includes(code);
}

function directFacetTitleMatch(question,title){
 const stop=new Set(['what','when','where','which','who','whom','whose','why','how','does','did','has','have','had','are','was','were','the','and','for','from','with','into','about','between','this','that','these','those','there','their','they','them','than','then','your','our','also','only','could','would','should']);
 const questionTerms=new Set((String(question||'').toLowerCase().match(/[a-z0-9]+/g)||[])
  .filter(term=>term.length>=4&&!stop.has(term)));
 const workTitle=String(title||'').split(/[—–]/,1)[0].toLowerCase();
 const titleTerms=new Set(workTitle.match(/[a-z0-9]+/g)||[]);
 let score=0;
 for(const term of questionTerms)if(titleTerms.has(term))score++;
 return score;
}

function directFacetTextMatch(question,text){
 const stop=new Set(['what','when','where','which','who','whom','whose','why','how','does','did','has','have','had','are','was','were','the','and','for','from','with','into','about','between','this','that','these','those','there','their','they','them','than','then','your','our','also','only','could','would','should']);
 const normalize=term=>/^(?:cause|causal|causality|causes|caused|causing)$/.test(term)?'caus':
  term.startsWith('necess')?'necess':term.startsWith('experienc')?'experienc':term;
 const questionTerms=new Set((String(question||'').toLowerCase().match(/[a-z0-9]+/g)||[])
  .filter(term=>term.length>=4&&!stop.has(term)).map(normalize));
 const textTerms=new Set((String(text||'').toLowerCase().match(/[a-z0-9]+/g)||[]).map(normalize));
 let score=0;
 for(const term of questionTerms)if(textTerms.has(term))score++;
 return score;
}

function interleavePlannedFacets(candidates,plannedFacetCount,question=''){
 const count=Math.max(0,Math.floor(Number(plannedFacetCount)||0));
 if(count<2||!candidates.some(candidate=>Array.isArray(candidate?.facetRanks)))
  return candidates;
 const used=new Set(),ordered=[];
 // The final facet is the reader's verbatim question; earlier facets are
 // targeted subtopic searches. Reserve the strongest result from the direct
 // question as well as one from each planned facet. The planner can broaden
 // or misread a question, while the exact wording can retrieve a directly
 // relevant work title (for example, History of the Conflict Between Religion
 // and Science). Use remaining slots for second-ranked planned results.
 for(let facet=0;facet<=count;facet++){
  const facetCandidates=candidates.filter(value=>!used.has(value)&&
   value.facetRanks?.some(item=>item.facet===facet&&
    (facet===count||item.rank===1)));
  // On the verbatim-question facet, a work whose title matches the question
  // is often a better direct source than a higher-scoring bibliographic or
  // incidental mention of that work. Consider every direct-query candidate
  // already in the shortlist, not only its top-ranked passage: an exact-title
  // source can rank just below a bibliographic mention. For same-title pages,
  // prefer text matching the reader's exact question over tiny score gaps.
  const candidate=facet===count&&facetCandidates.length
   ?facetCandidates.reduce((best,value)=>{
     const titleMatch=directFacetTitleMatch(question,value.title);
     const bestTitleMatch=directFacetTitleMatch(question,best.title);
     if(titleMatch!==bestTitleMatch)return titleMatch>bestTitleMatch?value:best;
     return directFacetTextMatch(question,value.text??value.preview)>
       directFacetTextMatch(question,best.text??best.preview)?value:best;
    },facetCandidates[0])
   :facetCandidates[0];
  if(candidate){used.add(candidate);ordered.push(candidate);}
 }
 for(let rank=2;rank<=2;rank++)for(let facet=0;facet<count;facet++){
  const candidate=candidates.find(value=>!used.has(value)&&
   value.facetRanks?.some(item=>item.facet===facet&&item.rank===rank));
  if(candidate){used.add(candidate);ordered.push(candidate);}
 }
 for(const candidate of candidates)if(!used.has(candidate))ordered.push(candidate);
 return ordered;
}

/* The answer flow may send six full pages. Keep their exact request below
 * both the Worker body limit and its separate verified-text limit. Candidate
 * order is already facet-balanced; preserve it so comparison parts stay covered.
 */
export function selectAnswerSources(candidates,question,turnstileToken,
  {maxSources=4,maxBytes=39000,maxSourceBytes=35000,history=[],plannedFacetCount=0}={}){
 if(!Array.isArray(candidates)||typeof question!=='string'||
    typeof turnstileToken!=='string')return [];
 const chosen=[],firstPerBook=[],seenBooks=new Set();
 for(const candidate of candidates){
   const key=String(candidate?.bookId||'');
   if(key&&!seenBooks.has(key)){seenBooks.add(key);firstPerBook.push(candidate);}
 }
 // Preserve passage ranking for ordinary questions. Comparison questions
 // need different works by design. Author-wide questions also benefit from
 // coverage across the author's works, so long as the question does not name
 // one specific work. matchExplicitBookIds resolves this from the candidates'
 // trusted catalog titles and does not add a model call.
 const comparisonIntent=/\b(?:compare|contrast|versus|vs\.?|differences?|similarities?)\b/i.test(question);
 const explicitlyNamedWorkIds=new Set(candidates.filter(candidate=>{
   const id=String(candidate?.bookId||'');
   return id&&catalogWorkTitles(candidate?.title).some(title=>
     questionContainsPhrase(question,title));
 }).map(candidate=>String(candidate.bookId)));
 const multiWorkIntent=explicitlyNamedWorkIds.size>1;
 const authorWideBooks=matchExplicitBookIds(question,candidates.map(candidate=>({
   id:String(candidate?.bookId||''),title:String(candidate?.title||'')
 })));
 const authorWideIntent=authorWideBooks.length>1;
 const facetBalanced=interleavePlannedFacets(candidates,plannedFacetCount,question);
 let ordered=facetBalanced;
 if(comparisonIntent){
   // For author comparisons, reserve one page per named author before filling
   // the budget. A book-per-side reservation can spend several slots on one
   // author's multiple works and omit the other author's best comparison page.
   ordered=comparisonAuthorOrder(question,candidates,facetBalanced,
     Math.max(0,Math.floor(Number(plannedFacetCount)||0)))||
     [...firstPerBook,...facetBalanced.filter(candidate=>!firstPerBook.includes(candidate))];
 }else if(multiWorkIntent){
   // When a question names multiple specific works, give each work a strong
   // passage before filling the remaining page budget. Then alternate works
   // so repeated hits from one query facet cannot crowd out the other work's
   // second-best evidence page.
   const strongestByBook=new Map();
   for(const candidate of candidates){
     const key=String(candidate?.bookId||'');
     if(!explicitlyNamedWorkIds.has(key))continue;
     const previous=strongestByBook.get(key);
     if(key&&(!previous||Number(candidate.score)>Number(previous.score)))
       strongestByBook.set(key,candidate);
   }
   const hasScores=candidates.every(candidate=>Number.isFinite(candidate?.score));
   const representatives=hasScores
     ?[...strongestByBook.values()].sort((a,b)=>b.score-a.score)
     :firstPerBook;
   const reserved=new Set(representatives);
   const remaining=new Map([...explicitlyNamedWorkIds].map(id=>[id,
     facetBalanced.filter(candidate=>String(candidate?.bookId||'')===id&&!reserved.has(candidate))]));
   const balanced=[];
   while([...remaining.values()].some(group=>group.length)){
     for(const id of explicitlyNamedWorkIds){
       const group=remaining.get(id);
       if(group?.length)balanced.push(group.shift());
     }
   }
   ordered=[...representatives,...balanced];
 }else if(authorWideIntent){
   // Broad author questions may benefit from multiple works, but a weak hit
   // from a marginal title should not take a slot from a much stronger page.
   // Treat the index score only as a retrieval-strength hint, never as proof.
   const scores=candidates.map(candidate=>Number(candidate?.score));
   const bestScore=Math.max(...scores.filter(Number.isFinite));
   if(scores.every(Number.isFinite)&&bestScore>0){
     const threshold=bestScore*0.85;
     const strongestByBook=new Map();
     for(const candidate of candidates){
       const key=String(candidate?.bookId||'');
       const previous=strongestByBook.get(key);
       if(key&&(!previous||Number(candidate.score)>Number(previous.score)))
         strongestByBook.set(key,candidate);
     }
     const strongRepresentatives=[...strongestByBook.values()].filter(candidate=>
       Number(candidate.score)>=threshold);
     ordered=[...strongRepresentatives,...facetBalanced.filter(candidate=>!strongRepresentatives.includes(candidate))];
   }else{
     // Preserve the established breadth behavior for legacy results without
     // comparable passage scores.
     ordered=[...firstPerBook,...facetBalanced.filter(candidate=>!firstPerBook.includes(candidate))];
   }
 }
 let selectedSourceBytes=0;
 for(const candidate of ordered){
   if(chosen.length>=maxSources)break;
   if(!candidate||typeof candidate.text!=='string'||
      !/^[1-9]\d{0,3}$/.test(String(candidate.bookId))||
      !Number.isSafeInteger(candidate.page)||candidate.page<1)continue;
   const candidateBytes=new TextEncoder().encode(candidate.text).byteLength;
   if(selectedSourceBytes+candidateBytes>maxSourceBytes)continue;
   const next=[...chosen,candidate];
   const bytes=new TextEncoder().encode(JSON.stringify({question,turnstileToken,history,
     sources:next.map(({bookId,page,text})=>({bookId,page,text}))})).byteLength;
   if(bytes<=maxBytes){chosen.push(candidate);selectedSourceBytes+=candidateBytes;}
 }
 return chosen;
}

