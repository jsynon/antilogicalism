/* Reading Companion — bounded, evidence-first passage planning.
 *
 * Generic question-facet coverage and within-book discrimination; no author-
 * specific words, hardcoded pages, model outputs or persistent user profiling.
 * This is still lexical retrieval, not proof of semantic entailment.
 */
const STOP = new Set(
  'a an and are as at be been being by can could did do does done for from had has have having how i if in into is it its of on or our out over should since so than that the their theirs them then there these they this those to under was were what when where which who whose why will with would you your his her hers him he she we us all according explain describe discussed discuss tell compare contrast'
  .split(' ')
);
const FRAMING = new Set(
  'book books work works author authors novel story text passage passages character characters chapter chapters article account view views theory theories idea ideas question reason reasoning ways way sense attempt attempts tried try relation relations role roles fit together'
  .split(' ')
);
const WORD = /[a-z0-9]+/g;

export function stemTerm(input){
  let w=String(input).toLowerCase();
  if(w.length>6 && w.endsWith('ies'))w=w.slice(0,-3)+'y';
  else if(w.length>6 && w.endsWith('ing'))w=w.slice(0,-3);
  else if(w.length>5 && w.endsWith('ed'))w=w.slice(0,-2);
  else if(w.length>5 && w.endsWith('es'))w=w.slice(0,-2);
  else if(w.length>5 && w.endsWith('s'))w=w.slice(0,-1);
  if(w.length>5 && w.endsWith('e'))w=w.slice(0,-1);
  return w;
}
export function termsFor(text,{title='',limit=20}={}){
  const titleTerms = new Set((String(title).toLowerCase().match(WORD)||[])
    .filter(w=>w.length>2).map(stemTerm));
  const all=[...new Set((String(text).toLowerCase().match(WORD)||[])
    .filter(w=>w.length>2&&!STOP.has(w)).map(stemTerm))];
  // Keep the important topic even when it is part of a title (e.g. species
  // and origin in Darwin). Put document-title and framing terms LAST rather
  // than letting them consume the entire bounded query budget.
  const topic=all.filter(w=>!titleTerms.has(w)&&!FRAMING.has(w));
  const other=all.filter(w=>!topic.includes(w));
  return [...topic,...other].slice(0,Math.min(24,Math.max(3,limit)));
}
export function planQuestion(question,{title=''}={}){
  const full=termsFor(question,{title,limit:20});
  // Split only at an explicit conjunction introducing another interrogative
  // clause. Ordinary "moral virtue and practical wisdom" remains one facet.
  const clauses=String(question).split(/[,;]?\s+\band\b\s+(?=(?:how|why|what|where|when|whether|which|who|does|do|did|can|should)\b)/i)
    .map(v=>v.trim()).filter(Boolean).slice(0,3);
  let facets=clauses.map(raw=>termsFor(raw,{title,limit:16}));
  facets=facets.filter(f=>f.length);
  if(!facets.length)facets=[full];
  // Book name / repeated characters can be cross-clause framing, not the
  // substance of every facet. Remove title tokens but only if content
  // questions still retain actual facet terms.
  return {full,facets};
}
function tokenizePage(text){
  return (String(text).toLowerCase().match(WORD)||[]).map(stemTerm);
}
function pageWindowScore(words,wanted){
  let top=0;
  const window=110;
  // One scan with fixed-size windows to reward co-occurrence and continuous
  // argument over distant isolated keywords or repeated page headings.
  for(let at=0;at<words.length;at+=55){
    const chunk=words.slice(at,at+window);
    if(!chunk.length)break;
    const seen=new Set(chunk.filter(w=>wanted.has(w)));
    if(seen.size>top)top=seen.size;
  }
  return top;
}
export function rankBookEvidence({question,title='',pages,maxCandidates=18}){
  const plan=planQuestion(question,{title});
  const valid=(Array.isArray(pages)?pages:[]).filter(p=>
     Number.isSafeInteger(p.page)&&p.page>0&&p.page<=10000&&
     typeof p.text==='string'&&p.text.trim().length>40);
  const titleTerms=new Set((title.toLowerCase().match(WORD)||[]).map(stemTerm));
  const pageCache=[];
  const freq=new Map();
  for(const p of valid){
    const words=tokenizePage(p.text);
    if(words.length<10)continue;
    const distinct=new Set(words);
    pageCache.push({item:p,words,distinct});
    for(const t of plan.full)if(distinct.has(t))freq.set(t,(freq.get(t)||0)+1);
  }
  const eligibleTerms=plan.full.filter(t=>freq.has(t));
  const n=pageCache.length;
  const importance=t=>{
    const df=freq.get(t)||0;
    if(!df)return 0;
    const rarity=Math.max(0,Math.log((n+1)/(df+1)));
    // Don't let a title/name repeat on every page swamp a distinct idea.
    const titleFactor=titleTerms.has(t)?0.22:1;
    const framingFactor=FRAMING.has(t)?0.20:1;
    return (0.5+Math.min(3.5,rarity))*titleFactor*framingFactor;
  };
  const planFacets=plan.facets.map(f=>f.filter(t=>freq.has(t)));
  const records=[];
  for(const entry of pageCache){
    const present=eligibleTerms.filter(t=>entry.distinct.has(t));
    if(!present.length)continue;
    const facets=planFacets.map(terms=>{
      if(!terms.length)return 0;
      const found=terms.filter(t=>entry.distinct.has(t));
      if(!found.length)return 0;
      const weight=found.reduce((sum,t)=>sum+importance(t),0);
      const total=terms.reduce((sum,t)=>sum+importance(t),0);
      const proximity=pageWindowScore(entry.words,new Set(found));
      // Retain an absolute relevance component so extremely broad overlap
      // doesn't crowd out a short but precise quoted argument.
      return weight + 3*found.length/terms.length +
        2*(total?weight/total:0) + Math.min(3,proximity)*0.6;
    });
    const fullScore=present.reduce((sum,t)=>sum+importance(t),0);
    records.push({item:entry.item,facets,score:fullScore+Math.max(...facets)});
  }
  records.sort((a,b)=>b.score-a.score||a.item.page-b.item.page);
  // Retain strong choices from EACH subquestion as well as the combined
  // ranking. This differs from just selecting top-2 of a single keyword bag.
  const selected=new Map();
  for(const r of records.slice(0,Math.min(12,maxCandidates)))selected.set(r.item.page,r);
  for(let facet=0;facet<planFacets.length;facet++){
    const ranked=[...records].sort((a,b)=>b.facets[facet]-a.facets[facet]||b.score-a.score);
    for(const r of ranked.filter(r=>r.facets[facet]>0).slice(0,Math.max(4,Math.ceil(maxCandidates/2)))){
      selected.set(r.item.page,r);
    }
  }
  const pool=[...selected.values()];
  function utility(pair){
    const usable=pair.filter(Boolean);
    const combined=planFacets.reduce((sum,terms,i)=>{
      if(!terms.length)return sum;
      return sum+Math.max(0,...usable.map(p=>p.facets[i]))*2;
    },0);
    const direct=usable.reduce((sum,p)=>sum+p.score*0.18,0);
    const diversity=usable.length===2&&usable[0].item.page!==usable[1].item.page?
      Math.min(2,Math.abs(usable[0].item.page-usable[1].item.page)/30):0;
    const redundancy=usable.length===2&&usable[0].item.page===usable[1].item.page?100000:0;
    return combined+direct+diversity-redundancy;
  }
  // Select the best pair under the same two-page AI budget, then offer
  // further pages for manual inspection separately.
  const pairPool=pool.slice(0,Math.min(20,pool.length));
  let best=null,bestScore=-Infinity;
  for(let i=0;i<pairPool.length;i++)for(let j=i+1;j<pairPool.length;j++){
    const pair=[pairPool[i],pairPool[j]];
    const candidate=utility(pair);
    if(candidate>bestScore){bestScore=candidate;best=pair;}
  }
  if(!best&&pool.length)best=[pool[0]];
  const front=(best||[]).map(x=>x.item.page);
  const others=records.filter(x=>!front.includes(x.item.page))
    .slice(0,Math.max(0,maxCandidates-front.length));
  const chosen=[...(best||[]),...others].slice(0,maxCandidates);
  return {plan,ranked:chosen,facetsCovered:planFacets.map((terms,i)=>
     terms.length>0 && chosen.slice(0,Math.min(2,chosen.length)).some(r=>r.facets[i]>0)),
    indexedPages:n};
}
