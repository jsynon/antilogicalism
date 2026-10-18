/* Antilogicalism Reading Companion v1.10.0 — browser retrieval only.
 * Real indexed v47 passages; no secrets, model keys or paid APIs in this file.
 * The Worker independently validates every submitted source page against v47
 * fingerprints before any inference. This is a four-book release, not 644 yet.
 */
import {RemoteLibrary} from './remote-library.mjs';
import {createSourceReader} from './source-reader.mjs';

const ROOT='https://jsynon.github.io/antilogicalism-library-data/';
const API='https://antilogicalism-companion-public.jsynon.workers.dev';
const FALLBACK_BOOK={id:'152',title:'History of the Peloponnesian War — Thucydides'};
const PDF_PAGE_LIMIT=14000;
const MAX_SELECTED=2;
const el=id=>document.getElementById(id);
const question=el('companion-question');
const form=el('companion-question-form');
if(!form)throw Error('Reading Companion markup is missing');
const bookFilter=el('companion-book-filter');
const findButton=el('companion-find-button');
const askButton=el('companion-ask-button');
const answerBox=el('companion-answer');
const passagesBox=el('companion-passage-list');
const status=el('companion-status');
const scope=el('companion-scope');
const challenge=el('companion-challenge');
const challengeBox=el('companion-turnstile');
const examples=el('companion-suggested-questions');
const library=new RemoteLibrary();
const sourceShards=new Map();
const sourceReader=createSourceReader({getBook:id=>bookShard(id),
  getManifest:()=>library.manifest(),isAllowedBook:id=>allowed.has(id)});
let bookList=[FALLBACK_BOOK], allowed=new Set(['152']), oldPilotFallback=true;
let pilotEnabled=false, turnstileToken='', turnstileId=null;
let candidates=[], selected=new Set(), lastSearch='', searching=false, answering=false;

function node(tag,textValue,className){
  const e=document.createElement(tag);
  if(textValue!==undefined)e.textContent=String(textValue);
  if(className)e.className=className;
  return e;
}
function setStatus(message){status.textContent=message;}
function selectionKey(s){return s.bookId+':'+s.page;}
function showAvailability(){
  const title=oldPilotFallback?'Thucydides (32-page pilot)':
    bookList.length+' verified books across philosophy, history, science, and literature';
  scope.textContent='Available collection: '+title+'. Source excerpts come from the original v47 index.';
}
function updateButtons(){
  askButton.disabled=searching||answering||!pilotEnabled||!turnstileToken||question.value.trim().length<5;
  findButton.disabled=searching||answering;
}
function populateBooks(){
  bookFilter.replaceChildren(new Option('All available books',''));
  for(const book of bookList)bookFilter.append(new Option(book.title,book.id));
  showAvailability();
}
async function loadCoverage(){
  try{
    const response=await fetch(ROOT+'reader-fingerprints-v1/coverage-v1.json',{cache:'no-store'});
    if(!response.ok)throw Error('The expanded fingerprint collection is not published yet.');
    const index=await response.json();
    if(index.schema!=='antilogicalism-reader-coverage-v1'||
       index.libraryVersion!==47||!index.books||typeof index.books!=='object')
      throw Error('Unexpected fingerprint coverage index');
    const desired=['7','114','152','529'];
    const list=desired.filter(id=>index.books[id]&&
      typeof index.books[id].title==='string'&&index.books[id].pages>0)
      .map(id=>({id,title:index.books[id].title}));
    if(list.length!==4)throw Error('The four-book collection is not published yet.');
    bookList=list;
    allowed=new Set(list.map(x=>x.id));
    oldPilotFallback=false;
  }catch{
    // Preserve working v1.9.5 passage browser until GitHub Actions exports
    // the complete data; do not pretend unavailable books have fingerprints.
    bookList=[FALLBACK_BOOK];allowed=new Set(['152']);
    oldPilotFallback=true;
  }
  populateBooks();
}
async function loadStatus(){
  try{
    const response=await fetch(API+'/api/pilot-status',{cache:'no-store'});
    if(!response.ok)throw Error('Public pilot status unavailable');
    const data=await response.json();
    pilotEnabled=data.enabled===true && typeof data.turnstileSiteKey==='string' &&
      data.turnstileSiteKey.length>10;
    if(!pilotEnabled){
      challenge.textContent='Book browsing works now. Hosted AI is not currently enabled.';
      return;
    }
    challenge.textContent='Hosted AI is available for verified books. Complete visitor verification before asking.';
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async=true;
    script.onload=()=>{
      if(!window.turnstile){challenge.textContent='Visitor verification could not start.';return;}
      turnstileId=window.turnstile.render(challengeBox,{
        sitekey:data.turnstileSiteKey,action:'companion_ask',theme:'light',
        callback:token=>{turnstileToken=token;updateButtons();},
        'expired-callback':()=>{turnstileToken='';updateButtons();},
        'error-callback':()=>{turnstileToken='';updateButtons();}
      });
    };
    script.onerror=()=>{challenge.textContent='Visitor verification service unavailable.';};
    document.head.appendChild(script);
  }catch{
    challenge.textContent='You can browse the verified source collection. Hosted AI status could not be checked.';
  }finally{updateButtons();}
}
function allowedPage(s){
  return (!oldPilotFallback|| (s.bookId==='152' && s.page>=33&&s.page<=64));
}
async function bookShard(id){
  if(!sourceShards.has(id)){
    const promise=library.jsonGzip('book-'+id+'.json').catch(error=>{
      sourceShards.delete(id);
      throw error;
    });
    sourceShards.set(id,promise);
  }
  return sourceShards.get(id);
}
async function searchPages(){
  const q=question.value.trim();
  if(q.length<5||q.length>400)throw Error('Please enter a question of 5–400 characters.');
  searching=true;updateButtons();setStatus('Searching the indexed books for relevant passages…');
  try{
    let populated=[];
    if(oldPilotFallback){
      // Until the four-book publication reaches GitHub Pages, search the
      // previously proven 32-page Thucydides selection directly. Do not
      // search the entire shard and accidentally offer unverified pages.
      const book=await bookShard('152');
      const stop=new Set(['what','when','where','why','does','was','were','the','and',
         'from','about','that','this','with','they','have','which','could','should']);
      const words=[...new Set((q.toLowerCase().match(/[a-z0-9]+/g)||[])
        .filter(w=>w.length>2&&!stop.has(w)))];
      const pdf='https://drive.google.com/file/d/1i78jRD5kH4-xs2l1TUtrp80olKQv8kRu/view?usp=sharing#page=';
      populated=book.pages.filter(p=>p.page>=33&&p.page<=64 &&
          typeof p.text==='string' && p.text.trim().length>=25)
        .map(p=>{
          const content=p.text.toLowerCase();
          const hits=words.filter(w=>content.includes(w));
          const points=hits.length*10+
             Math.min(10,hits.reduce((v,w)=>v+content.split(w).length-1,0));
          return {id:'S1',bookId:'152',title:FALLBACK_BOOK.title,
            page:p.page,globalPageId:p.id,text:p.text,score:points,
            url:pdf+p.page,
            preview:p.text.replace(/\s+/g,' ').trim().slice(0,600)};
        }).filter(s=>new TextEncoder().encode(s.text).byteLength<=PDF_PAGE_LIMIT)
        .sort((a,b)=>b.score-a.score||a.page-b.page);
    }else{
      const found=await library.search(q,{bookId:bookFilter.value,
        allowedBookIds:allowed,maxBooks:2,pagesPerBook:3});
      // Prefer one passage from each relevant book for comparative questions.
      const results=found.sources.filter(allowedPage);
      const representatives=[],others=[],visited=new Set();
      for(const r of results){
        if(visited.has(r.bookId))others.push(r);
        else {visited.add(r.bookId);representatives.push(r);}
      }
      const ordered=[...representatives,...others];
      for(const s of ordered){
        const shard=await bookShard(s.bookId);
        const original=shard.pages?.find(p=>p.id===s.globalPageId && p.page===s.page);
        if(!original || typeof original.text!=='string')continue;
        const byteLength=new TextEncoder().encode(original.text).byteLength;
        if(byteLength<25||byteLength>PDF_PAGE_LIMIT)continue;
        populated.push({...s,text:original.text,byteLength});
      }
    }
    candidates=populated.slice(0,8);
    lastSearch=q+'|'+bookFilter.value;
    selected=new Set(candidates.slice(0,Math.min(MAX_SELECTED,candidates.length)).map(selectionKey));
    renderPassages();
    if(!candidates.length){
      setStatus('No eligible verified passages found for that question. Try another wording or select a book.');
      return false;
    }
    setStatus('Found '+candidates.length+' relevant passages. '+selected.size+
      ' source page(s) selected for verification.');
    return true;
  }finally{searching=false;updateButtons();}
}
function renderPassages(){
  passagesBox.replaceChildren();
  if(!candidates.length)return;
  passagesBox.append(node('p','Retrieved passages (choose up to two for the answer)','companion-hint'));
  for(const s of candidates){
    const card=node('article',undefined,'companion-source');
    const label=node('label',undefined,'companion-source-heading');
    const check=document.createElement('input');
    check.type='checkbox';check.checked=selected.has(selectionKey(s));
    check.setAttribute('aria-label','Use '+s.title+' PDF page '+s.page);
    check.addEventListener('change',()=>{
      if(check.checked&&selected.size>=MAX_SELECTED){
        check.checked=false;setStatus('Choose no more than two passage pages.');return;
      }
      if(check.checked)selected.add(selectionKey(s));
      else selected.delete(selectionKey(s));
      updateButtons();
    });
    label.append(check,node('span',s.title+' · PDF page '+s.page));
    const summary=node('p',s.preview,'companion-passage-preview');
    const details=document.createElement('details');
    details.append(node('summary','Read full indexed page'),node('pre',s.text,'companion-full-page'));
    const link=document.createElement('a');link.href=s.url;
    link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open original PDF page';
    card.append(label,summary,details,link);
    passagesBox.append(card);
  }
}
function putCitationTokens(target,answer,citations){
  const byId=new Map(citations.map(s=>[s.id,s]));
  const pattern=/\[(S[1-9]\d*)\]/g;
  let at=0,match;
  while((match=pattern.exec(answer))!==null){
    if(match.index>at)target.append(document.createTextNode(answer.slice(at,match.index)));
    const source=byId.get(match[1]);
    if(source){
      const a=document.createElement('a');
      a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';
      a.textContent=match[0];a.className='companion-inline-citation';
      a.title=source.title+' PDF page '+source.page;
      target.append(a);
    }else target.append(document.createTextNode(match[0]));
    at=match.index+match[0].length;
  }
  if(at<answer.length)target.append(document.createTextNode(answer.slice(at)));
}
function renderResponse(data){
  sourceReader.reset();
  answerBox.replaceChildren();
  const citations=Array.isArray(data.citations)?data.citations:[];
  answerBox.append(node('h2',data.outcome==='insufficient-evidence'?
    'Insufficient evidence':'Reading Companion answer'));
  const reply=node('div',undefined,'companion-answer-text');
  putCitationTokens(reply,String(data.answer||''),citations);
  answerBox.append(reply);
  if(data.missing)answerBox.append(node('p','Evidence limitation: '+data.missing,'companion-hint'));

  // Preserve familiar v1.7 Reader Mode order: Explore further, Key passages,
  // then Sources. Buttons populate the composer; no hidden AI calls.
  const followUps=Array.isArray(data.followUpQuestions)?data.followUpQuestions:[];
  const valid=followUps.filter(s=>typeof s==='string' && s.length<=180 &&
     s.endsWith('?')).slice(0,2);
  if(valid.length){
    const box=node('section',undefined,'companion-follow-ups');
    box.append(node('h3','Explore further'));
    const buttons=node('div',undefined,'companion-follow-up-buttons');
    for(const suggestion of valid){
      const b=node('button',suggestion);
      b.type='button';b.addEventListener('click',()=>{
        question.value=suggestion;
        lastSearch='';selected.clear();candidates=[];passagesBox.replaceChildren();
        question.focus();updateButtons();
        setStatus('Question ready. Click Ask Reading Companion to retrieve new supporting passages.');
      });
      buttons.append(b);
    }
    box.append(buttons);answerBox.append(box);
  }
  const highlights=Array.isArray(data.evidenceHighlights)?data.evidenceHighlights:[];
  if(highlights.length){
    const panel=node('section',undefined,'companion-highlights');
    panel.append(node('h3','Key passages from the source books'));
    for(const item of highlights.slice(0,3)){
      if(typeof item.quote!=='string'||!item.quote.trim()||
        typeof item.url!=='string')continue;
      const quote=node('blockquote',item.quote);
      const a=document.createElement('a');a.href=item.url;
      a.target='_blank';a.rel='noopener noreferrer';
      a.textContent='['+item.source_id+'] '+item.title+' · PDF p. '+item.page;
      quote.append(document.createTextNode(' '),a);
      panel.append(quote);
    }
    answerBox.append(panel);
  }
  if(citations.length){
    const sources=node('section',undefined,'companion-citations');
    sources.append(node('h3','Sources'));
    for(const source of citations){
      const row=node('p');
      const link=document.createElement('a');link.href=source.url;
      link.target='_blank';link.rel='noopener noreferrer';
      link.textContent='['+source.id+'] '+source.title+' · PDF page '+source.page;
      row.append(link);
      // The original PDF link remains untouched. The new button opens a
      // separate in-page reader using the same trusted v47 book shard.
      const highlight=(Array.isArray(data.evidenceHighlights)?
        data.evidenceHighlights:[]).find(h=>
        h.source_id===source.id&&Number(h.page)===Number(source.page));
      const original=candidates.find(p=>p.bookId===String(source.bookId) &&
        p.page===Number(source.page));
      const excerpt=(typeof highlight?.quote==='string'&&highlight.quote.trim())?
        highlight.quote:(original?.preview||source.preview||'');
      const read=node('button','Read passage here','companion-inline-read');
      read.type='button';
      read.addEventListener('click',async()=>{
        try{
          await sourceReader.open({...source,excerpt},read);
        }catch(error){setStatus('Source reader: '+error.message);}
      });
      row.append(document.createTextNode(' '),read);
      sources.append(row);
    }
    answerBox.append(sources);
  }
  answerBox.append(node('p','Source text verified by SHA-256. AI interpretations still require critical reading.','companion-hint'));
}
async function askQuestion(){
  const q=question.value.trim();
  if(!pilotEnabled){setStatus('Hosted AI answers are not currently enabled.');return;}
  if(!turnstileToken){setStatus('Complete visitor verification before asking.');return;}
  answering=true;updateButtons();sourceReader.reset();answerBox.replaceChildren();
  try{
    if(lastSearch!==q+'|'+bookFilter.value || !selected.size){
      const found=await searchPages();
      if(!found)return;
    }
    const chosen=candidates.filter(s=>selected.has(selectionKey(s))).slice(0,MAX_SELECTED);
    if(!chosen.length){setStatus('Select a relevant passage first.');return;}
    const token=turnstileToken;turnstileToken='';
    setStatus('Verifying original source pages and generating an explanation…');
    const response=await fetch(API+'/api/pilot-answer',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:q,turnstileToken:token,
        sources:chosen.map(({bookId,page,text})=>({bookId,page,text}))})
    });
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Worker returned HTTP '+response.status);
    renderResponse(data);
    setStatus('The verified answer is ready.');
  }catch(error){
    setStatus('The answer could not be completed: '+error.message);
  }finally{
    answering=false;
    if(window.turnstile&&turnstileId!==null)window.turnstile.reset(turnstileId);
    updateButtons();
  }
}
findButton.addEventListener('click',async()=>{
  sourceReader.reset();answerBox.replaceChildren();
  try{await searchPages();}
  catch(error){setStatus('Passage search failed: '+error.message);}
});
form.addEventListener('submit',event=>{event.preventDefault();askQuestion();});
bookFilter.addEventListener('change',()=>{lastSearch='';selected.clear();candidates=[];
  passagesBox.replaceChildren();updateButtons();});
question.addEventListener('input',()=>{lastSearch='';updateButtons();});
for(const b of examples.querySelectorAll('button')){
  b.addEventListener('click',()=>{question.value=b.textContent;
    lastSearch='';candidates=[];selected.clear();passagesBox.replaceChildren();
    question.focus();setStatus('Question ready. Click Find passages or Ask Reading Companion.');
    updateButtons();});
}
(async()=>{await loadCoverage();await loadStatus();setStatus('Choose a question to explore the verified collection.');})();
