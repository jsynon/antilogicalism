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
   const seen=new Set(),out=[];
   function add(entry,facet){
     if(!valid(entry))return false;
     const key=String(entry.bookId)+':'+entry.page;
     if(seen.has(key))return false;
     seen.add(key);out.push({...entry,facet});return true;
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
         facets:new Set()};
       byPage.set(key,record);
     }
     record.rankScore+=1/(RANK_OFFSET+rank+1);
     record.facets.add(facet);
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
   .slice(0,limit).map(({entry,facet,facets})=>({...entry,facet,
     matchedFacets:facets.size}));
}
export function validSearchPlan(value){
 return Array.isArray(value)&&value.length===2&&
   value.every(q=>typeof q==='string'&&q.trim().length>=12&&q.trim().length<=160)&&
   value[0].trim().toLowerCase()!==value[1].trim().toLowerCase();
}

/* Keep the reader's exact wording as a lexical facet alongside the two
 * planner rewrites. This lets retrieval recover source language the planner
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
 const work=String(title||'').split(' — ')[0];
 const variants=[work,...work.split(':').slice(1)];
 const cleaned=variants.map(value=>value.replace(/\([^)]*\)/g,' ').trim());
 return [...new Set(cleaned.flatMap(value=>[value,value.replace(/^(the|a|an)\s+/i,'')])
  .filter(value=>normalizeCatalogText(value).length>=4))];
}
function catalogAuthorNames(title){
 const parts=String(title||'').split(' — ');
 if(parts.length<2)return [];
 const author=parts.slice(1).join(' ').trim();
 if(/\bedited by\b/i.test(author))return [];
 return author.split(/\s+and\s+/i).filter(Boolean);
}
export function matchExplicitBookIds(question,books){
 if(typeof question!=='string'||!Array.isArray(books))return [];
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

/* Planning improves retrieval, but a temporary planner outage must not block
 * direct search with the reader's own wording. Keep explicit request denials
 * and rate limits fail-closed. */
export function canFallbackToDirectSearch(status,code=''){
 if(['ai-daily-limit-reached','ai-capacity-unavailable','ai-rate-limited'].includes(code))return false;
 if(status===null||status===undefined)return true;
 if(Number.isInteger(status)&&status>=500)return true;
 if(Number.isInteger(status)&&status>=400)return false;
 return ['invalid-response','search-planning-failed','network-error'].includes(code);
}

/* Send up to four full pages to the verifier while keeping the exact request
 * below the Worker body limit. The candidate order is already facet-balanced;
 * preserve it so the first options still cover each part of a comparison.
 */
export function selectAnswerSources(candidates,question,turnstileToken,
  {maxSources=4,maxBytes=30000,history=[]}={}){
 if(!Array.isArray(candidates)||typeof question!=='string'||
    typeof turnstileToken!=='string')return [];
 const chosen=[],firstPerBook=[],alternates=[],seenBooks=new Set();
 for(const candidate of candidates){
   const key=String(candidate?.bookId||'');
   if(key&&!seenBooks.has(key)){seenBooks.add(key);firstPerBook.push(candidate);}
   else alternates.push(candidate);
 }
 // Preserve passage ranking for ordinary questions. Comparison questions
 // need different works by design. Author-wide questions also benefit from
 // coverage across the author's works, so long as the question does not name
 // one specific work. matchExplicitBookIds resolves this from the candidates'
 // trusted catalog titles and does not add a model call.
 const comparisonIntent=/\b(?:compare|contrast|versus|vs\.?|differences?|similarities?)\b/i.test(question);
 const authorWideBooks=matchExplicitBookIds(question,candidates.map(candidate=>({
   id:String(candidate?.bookId||''),title:String(candidate?.title||'')
 })));
 const authorWideIntent=authorWideBooks.length>1;
 let ordered=candidates;
 if(comparisonIntent){
   // A comparison requires evidence from each work or author by design.
   ordered=[...firstPerBook,...alternates];
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
     const reserved=new Set(strongRepresentatives);
     ordered=[...strongRepresentatives,...candidates.filter(candidate=>!reserved.has(candidate))];
   }else{
     // Preserve the established breadth behavior for legacy results without
     // comparable passage scores.
     ordered=[...firstPerBook,...alternates];
   }
 }
 for(const candidate of ordered){
   if(chosen.length>=maxSources)break;
   if(!candidate||typeof candidate.text!=='string'||
      !/^[1-9]\d{0,3}$/.test(String(candidate.bookId))||
      !Number.isSafeInteger(candidate.page)||candidate.page<1)continue;
   const next=[...chosen,candidate];
   const bytes=new TextEncoder().encode(JSON.stringify({question,turnstileToken,history,
     sources:next.map(({bookId,page,text})=>({bookId,page,text}))})).byteLength;
   if(bytes<=maxBytes)chosen.push(candidate);
 }
 return chosen;
}
