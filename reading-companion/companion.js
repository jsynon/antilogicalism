/* Antilogicalism Reading Companion pilot — browser-only corpus retrieval.
   No private tokens, model credentials or bills; public AI is disabled until
   the operator explicitly enables the protected Cloudflare pilot. */
(() => {
  'use strict';
  const ROOT='https://jsynon.github.io/antilogicalism-library-data/data-v47/';
  const API='https://antilogicalism-companion-public.jsynon.workers.dev';
  const PDF='https://drive.google.com/file/d/1i78jRD5kH4-xs2l1TUtrp80olKQv8kRu/view?usp=sharing#page=';
  const STOP=new Set('what when where why who whose about from these those with that which would could should does were have this what into many some been then than the and for how are was will can not did has had over under because caused cause'.split(' '));
  const el=id=>document.getElementById(id);
  const form=el('companion-question-form');
  if(!form)return;
  const question=el('companion-question');
  const status=el('companion-status');
  const scope=el('companion-scope');
  const list=el('companion-passage-list');
  const answer=el('companion-answer');
  const ask=el('companion-ask-button');
  const lookup=el('companion-find-button');
  const challenge=el('companion-challenge');
  const turnstileBox=el('companion-turnstile');
  const PAGE_LIMIT=2;
  let pages=[], selected=new Set(), pilotEnabled=false, turnstileToken='', turnstileId=null;
  const text=(tag,content,className)=>{
    const node=document.createElement(tag);
    node.textContent=content;
    if(className)node.className=className;
    return node;
  };
  function tokenize(input) {
    return [...new Set((input.toLowerCase().match(/[a-z0-9]+/g)||[])
      .filter(w=>w.length>2&&!STOP.has(w)))].slice(0,12);
  }
  async function loadBook(){
    const response=await fetch(ROOT+'book-152.json.gz',{cache:'force-cache'});
    if(!response.ok)throw Error('The library source could not be loaded (HTTP '+response.status+').');
    const data=new Uint8Array(await response.arrayBuffer());
    if(data.byteLength>10000000)throw Error('Book source exceeds the download limit.');
    let raw;
    if(data[0]===31&&data[1]===139){
      if(typeof DecompressionStream==='undefined')throw Error('Browser gzip support required.');
      raw=await new Response(new Blob([data]).stream()
        .pipeThrough(new DecompressionStream('gzip'))).text();
    }else raw=new TextDecoder('utf-8',{fatal:true}).decode(data);
    const book=JSON.parse(raw);
    if(!Array.isArray(book.pages))throw Error('Unexpected v47 book format.');
    pages=book.pages
      .filter(p=>Number.isSafeInteger(p.page)&&p.page>=33&&p.page<=64&&
        Number.isSafeInteger(p.id)&&typeof p.text==='string'&&p.text.trim().length>=25)
      .map(p=>({bookId:'152',page:p.page,globalPageId:p.id,text:p.text}))
      .sort((a,b)=>a.page-b.page);
    if(!pages.length)throw Error('No indexed pages were found in the pilot range.');
    scope.textContent='Thucydides, History of the Peloponnesian War · PDF pages 33–64 · '+pages.length+' indexed pages available.';
  }
  function rankedPages(){
    const words=tokenize(question.value.trim());
    return pages.map(p=>{
      const body=p.text.toLowerCase();
      const hits=words.filter(w=>body.includes(w));
      const count=hits.reduce((sum,w)=>sum+(body.split(w).length-1),0);
      return {...p,score:hits.length*10+Math.min(10,count)};
    }).sort((a,b)=>b.score-a.score||a.page-b.page);
  }
  function renderPages(){
    const ranked=rankedPages();
    list.replaceChildren();
    if(!ranked.length)return;
    if(!selected.size)selected=new Set(ranked.slice(0,1).map(p=>p.page));
    const head=text('p','Select up to two passages. The full, original page text—not the shortened preview—is verified before AI answers.','companion-hint');
    list.append(head);
    for(const p of ranked.slice(0,8)){
      const card=document.createElement('article');
      card.className='companion-source';
      const label=document.createElement('label');
      label.className='companion-source-heading';
      const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(p.page);
      check.setAttribute('aria-label','Use PDF page '+p.page);
      check.addEventListener('change',()=>{
        if(check.checked && selected.size>=PAGE_LIMIT){
          check.checked=false;status.textContent='Choose no more than two pages per question.';return;
        }
        if(check.checked)selected.add(p.page);else selected.delete(p.page);
        updateAsk();
      });
      label.append(check,text('span','PDF page '+p.page+' · '+p.score+' relevance points'));
      const excerpt=text('p',p.text.replace(/\s+/g,' ').trim().slice(0,480)+(p.text.length>480?'…':''));
      const more=document.createElement('details');
      const summary=text('summary','Read full indexed page');
      const full=text('pre',p.text,'companion-full-page');
      more.append(summary,full);
      const link=document.createElement('a');link.href=PDF+p.page;link.rel='noopener noreferrer';link.target='_blank';link.textContent='Open original PDF page';
      card.append(label,excerpt,more,link);list.append(card);
    }
    const hidden=selected.size&&[...selected].some(p=>!ranked.slice(0,8).some(s=>s.page===p));
    if(hidden){selected=new Set([...selected].filter(p=>ranked.slice(0,8).some(s=>s.page===p)));renderPages();return;}
    status.textContent='Showing the eight most relevant pages within the pilot selection. You can inspect them even while public AI is off.';
    updateAsk();
  }
  function updateAsk(){
    ask.disabled=!pilotEnabled||!selected.size||!turnstileToken||!question.value.trim();
  }
  async function loadStatus(){
    try{
      const response=await fetch(API+'/api/pilot-status',{cache:'no-store'});
      if(!response.ok)throw Error('Service status unavailable');
      const data=await response.json();
      pilotEnabled=data.enabled===true && typeof data.turnstileSiteKey==='string' && data.turnstileSiteKey.length>10;
      if(!pilotEnabled){
        challenge.textContent='Source browsing is available. Hosted AI answers are not yet enabled for public visitors.';
        updateAsk();return;
      }
      challenge.textContent='AI pilot is available for this limited selection. Complete the visitor verification to ask a question.';
      const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async=true;script.defer=true;
      script.onload=()=>{
        if(!window.turnstile){challenge.textContent='Visitor verification is unavailable.';return;}
        turnstileId=window.turnstile.render(turnstileBox,{
          sitekey:data.turnstileSiteKey,action:'companion_ask',theme:'light',
          callback:token=>{turnstileToken=token;updateAsk();},
          'expired-callback':()=>{turnstileToken='';updateAsk();},
          'error-callback':()=>{turnstileToken='';updateAsk();}
        });
      };
      script.onerror=()=>{challenge.textContent='Visitor verification could not load. Please try later.';};
      document.head.appendChild(script);
    }catch{
      challenge.textContent='You can browse source pages. Hosted AI availability could not be checked.';
    }
    updateAsk();
  }
  function renderAnswer(data) {
    answer.replaceChildren();
    const h=text('h2',data.outcome==='insufficient-evidence'?'Insufficient evidence':'Reading Companion answer');
    answer.append(h,text('p',data.answer||'No explanation was returned.','companion-answer-text'));
    const cites=Array.isArray(data.citations)?data.citations:[];
    for(const s of cites){
      const article=document.createElement('article');
      article.className='companion-citation';
      const title=text('strong','['+s.id+'] '+s.title+' · PDF page '+s.page);
      const link=document.createElement('a');link.href=s.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View original PDF page';
      article.append(title,text('p',s.preview),link);answer.append(article);
    }
    const note=text('p','Evidence coverage: '+(data.coverage||'unknown')+
      '. Source provenance verified using SHA-256; individual AI claims are not independently fact-checked.','companion-hint');
    answer.append(note);
    if(data.missing)answer.append(text('p','Additional evidence needed: '+data.missing,'companion-hint'));
  }
  lookup.addEventListener('click',()=>{
    selected.clear();answer.replaceChildren();renderPages();
  });
  question.addEventListener('input',()=>{turnstileToken=turnstileToken;updateAsk();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!pilotEnabled){status.textContent='Hosted AI answers are currently disabled.';return;}
    if(!turnstileToken){status.textContent='Complete the visitor verification first.';return;}
    const chosen=pages.filter(p=>selected.has(p.page)).slice(0,PAGE_LIMIT);
    if(!chosen.length){status.textContent='Select a source page first.';return;}
    const token=turnstileToken;turnstileToken='';ask.disabled=true;
    status.textContent='Verifying source pages and preparing an evidence-based answer…';
    answer.replaceChildren();
    try{
      const response=await fetch(API+'/api/pilot-answer',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({question:question.value.trim(),turnstileToken:token,
          sources:chosen.map(p=>({bookId:'152',page:p.page,text:p.text}))})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'The service returned HTTP '+response.status);
      renderAnswer(data);
      status.textContent='The verified answer is ready.';
    }catch(error){status.textContent='The answer could not be completed: '+error.message;}
    finally{
      if(window.turnstile && turnstileId!==null)window.turnstile.reset(turnstileId);
      updateAsk();
    }
  });
  (async()=>{
    status.textContent='Loading original indexed Thucydides passages…';
    try{await loadBook();renderPages();}
    catch(error){status.textContent='Library passages unavailable: '+error.message;lookup.disabled=true;}
    await loadStatus();
  })();
})();
