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
 const seen=new Set(),out=[];
 function add(entry,facet){
   if(!entry||!Number.isSafeInteger(entry.page)||entry.page<1||
       !/^[1-9]\d{0,3}$/.test(String(entry.bookId)))return false;
   const key=String(entry.bookId)+':'+entry.page;
   if(seen.has(key))return false;
   seen.add(key);out.push({...entry,facet});return true;
 }
 // One source from each facet first — only then use alternates. This avoids
 // the old behavior of automatically sending two snippets from one storyline.
 for(let facet=0;facet<groups.length;facet++){
   const group=groups[facet];
   for(const entry of group)if(add(entry,facet))break;
 }
 // Round-robin to keep options available without expanding AI costs.
 for(let i=0;i<15&&out.length<limit;i++){
   for(let f=0;f<groups.length&&out.length<limit;f++)
     if(groups[f][i])add(groups[f][i],f);
 }
 return out.slice(0,limit);
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

/* Planning improves retrieval, but a temporary planner outage must not block
 * direct search with the reader's own wording. Keep explicit request denials
 * and rate limits fail-closed. */
export function canFallbackToDirectSearch(status,code=''){
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
 const chosen=[];
 for(const candidate of candidates){
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
