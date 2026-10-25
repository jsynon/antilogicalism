import {explicitScriptureReferences,hasExplicitScriptureReference,queryTerms} from './remote-library.mjs';
import {catalogIdentity} from './reader-contract.mjs';

/* Merge two independently retrieved question facets, retaining alternatives
 * for source selection and manual inspection.
 * No generated claim or PDF locator is trusted by this component.
 */
export function mergeFacetSearches(results,limit=8,reserveFacetIndexes=[],{
 directQuestionFacetIndex=-1,partQuestions=[],partFacetScopes=[],preferPrimaryBible=false
}={}){
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
 const directPartReservations=()=>{
   if(!Number.isInteger(directQuestionFacetIndex)||directQuestionFacetIndex<0||
      directQuestionFacetIndex>=groups.length||!Array.isArray(partQuestions))return [];
   const directCandidates=groups[directQuestionFacetIndex];
   const reservations=[],reserved=new Set();
   for(const part of partQuestions.slice(0,Math.max(0,Math.floor(Number(limit)||0)))){
     if(typeof part?.partId!=='string'||typeof part?.question!=='string')continue;
     const sourceIds=Array.isArray(part.sourceBookIds)?part.sourceBookIds.map(String):[];
     const best=directCandidates.map((entry,rank)=>({entry,rank,
       overlap:directFacetTextMatch(part.question,entry?.preview||entry?.text||''),
       primaryBible:/\bbible\b/i.test(String(entry?.title||''))&&
        !/\b(?:annotated|study|commentary|notes)\b/i.test(String(entry?.title||''))
     })).filter(item=>valid(item.entry)&&item.overlap>=2&&
       (!sourceIds.length||sourceIds.includes(String(item.entry.bookId))))
       .sort((a,b)=>(preferPrimaryBible&&a.primaryBible!==b.primaryBible
          ?(b.primaryBible?1:0)-(a.primaryBible?1:0):0)||
         b.overlap-a.overlap||a.rank-b.rank||
         (Number(b.entry.score)||0)-(Number(a.entry.score)||0))[0];
     if(!best)continue;
     const key=String(best.entry.bookId)+':'+best.entry.page;
     if(reserved.has(key))continue;
     reserved.add(key);
     reservations.push({entry:best.entry,facet:directQuestionFacetIndex});
   }
   return reservations;
 };
 const partFacetReservations=()=>{
   if(!Array.isArray(partFacetScopes))return [];
   const reservations=[],reserved=new Set();
   const eligibleScopes=[];
   for(const item of partFacetScopes){
     const facet=item?.facet;
     if(!Number.isInteger(facet)||facet<0||facet>=groups.length)continue;
     const sourceIds=Array.isArray(item.sourceBookIds)?[...new Set(item.sourceBookIds.map(String))]:[];
     if(!sourceIds.length)continue;
     eligibleScopes.push({facet,sourceIds});
   }
   // Reserve one best page per distinct work before spending a second slot
   // within any work. Broad author facets can resolve to many books; reserving
   // two pages from each of the first few books used to crowd out the best
   // evidence from later works before page hydration.
   const reservePass=(pageOffset)=>{
     for(const {facet,sourceIds} of eligibleScopes)for(const sourceId of sourceIds){
       const matches=groups[facet].filter(entry=>valid(entry)&&String(entry.bookId)===sourceId);
       const entry=matches[pageOffset];
       if(!entry)continue;
       const key=sourceId+':'+entry.page;
       if(reserved.has(key))continue;
       reservations.push({entry,facet});
       reserved.add(key);
     }
   };
   reservePass(0);
   reservePass(1);
   return reservations;
 };
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
   for(const {entry,facet} of [...partFacetReservations(),...directPartReservations()]){
     if(out.length>=limit)break;
     add(entry,facet);
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
 const ranked=[...byPage.values()].sort((a,b)=>
   b.rankScore-a.rankScore||b.bestScore-a.bestScore||a.firstSeen-b.firstSeen)
   .map(({entry,facet,facets,facetRanks})=>({...entry,facet,
     matchedFacets:facets.size,facetRanks}));
 // Keep the top two results from every facet that is explicitly linked to a
 // question part. A decisive passage can rank second on its best query while
 // several weaker rank-one pages from other facets crowd it out globally.
 const reserved=[],reservedKeys=new Set();
 for(const {entry} of partFacetReservations()){
   const key=String(entry.bookId)+':'+entry.page;
   const candidate=ranked.find(value=>String(value.bookId)+':'+value.page===key);
   if(candidate&&!reservedKeys.has(key)&&reserved.length<limit){
     reserved.push(candidate);reservedKeys.add(key);
   }
 }
 for(const {entry} of directPartReservations()){
   const key=String(entry.bookId)+':'+entry.page;
   const candidate=ranked.find(value=>String(value.bookId)+':'+value.page===key);
   if(candidate&&!reservedKeys.has(key)&&reserved.length<limit){
     reserved.push(candidate);reservedKeys.add(key);
   }
 }
 for(const facet of [...new Set(reserveFacetIndexes)]){
   const facetPages=groups[facet]||[];
   const pagesToReserve=[];
   if(facet===directQuestionFacetIndex){
     // Preserve the verbatim-question facet's top alternatives. A directly
     // relevant second page can be crucial even when a different work has a
     // higher lexical rank; the final selector applies its own direct-title
     // and text-relevance rules.
     pagesToReserve.push(...facetPages.slice(0,2));
   }else{
     const firstByBook=[],seenFacetBooks=new Set();
     for(const entry of facetPages){
       const bookId=String(entry?.bookId||'');
       if(bookId&&!seenFacetBooks.has(bookId)){seenFacetBooks.add(bookId);firstByBook.push(entry);}
     }
     // Distinct works get their best page before a repeated page from the
     // same work can consume the bounded candidate pool.
     pagesToReserve.push(...firstByBook.slice(0,2));
   }
   for(const entry of pagesToReserve){
     const key=String(entry.bookId)+':'+entry.page;
     const candidate=ranked.find(value=>String(value.bookId)+':'+value.page===key);
     if(candidate&&!reservedKeys.has(key)&&reserved.length<limit){
       reserved.push(candidate);reservedKeys.add(key);
     }
   }
 }
 for(const candidate of ranked){
   const key=String(candidate.bookId)+':'+candidate.page;
   if(reservedKeys.has(key))continue;
   if(reserved.length>=limit)break;
   reserved.push(candidate);reservedKeys.add(key);
 }
 return reserved;
}

/* Shared browser/evaluator retrieval assembly. Both callers search the same
 * facet pool, hydrate the same canonical page text, and hand the same candidate
 * ordering to selectAnswerSources. `pageLoader` is the only environment
 * difference (the browser has a shard cache; the evaluator reads the shard
 * through RemoteLibrary directly).
 */
export async function retrieveEvidence({question,queries,partQueries=[],library,books,allowedBookIds,
 selectedBookIds=[],pageLoader,directFallback=false,allowedPage=()=>true,partQuestions=[],
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
 if(!Array.isArray(partQueries)||partQueries.length>12||partQueries.some(item=>
   !item||typeof item.partId!=='string'||!/^P[1-9]\d*$/.test(item.partId)||
   typeof item.query!=='string'||item.query.trim().length<5||item.query.trim().length>400))
  throw Error('Part-specific retrieval queries are invalid.');
 // A search query may be linked to several question parts. Bound the unique
 // searches separately from those links so comparison parts can reuse each
 // source-side query without spending additional retrieval work.
 if(new Set(partQueries.map(item=>item.query.trim().toLocaleLowerCase())).size>6)
  throw Error('Too many distinct part-specific retrieval queries.');
 const baseQueries=buildSearchFacets(direct,useDirect?[direct]:queries);
 const searchQueries=[...baseQueries];
 for(const item of partQueries){
  const query=item.query.trim();
  if(!searchQueries.some(value=>value.trim().toLocaleLowerCase()===query.toLocaleLowerCase()))
   searchQueries.push(query);
 }
 const partFacetIndices=partQueries.map(item=>({partId:item.partId,
  facet:searchQueries.findIndex(value=>value.trim().toLocaleLowerCase()===item.query.trim().toLocaleLowerCase())}));
 // The planner's main queries can be more useful than the part's natural-
 // language search query. Associate a focused planner facet with a part when
 // they share at least two distinctive terms. This lets a page found by that
 // facet keep its eligibility link through selection; the Worker still checks
 // source scope, citations, and semantic support. Do not map the verbatim
 // question or direct-fallback query to every part.
 if(!useDirect){
  const linked=new Set(partFacetIndices.map(item=>item.partId+':'+item.facet));
  for(let facet=0;facet<queries.length;facet++)for(const item of partQuestions){
   const partId=typeof item?.partId==='string'?item.partId:'';
   const partQuestion=typeof item?.question==='string'?item.question:'';
   if(!/^P[1-9]\d*$/.test(partId)||partQuestion.trim().length<5)continue;
   const key=partId+':'+facet;
   if(!linked.has(key)&&directFacetTextMatch(searchQueries[facet],partQuestion)>=2){
    partFacetIndices.push({partId,facet});
    linked.add(key);
   }
  }
 }
 // Part rewrites can drop an explicit citation from the reader's question.
 // Carry a single unambiguous scripture reference into each unscoped part
 // facet so search does not reinterpret a biblical name (James, John, etc.)
 // as an author's surname. Keep the original facet text for relevance links;
 // the inherited reference is retrieval scope only.
 const scriptureReferences=explicitScriptureReferences(direct);
 const inheritedScriptureReference=scriptureReferences.length===1?scriptureReferences[0]:'';
 const scriptureScopeByFacet=new Map();
 if(inheritedScriptureReference){
  for(const item of partFacetIndices){
   const part=partQuestions.find(value=>value?.partId===item.partId);
   const sourceBookIds=Array.isArray(part?.sourceBookIds)?part.sourceBookIds.map(String):[];
   if(sourceBookIds.length||hasExplicitScriptureReference(searchQueries[item.facet]))continue;
   scriptureScopeByFacet.set(item.facet,inheritedScriptureReference);
  }
 }
 const selected=selectedBookIds.map(String);
 const selectedAllowed=new Set(selected.filter(id=>allowedBookIds.has(id)));
 if(selected.length&&selected.some(id=>!allowedBookIds.has(id)))
  throw Error('Selected book is not present in the published corpus.');
 const namedBookIds=selected.length?selected:matchExplicitBookIds(direct,books);
 const targetBookIds=namedBookIds.length?namedBookIds:[null];
 const retrievalAllowed=selected.length?selectedAllowed:allowedBookIds;
 const searchSets=await Promise.all(searchQueries.map(async (query,index)=>{
  const scopeReference=scriptureScopeByFacet.get(index)||'';
  const executedQuery=scopeReference?`${scopeReference} ${query}`:query;
  const facetBookIds=targetBooksForFacet(executedQuery,books,targetBookIds[0]===null?null:targetBookIds);
  const targeted=await Promise.all(facetBookIds.map(bookId=>library.search(executedQuery,{
   ...(bookId?{bookId}:{}),allowedBookIds:retrievalAllowed,maxBooks,pagesPerBook
  })));
  return {sources:targeted.flatMap(set=>Array.isArray(set?.sources)?set.sources:[])
   .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)),executedQuery,scopeReference,
   targetBookIds:facetBookIds.filter(Boolean).map(String)};
 }));
 // In a two-source comparison, one author's query can miss because its wording
 // does not occur in that author's books even when the other side retrieved a
 // clear topic. Reuse that existing topic query once, scoped to the missing
 // side's trusted book IDs. A hit from the broad question facet is not enough
 // to suppress this retry: it may be an incidental mention that never becomes
 // eligible evidence for the missing side's answer part. This adds no model
 // call and never broadens evidence to the other author's works.
 const sides=crossSourceSides(partQuestions);
 if(sides.length===2){
  const sideFacets=sides.map(side=>{
   const linked=partFacetIndices.filter(item=>item.partId===side.part.partId)
    .map(item=>item.facet).filter((facet,index,values)=>values.indexOf(facet)===index);
   return linked.find(facet=>searchSets[facet]?.targetBookIds?.some(id=>side.bookIds.includes(String(id))))??
    linked[0]??-1;
  });
  for(let sideIndex=0;sideIndex<2;sideIndex++){
   const side=sides[sideIndex],facet=sideFacets[sideIndex],counterpartFacet=sideFacets[1-sideIndex];
   if(facet<0||counterpartFacet<0||searchSets[facet]?.sources.length||
      !searchSets[counterpartFacet]?.sources.length)continue;
   const counterpartQuery=searchQueries[counterpartFacet];
   const activeIds=side.bookIds.filter(id=>allowedBookIds.has(String(id)));
   const retryQuery=scopedCounterpartQuery(counterpartQuery,direct,activeIds,
    [...new Set([...sides[0].bookIds,...sides[1].bookIds])],books);
   if(!retryQuery||retryQuery.toLocaleLowerCase()===searchQueries[facet].toLocaleLowerCase())continue;
   try{
    const retry=await library.search(retryQuery,{allowedBookIds:new Set(activeIds),maxBooks,pagesPerBook});
    const scopedSources=(Array.isArray(retry?.sources)?retry.sources:[])
     .filter(source=>activeIds.includes(String(source.bookId)))
     .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0));
    if(scopedSources.length){
     searchSets[facet]={...searchSets[facet],sources:scopedSources,executedQuery:retryQuery,
      fallbackFrom:searchQueries[facet],targetBookIds:activeIds};
    }
   }catch{
    // This is a best-effort recovery. A missing index partition or transient
    // request must leave the original source-side result empty, not block the
    // other author's independently retrieved evidence.
   }
  }
 }
 const linkedFacets=[...new Set(partFacetIndices.map(item=>item.facet).filter(index=>index>=0))];
 // A planner part may omit sourceBookIds even when its focused query resolves
 // an author or work to specific catalog entries. Carry those trusted resolved
 // IDs into evidence eligibility so a global, secondary mention of the same
 // passage cannot replace the requested primary source.
 const partSourceBookIds=new Map();
 for(const part of partQuestions){
  if(typeof part?.partId!=='string')continue;
  const explicit=Array.isArray(part.sourceBookIds)?part.sourceBookIds.map(String):[];
  const resolved=partFacetIndices.filter(item=>item.partId===part.partId)
   .flatMap(item=>searchSets[item.facet]?.targetBookIds||[]);
  const ids=[...new Set(explicit.length?explicit:resolved)];
  if(ids.length)partSourceBookIds.set(part.partId,ids);
 }
 const scopedPartQuestions=partQuestions.map(part=>({
  ...part,...(partSourceBookIds.has(part?.partId)?{sourceBookIds:partSourceBookIds.get(part.partId)}:{})
 }));
 const partFacetScopes=partQuestions.length?partFacetIndices.map(item=>({partId:item.partId,facet:item.facet,
  sourceBookIds:partSourceBookIds.get(item.partId)||searchSets[item.facet]?.targetBookIds||[]})):[];
 const directQuestionFacetIndex=searchQueries.findIndex(value=>
  value.trim().toLocaleLowerCase()===direct.toLocaleLowerCase());
 const results=searchSets.length>1?mergeFacetSearches(searchSets,maxCandidates,linkedFacets,{
  directQuestionFacetIndex,partQuestions:scopedPartQuestions,partFacetScopes,
  preferPrimaryBible:scriptureReferences.length===1
 }):
  (searchSets[0]?.sources||[]).map((source,index)=>({...source,facet:0,
    facetRanks:[{facet:0,rank:index+1}]}));
 const filtered=results.filter(source=>allowedPage(source)&&
  allowedBookIds.has(String(source.bookId))&&
  (!selected.length||selectedAllowed.has(String(source.bookId))));
 const representatives=[],others=[],visited=new Set();
 for(const source of filtered){
  const group=searchQueries.length>1?String(source.facet):String(source.bookId);
  if(visited.has(group))others.push(source);
  else{visited.add(group);representatives.push(source);}
 }
 const partIdsForFacet=facet=>partFacetIndices.filter(item=>item.facet===facet).map(item=>item.partId);
 const populated=[];
 const partAllowsBook=(partId,bookId)=>{
  const sourceIds=partSourceBookIds.get(partId)||[];
  return !sourceIds.length||sourceIds.includes(String(bookId));
 };
 for(const source of [...representatives,...others]){
  const page=await pageLoader(source);
  if(!page||typeof page.text!=='string')continue;
  const byteLength=new TextEncoder().encode(page.text).byteLength;
  if(byteLength<25||byteLength>pageLimit)continue;
  const matchedFacets=new Set((source.facetRanks||[]).map(item=>item.facet));
  const candidatePartIds=new Set(partFacetIndices.filter(item=>matchedFacets.has(item.facet)&&
   partAllowsBook(item.partId,source.bookId))
   .map(item=>item.partId));
  // A page can answer more than the one planner facet that found it. Add a
  // second part link only when the hydrated page shares at least two
  // distinctive terms with that part's own query. This broadens eligibility
  // without treating a generic topical hit as proof; the Worker still checks
  // source scope, citations, and semantic support before it can be answered.
  const partText=new Map();
  for(const item of partQueries){
   const queries=partText.get(item.partId)||[];
   queries.push(item.query);
   partText.set(item.partId,queries);
  }
  for(const [partId,queries] of partText){
   if(candidatePartIds.has(partId)||!partAllowsBook(partId,source.bookId))continue;
   const partQuestion=(Array.isArray(partQuestions)?partQuestions:[])
    .find(item=>item?.partId===partId)?.question||'';
   if(queries.some(query=>directFacetTextMatch(query,page.text)>=2||
      hasQuotedPhraseMatch(query,page.text))||hasQuotedPhraseMatch(partQuestion,page.text))
      candidatePartIds.add(partId);
  }
  populated.push({...source,text:page.text,byteLength,
    ...(partFacetIndices.length?{candidatePartIds:[...candidatePartIds]}:{})});
  if(populated.length>=maxCandidates)break;
 }
 return {candidates:populated,partFacetIndices,searches:searchSets.map((set,index)=>({
  query:searchSets[index].executedQuery+(namedBookIds.length?' [named books: '+namedBookIds.join(', ')+']':''),
  ...(searchSets[index].scopeReference?{originalQuery:searchQueries[index],scopeInherited:true}:{}),
  ...(searchSets[index].fallbackFrom?{fallbackFrom:searchSets[index].fallbackFrom,
   fallbackReason:'empty-source-side-facet'}:{}),
  resultCount:set.sources.length,partIds:partIdsForFacet(index),
  ...(set.targetBookIds.length?{targetBookIds:set.targetBookIds}:{}),sources:set.sources.slice(0,8)
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

function crossSourceSides(partQuestions){
 const sides=(Array.isArray(partQuestions)?partQuestions:[]).filter(part=>
  typeof part?.partId==='string'&&Array.isArray(part.sourceBookIds)&&part.sourceBookIds.length);
 for(let leftIndex=0;leftIndex<sides.length;leftIndex++)for(let rightIndex=leftIndex+1;rightIndex<sides.length;rightIndex++){
  const left=sides[leftIndex],right=sides[rightIndex];
  const leftIds=[...new Set(left.sourceBookIds.map(String))],rightIds=[...new Set(right.sourceBookIds.map(String))];
  if(leftIds.some(id=>rightIds.includes(id)))continue;
  const combined=[...leftIds,...rightIds];
  if(sides.some(part=>part!==left&&part!==right&&combined.every(id=>part.sourceBookIds.map(String).includes(id))))
   return [{part:left,bookIds:leftIds},{part:right,bookIds:rightIds}];
 }
 return [];
}

function scopedCounterpartQuery(counterpartQuery,question,targetIds,allSideIds,books){
 const names=[];
 for(const id of allSideIds){
  const title=books.find(book=>String(book.id)===String(id))?.title||'';
  const identity=catalogIdentity(title);
  names.push(...identity.authors,...identity.authors.map(author=>String(author).split(/\s+/u).at(-1)),
   identity.work,...identity.aliases);
 }
 const escape=value=>String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 let topicalText=[counterpartQuery,question].filter(Boolean).join(' ');
 for(const name of [...new Set(names)].sort((a,b)=>b.length-a.length)){
  if(name.length<4)continue;
  topicalText=topicalText.replace(new RegExp('(?:^|[^\\p{L}\\p{N}])'+escape(name)+
   '(?:(?:\\x27s|’s))?(?=$|[^\\p{L}\\p{N}])','giu'),' ');
 }
 const generic=new Set(['think','thinks','thought','say','says','said','position','positions','idea','ideas',
  'account','accounts','view','views','response','respond','would','could','should','might','define','definition']);
 const terms=[...new Set(queryTerms(topicalText).filter(term=>!generic.has(term)))].slice(0,8);
 if(!terms.length)return '';
 const targetAuthors=[...new Set(targetIds.flatMap(id=>{
  const title=books.find(book=>String(book.id)===String(id))?.title||'';
  return catalogIdentity(title).authors;
 }))];
 const label=targetAuthors.length?targetAuthors.join(' '):targetIds
  .map(id=>catalogIdentity(books.find(book=>String(book.id)===String(id))?.title||'').work)
  .filter(Boolean).slice(0,2).join(' ');
 return [label,...terms].filter(Boolean).join(' ').slice(0,160);
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
 const stop=new Set(['what','when','where','which','who','whom','whose','why','how','does','did','has','have','had','are','was','were','the','and','for','from','with','into','about','between','this','that','these','those','there','their','they','them','than','then','your','our','also','only','could','would','should',
  // In a cross-work comparison, author/title names and the comparison verb
  // identify bibliographic scope, not the passage's topical relevance.
  'hume','kant','enquiry','critique','pure','reason','differ','differs','different','difference','differences','compare','comparison','contrast','versus']);
 const normalize=term=>/^(?:cause|causal|causality|causes|caused|causing)$/.test(term)?'caus':
  term.startsWith('necess')?'necess':term.startsWith('experienc')?'experienc':term;
 const questionTerms=new Set((String(question||'').toLowerCase().match(/[a-z0-9]+/g)||[])
  .filter(term=>term.length>=4&&!stop.has(term)).map(normalize));
 const textTerms=new Set((String(text||'').toLowerCase().match(/[a-z0-9]+/g)||[]).map(normalize));
 let score=0;
 for(const term of questionTerms)if(textTerms.has(term))score++;
 return score;
}

/* A quoted passage title or phrase can be stronger evidence of part relevance
 * than ordinary term overlap. Match only longer quoted phrases, in order, and
 * allow OCR to split one word into adjacent one-letter tokens (e.g. “T o be”).
 * This grants a source eligibility link; it does not certify semantic support.
 */
function hasQuotedPhraseMatch(question,text){
 const value=String(question||'');
 const phrases=[];
 for(const match of value.matchAll(/[“"]([^”"]{8,120})[”"]|‘([^’]{8,120})’|'([^']{8,120})'/gu))
  phrases.push(match[1]||match[2]||match[3]||'');
 const sourceWords=String(text||'').toLocaleLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').match(/[\p{L}\p{N}]+/gu)||[];
 for(const phrase of phrases){
  const target=phrase.toLocaleLowerCase().normalize('NFKD')
   .replace(/[\u0300-\u036f]/g,'').match(/[\p{L}\p{N}]+/gu)||[];
  if(target.length<4||target.join('').length<12)continue;
  for(let start=0;start<sourceWords.length;start++){
   let at=start,matched=true,usedSplit=false;
   for(const word of target){
    let joined='';
    for(let count=0;count<3&&at+count<sourceWords.length;count++){
     const next=sourceWords[at+count];
     joined+=next;
     if(joined===word){
      if(count)usedSplit=true;
      at+=count+1;
      break;
     }
     if(joined.length>=word.length||!word.startsWith(joined)){matched=false;break;}
    }
    if(!matched||at>sourceWords.length){matched=false;break;}
    // No source token was consumed when the concatenated fragments did not
    // equal this target word.
    if(joined!==word){matched=false;break;}
   }
   if(matched&&usedSplit)return true;
   // Ordinary exact phrase matches are useful too, but only when the page
   // contains the full multiword phrase, not a short generic quotation.
   if(matched)return true;
  }
 }
 return false;
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
  // use question-text overlap to break ties with retrieval order.
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
  {maxSources=4,maxBytes=39000,maxSourceBytes=35000,history=[],plannedFacetCount=0,
   partQuestions=[]}={}){
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
 const hypotheticalAuthorResponse=/\b(?:what|how)\s+would\b[^?!.]{0,120}\b(?:think|say|respond|react|view|regard)\b[^?!.]{0,100}\b(?:about|of|on|regarding|concerning|to)\b/i
  .test(question);
 const crossAuthorIntent=hypotheticalAuthorResponse&&
  explicitlyNamedAuthorGroups(question,candidates).length>=2;
 const comparisonIntent=/\b(?:compare|contrast|versus|vs\.?|differences?|similarities?)\b/i.test(question)||
  crossAuthorIntent;
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
 // Reserve a directly matched page for each requested part before ordinary
 // facet balancing. This keeps the six-page budget from dropping an entire
 // question part when a broad planner query dominates the shortlist.
 const partRepresentatives=[],reservedPartPages=new Set();
 const partIds=[...new Set(candidates.flatMap(candidate=>candidate.candidatePartIds||[]))];
 const partQuestionById=new Map((Array.isArray(partQuestions)?partQuestions:[])
  .filter(item=>item&&typeof item.partId==='string'&&typeof item.question==='string')
  .map(item=>[item.partId,/^How do the named sources compare in response to this question:/i
    .test(item.question)?question:item.question]));
 for(const partId of partIds){
  const eligible=candidates.filter(value=>value.candidatePartIds?.includes(partId)&&
   !reservedPartPages.has(value));
  // Aggregate vector rank can favor a page that mentions the topic without
  // answering this specific part. Among pages already linked to the part,
  // prefer the one whose actual prose covers more of the part's distinctive
  // terms. The original question remains the fallback and comparison target.
  const targetQuestion=partQuestionById.get(partId)||question;
  const candidate=eligible.length?eligible.reduce((best,value)=>{
    const valuePhrase=hasQuotedPhraseMatch(targetQuestion,value.text??value.preview);
    const bestPhrase=hasQuotedPhraseMatch(targetQuestion,best.text??best.preview);
    if(valuePhrase!==bestPhrase)return valuePhrase?value:best;
    return directFacetTextMatch(targetQuestion,value.text??value.preview)>
      directFacetTextMatch(targetQuestion,best.text??best.preview)?value:best;
  },eligible[0]):null;
  if(candidate){partRepresentatives.push(candidate);reservedPartPages.add(candidate);}
 }
 if(partRepresentatives.length){
  // Once every requested part has one candidate, use spare packet slots for
  // another linked book when available. This gives a direct definition or
  // comparison a second independent source before sending pages that have no
  // question-part link. A link is still only an eligibility signal; the Worker
  // performs the claim-level evidence review.
  const diverseRepresentatives=[];
  for(const partId of partIds){
   const representedBooks=new Set([...reservedPartPages]
    .filter(value=>value.candidatePartIds?.includes(partId)).map(value=>String(value.bookId)));
   const eligible=ordered.filter(value=>!reservedPartPages.has(value)&&
    value.candidatePartIds?.includes(partId)&&!representedBooks.has(String(value.bookId)));
   if(!eligible.length)continue;
   const targetQuestion=partQuestionById.get(partId)||question;
   const candidate=eligible.reduce((best,value)=>{
    const overlap=directFacetTextMatch(targetQuestion,value.text??value.preview);
    const bestOverlap=directFacetTextMatch(targetQuestion,best.text??best.preview);
    return overlap>bestOverlap||overlap===bestOverlap&&(Number(value.score)||0)>(Number(best.score)||0)?value:best;
   },eligible[0]);
   diverseRepresentatives.push(candidate);reservedPartPages.add(candidate);
  }
  const remainingLinked=ordered.filter(value=>!reservedPartPages.has(value)&&
   Array.isArray(value.candidatePartIds)&&value.candidatePartIds.length);
  const remainingUnlinked=ordered.filter(value=>!reservedPartPages.has(value)&&
   (!Array.isArray(value.candidatePartIds)||!value.candidatePartIds.length));
  ordered=[...partRepresentatives,...diverseRepresentatives,...remainingLinked,...remainingUnlinked];
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
     sources:next.map(({bookId,page,text,candidatePartIds})=>({bookId,page,text,
      ...(Array.isArray(candidatePartIds)?{candidatePartIds}:{})}))})).byteLength;
   if(bytes<=maxBytes){chosen.push(candidate);selectedSourceBytes+=candidateBytes;}
 }
 return chosen;
}

