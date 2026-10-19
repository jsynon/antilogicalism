/* Antilogicalism Reading Companion v1.10.0 — browser retrieval only.
 * Real indexed v47 passages; no secrets, model keys or paid APIs in this file.
 * The Worker independently validates every submitted source page against v47
 * fingerprints before any inference. This is a four-book release, not 644 yet.
 */
import {RemoteLibrary} from './remote-library.mjs';
import {createSourceReader} from './source-reader.mjs';
import {readablePageWithHighlight} from './source-text-format.mjs';
import {mergeFacetSearches,validSearchPlan} from './evidence-search.mjs';
import {createDiagnosticReport} from './diagnostic-report.mjs';
import {matchingBooks} from './book-filter.mjs';

const ROOT='https://jsynon.github.io/antilogicalism-library-data/';
const API='https://antilogicalism-companion-public.jsynon.workers.dev';
const FALLBACK_BOOK={id:'152',title:'History of the Peloponnesian War — Thucydides'};
const PDF_PAGE_LIMIT=14000;
const MAX_ANSWER_SOURCES=2;
const el=id=>document.getElementById(id);
const question=el('companion-question');
const form=el('companion-question-form');
if(!form)throw Error('Reading Companion markup is missing');
const bookFilter=el('companion-book-filter');
const bookFinder=el('companion-book-finder');
const bookCount=el('companion-book-count');
const askButton=el('companion-ask-button');
const answerBox=el('companion-answer');
const status=el('companion-status');
const scope=el('companion-scope');
const challenge=el('companion-challenge');
const challengeBox=el('companion-turnstile');
const diagnosticPanel=el('companion-diagnostic-panel');
const diagnosticToggle=el('companion-diagnostic-toggle');
const diagnosticDetails=el('companion-diagnostic-details');
const diagnosticOutput=el('companion-diagnostic-output');
const diagnosticCopy=el('companion-diagnostic-copy');
const diagnosticCopyStatus=el('companion-diagnostic-copy-status');
const library=new RemoteLibrary();
const sourceShards=new Map();
const sourceReader=createSourceReader({getBook:id=>bookShard(id),
  getManifest:()=>library.manifest(),isAllowedBook:id=>allowed.has(id)});
let bookList=[FALLBACK_BOOK], allowed=new Set(['152']), oldPilotFallback=true;
let pilotEnabled=false, searchPlanningEnabled=false, turnstileToken='', turnstileId=null;
let pendingTurnstile=null;
let candidates=[], searching=false, answering=false;
let diagnosticState=null;

function node(tag,textValue,className){
  const e=document.createElement(tag);
  if(textValue!==undefined)e.textContent=String(textValue);
  if(className)e.className=className;
  return e;
}
function setStatus(message){status.textContent=message;}
function refreshDiagnostic(){
  if(!diagnosticState)return;
  diagnosticOutput.textContent=JSON.stringify(createDiagnosticReport(diagnosticState),null,2);
}
function beginDiagnostic(questionText){
  diagnosticState={question:questionText,selectedBookId:bookFilter.value||'all',
    libraryVersion:47,fallbackMode:oldPilotFallback,stage:'planning',
    plannerQueries:[],searches:[],candidates:[],submittedSources:[],
    evidenceHighlights:[]};
  diagnosticPanel.hidden=false;
  diagnosticToggle.checked=false;
  diagnosticDetails.hidden=true;
  diagnosticDetails.open=false;
  diagnosticCopyStatus.textContent='';
  refreshDiagnostic();
}
function showAvailability(){
  const title=oldPilotFallback?'a Thucydides sample':
    bookList.length+' books across philosophy, history, science, and literature';
  scope.textContent='Pilot collection: '+title+'.';
}
function updateButtons(){
  askButton.disabled=searching||answering||!pilotEnabled||!turnstileToken||question.value.trim().length<5;
}
function populateBooks(){
  const selected=bookFilter.value;
  const matches=matchingBooks(bookList,bookFinder?.value||'');
  bookFilter.replaceChildren(new Option('All pilot books',''));
  if(selected&&!matches.some(book=>book.id===selected)){
    const current=bookList.find(book=>book.id===selected);
    if(current)bookFilter.append(new Option(current.title+' (selected)',current.id));
  }
  for(const book of matches)bookFilter.append(new Option(book.title,book.id));
  if(selected)bookFilter.value=selected;
  if(bookCount){
    const query=bookFinder?.value.trim()||'';
    bookCount.textContent=query?
      'Showing '+matches.length+' of '+bookList.length+' pilot books.':
      bookList.length+' pilot '+(bookList.length===1?'book':'books')+' available.';
  }
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
    // Preserve the previously verified sample until GitHub Actions exports
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
    searchPlanningEnabled=data.searchPlanning===true;
    pilotEnabled=data.enabled===true && typeof data.turnstileSiteKey==='string' &&
      data.turnstileSiteKey.length>10;
    if(!pilotEnabled){
      challenge.textContent='You can browse the books, but answering is temporarily unavailable.';
      return;
    }
    challenge.textContent='Complete the quick check below before asking a question.';
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async=true;
    script.onload=()=>{
      if(!window.turnstile){challenge.textContent='The quick check could not start. Please reload the page.';return;}
      turnstileId=window.turnstile.render(challengeBox,{
        sitekey:data.turnstileSiteKey,action:'companion_ask',theme:'light',
        callback:token=>{
          turnstileToken=token;
          if(pendingTurnstile){
            const waiter=pendingTurnstile;
            pendingTurnstile=null;clearTimeout(waiter.timeout);
            waiter.resolve(token);
          }
          updateButtons();
        },
        'expired-callback':()=>{turnstileToken='';updateButtons();},
        'error-callback':()=>{turnstileToken='';updateButtons();}
      });
    };
    script.onerror=()=>{challenge.textContent='The quick check is temporarily unavailable.';};
    document.head.appendChild(script);
  }catch{
    challenge.textContent='You can browse the books. Answering is temporarily unavailable.';
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
async function retrieveSources(plannedQueries=null){
  const q=question.value.trim();
  if(q.length<5||q.length>400)throw Error('Please enter a question of 5–400 characters.');
  candidates=[];
  if(diagnosticState)diagnosticState.stage='retrieving';
  searching=true;updateButtons();setStatus('Searching for relevant passages…');
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
      if(diagnosticState)diagnosticState.searches=[{query:q,
        resultCount:populated.length,sources:populated.slice(0,8)}];
    }else{
      const searches=validSearchPlan(plannedQueries)?plannedQueries:[q];
      const foundSets=await Promise.all(searches.map(term=>library.search(term,{
        bookId:bookFilter.value,allowedBookIds:allowed,maxBooks:2,
        pagesPerBook:3
      })));
      if(diagnosticState)diagnosticState.searches=foundSets.map((set,index)=>({
        query:searches[index],resultCount:Array.isArray(set.sources)?set.sources.length:0,
        sources:(set.sources||[]).slice(0,8)
      }));
      const results=foundSets.length>1?
        mergeFacetSearches(foundSets,8).filter(allowedPage):
        foundSets[0].sources.filter(allowedPage);
      // Preserve one page for each distinct facet before filling from other
      // candidates. The answer uses the strongest two verified full pages.
      const representatives=[],others=[],visited=new Set();
      for(const r of results){
        const group=plannedQueries?String(r.facet):r.bookId;
        if(visited.has(group))others.push(r);
        else {visited.add(group);representatives.push(r);}
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
    if(diagnosticState){
      diagnosticState.candidates=candidates;
      diagnosticState.stage=candidates.length?'sources_retrieved':'no_matches';
      if(!candidates.length)diagnosticState.outcome='no-matching-passages';
      refreshDiagnostic();
    }
    if(!candidates.length){
      setStatus('No matching passages found. Try different wording or choose another book.');
      return false;
    }
    setStatus('Checking the source passages…');
    return true;
  }finally{searching=false;updateButtons();}
}
function sourcePage(source){
  if(!source)return null;
  return candidates.find(page=>page.bookId===String(source.bookId) &&
    page.page===Number(source.page))||null;
}
function appendFullPage(parent,source,excerpt=''){
  if(!source||typeof source.text!=='string'||!source.text.trim())return;
  const details=document.createElement('details');
  details.className='companion-page-text';
  const summary=node('summary','View full page text');
  const full=node('pre',undefined,'companion-full-page');
  const page=readablePageWithHighlight(source.text,excerpt);
  let note=null;
  if(page.match){
    const {start,end}=page.match;
    if(start>0)full.append(document.createTextNode(page.displayText.slice(0,start)));
    const mark=node('mark',page.displayText.slice(start,end),'cited-highlight');
    full.append(mark);
    if(end<page.displayText.length)
      full.append(document.createTextNode(page.displayText.slice(end)));
  }else{
    full.textContent=page.displayText;
    if(excerpt.trim())note=node('p',
      'The cited words could not be matched confidently in this page text, so no highlight is shown.',
      'companion-hint');
  }
  if(page.match?.partial)note=node('p',
    'Only the matching part of the cited passage appears on this page.',
    'companion-hint');
  details.append(summary,full);
  if(note)details.append(note);
  parent.append(details);
}
function putCitationTokens(target,answer,citations,evidenceHighlights=[]){
  const byId=new Map(citations.map(s=>[s.id,s]));
  const pattern=/\[(S[1-9]\d*)\]/g;
  let at=0,match;
  while((match=pattern.exec(answer))!==null){
    if(match.index>at)target.append(document.createTextNode(answer.slice(at,match.index)));
    const source=byId.get(match[1]);
    if(source){
      const a=document.createElement('button');
      a.type='button';
      a.textContent=match[0];a.className='companion-inline-citation';
      a.title=source.title+' PDF page '+source.page;
      a.setAttribute('aria-label','Open '+match[0]+' in the page reader: '+
        source.title+', PDF page '+source.page);
      const evidence=evidenceHighlights.find(item=>item.source_id===source.id&&
        Number(item.page)===Number(source.page));
      a.addEventListener('click',async()=>{
        try{
          await sourceReader.open({...source,excerpt:evidence?.quote||''},a);
        }catch(error){setStatus('Source reader: '+error.message);}
      });
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
  const highlights=Array.isArray(data.evidenceHighlights)?data.evidenceHighlights:[];
  answerBox.append(node('h2',data.outcome==='insufficient-evidence'?
    'Insufficient evidence':'Reading Companion answer'));
  const reply=node('div',undefined,'companion-answer-text');
  putCitationTokens(reply,String(data.answer||''),citations,highlights);
  answerBox.append(reply);
  if(data.missing)answerBox.append(node('p','What these passages don’t establish: '+data.missing,'companion-hint'));

  // Keep the familiar Reader Mode order: Explore further, Key passages,
  // then Sources. These follow-up buttons are separate from the removed
  // suggested-question buttons above the question form.
  const followUps=Array.isArray(data.followUpQuestions)?data.followUpQuestions:[];
  const valid=followUps.filter(s=>typeof s==='string' && s.length<=180 &&
     s.endsWith('?')).slice(0,2);
  if(valid.length){
    const box=node('section',undefined,'companion-follow-ups');
    box.append(node('h3','Explore further'));
    const buttons=node('div',undefined,'companion-follow-up-buttons');
    for(const suggestion of valid){
      const button=node('button',suggestion);
      button.type='button';
      button.addEventListener('click',()=>{
        question.value=suggestion;
        question.focus();updateButtons();
      });
      buttons.append(button);
    }
    box.append(buttons);answerBox.append(box);
  }
  if(highlights.length){
    const panel=node('section',undefined,'companion-highlights');
    panel.append(node('h3','Key passages from the source books'));
    for(const item of highlights.slice(0,3)){
      if(typeof item.quote!=='string'||!item.quote.trim()||
        typeof item.url!=='string')continue;
      const citation=citations.find(source=>source.id===item.source_id&&
        Number(source.page)===Number(item.page));
      if(!citation)continue;
      const original=sourcePage(citation);
      const card=node('article',undefined,'companion-key-passage');
      const quote=node('p',item.quote,'companion-key-quote');
      const a=document.createElement('a');a.href=item.url;
      a.target='_blank';a.rel='noopener noreferrer';
      a.textContent='['+item.source_id+'] '+item.title+' · PDF p. '+item.page;
      const read=node('button','Read passage','companion-inline-read');
      read.type='button';
      read.addEventListener('click',async()=>{
        try{await sourceReader.open({...citation,excerpt:item.quote},read);}
        catch(error){setStatus('Source reader: '+error.message);}
      });
      card.append(quote,a,read);
      appendFullPage(card,original,item.quote);
      panel.append(card);
    }
    answerBox.append(panel);
  }
  if(citations.length){
    const sources=node('section',undefined,'companion-citations');
    sources.append(node('h3','Sources'));
    for(const source of citations){
      const row=node('article',undefined,'companion-source-entry');
      const label=node('p');
      const link=document.createElement('a');link.href=source.url;
      link.target='_blank';link.rel='noopener noreferrer';
      link.textContent='['+source.id+'] '+source.title+' · PDF page '+source.page;
      label.append(link);row.append(label);
      // The original PDF link remains untouched. The new button opens a
      // separate in-page reader using the same trusted v47 book shard.
      const highlight=(Array.isArray(data.evidenceHighlights)?
        data.evidenceHighlights:[]).find(h=>
        h.source_id===source.id&&Number(h.page)===Number(source.page));
      const original=sourcePage(source);
      const excerpt=(typeof highlight?.quote==='string'&&highlight.quote.trim())?
        highlight.quote:(original?.preview||source.preview||'');
      const read=node('button','Read passage','companion-inline-read');
      read.type='button';
      read.addEventListener('click',async()=>{
        try{
          await sourceReader.open({...source,excerpt},read);
        }catch(error){setStatus('Source reader: '+error.message);}
      });
      row.append(read);
      appendFullPage(row,original,highlight?.quote||'');
      sources.append(row);
    }
    answerBox.append(sources);
  }
  answerBox.append(node('p','Citations link to the original PDF pages. Scanned text and interpretations can contain errors.','companion-hint'));
  if(diagnosticState){
    diagnosticState.stage='complete';
    diagnosticState.outcome=data.outcome;
    diagnosticState.coverage=data.coverage;
    diagnosticState.reviewStatus=data.reviewStatus;
    diagnosticState.answer=data.answer;
    diagnosticState.citations=citations;
    diagnosticState.evidenceHighlights=highlights.map(item=>{
      const source=citations.find(s=>s.id===item.source_id&&Number(s.page)===Number(item.page));
      const original=sourcePage(source);
      const page=original?readablePageWithHighlight(original.text,item.quote):null;
      return {source_id:item.source_id,page:Number(item.page),
        quoteLocated:Boolean(page?.match),partialMatch:page?.match?.partial===true};
    });
    refreshDiagnostic();
  }
}
async function requestSourcePlan(q,verificationToken){
  if(diagnosticState)diagnosticState.stage='planning';
  const res=await fetch(API+'/api/pilot-plan',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:q,bookId:bookFilter.value,
      turnstileToken:verificationToken})
  });
  let data;
  try{data=await res.json();}catch{throw Error('The evidence search service returned an invalid response.');}
  if(!res.ok)throw Error(data.error||'Evidence search planning is unavailable');
  if(!validSearchPlan(data.queries))throw Error('The evidence search plan was incomplete.');
  if(diagnosticState){diagnosticState.plannerQueries=data.queries;refreshDiagnostic();}
  return data.queries;
}
async function nextTurnstileToken(){
  if(!window.turnstile||turnstileId===null)
    throw Error('The quick check needs to be reloaded.');
  if(pendingTurnstile)throw Error('The quick check is already in progress.');
  turnstileToken='';
  const pending=new Promise((resolve,reject)=>{
    const waiter={resolve,reject,timeout:null};
    waiter.timeout=setTimeout(()=>{
      if(pendingTurnstile===waiter){
        pendingTurnstile=null;
        reject(Error('The quick check took too long. Please try again.'));
      }
    },120000);
    pendingTurnstile=waiter;
  });
  setStatus('Complete the quick check to continue.');
  window.turnstile.reset(turnstileId);
  challengeBox.scrollIntoView({behavior:'smooth',block:'center'});
  const token=await pending;
  if(typeof token!=='string'||token.length<5)
    throw Error('Please complete the quick check.');
  return token;
}
async function askQuestion(){
  const q=question.value.trim();
  if(!pilotEnabled){setStatus('Answering is temporarily unavailable.');return;}
  if(!turnstileToken){setStatus('Complete the quick check before asking.');return;}
  beginDiagnostic(q);
  answering=true;updateButtons();sourceReader.reset();answerBox.replaceChildren();
  try{
    let token=turnstileToken;
    if(searchPlanningEnabled && !oldPilotFallback){
      // One extra bounded hosted AI call helps FIND source passages, not
      // invent answers. It consumes a single-use Turnstile token. A SECOND
      // fresh verification is required for the fingerprint-protected answer.
      turnstileToken='';
      setStatus('Looking across the collection for useful passages…');
      const queries=await requestSourcePlan(q,token);
      setStatus('Gathering passages from across the collection…');
      const found=await retrieveSources(queries);
      if(!found)return;
      token=await nextTurnstileToken();
    }else{
      const found=await retrieveSources();
      if(!found)return;
    }
    const chosen=candidates.slice(0,MAX_ANSWER_SOURCES);
    if(!chosen.length){setStatus('No matching passages found. Try different wording or choose another book.');return;}
    if(diagnosticState){
      diagnosticState.submittedSources=chosen.map((source,index)=>({...source,id:'S'+(index+1)}));
      diagnosticState.stage='answering';
      refreshDiagnostic();
    }
    turnstileToken='';
    setStatus('Checking the source passages and preparing your answer…');
    const response=await fetch(API+'/api/pilot-answer',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:q,turnstileToken:token,
        sources:chosen.map(({bookId,page,text})=>({bookId,page,text}))})
    });
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Worker returned HTTP '+response.status);
    renderResponse(data);
    setStatus(data.outcome==='insufficient-evidence'?
      'These passages don’t provide enough evidence for a complete answer. Try different wording or choose another book.':'');
  }catch(error){
    console.error('Reading Companion request failed:',error);
    if(diagnosticState){
      const stage=diagnosticState.stage;
      diagnosticState.stage='failed';
      diagnosticState.failureCategory=stage==='planning'?'planner-request-failed':
        stage==='retrieving'?'retrieval-failed':'answer-request-failed';
      refreshDiagnostic();
    }
    setStatus('Could not prepare the answer. Please try again.');
  }finally{
    answering=false;
    if(window.turnstile&&turnstileId!==null)window.turnstile.reset(turnstileId);
    updateButtons();
  }
}
diagnosticToggle.addEventListener('change',()=>{
  diagnosticDetails.hidden=!diagnosticToggle.checked;
  if(diagnosticToggle.checked){diagnosticDetails.open=true;refreshDiagnostic();}
});
diagnosticCopy.addEventListener('click',async()=>{
  try{
    await navigator.clipboard.writeText(diagnosticOutput.textContent);
    diagnosticCopyStatus.textContent='Diagnostic report copied.';
  }catch{
    diagnosticCopyStatus.textContent='Copy is unavailable here. You can select and copy the report text below.';
  }
});
form.addEventListener('submit',event=>{event.preventDefault();askQuestion();});
bookFilter.addEventListener('change',updateButtons);
bookFinder?.addEventListener('input',populateBooks);
question.addEventListener('input',updateButtons);
(async()=>{await loadCoverage();await loadStatus();})();
