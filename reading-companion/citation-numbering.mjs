import {inlineCitationGroups} from './diagnostic-report.mjs';

export function buildCitationNumbering(answer,citations=[]){
 const available=new Set(citations.map(source=>String(source?.id||'')));
 const ids=[];
 const seen=new Set();
 const add=id=>{
  const key=String(id||'');
  if(available.has(key)&&!seen.has(key)){seen.add(key);ids.push(key);}
 };
 for(const group of inlineCitationGroups(String(answer||'')))
  for(const id of group.ids)add(id);
 for(const source of citations)add(source?.id);
 return new Map(ids.map((id,index)=>[id,index+1]));
}

export function citationDisplayLabel(id,numbering=new Map()){
 const key=String(id||'');
 const number=numbering.get(key);
 if(Number.isInteger(number)&&number>0)return String(number);
 return key.replace(/^S(?=\\d+$)/,'');
}

export function sortCitationsByNumber(citations=[],numbering=new Map()){
 return citations.map((source,index)=>({source,index}))
  .sort((a,b)=>(numbering.get(String(a.source?.id||''))||Number.MAX_SAFE_INTEGER)-
    (numbering.get(String(b.source?.id||''))||Number.MAX_SAFE_INTEGER)||a.index-b.index)
  .map(entry=>entry.source);
}
