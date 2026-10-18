/* Merge two independently retrieved question facets under the existing
 * two-page evidence budget, retaining alternatives for manual inspection.
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
