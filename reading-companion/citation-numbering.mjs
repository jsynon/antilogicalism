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

export function sourceAttributionLabel(provenance={}){
 const voice=provenance?.pageVoice;
 if(voice?.kind==='editorial-introduction'&&voice.name)
  return 'Editorial introduction by '+voice.name+
   (voice.creditedAuthor?' · Work credited to '+voice.creditedAuthor:'');
 const workVoice=provenance?.workVoice;
 if(workVoice?.kind==='pseudonymous-author'&&workVoice.name)
  return 'Published under pseudonym: '+workVoice.name+
   (workVoice.creditedAuthor?' · Credited author: '+workVoice.creditedAuthor:'');
 if(['introduction','preface','commentary','notes'].includes(provenance?.pageSectionHint)&&
   provenance?.pageVoiceHint==='editorial-or-front-matter; verify against the passage')
  return (provenance.pageSectionHint[0].toUpperCase()+provenance.pageSectionHint.slice(1))+': page speaker not confirmed';
 return '';
}
