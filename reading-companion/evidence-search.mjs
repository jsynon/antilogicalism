import {explicitScriptureReferences,hasExplicitScriptureReference,queryTerms,
 PRODUCTION_MAX_BOOKS,PRODUCTION_PAGES_PER_BOOK} from './remote-library.mjs';
import {catalogIdentity} from './reader-contract.mjs';

// Keep live browser and workflow retrieval breadth on one shared contract. The
// 32-page candidate handoff gives the semantic selector room for facet-only
// works while remaining below its existing 48-candidate contract and transport
// byte budget; the final answer packet stays separately capped at six pages.
export const LIVE_RETRIEVAL_CONFIG=Object.freeze({maxCandidates:32,
 maxBooks:PRODUCTION_MAX_BOOKS,pagesPerBook:PRODUCTION_PAGES_PER_BOOK});
// The wider profile is for controlled evaluations. Public traffic keeps the
// proven baseline until saved-trace review shows a recall gain without weaker
// final source packets or unacceptable latency.
export const RETRIEVAL_PROFILES=Object.freeze({
 baseline:LIVE_RETRIEVAL_CONFIG,
 expanded:Object.freeze({maxCandidates:48,maxBooks:6,pagesPerBook:4})
});

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
       overlap:localFacetTextMatch(part.question,entry?.preview||entry?.text||'').overlap,
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
   const reservations=[],reserved=new Set(),scopesByPart=new Map();
   for(const item of partFacetScopes){
     const facet=item?.facet;
     if(!Number.isInteger(facet)||facet<0||facet>=groups.length)continue;
     const sourceIds=Array.isArray(item.sourceBookIds)?[...new Set(item.sourceBookIds.map(String))]:[];
     if(!sourceIds.length)continue;
    const partId=typeof item.partId==='string'?item.partId:'';
    if(!partId)continue;
    const scopes=scopesByPart.get(partId)||[];
    scopes.push({facet,sourceIds});
    scopesByPart.set(partId,scopes);
   }
   const parts=[...scopesByPart.keys()];
   const candidatesByPart=new Map(parts.map(partId=>{
     const bestByPage=new Map();
     for(const {facet,sourceIds} of scopesByPart.get(partId)){
       groups[facet].forEach((entry,rank)=>{
         if(!valid(entry)||!sourceIds.includes(String(entry.bookId)))return;
         const key=String(entry.bookId)+':'+entry.page;
         const previous=bestByPage.get(key);
         if(!previous||rank<previous.rank||
            (rank===previous.rank&&(Number(entry.score)||0)>(Number(previous.entry.score)||0)))
           bestByPage.set(key,{entry,facet,rank});
       });
     }
     const partQuestion=partQuestions.find(item=>item?.partId===partId)?.question||'';
     return [partId,[...bestByPage.values()].sort((a,b)=>{
       // A quoted phrase in the question may sit on the next page after a
       // stronger adjacent-page keyword hit. Preserve that exact passage
       // inside the same source scope before rank-one pages consume the cap.
       const aQuoted=quotedPhraseMatchLength(partQuestion,a.entry?.preview||a.entry?.text||'');
       const bQuoted=quotedPhraseMatchLength(partQuestion,b.entry?.preview||b.entry?.text||'');
       if(aQuoted!==bQuoted)return bQuoted-aQuoted;
       return a.rank-b.rank||(Number(b.entry.score)||0)-(Number(a.entry.score)||0);
     })];
   }));
   // First reserve one eligible result for each question part when one exists. A broad
   // part may resolve to many books and facets; reserving all of those pages
   // in facet order can exhaust the candidate cap before another part gets a
   // chance, even when that part's own searches returned strong evidence.
   for(const partId of parts){
     const candidate=candidatesByPart.get(partId)?.find(item=>
       !reserved.has(String(item.entry.bookId)+':'+item.entry.page));
     if(!candidate)continue;
     const key=String(candidate.entry.bookId)+':'+candidate.entry.page;
     reservations.push(candidate);
     reserved.add(key);
   }
   // Preserve work diversity after part coverage, distributing additional
   // pages across parts instead of letting one broad part monopolize slots.
   for(let round=0;round<limit&&reservations.length<limit;round++){
     let added=false;
     for(const partId of parts){
       if(reservations.length>=limit)break;
       const partScopes=scopesByPart.get(partId);
       const representedBooks=new Set(reservations.filter(item=>partScopes.some(scope=>
         scope.facet===item.facet&&scope.sourceIds.includes(String(item.entry.bookId))))
         .map(item=>String(item.entry.bookId)));
       const candidate=(candidatesByPart.get(partId)||[]).find(item=>
         !reserved.has(String(item.entry.bookId)+':'+item.entry.page)&&
         !representedBooks.has(String(item.entry.bookId)));
       if(!candidate)continue;
       const key=String(candidate.entry.bookId)+':'+candidate.entry.page;
       reservations.push(candidate);
       reserved.add(key);
       added=true;
     }
     if(!added)break;
   }
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
 // Before spending the remaining cap on globally corroborated pages, give
 // each facet a fair chance to contribute its best as-yet-unrepresented work.
 // Reciprocal-rank aggregation is useful for corroboration, but by itself it
 // can let repeated hits from a few works crowd out a distinct work that only
 // one query angle found. These are still candidates only; the Worker judges
 // passage relevance after fingerprint verification.
 const representedBooks=new Set(reserved.map(item=>String(item.bookId)));
 for(let round=0;round<limit&&reserved.length<limit;round++){
   let added=false;
   for(let facet=0;facet<groups.length&&reserved.length<limit;facet++){
     const entry=groups[facet].find(value=>valid(value)&&
       !representedBooks.has(String(value.bookId))&&
       !reservedKeys.has(String(value.bookId)+':'+value.page));
     if(!entry)continue;
     const key=String(entry.bookId)+':'+entry.page;
     const candidate=ranked.find(value=>String(value.bookId)+':'+value.page===key);
     if(!candidate)continue;
     reserved.push(candidate);reservedKeys.add(key);
     representedBooks.add(String(candidate.bookId));
     added=true;
   }
   if(!added)break;
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
 * facet pool and hydrate the same canonical candidate pages. The browser and
 * evaluator pass this ordered pool to the Worker; final semantic selection
 * happens only after the Worker verifies page fingerprints. `pageLoader` is
 * the only environment difference (browser shard cache versus evaluator
 * RemoteLibrary access).
 */
export async function retrieveEvidence({question,queries,partQueries=[],gapQueries=[],gapQueryPartLinks=[],sourceGroups=[],library,books,allowedBookIds,
 selectedBookIds=[],pageLoader,directFallback=false,allowedPage=()=>true,partQuestions=[],
 maxCandidates=LIVE_RETRIEVAL_CONFIG.maxCandidates,maxBooks=LIVE_RETRIEVAL_CONFIG.maxBooks,
 pagesPerBook=LIVE_RETRIEVAL_CONFIG.pagesPerBook,pageLimit=14000}={}){
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
 const selected=selectedBookIds.map(String);
 const selectedAllowed=new Set(selected.filter(id=>allowedBookIds.has(id)));
 if(selected.length&&selected.some(id=>!allowedBookIds.has(id)))
  throw Error('Selected book is not present in the published corpus.');
 if(!Array.isArray(partQueries)||partQueries.length>12||partQueries.some(item=>
   !item||typeof item.partId!=='string'||!/^P[1-9]\d*$/.test(item.partId)||
   typeof item.query!=='string'||item.query.trim().length<5||item.query.trim().length>400))
  throw Error('Part-specific retrieval queries are invalid.');
 // A search query may be linked to several question parts. Bound the unique
 // searches separately from those links so comparison parts can reuse each
 // source-side query without spending additional retrieval work.
 if(new Set(partQueries.map(item=>item.query.trim().toLocaleLowerCase())).size>6)
  throw Error('Too many distinct part-specific retrieval queries.');
 if(!Array.isArray(gapQueries)||gapQueries.length>3||gapQueries.some(query=>
   typeof query!=='string'||query.trim().length<8||query.trim().length>160))
  throw Error('Conditional retrieval queries are invalid.');
 // A whole-question coverage check uses the synthetic P1 identifier when
 // the planner supplied no explicit subparts (for example, fixed-query eval).
 const knownPartIds=new Set(partQuestions.map(part=>part?.partId).filter(id=>
  typeof id==='string'&&/^P[1-9]\d*$/.test(id)));
 if(!knownPartIds.size)knownPartIds.add('P1');
 if(!Array.isArray(gapQueryPartLinks)||gapQueryPartLinks.length>3||
    gapQueryPartLinks.some(link=>!link||typeof link.query!=='string'||
     !gapQueries.some(query=>query.trim().toLocaleLowerCase()===link.query.trim().toLocaleLowerCase())||
     !Array.isArray(link.partIds)||link.partIds.length<1||link.partIds.length>6||
     link.partIds.some(id=>!knownPartIds.has(id))))
  throw Error('Conditional retrieval query links are invalid');
 if(!Array.isArray(sourceGroups)||sourceGroups.length>8||sourceGroups.some(group=>
   !group||!['primary','subject','commentary','unspecified'].includes(group.role)||
   !Array.isArray(group.bookIds)||group.bookIds.length>20||
   group.bookIds.some(id=>typeof id!=='string'||!allowedBookIds.has(id))))
  throw Error('Catalog source groups are invalid');
 // Direct fallback uses only the unchanged question. Topic or source-language
 // expansions belong in the planner output, where they remain visible in traces.
 const fallbackQueries=useDirect?[direct]:queries;
 const baseQueries=buildSearchFacets(direct,fallbackQueries);
 const searchQueries=[...baseQueries];
 // Conditional gap searches add bounded lexical facets without replacing the
 // reader's question or original planner facets. Evidence checks still decide
 // what may support the answer.
 for(const query of gapQueries){
  const value=query.trim();
  if(!searchQueries.some(existing=>existing.trim().toLocaleLowerCase()===value.toLocaleLowerCase()))
   searchQueries.push(value);
 }
 for(const item of partQueries){
  const query=item.query.trim();
  if(!searchQueries.some(value=>value.trim().toLocaleLowerCase()===query.toLocaleLowerCase()))
   searchQueries.push(query);
 }
 const partFacetIndices=partQueries.map(item=>({partId:item.partId,
  facet:searchQueries.findIndex(value=>value.trim().toLocaleLowerCase()===item.query.trim().toLocaleLowerCase())}));
 // Keep each optional gap lead attached to the weak part it was generated for.
 // This affects candidate eligibility only; exact-span review still decides
 // whether any retrieved passage actually supports an answer.
 for(const link of gapQueryPartLinks){
  const facet=searchQueries.findIndex(value=>value.trim().toLocaleLowerCase()===link.query.trim().toLocaleLowerCase());
  for(const partId of link.partIds){
   if(facet>=0&&!partFacetIndices.some(item=>item.partId===partId&&item.facet===facet))
    partFacetIndices.push({partId,facet,kind:'gap'});
  }
 }
 // The planner's main queries can be more useful than the part's natural-
 // language search query. Associate a focused planner facet with a part when
 // they share at least two distinctive terms. For a single-part plan, one
 // shared subject term is sufficient after removing generic search framing;
 // the planner's facets all elaborate that one requested answer. This carries
 // eligibility only, not semantic proof. Multi-part plans keep the two-term
 // bar so a shared topic word cannot blur distinct requested parts.
 if(!useDirect){
  const linked=new Set(partFacetIndices.map(item=>item.partId+':'+item.facet));
  for(let facet=0;facet<queries.length;facet++)for(const item of partQuestions){
   const partId=typeof item?.partId==='string'?item.partId:'';
   const partQuestion=typeof item?.question==='string'?item.question:'';
   if(!/^P[1-9]\d*$/.test(partId)||partQuestion.trim().length<5)continue;
   const key=partId+':'+facet;
   const onePartPlan=partQuestions.length===1;
   const overlap=onePartPlan
    ?singlePartFacetTextMatch(searchQueries[facet],partQuestion)
    :directFacetTextMatch(searchQueries[facet],partQuestion);
   if(!linked.has(key)&&overlap>=(onePartPlan?1:2)){
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
 const namedBookIds=selected.length?selected:matchExplicitBookIds(direct,books);
 const targetBookIds=namedBookIds.length?namedBookIds:[null];
 const retrievalAllowed=selected.length?selectedAllowed:allowedBookIds;
 const sourceIdsForFacet=facet=>{
  const linkedPartIds=new Set(partFacetIndices.filter(item=>item.facet===facet)
   .map(item=>item.partId));
  const ids=[...new Set(partQuestions.filter(part=>linkedPartIds.has(part?.partId)&&
   Array.isArray(part?.sourceBookIds)).flatMap(part=>part.sourceBookIds.map(String)))];
  return ids.filter(id=>retrievalAllowed.has(id));
 };
 const searchSets=await Promise.all(searchQueries.map(async (query,index)=>{
  const scopeReference=scriptureScopeByFacet.get(index)||'';
  const executedQuery=scopeReference?`${scopeReference} ${query}`:query;
  // A part-specific query must use that part's validated catalog scope. A
  // whole-question author match can be incomplete for multi-author prompts;
  // reusing it here may accidentally constrain a Kant facet to Aristotle IDs.
  const partScopeIds=sourceIdsForFacet(index);
  const queryScopeIds=partScopeIds.length?partScopeIds:targetBookIds;
  const facetBookIds=targetBooksForFacet(executedQuery,books,
   queryScopeIds[0]===null?null:queryScopeIds);
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
   const retryQuery=scopedCounterpartQuery(searchQueries[facet],counterpartQuery,direct,activeIds,
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
 // A global or mixed-source facet can return plenty of pages while omitting
 // one explicitly named author or work. Retry each missing catalog group once
 // inside its already-validated book IDs. This is local retrieval work: it
 // adds no model call and cannot widen the answer's six-page evidence cap.
 const candidatesSoFar=()=>searchSets.flatMap(set=>set.sources||[]);
 const groupHasLinkedCandidate=(ids,linkedParts)=>{
  if(!linkedParts.length)return candidatesSoFar().some(source=>ids.includes(String(source.bookId)));
  const partIds=new Set(linkedParts.map(part=>part.partId));
  const linkedFacets=new Set(partFacetIndices.filter(item=>partIds.has(item.partId))
   .map(item=>item.facet));
  // An incidental hit from the broad question facet must not suppress
  // recovery when the query linked to the missing source part returned no
  // page from that catalog group.
  return [...linkedFacets].some(facet=>(searchSets[facet]?.sources||[])
   .some(source=>ids.includes(String(source.bookId))));
 };
 for(const group of sourceGroups.filter(item=>['primary','subject'].includes(item.role)).slice(0,4)){
  const ids=[...new Set(group.bookIds.map(String).filter(id=>allowedBookIds.has(id)))];
  const linkedParts=partQuestions.filter(part=>Array.isArray(part?.sourceBookIds)&&
    part.sourceBookIds.some(id=>ids.includes(String(id))));
  if(!ids.length||groupHasLinkedCandidate(ids,linkedParts))continue;
  const preferred=linkedParts.flatMap(part=>partQueries.filter(item=>item.partId===part.partId)
    .map(item=>item.query));
  const query=[...new Set([...preferred,...gapQueryPartLinks.filter(link=>
    linkedParts.some(part=>link.partIds.includes(part.partId))).map(link=>link.query)])]
    .find(value=>typeof value==='string'&&value.trim().length>=5)||
    (ids.length===1?direct:'');
  if(!query)continue;
  const facet=searchQueries.length;
  searchQueries.push(query);
  for(const part of linkedParts)partFacetIndices.push({partId:part.partId,facet,kind:'source-group-recovery'});
  let recovered=[];
  try{
   const result=await library.search(query,{allowedBookIds:new Set(ids),maxBooks,pagesPerBook});
   recovered=(Array.isArray(result?.sources)?result.sources:[])
    .filter(source=>ids.includes(String(source.bookId)))
    .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0));
  }catch{
   // A missing partition or transient index failure leaves this source group
   // visibly uncovered; it does not interrupt retrieval for the other groups.
  }
  searchSets.push({sources:recovered,executedQuery:query,targetBookIds:ids,
   groupScopeRecovery:true,sourceGroupLabel:String(group.label||'').slice(0,120)});
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
  const resolved=partFacetIndices.filter(item=>item.partId===part.partId&&item.kind!=='gap')
   .flatMap(item=>searchSets[item.facet]?.targetBookIds||[]);
  const ids=[...new Set(explicit.length?explicit:resolved)];
  if(ids.length)partSourceBookIds.set(part.partId,ids);
 }
 const scopedPartQuestions=partQuestions.map(part=>({
  ...part,...(partSourceBookIds.has(part?.partId)?{sourceBookIds:partSourceBookIds.get(part.partId)}:{})
 }));
 // A part's natural-language query may omit an author name that a sibling
 // planner facet used to resolve its catalog works. Search that exact part
 // wording inside the already-resolved works so an unscoped global hit
 // cannot crowd out work-linked evidence. This adds local index searches only;
 // it does not widen scope, add a Worker call, or change the answer-page cap.
 const comparisonSides=crossSourceSides(scopedPartQuestions);
 const primaryPartIds=comparisonSides.length===2
  ?new Set(comparisonSides.map(side=>side.part.partId))
  :new Set(scopedPartQuestions.map(part=>part?.partId).filter(Boolean));
 let quotedPartFallbacks=0;
 for(const part of scopedPartQuestions){
  if(!primaryPartIds.has(part?.partId)||typeof part?.question!=='string')continue;
  const query=part.question.trim();
  const sourceIds=partSourceBookIds.get(part.partId)||[];
  if(!sourceIds.length)continue;
  let facet=searchQueries.findIndex(value=>value.trim().toLocaleLowerCase()===query.toLocaleLowerCase());
  let searchSet;
  const scopedIds=sourceIds.filter(id=>retrievalAllowed.has(String(id)));
  // In All Books mode, a planner can identify one trusted source work even
  // though its rewritten searches remain global. If those results from that
  // work do not contain the question's substantial quotation, run the full
  // part wording once against that exact work. This recovers source-native
  // wording such as Hamlet's quoted line without widening search or using AI.
  // Selected Books already searches the chosen work directly, and comparison
  // parts with several works use the established scoped-query path below.
  if(!selected.length&&scopedIds.length===1&&quotedPartFallbacks<2&&
     hasSubstantialQuotedPhrase(part.question)){
   const bookId=String(scopedIds[0]);
   const existingSources=searchSets.flatMap(set=>set.sources||[])
    .filter(source=>String(source.bookId)===bookId);
   const quoteAlreadyRetrieved=existingSources.some(source=>
    quotedPhraseMatchLength(part.question,source.preview||source.text||'')>0);
   const queryAlreadyScoped=facet>=0&&
    (searchSets[facet]?.targetBookIds||[]).map(String).includes(bookId);
   if(!quoteAlreadyRetrieved&&!queryAlreadyScoped){
    quotedPartFallbacks++;
    let scopedSources=[];
    try{
     const retry=await library.search(query,{bookId,allowedBookIds:retrievalAllowed,maxBooks,pagesPerBook});
     scopedSources=(Array.isArray(retry?.sources)?retry.sources:[])
      .filter(source=>String(source.bookId)===bookId)
      .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0));
    }catch{
     // The optional exact-work recovery must not block the ordinary facets.
    }
    facet=searchQueries.length;
    searchQueries.push(query);
    searchSets.push({sources:scopedSources,executedQuery:query,targetBookIds:[bookId],
     inheritedPartScope:part.partId,quoteFallback:true});
    partFacetIndices.push({partId:part.partId,facet});
    continue;
   }
  }
  if(facet<0){
   // Planner part queries may combine the reader's question with a rewritten
   // sub-question, so exact wording is not guaranteed to exist as a facet.
   // Add a separate local facet only when the linked planner facet resolved
   // multiple works. A one-work scope has already been searched by its linked
   // facet; preserving that path avoids changing established single-work
   // packets. Never issue this fallback as an unrestricted library query.
   const scopedIds=sourceIds.filter(id=>retrievalAllowed.has(String(id)));
   if(scopedIds.length<2)continue;
   facet=searchQueries.length;
   searchQueries.push(query);
   searchSet={sources:[],executedQuery:query,targetBookIds:[],inheritedPartScope:part.partId};
   searchSets.push(searchSet);
   partFacetIndices.push({partId:part.partId,facet});
  }else{
   searchSet=searchSets[facet];
  }
  const alreadySearched=new Set((searchSet?.targetBookIds||[]).map(String));
  const missingIds=sourceIds.filter(id=>retrievalAllowed.has(String(id))&&!alreadySearched.has(String(id)));
  if(!missingIds.length)continue;
  const scopedResults=await Promise.all(missingIds.map(async bookId=>{
   try{return await library.search(query,{bookId:String(bookId),allowedBookIds:retrievalAllowed,
    maxBooks,pagesPerBook});}catch{return {sources:[]};}
  }));
  const retained=(searchSet?.sources||[]).filter(source=>sourceIds.includes(String(source.bookId)));
  const seen=new Set(retained.map(source=>String(source.bookId)+':'+source.page));
  for(const result of scopedResults)for(const source of Array.isArray(result?.sources)?result.sources:[]){
   const key=String(source.bookId)+':'+source.page;
   if(!missingIds.includes(String(source.bookId))||seen.has(key))continue;
   seen.add(key);
   retained.push(source);
  }
  searchSet.sources=retained.sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0));
  searchSet.targetBookIds=[...new Set([...alreadySearched,...missingIds])];
  searchSet.inheritedPartScope=part.partId;
 }
 const partFacetScopes=partQuestions.length?partFacetIndices.map(item=>({partId:item.partId,facet:item.facet,
  sourceBookIds:item.kind==='gap'?(partSourceBookIds.get(item.partId)||[]):
   (partSourceBookIds.get(item.partId)||searchSets[item.facet]?.targetBookIds||[])})):[];
 const directQuestionFacetIndex=searchQueries.findIndex(value=>
  value.trim().toLocaleLowerCase()===direct.toLocaleLowerCase());
 // Give each deterministic outage-only source facet a candidate slot before
 // unrelated high-scoring hits from the verbatim question can crowd it out.
 // This preserves evidence availability; it does not certify relevance.
 const fallbackFacetIndexes=useDirect?baseQueries.map((value,index)=>
  value.trim().toLocaleLowerCase()===direct.toLocaleLowerCase()?-1:index).filter(index=>index>=0):[];
 const reservedFacetIndexes=[...new Set([...linkedFacets,...fallbackFacetIndexes])];
 const hasScriptureFallbackFacet=fallbackFacetIndexes.some(index=>
  hasExplicitScriptureReference(searchQueries[index]));
 const results=searchSets.length>1?mergeFacetSearches(searchSets,maxCandidates,reservedFacetIndexes,{
  directQuestionFacetIndex,partQuestions:scopedPartQuestions,partFacetScopes,
  preferPrimaryBible:scriptureReferences.length===1||hasScriptureFallbackFacet
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
   if(queries.some(query=>localFacetTextMatch(query,page.text).overlap>=2||
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
  ...(searchSets[index].inheritedPartScope?{partScopeInherited:searchSets[index].inheritedPartScope}:{}),
  ...(searchSets[index].quoteFallback?{quoteFallback:true}:{}),
  ...(searchSets[index].groupScopeRecovery?{groupScopeRecovery:true,
   sourceGroupLabel:searchSets[index].sourceGroupLabel}:{}),
  ...(searchSets[index].fallbackFrom?{fallbackFrom:searchSets[index].fallbackFrom,
   fallbackReason:'empty-source-side-facet'}:{}),
  resultCount:set.sources.length,partIds:partIdsForFacet(index),
  ...(set.targetBookIds.length?{targetBookIds:set.targetBookIds}:{}),
  // The offline gold audit needs to distinguish a search miss from evidence
  // lost during candidate assembly. Keep IDs plus a short excerpt for every
  // bounded result, so reviewers can judge search-only hits without a full page dump.
  sourceTraceComplete:true,
  sources:set.sources.map(source=>({bookId:source.bookId,page:source.page,
   globalPageId:source.globalPageId,title:String(source.title||'').slice(0,180),
   ...(source.score!==undefined?{score:Number(source.score)||0}:{}),
   excerpt:String(source.preview||source.excerpt||'').slice(0,360)}))
 })),searchQueries,namedBookIds};
}

/* Text overlap is a retrieval diagnostic, never a relevance verdict. Count
 * terms only within a sentence or clause, and keep reference-list pages from
 * acting as evidence. Index entries can put unrelated words close together;
 * weak coherent prose triggers the existing librarian retry, while answer
 * review still decides whether a passage supports a claim.
 */
export function assessEvidenceCoverage(candidates,question,partQuestions=[]){
 const parts=Array.isArray(partQuestions)&&partQuestions.length
  ?partQuestions.filter(item=>typeof item?.question==='string').map(item=>({
    partId:item.partId||'',question:item.question,
    ...(Array.isArray(item.sourceBookIds)?{sourceBookIds:item.sourceBookIds}:{})}))
  :[{partId:'P1',question:String(question||'')}];
 const partTerms=parts.map(part=>facetTerms(part.question.replace(
  /\b(?:explain|source|question|detail|specific|named|book|passage|answer|enough|sufficiently|testing|fake)\b/giu,' ')));
 const assessments=parts.map((part,partIndex)=>{
  const siblingTerms=new Set(partTerms.filter((_,index)=>index!==partIndex).flat());
  const distinctiveTerms=partTerms[partIndex].filter(term=>!siblingTerms.has(term));
  let best={overlap:0,matchedTerms:[],windowStart:-1,source:null};
  let bestIndex={overlap:0,matchedTerms:[],windowStart:-1,source:null};
  let indexLikeSource=null;
  const requestedBookIds=Array.isArray(part.sourceBookIds)?
   [...new Set(part.sourceBookIds.map(String).filter(id=>/^[1-9]\d{0,3}$/.test(id)))]:[];
  const scopedCandidates=requestedBookIds.length?
   (Array.isArray(candidates)?candidates:[]).filter(source=>requestedBookIds.includes(String(source?.bookId))):
   (Array.isArray(candidates)?candidates:[]);
  const missingRequestedSource=Boolean(requestedBookIds.length&&!scopedCandidates.length);
  // Strip generic prompt scaffolding so evaluation templates such as
  // "Explain the source question" do not create artificial search calls.
  const coverageQuestion=part.question.replace(/\b(?:explain|source|question|detail|specific|named|book|passage|answer|enough|sufficiently|testing|fake)\b/giu,' ');
  for(const source of scopedCandidates){
   const text=source?.text||source?.preview||source?.excerpt||'';
   if(isIndexLikeText(text)){
    if(!indexLikeSource)indexLikeSource=coverageSourceRef(source);
    const indexMatch=textFacetMatch(coverageQuestion,text);
    if(indexMatch.overlap>bestIndex.overlap)
     bestIndex={...indexMatch,source:coverageSourceRef(source)};
    continue;
   }
   const match=localFacetTextMatch(coverageQuestion,text,22,distinctiveTerms);
   const distinctiveOverlap=match.matchedTerms.filter(term=>distinctiveTerms.includes(term)).length;
   const bestDistinctiveOverlap=best.matchedTerms.filter(term=>distinctiveTerms.includes(term)).length;
   if(match.overlap>best.overlap||
      (match.overlap===best.overlap&&distinctiveOverlap>bestDistinctiveOverlap))
    best={...match,source:coverageSourceRef(source)};
  }
  const terms=facetTerms(coverageQuestion);
  const overlap=terms.length?best.overlap:2;
  const matchedDistinctiveTerms=best.matchedTerms.filter(term=>distinctiveTerms.includes(term));
  const sharedMatchedTerms=best.matchedTerms.filter(term=>!distinctiveTerms.includes(term));
  // A couple of matching words are not enough when a question has several
  // distinct content terms. Keep a two-term floor for short questions; for
  // longer facets, require more than one quarter of their terms in one span.
  const required=Math.min(terms.length,Math.max(2,Math.floor(terms.length*0.25)+1));
  // Shared names and topic words can describe every clause in a compound
  // question. They cannot, by themselves, establish that this particular
  // part has a relevant retrieval lead. This remains a retrieval trigger;
  // semantic selection and answer review still decide what the text supports.
  const onlySharedPartTerms=parts.length>1&&distinctiveTerms.length>0&&
   matchedDistinctiveTerms.length===0;
  const weak=missingRequestedSource||(terms.length>0&&overlap<required)||onlySharedPartTerms;
  const indexLikeIsStrongest=bestIndex.overlap>best.overlap;
  const coverageReason=missingRequestedSource?'named-source-candidate-missing':weak
   ?onlySharedPartTerms?'only-shared-part-terms':indexLikeIsStrongest?'index-like-candidates-not-counted':'no-coherent-term-cluster'
   :'coherent-prose-cluster-found';
  // Only blame an index candidate when it is the strongest lexical match;
  // unrelated index pages must not misdescribe the best prose candidate.
  const diagnosticMatch=indexLikeIsStrongest?bestIndex:best;
  const matchedTerms=terms.length
   ?(weak&&indexLikeIsStrongest&&bestIndex.matchedTerms.length
     ?bestIndex.matchedTerms:best.matchedTerms):[];
  return {...part,overlap,matchedTerms,distinctiveTerms:distinctiveTerms.slice(0,12),
   matchedDistinctiveTerms:matchedDistinctiveTerms.slice(0,12),
   sharedMatchedTerms:sharedMatchedTerms.slice(0,12),
   distinctiveTermCount:terms.length,
   coverageRatio:missingRequestedSource?0:terms.length?Number((overlap/terms.length).toFixed(3)):1,
   requiredTermCount:required,
   ...(requestedBookIds.length?{requestedBookIds,candidateBookIds:[...new Set(scopedCandidates.map(source=>String(source.bookId)))]}:{}),
   coverageSignal:weak?'weak-coherent-text':'coherent-text-found',
   coverageReason,coverageSource:diagnosticMatch.source||indexLikeSource};
 });
 const weakParts=assessments.filter(part=>part.coverageSignal==='weak-coherent-text');
 return {parts:assessments,weakParts,shouldSearch:weakParts.length>0};
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
const COLLECTIVE_BYLINE=/^(?:various(?: authors)?|multiple authors|anonymous|unknown(?: author)?)$/u;
function catalogAuthorNames(title){
 // Collective credits are useful catalog metadata, but they are not people.
 // Excluding them here keeps ordinary words such as “authors” from turning
 // an all-books question into a search scoped to every compiled anthology.
 return catalogIdentity(title).authors.filter(name=>
  !COLLECTIVE_BYLINE.test(normalizeCatalogText(name)));
}
function namedSpeakerPhrase(question){
 // A last name is a scope hint only when the question places it in the
 // speaker role. The verb set covers ordinary ways readers ask about a view;
 // incidental topic words elsewhere in the question are not author mentions.
 const match=String(question||'').match(/\b(?:what|how)\s+(?:did|does|do|would)\s+([\p{L}][\p{L}\p{M}.'’\-]*(?:\s+[\p{L}][\p{L}\p{M}.'’\-]*){0,3}?)\s+(?:(?:have|has|had)\s+to\s+)?(?:say|says|said|teach|teaches|taught|think|thinks|thought|argue|argues|argued|believe|believes|believed|write|writes|wrote|hold|holds|held|handle|handles|handled|address|addresses|addressed|describe|describes|described|explain|explains|explained|discuss|discusses|discussed|approach|approaches|approached|examine|examines|examined|present|presents|presented|portray|portrays|portrayed|interpret|interprets|interpreted|define|defines|defined)\b/iu);
 if(!match)return '';
 const name=match[1].trim();
 return new Set(['it','they','he','she','the author','the book','the text','people','someone','anyone',
  'different authors','the authors','writers','the writers'])
  .has(normalizeCatalogText(name))?'':name;
}
function explicitlyComparedAuthors(question,names){
 const text=normalizeCatalogText(question);
 if(!/\b(?:difference|differ|compare|comparison|contrast|between|versus|vs)\b/i.test(text))
  return new Set();
 const candidates=[...new Map(names.map(name=>{
  const key=normalizeCatalogText(name);
  const surname=key.split(' ').filter(Boolean).at(-1)||'';
  return [key,{key,surname}];
 }).filter(([,item])=>item.surname.length>=4&&questionContainsPhrase(question,item.surname))).values()];
 const mentioned=new Set();
 for(let left=0;left<candidates.length;left++){
  for(let right=left+1;right<candidates.length;right++){
   const a=candidates[left],b=candidates[right];
   if(a.surname===b.surname)continue;
   const aIndex=text.indexOf(a.surname),bIndex=text.indexOf(b.surname);
   if(aIndex<0||bIndex<0)continue;
   const start=Math.min(aIndex,bIndex),end=Math.max(aIndex,bIndex);
   if(/\b(?:and|versus|vs)\b/i.test(text.slice(start+a.surname.length,end))){
    mentioned.add(a.key);mentioned.add(b.key);
   }
  }
 }
 return mentioned;
}
function explicitlyMentionsAuthor(question,name,comparedAuthors=new Set()){
 const normalized=normalizeCatalogText(name);
 if(!normalized)return false;
 if(comparedAuthors.has(normalized)||questionContainsPhrase(question,name))return true;
 const surname=normalized.split(' ').filter(Boolean).at(-1)||'';
 if(surname.length<4)return false;
 const speaker=normalizeCatalogText(namedSpeakerPhrase(question));
 if(speaker&&(speaker===normalized||speaker===surname))return true;
 // Preserve concise named-author questions ("Nietzsche on morality") while
 // requiring a proper-name signal when a surname appears outside a speaker
 // construction. Common lowercase topic words in a byline cannot scope search.
 const escaped=surname.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
 const capitalized=new RegExp('(?<![\\p{L}])'+escaped[0].toLocaleUpperCase()+
  escaped.slice(1)+'(?![\\p{L}])','u');
 return capitalized.test(String(question||''));
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
 const comparedAuthors=explicitlyComparedAuthors(question,
  [...groups.values()].map(group=>group.name));
 return [...groups.values()].filter(group=>
  explicitlyMentionsAuthor(question,group.name,comparedAuthors));
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
 const comparedAuthors=explicitlyComparedAuthors(question,
  valid.flatMap(book=>catalogAuthorNames(book.title)));
 for(const book of valid){
  for(const name of catalogAuthorNames(book.title)){
   if(explicitlyMentionsAuthor(question,name,comparedAuthors)){
    const surname=normalizeCatalogText(name).split(' ').filter(Boolean).at(-1)||'';
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
 const text=String(query||'');
 const matches=matchExplicitBookIds(text,books)
  .filter(id=>!scoped||scoped.includes(String(id)));
 if(matches.length)return matches;
 // If a named teacher appears only in the title of a compiled work, target
 // that book for this named-speaker facet alone. Do not let this subject-title
 // match constrain sibling topical facets or all-books source diversity.
 const speakerKey=normalizeCatalogText(namedSpeakerPhrase(text));
 if(speakerKey){
  const subjectTitles=(books||[]).filter(book=>
   /^[1-9]\d{0,3}$/.test(String(book?.id||''))&&
   catalogWorkTitles(book?.title).some(title=>questionContainsPhrase(title,speakerKey)))
   .map(book=>String(book.id)).filter(id=>!scoped||scoped.includes(id));
  if(subjectTitles.length)return [...new Set(subjectTitles)].slice(0,8);
 }
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

function scopedCounterpartQuery(failedQuery,counterpartQuery,question,targetIds,allSideIds,books){
 const names=[];
 for(const id of allSideIds){
  const title=books.find(book=>String(book.id)===String(id))?.title||'';
  const identity=catalogIdentity(title);
  names.push(...identity.authors,...identity.authors.map(author=>String(author).split(/\s+/u).at(-1)),
   identity.work,...identity.aliases);
 }
 const escape=value=>String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 // Keep topic words from both sides. An abstract query for the missing author
 // may be empty precisely because its wording is not source-native; the other
 // author's successful topic query supplies a useful anchor, while the failed
 // facet can contribute a concrete term such as "religious" or "causal".
 let topicalText=[failedQuery,counterpartQuery,question].filter(Boolean).join(' ');
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

const FACET_MATCH_STOP_WORDS=new Set(['what','when','where','which','who','whom','whose','why','how','does','did','has','have','had','are','was','were','the','and','for','from','with','into','about','between','this','that','these','those','there','their','they','them','than','then','your','our','also','only','could','would','should',
  // Comparison framing does not describe passage content; source names and
  // titles remain ordinary query terms and are not listed here.
  'differ','differs','different','difference','differences','compare','comparison','contrast','versus']);
 const normalize=term=>/^(?:cause|causal|causality|causes|caused|causing)$/.test(term)?'caus':
  term.startsWith('necess')?'necess':term.startsWith('experienc')?'experienc':term;
function facetTerms(question){
 return [...new Set((String(question||'').toLowerCase().match(/[a-z0-9]+/g)||[])
  .filter(term=>term.length>=4&&!FACET_MATCH_STOP_WORDS.has(term)).map(normalize))];
}
function directFacetTextMatch(question,text){
 const questionTerms=new Set((String(question||'').toLowerCase().match(/[a-z0-9]+/g)||[])
  .filter(term=>term.length>=4&&!FACET_MATCH_STOP_WORDS.has(term)).map(normalize));
 const textTerms=new Set((String(text||'').toLowerCase().match(/[a-z0-9]+/g)||[]).map(normalize));
 let score=0;
 for(const term of questionTerms)if(textTerms.has(term))score++;
 return score;
}
function coverageSourceRef(source){
 if(!source||typeof source!=='object')return null;
 const ref={};
 for(const key of ['bookId','page','globalPageId']){
  const value=source[key];
  if((typeof value==='string'&&value.length<=120)||
     (Number.isSafeInteger(value)&&value>0))ref[key]=value;
 }
 return Object.keys(ref).length?ref:null;
}
function isIndexLikeText(text){
 const value=String(text||'');
 if(/^\s*(?:index|subject index|general index|topical index)\s*$/imu.test(value))return true;
 const lines=value.split(/\n+/u).map(line=>line.trim()).filter(Boolean);
 const entries=lines.length>1?lines:value.split(/\s*;\s*/u).map(line=>line.trim()).filter(Boolean);
 if(entries.length<5)return false;
 const pageReferenceEntries=entries.filter(entry=>/(?:[,;:]\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?\s*[.;,]?$|\bpp?\.\s*\d{1,4})$/iu.test(entry));
 const shortEntries=entries.filter(entry=>(entry.match(/[\p{L}\p{N}]+/gu)||[]).length<=18);
 return pageReferenceEntries.length>=4&&pageReferenceEntries.length/entries.length>=0.55&&
  shortEntries.length/entries.length>=0.6;
}
function textFacetMatch(question,text,windowSize=22,preferredTerms=[]){
 const terms=facetTerms(question);
 if(!terms.length)return {overlap:0,matchedTerms:[],windowStart:-1};
 const preferred=new Set(preferredTerms);
 let best={overlap:0,matchedTerms:[],windowStart:-1};
 let offset=0;
 // Sentence, clause, and list boundaries keep nearby but unrelated entries
 // from combining into an apparently complete answer facet.
 for(const segment of String(text||'').split(/(?<=[.!?;])\s+|[\n\r•▪]+/u)){
  const words=(segment.toLowerCase().match(/[a-z0-9]+/g)||[]).map(normalize);
  for(let start=0;start<words.length;start++){
   const window=new Set(words.slice(start,start+windowSize));
   const matchedTerms=terms.filter(term=>window.has(term));
   const distinctiveOverlap=matchedTerms.filter(term=>preferred.has(term)).length;
   const bestDistinctiveOverlap=best.matchedTerms.filter(term=>preferred.has(term)).length;
   if(matchedTerms.length>best.overlap||
      (matchedTerms.length===best.overlap&&distinctiveOverlap>bestDistinctiveOverlap))
    best={overlap:matchedTerms.length,matchedTerms,windowStart:offset+start};
   if(best.overlap===terms.length)return best;
  }
  offset+=words.length;
 }
 return best;
}
function localFacetTextMatch(question,text,windowSize=22,preferredTerms=[]){
 const match=textFacetMatch(question,text,windowSize,preferredTerms);
 return isIndexLikeText(text)?{...match,overlap:0,matchedTerms:[],indexLike:true}:match;
}

/* Rank with inspectable text signals before using the search score. These
 * signals reward a close, coherent term cluster; they are retrieval heuristics,
 * never a claim that the passage semantically supports an answer. */
function candidateEvidenceFit(candidate,question){
 const text=String(candidate?.text||candidate?.preview||candidate?.excerpt||'');
 const match=localFacetTextMatch(question,text);
 const distinctiveTermCount=facetTerms(question).length;
 return {quotedPhraseMatch:hasQuotedPhraseMatch(question,text),
  matchedTerms:match.matchedTerms,matchedTermCount:match.overlap,
  distinctiveTermCount,
  coverageRatio:distinctiveTermCount?match.overlap/distinctiveTermCount:0,
  retrievalScore:Number.isFinite(candidate?.score)?candidate.score:null};
}
function compareEvidenceFit(left,right){
 if(left.quotedPhraseMatch!==right.quotedPhraseMatch)return left.quotedPhraseMatch?-1:1;
 if(left.coverageRatio!==right.coverageRatio)return right.coverageRatio-left.coverageRatio;
 if(left.matchedTermCount!==right.matchedTermCount)return right.matchedTermCount-left.matchedTermCount;
 return 0;
}
function compareEvidenceCandidates(left,right,question,representedBooks=new Set()){
 const fitOrder=compareEvidenceFit(candidateEvidenceFit(left,question),candidateEvidenceFit(right,question));
 if(fitOrder)return fitOrder;
 // Source diversity is only a tie-breaker between equally close passages; a
 // second book cannot displace a more relevant passage simply to raise counts.
 const leftNew=!representedBooks.has(String(left?.bookId||''));
 const rightNew=!representedBooks.has(String(right?.bookId||''));
 if(leftNew!==rightNew)return leftNew?-1:1;
 const leftScore=Number.isFinite(left?.score)?left.score:Number.NEGATIVE_INFINITY;
 const rightScore=Number.isFinite(right?.score)?right.score:Number.NEGATIVE_INFINITY;
 return rightScore-leftScore;
}
function singlePartFacetTextMatch(facet,partQuestion){
 const searchFraming=/\b(?:definition|nature|concept|concepts|meaning|explain|explains|explained|explaining|philosophy|philosophical|texts|text|account|accounts|theory|theories|role|function)\b/giu;
 return directFacetTextMatch(String(facet||'').replace(searchFraming,' '),
  String(partQuestion||'').replace(searchFraming,' '));
}

/* A quoted passage title or phrase can be stronger evidence of part relevance
 * than ordinary term overlap. Match only longer quoted phrases, in order, and
 * allow OCR to split one word into adjacent one-letter tokens (e.g. “T o be”).
 * This grants a source eligibility link; it does not certify semantic support.
 */
function hasQuotedPhraseMatch(question,text){
 const value=String(question||''),phrases=[];
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

function quotedPhraseMatchLength(question,text){
 const value=String(question||''),phrases=[];
 for(const match of value.matchAll(/[“"]([^”"]{8,120})[”"]|‘([^’]{8,120})’/gu))
  phrases.push(match[1]||match[2]||'');
 // Treat ASCII apostrophes as quotes only when they do not belong to a word.
 for(const match of value.matchAll(/(?<![\p{L}\p{N}])'([^']{8,120})'(?![\p{L}\p{N}])/gu))
  phrases.push(match[1]||'');
 const normalize=word=>word==='makes'?'make':word;
 const sourceWords=(String(text||'').toLocaleLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').match(/[\p{L}\p{N}]+/gu)||[])
  .filter(word=>!['do','does','did'].includes(word)).map(normalize);
 let longest=0;
 for(const phrase of phrases){
  const target=(phrase.toLocaleLowerCase().normalize('NFKD')
   .replace(/[\u0300-\u036f]/g,'').match(/[\p{L}\p{N}]+/gu)||[]).map(normalize);
  if(target.length<4||target.join('').length<12)continue;
  for(let start=0;start+target.length<=sourceWords.length;start++){
   if(target.every((word,index)=>sourceWords[start+index]===word)){
    longest=Math.max(longest,phrase.trim().length);
    break;
   }
  }
 }
 return longest;
}

function hasSubstantialQuotedPhrase(question){
 const value=String(question||''),phrases=[];
 for(const match of value.matchAll(/[“"]([^”"]{8,120})[”"]|‘([^’]{8,120})’/gu))
  phrases.push(match[1]||match[2]||'');
 for(const match of value.matchAll(/(?<![\p{L}\p{N}])'([^']{8,120})'(?![\p{L}\p{N}])/gu))
  phrases.push(match[1]||'');
 return phrases.some(phrase=>{
  const words=phrase.toLocaleLowerCase().normalize('NFKD')
   .replace(/[\u0300-\u036f]/g,'').match(/[\p{L}\p{N}]+/gu)||[];
  return words.length>=4&&words.join('').length>=12;
 });
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
     return localFacetTextMatch(question,value.text??value.preview).overlap>
       localFacetTextMatch(question,best.text??best.preview).overlap?value:best;
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

/* Share the exact pre-packet exclusions with the experimental selector so
 * the comparison changes page ranking only, not what counts as a candidate. */
export function auditSelectionCoverage(candidates,selected,partQuestions=[]){
 const selectedKeys=new Set((Array.isArray(selected)?selected:[])
  .map(item=>String(item?.bookId)+':'+String(item?.page)));
 return (Array.isArray(partQuestions)?partQuestions:[])
  .filter(part=>typeof part?.partId==='string'&&/^P[1-9]\d*$/.test(part.partId))
  .map(part=>{
   const eligible=(Array.isArray(candidates)?candidates:[]).filter(candidate=>
    Array.isArray(candidate?.candidatePartIds)&&candidate.candidatePartIds.includes(part.partId));
   const selectedCount=eligible.filter(candidate=>
    selectedKeys.has(String(candidate.bookId)+':'+String(candidate.page))).length;
   return {partId:part.partId,linkedCandidateCount:eligible.length,selectedCount,
    status:!eligible.length?'no-linked-candidate':selectedCount?'selected':'candidate-not-selected'};
  });
}
export function prepareAnswerCandidates(candidates){
 if(!Array.isArray(candidates))return [];
 // A catalogued general/subject index can contain topical terms plus useful
 // looking page references even when the bounded text excerpt misses the
 // index layout. Keep those pages in search traces, but never send them as
 // answer evidence.
 return dedupeEditionCopies(candidates.filter(candidate=>
  !isIndexLikeText(candidate?.text||candidate?.preview||candidate?.excerpt||'')&&
  !/\b(?:general|subject|topical)\s+index\b|\bindex\s+to\b/iu.test(String(candidate?.title||''))));
}

/* Offline evaluation view of the evidence packet. The local term-coherence
 * signals explain ranking behavior but do not grade semantic relevance. */
export function auditEvidencePacketSelection(candidates,selected,question,partQuestions=[]){
 const selectedKeys=new Set((Array.isArray(selected)?selected:[])
  .map(item=>String(item?.bookId)+':'+String(item?.page)));
 const parts=Array.isArray(partQuestions)&&partQuestions.length
  ?partQuestions.filter(item=>typeof item?.partId==='string'&&typeof item?.question==='string')
   .map(item=>({partId:item.partId,question:item.question}))
  :[{partId:'P1',question:String(question||'')}];
 const describe=(candidate,part,linked)=>({
  bookId:String(candidate?.bookId||''),title:String(candidate?.title||'').slice(0,200),
  page:Number.isSafeInteger(candidate?.page)?candidate.page:null,
  selected:selectedKeys.has(String(candidate?.bookId)+':'+String(candidate?.page)),
  linkedToPart:linked,signals:candidateEvidenceFit(candidate,part.question)
 });
 const partAudits=parts.map(part=>{
  const all=Array.isArray(candidates)?candidates:[];
  const linked=all.filter(candidate=>Array.isArray(candidate?.candidatePartIds)&&
   candidate.candidatePartIds.includes(part.partId));
  const pool=linked.length?linked:all;
  const ranked=[...pool].sort((left,right)=>compareEvidenceCandidates(left,right,part.question));
  return {partId:part.partId,linkedCandidateCount:linked.length,
   rankedCandidateCount:pool.length,
   selectedCount:pool.filter(candidate=>selectedKeys.has(
    String(candidate?.bookId)+':'+String(candidate?.page))).length,
   bestCandidates:ranked.slice(0,8).map(candidate=>describe(candidate,part,
    linked.includes(candidate))),
   selectedPages:pool.filter(candidate=>selectedKeys.has(
    String(candidate?.bookId)+':'+String(candidate?.page))).map(candidate=>describe(candidate,part,
     linked.includes(candidate)))};
 });
 return {version:'evidence-packet-audit-v1',
  method:'local-phrase-and-coherent-term-cluster-ranking',
  semanticRelevanceScored:false,candidateCount:Array.isArray(candidates)?candidates.length:0,
  selectedCount:Array.isArray(selected)?selected.length:0,parts:partAudits};
}

/* Build the bounded six-page comparison arm used by the candidate-pool
 * ablation. The live Worker applies the same page and byte limits after its
 * semantic selector maps IDs back to fingerprint-verified pages. */
export function boundAnswerSources(candidates,question,turnstileToken,
  {maxSources=4,maxBytes=39000,maxSourceBytes=35000,history=[]}={}){
 if(!Array.isArray(candidates)||typeof question!=='string'||typeof turnstileToken!=='string')return [];
 const chosen=[];let selectedSourceBytes=0;
 for(const candidate of candidates){
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

/* The public answer flow still facet-balances before applying the shared six-
 * page and byte limits. The model ablation uses the same limits without
 * reordering its model-ranked candidates. */
export function selectAnswerSources(candidates,question,turnstileToken,
  {maxSources=4,maxBytes=39000,maxSourceBytes=35000,history=[],plannedFacetCount=0,
   partQuestions=[]}={}){
 if(!Array.isArray(candidates)||typeof question!=='string'||
    typeof turnstileToken!=='string')return [];
 // Index/list pages can help diagnose a retrieval miss, but their entries are
 // not answer passages. Keep them in retrieval traces and exclude them here.
 candidates=prepareAnswerCandidates(candidates);
 const firstPerBook=[],seenBooks=new Set();
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
 // Preserve one strongest linked page for every requested part, then rank
 // the remaining packet by local passage fit. Distinct books break ties only;
 // source diversity is useful when evidence is equally relevant, not a quota.
 const partRepresentatives=[],reservedPartPages=new Set();
 const partIds=[...new Set(candidates.flatMap(candidate=>candidate.candidatePartIds||[]))];
 const partQuestionById=new Map((Array.isArray(partQuestions)?partQuestions:[])
  .filter(item=>item&&typeof item.partId==='string'&&typeof item.question==='string')
  .map(item=>[item.partId,/^How do the named sources compare in response to this question:/i
    .test(item.question)?question:item.question]));
 for(const partId of partIds){
  const eligible=candidates.filter(value=>value.candidatePartIds?.includes(partId)&&
   !reservedPartPages.has(value));
  const targetQuestion=partQuestionById.get(partId)||question;
  const candidate=eligible.length?eligible.reduce((best,value)=>
    compareEvidenceCandidates(value,best,targetQuestion)<0?value:best,eligible[0]):null;
  if(candidate){partRepresentatives.push(candidate);reservedPartPages.add(candidate);}
 }
 if(partRepresentatives.length){
  const representedBooks=new Set(partRepresentatives.map(value=>String(value.bookId)));
  const rankRemaining=(pool)=>{
   const remaining=pool.filter(value=>!reservedPartPages.has(value));
   const ranked=[];
   const bestFit=(candidate)=>{
    const linked=(candidate.candidatePartIds||[]).map(id=>partQuestionById.get(id)).filter(Boolean);
    const questions=linked.length?linked:[question];
    return questions.map(value=>candidateEvidenceFit(candidate,value)).reduce((best,value)=>
      compareEvidenceFit(value,best)<0?value:best);
   };
   const compareRank=(left,right)=>{
    const fitOrder=compareEvidenceFit(bestFit(left),bestFit(right));
    if(fitOrder)return fitOrder;
    const leftNew=!representedBooks.has(String(left?.bookId||''));
    const rightNew=!representedBooks.has(String(right?.bookId||''));
    if(leftNew!==rightNew)return leftNew?-1:1;
    const leftScore=Number.isFinite(left?.score)?left.score:Number.NEGATIVE_INFINITY;
    const rightScore=Number.isFinite(right?.score)?right.score:Number.NEGATIVE_INFINITY;
    return rightScore-leftScore;
   };
   while(remaining.length){
    let bestIndex=0;
    for(let index=1;index<remaining.length;index++)
     if(compareRank(remaining[index],remaining[bestIndex])<0)bestIndex=index;
    const [candidate]=remaining.splice(bestIndex,1);
    ranked.push(candidate);
    representedBooks.add(String(candidate.bookId));
   }
   return ranked;
  };
  const remainingLinked=ordered.filter(value=>!reservedPartPages.has(value)&&
   Array.isArray(value.candidatePartIds)&&value.candidatePartIds.length);
  const remainingUnlinked=ordered.filter(value=>!reservedPartPages.has(value)&&
   (!Array.isArray(value.candidatePartIds)||!value.candidatePartIds.length));
  ordered=[...partRepresentatives,...rankRemaining(remainingLinked),...rankRemaining(remainingUnlinked)];
 }
 return boundAnswerSources(ordered,question,turnstileToken,{maxSources,maxBytes,maxSourceBytes,history});
}

/* Some catalogs publish the same passage in several edition records, with
 * different surrounding text or page lengths. Collapse only same-work copies
 * whose smaller passage is almost wholly contained in the larger one. */
function dedupeEditionCopies(candidates){
 const seenByTitle=new Map(),out=[];
 for(const candidate of candidates){
  const title=String(candidate?.title||'').toLocaleLowerCase().normalize('NFKD')
   .replace(/[\u0300-\u036f]/g,'').replace(/\b(?:19|20)\d{2}\b/g,' ')
   .replace(/\b(?:edition|editions|printing|reprint|revised|updated)\b/g,' ')
   .replace(/[^a-z0-9]+/g,' ').trim();
  const text=typeof candidate?.text==='string'?candidate.text:'';
  const tokens=normalizedCopyTokens(text);
  // Short fragments do not carry enough language to distinguish a repeated
  // heading from a genuinely duplicated passage.
  if(title.length<6||tokens.length<40){out.push(candidate);continue;}
  const entries=seenByTitle.get(title)||[];
  const shingles=copyShingles(tokens);
  const duplicate=entries.find(entry=>nearDuplicateCopy(entry,tokens,shingles));
  if(!duplicate){
   const entry={candidate,index:out.length,tokens,shingles};
   entries.push(entry);seenByTitle.set(title,entries);out.push(candidate);continue;
  }
  // Keep the stronger retrieved edition in the original packet position.
  // This changes citation redundancy, not source scope or answer obligations.
  if((Number(candidate?.score)||0)>(Number(duplicate.candidate?.score)||0)){
   out[duplicate.index]=candidate;duplicate.candidate=candidate;
   duplicate.tokens=tokens;duplicate.shingles=shingles;
  }
 }
 return out;
}
function normalizedCopyTokens(text){
 return String(text||'').toLocaleLowerCase().normalize('NFKC')
  .match(/[\p{L}\p{N}]+/gu)||[];
}
function copyShingles(tokens){
 const shingles=new Set();
 for(let index=0;index+2<tokens.length;index++)
  shingles.add(tokens[index]+' '+tokens[index+1]+' '+tokens[index+2]);
 return shingles;
}
function nearDuplicateCopy(previous,tokens,shingles){
 const common=[...shingles].reduce((count,shingle)=>
  count+(previous.shingles.has(shingle)?1:0),0);
 // Normalize against the smaller shingle set: page excerpts may differ greatly
 // in length while containing the same quoted passage. Substantial rewrites
 // still fail because many shingles from the shorter passage are absent.
 return common/Math.max(1,Math.min(shingles.size,previous.shingles.size))>=0.94;
}

