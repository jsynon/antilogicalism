/* Merge two independently retrieved question facets, retaining alternatives
 * for source selection and manual inspection.
 * No generated claim or PDF locator is trusted by this component.
 */
export function mergeFacetSearches(results,limit=8){
 if(!Array.isArray(results))return [];
 const groups=results.map(r=>Array.isArray(r?.sources)?r.sources:[]);
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

/* Send up to four full pages to the verifier while keeping the exact request
 * below the Worker body limit. The candidate order is already facet-balanced;
 * preserve it so the first options still cover each part of a comparison.
 */
export function selectAnswerSources(candidates,question,turnstileToken,
  {maxSources=4,maxBytes=30000}={}){
 if(!Array.isArray(candidates)||typeof question!=='string'||
    typeof turnstileToken!=='string')return [];
 const chosen=[];
 for(const candidate of candidates){
   if(chosen.length>=maxSources)break;
   if(!candidate||typeof candidate.text!=='string'||
      !/^[1-9]\d{0,3}$/.test(String(candidate.bookId))||
      !Number.isSafeInteger(candidate.page)||candidate.page<1)continue;
   const next=[...chosen,candidate];
   const bytes=new TextEncoder().encode(JSON.stringify({question,turnstileToken,
     sources:next.map(({bookId,page,text})=>({bookId,page,text}))})).byteLength;
   if(bytes<=maxBytes)chosen.push(candidate);
 }
 return chosen;
}
