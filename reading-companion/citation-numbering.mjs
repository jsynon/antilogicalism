// Audit fix C6: inlineCitationGroups and auditCitationIds moved here
// from diagnostic-report.mjs when the diagnostic pipeline was
// deleted. They are live citation machinery (rendering + the harness
// citation audit), not diagnostics.

// Accept both a single marker ([S1]) and grouped markers ([S1, S3]) for
// rendering. The audit below intentionally remains broader so malformed or
// unmatched markers still surface.
export function inlineCitationGroups(answer){
  return [...String(answer||'').matchAll(/\[((?:S[1-9]\d*)(?:\s*,\s*S[1-9]\d*)*)\]/g)]
    .map(match=>({start:match.index,end:match.index+match[0].length,
      ids:match[1].split(/\s*,\s*/)}));
}

export function auditCitationIds(answer,citations=[]){
  const inlineIds=[...new Set([...String(answer||'').matchAll(/\[([^\]]+)\]/g)]
    .flatMap(match=>match[1].match(/\bS[1-9]\d*\b/g)||[]))];
  const returnedIds=[...new Set(citations.map(source=>source?.id)
    .filter(id=>typeof id==='string'&&/^S[1-9][0-9]*$/.test(id)))];
  return {
    inlineIds,
    returnedIds,
    inlineIdsWithoutSource:inlineIds.filter(id=>!returnedIds.includes(id)),
    sourcesNotCited:returnedIds.filter(id=>!inlineIds.includes(id))
  };
}

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
 if(['editorial-introduction','editorial-commentary'].includes(voice?.kind)&&voice.name)
  return (voice.kind==='editorial-introduction'?'Editorial introduction by ':'Editorial commentary by ')+voice.name+
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
