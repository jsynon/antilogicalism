/* Antilogicalism Reading Companion v1.12.0 — staged verified-library alpha.
 * Real indexed v48 passages; no secrets, model keys or paid APIs in this file.
 * The Worker independently validates every submitted source page against v48
 * fingerprints before any inference. The verified scope comes from the
 * owner-published cohort manifest; expanding it does not change v48 OCR.
 */
import {RemoteLibrary} from './remote-library.mjs';
import {createSourceReader} from './source-reader.mjs';
import {readablePageWithHighlight} from './source-text-format.mjs';
import {validSearchPlan,selectAnswerSources,canFallbackToDirectSearch,retrieveEvidence} from './evidence-search.mjs';
import {auditCitationIds,createDiagnosticReport,diagnosticFailureCode,
  inlineCitationGroups,userFailureMessage} from './diagnostic-report.mjs';
import {filterBooksByText,sortBooksForSelector} from './book-order.mjs';
import {buildCitationNumbering,citationDisplayLabel,sortCitationsByNumber,sourceAttributionLabel} from './citation-numbering.mjs';

const ROOT='https://jsynon.github.io/antilogicalism-library-data/';
const API='https://antilogicalism-companion-public.jsynon.workers.dev';
const FALLBACK_BOOK={id:'152',title:'History of the Peloponnesian War — Thucydides'};
const PDF_PAGE_LIMIT=14000;
const MAX_ANSWER_SOURCES=6;
const el=id=>document.getElementById(id);
const question=el('companion-question');
const form=el('companion-question-form');
if(!form)throw Error('Reading Companion markup is missing');
const bookFilter=el('companion-book-filter');
const bookSearch=el('companion-book-search');
const bookSearchStatus=el('companion-book-search-status');
const askButton=el('companion-ask-button');
const answerBox=el('companion-answer');
const status=el('companion-status');
const challenge=el('companion-challenge');
const challengeBox=el('companion-turnstile');
const diagnosticPanel=el('companion-diagnostic-panel');
const diagnosticToggle=el('companion-diagnostic-toggle');
const diagnosticDetails=el('companion-diagnostic-details');
const diagnosticOutput=el('companion-diagnostic-output');
const diagnosticCopy=el('companion-diagnostic-copy');
const diagnosticCopyStatus=el('companion-diagnostic-copy-status');
const newConversationButton=el('companion-new-conversation');
const library=new RemoteLibrary();
const sourceShards=new Map();
const sourceReader=createSourceReader({getBook:id=>bookShard(id),
  getManifest:()=>library.manifest(),isAllowedBook:id=>allowed.has(id)});
let bookList=[FALLBACK_BOOK], allowed=new Set(['152']), oldPilotFallback=true;
let pilotEnabled=false, searchPlanningEnabled=false, turnstileToken='', turnstileId=null;
let pendingTurnstile=null;
let candidates=[], searching=false, answering=false;
let diagnosticState=null;
let conversationHistory=[];
let conversationBookScope='';

function boundedHistoryMessage(role,content){
  let text=String(content||'').trim();
  if(text.length>700){
    text=text.slice(0,700);
    const end=Math.max(text.lastIndexOf('. '),text.lastIndexOf('? '),text.lastIndexOf('! '));
    if(end>250)text=text.slice(0,end+1);
    else text=text.slice(0,text.lastIndexOf(' ')).trim();
  }
  return {role,content:text};
}
function recentConversation(){return conversationHistory.slice(-6);}
function rememberTurn(questionText,answerText){
  conversationHistory.push(boundedHistoryMessage('user',questionText),
    boundedHistoryMessage('assistant',answerText));
  conversationHistory=conversationHistory.slice(-6);
  if(newConversationButton)newConversationButton.hidden=false;
}
function startNewConversation(){
  if(answering)return;
  conversationHistory=[];
  conversationBookScope=bookFilter.value||'all';
  answerBox.replaceChildren();
  question.value='';
  newConversationButton.hidden=true;
  if(diagnosticPanel)diagnosticPanel.hidden=true;
  sourceReader.reset();
  setStatus('New conversation started.');
  updateButtons();
}

function node(tag,textValue,className){
  const e=document.createElement(tag);
  if(textValue!==undefined)e.textContent=String(textValue);
  if(className)e.className=className;
  return e;
}
function refreshStatusState(){
  const busy=Boolean(status.textContent.trim())&&(searching||answering);
  status.classList.toggle('is-busy',busy);
  status.setAttribute('aria-busy',String(busy));
}
function setStatus(message){status.textContent=message;refreshStatusState();}
function refreshDiagnostic(){
  if(!diagnosticState||!diagnosticOutput)return;
  diagnosticOutput.textContent=JSON.stringify(createDiagnosticReport(diagnosticState),null,2);
}
function beginDiagnostic(questionText){
  diagnosticState={question:questionText,selectedBookId:bookFilter.value||'all',
    libraryVersion:48,fallbackMode:oldPilotFallback,stage:'planning',
    plannerQueries:[],searches:[],candidates:[],submittedSources:[],
    evidenceHighlights:[],failureHttpStatus:null,failureCode:'',
    failureStage:null,failureProviderClass:null,failureProviderCode:null,
    failureAnswerCharacters:null,failureDetail:null,
    plannerWorkerVersionId:null,plannerWorkerVersionTag:null,plannerWorkerVersionTimestamp:null,
    plannerWorkerSourceBuild:null,answerWorkerVersionId:null,answerWorkerVersionTag:null,
    answerWorkerVersionTimestamp:null,answerWorkerSourceBuild:null};
  if(diagnosticPanel&&diagnosticToggle&&diagnosticDetails&&diagnosticCopyStatus){
    diagnosticPanel.hidden=false;
    diagnosticToggle.checked=false;
    diagnosticDetails.hidden=true;
    diagnosticDetails.open=false;
    diagnosticCopyStatus.textContent='';
    refreshDiagnostic();
  }
}
function updateButtons(){
  askButton.disabled=searching||answering||!pilotEnabled||!turnstileToken||question.value.trim().length<5;
  askButton.textContent=searching||answering?'Working…':'Ask Reading Companion';
  if(newConversationButton)newConversationButton.disabled=answering;
  refreshStatusState();
}
function updateBookOptions(){
  const previous=bookFilter.value;
  const query=bookSearch.value.trim();
  const matches=filterBooksByText(bookList,query);
  const selected=bookList.find(book=>book.id===previous);
  bookFilter.replaceChildren(new Option('All books',''));
  if(selected&&!matches.some(book=>book.id===selected.id))
    bookFilter.append(new Option('Current selection: '+selected.title,selected.id));
  for(const book of matches){
    if(selected&&book.id===selected.id)continue;
    bookFilter.append(new Option(book.title,book.id));
  }
  bookFilter.value=previous;
  if(bookSearchStatus){
    bookSearchStatus.textContent=query?
      (matches.length?matches.length+' matching books.':'No matching books.'):
      '';
  }
}
function populateBooks(){
  updateBookOptions();
}
async function loadCoverage(){
  try{
    const response=await fetch(ROOT+'reader-fingerprints-v2/coverage-v2.json',{cache:'no-store'});
    if(!response.ok)throw Error('The v48 fingerprint collection is not available yet.');
    const index=await response.json();
    if(index.schema!=='antilogicalism-reader-coverage-v2'||
       index.libraryVersion!==48||!index.books||typeof index.books!=='object')
      throw Error('Unexpected fingerprint coverage index');
    const list=sortBooksForSelector(Object.entries(index.books)
      .filter(([id,book])=>/^[1-9]\d{0,3}$/.test(id)&&book&&
        typeof book.title==='string'&&book.title.trim()&&
        Number.isSafeInteger(book.pages)&&book.pages>0&&
        Number.isSafeInteger(book.chunks)&&book.chunks>0)
      .map(([id,book])=>({id,title:book.title}))
      );
    if(!list.length)throw Error('No verified books are published yet.');
    bookList=list;
    allowed=new Set(list.map(x=>x.id));
    oldPilotFallback=false;
  }catch{
    // Preserve the previously verified sample until a valid owner-published
    // coverage manifest is available; do not pretend unlisted books have
    // fingerprints.
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
async function retrieveSources(plannedQueries=null,{plannerFallback=false,plan=null,partQuestions=[]}={}){
  const q=question.value.trim();
  if(q.length<5||q.length>400)throw Error('Please enter a question of 5–400 characters.');
  candidates=[];
  if(diagnosticState)diagnosticState.stage='retrieving';
  searching=true;updateButtons();setStatus(plannerFallback?
    'Search planning is temporarily unavailable; searching directly with your question…':
    'Searching for relevant passages…');
  try{
    let populated=[];
    if(oldPilotFallback){
      // If the v48 fingerprint collection cannot be loaded, search the
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
      const retrieval=await retrieveEvidence({question:q,
        queries:plannerFallback||!plannedQueries?[q]:plannedQueries,
        partQuestions,
        partQueries:!plannerFallback&&Array.isArray(plan?.parts)?plan.parts.flatMap(part=>
          (Array.isArray(part.searchQueries)&&part.searchQueries.length?part.searchQueries:[part.question])
            .map(query=>({partId:part.id,query}))):[],
        directFallback:plannerFallback||!plannedQueries,
        library,books:bookList,allowedBookIds:allowed,
        selectedBookIds:bookFilter.value?[bookFilter.value]:[],allowedPage,
        maxCandidates:12,pageLimit:PDF_PAGE_LIMIT,
        pageLoader:async source=>{
          const shard=await bookShard(source.bookId);
          const page=shard.pages?.find(item=>item.id===source.globalPageId&&item.page===source.page);
          return page&&typeof page.text==='string'?{text:page.text}:null;
        }});
      populated=retrieval.candidates;
      if(diagnosticState){
        diagnosticState.searches=retrieval.searches;
      }
      if(diagnosticState&&plan)diagnosticState.plannerPlan=plan;
    }
    candidates=populated.slice(0,12);
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
function appendCitationTokens(target,answer,citations,evidenceHighlights=[],numbering=new Map()){
  const byId=new Map(citations.map(s=>[s.id,s]));
  const groups=inlineCitationGroups(answer);
  let at=0;
  const appendCitation=(id,citationGroup)=>{
    const source=byId.get(id);
    if(source){
      const a=document.createElement('button');
      a.type='button';
      const label=citationDisplayLabel(id,numbering);
      a.textContent=label;a.className='companion-inline-citation';
      const attribution=sourceAttributionLabel(source.provenance);
      a.title=source.title+' PDF page '+source.page+(attribution?' · '+attribution:'');
      a.setAttribute('aria-label','Open ['+label+'] in the page reader: '+
        source.title+', PDF page '+source.page+(attribution?'. '+attribution:''));
      const evidence=evidenceHighlights.find(item=>item.source_id===source.id&&
        Number(item.page)===Number(source.page));
      a.addEventListener('click',async()=>{
        try{
          await sourceReader.open({...source,excerpt:evidence?.quote||''},a);
        }catch(error){setStatus('Source reader: '+error.message);}
      });
      citationGroup.append(a);
    }else citationGroup.append(document.createTextNode(citationDisplayLabel(id,numbering)));
  };
  for(const group of groups){
    if(group.start>at)target.append(document.createTextNode(answer.slice(at,group.start)));
    const citationGroup=document.createElement('span');
    citationGroup.style.whiteSpace='nowrap';
    citationGroup.append(document.createTextNode('['));
    group.ids.forEach((id,index)=>{
      if(index)citationGroup.append(document.createTextNode(', '));
      appendCitation(id,citationGroup);
    });
    citationGroup.append(document.createTextNode(']'));
    target.append(citationGroup);
    at=group.end;
  }
  if(at<answer.length)target.append(document.createTextNode(answer.slice(at)));
}
function putCitationTokens(target,answer,citations,evidenceHighlights=[],numbering=new Map()){
  const pattern=/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_/g;
  let at=0;
  for(const match of answer.matchAll(pattern)){
    if(match.index>at)appendCitationTokens(target,answer.slice(at,match.index),
      citations,evidenceHighlights,numbering);
    const isBold=match[1]!==undefined||match[2]!==undefined;
    const formatted=document.createElement(isBold?'strong':'em');
    appendCitationTokens(formatted,match[1]??match[2]??match[3]??match[4],
      citations,evidenceHighlights,numbering);
    target.append(formatted);
    at=match.index+match[0].length;
  }
  if(at<answer.length)appendCitationTokens(target,answer.slice(at),
    citations,evidenceHighlights,numbering);
}
function putMarkdownBlocks(target,answer,citations,evidenceHighlights=[],numbering=new Map()){
  let paragraph=[];
  let list=null;
  let listType='';
  const flushParagraph=()=>{
    if(!paragraph.length)return;
    const p=document.createElement('p');
    putCitationTokens(p,paragraph.join(' ').trim(),citations,evidenceHighlights,numbering);
    target.append(p);
    paragraph=[];
  };
  for(const line of String(answer).replace(/\r\n?/g,'\n').split('\n')){
    const bullet=line.match(/^\s*(?:[*+-]|\d+[.)])\s+(.+?)\s*$/);
    if(bullet){
      flushParagraph();
      const nextListType=/^\s*\d/.test(line)?'ol':'ul';
      if(!list||listType!==nextListType){
        list=document.createElement(nextListType);
        target.append(list);
        listType=nextListType;
      }
      const item=document.createElement('li');
      putCitationTokens(item,bullet[1],citations,evidenceHighlights,numbering);
      list.append(item);
      continue;
    }
    if(!line.trim()){
      flushParagraph();
      continue;
    }
    list=null;
    listType='';
    paragraph.push(line);
  }
  flushParagraph();
}
function renderResponse(data,turnQuestion=''){
  const turn=node('article',undefined,'companion-turn');
  if(turnQuestion)turn.append(node('p','Question: '+turnQuestion,'companion-turn-question'));
  const citations=Array.isArray(data.citations)?data.citations:[];
  const answer=String(data.answer||'');
  const numbering=buildCitationNumbering(answer,citations);
  const orderedCitations=sortCitationsByNumber(citations,numbering);
  const highlights=Array.isArray(data.evidenceHighlights)?data.evidenceHighlights:[];
  turn.append(node('h2',data.outcome==='insufficient-evidence'?
    'Insufficient evidence':'Reading Companion answer'));
  const reply=node('div',undefined,'companion-answer-text');
  putMarkdownBlocks(reply,answer,citations,highlights,numbering);
  turn.append(reply);
  if(orderedCitations.length){
    const panel=node('section',undefined,'companion-highlights');
    panel.append(node('h3','Key passages from the source books'));
    for(const source of orderedCitations){
      const highlight=highlights.find(item=>
        item.source_id===source.id&&Number(item.page)===Number(source.page));
      const excerpt=(typeof highlight?.quote==='string'&&highlight.quote.trim())?
        highlight.quote:'';
      const card=node('article',undefined,'companion-key-passage');
      const quote=node('p',excerpt||'No verified passage highlight is available for this citation.',
        'companion-key-quote');
      const link=document.createElement('a');link.href=source.url;
      link.target='_blank';link.rel='noopener noreferrer';
      link.textContent='['+citationDisplayLabel(source.id,numbering)+'] '+source.title+' · p. '+source.page;
      const attribution=sourceAttributionLabel(source.provenance);
      if(attribution)card.append(node('p',attribution,'companion-source-attribution'));
      const read=node('button','Read passage','companion-inline-read');
      read.type='button';
      read.addEventListener('click',async()=>{
        try{await sourceReader.open({...source,excerpt},read);}
        catch(error){setStatus('Source reader: '+error.message);}
      });
      card.append(quote,link,read);
      panel.append(card);
    }
    turn.append(panel);
  }
  if(diagnosticState){
    diagnosticState.stage='complete';
    diagnosticState.outcome=data.outcome;
    diagnosticState.coverage=data.coverage;
    diagnosticState.reviewStatus=data.reviewStatus;
    diagnosticState.pipeline=data.pipeline||null;
    diagnosticState.usage=data.usage||null;
    diagnosticState.reviewedEvidence=data.evidenceMap;
    diagnosticState.questionParts=data.questionParts;
    diagnosticState.answer=data.answer;
    diagnosticState.citations=citations;
    diagnosticState.evidenceHighlights=highlights.map(item=>{
      const source=citations.find(s=>s.id===item.source_id&&Number(s.page)===Number(item.page));
      const original=sourcePage(source);
      const page=original?readablePageWithHighlight(original.text,item.quote):null;
      return {source_id:item.source_id,page:Number(item.page),quote:item.quote,
        quoteLocated:Boolean(page?.match),partialMatch:page?.match?.partial===true};
    });
    refreshDiagnostic();
  }
  answerBox.append(turn);
  const reduceMotion=window.matchMedia&&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  turn.scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'start'});
}
async function requestSourcePlan(q,verificationToken,history){
  if(diagnosticState)diagnosticState.stage='planning';
  const res=await fetch(API+'/api/pilot-plan',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:q,bookId:bookFilter.value,history,
      turnstileToken:verificationToken})
  });
  let data;
  try{data=await res.json();}catch{
    if(diagnosticState)diagnosticState.failureCode='invalid-response';
    throw Error('The evidence search service returned an invalid response.');
  }
  if(diagnosticState){
    diagnosticState.plannerWorkerVersionId=data.workerVersionId;
    diagnosticState.plannerWorkerVersionTag=data.workerVersionTag;
    diagnosticState.plannerWorkerVersionTimestamp=data.workerVersionTimestamp;
    diagnosticState.plannerWorkerSourceBuild=data.workerSourceBuild;
    refreshDiagnostic();
  }
  if(!res.ok){
    if(diagnosticState){
      diagnosticState.failureHttpStatus=res.status;
      diagnosticState.failureCode=diagnosticFailureCode(res.status,'planner',data.failureCode);
      diagnosticState.failureProviderClass=data.failureProviderClass||null;
      diagnosticState.failureProviderCode=data.failureProviderCode||null;
    }
    throw Error(data.error||'Evidence search planning is unavailable');
  }
  if(!validSearchPlan(data.queries)){
    if(diagnosticState)diagnosticState.failureCode='search-planning-failed';
    throw Error('The evidence search plan was incomplete.');
  }
  const plan=data.plan&&typeof data.plan==='object'&&!Array.isArray(data.plan)?data.plan:null;
  if(diagnosticState){diagnosticState.plannerQueries=data.queries;
    diagnosticState.plannerPlan=plan;refreshDiagnostic();}
  return {queries:data.queries,plan};
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
async function askQuestion(questionText){
  const q=String(questionText??question.value).trim();
  if(answering)return;
  if(questionText!==undefined)question.value=q;
  if(!pilotEnabled){setStatus('Answering is temporarily unavailable.');return;}
  if(q.length<5||q.length>400){setStatus('Please enter a question of 5–400 characters.');return;}
  const currentScope=bookFilter.value||'all';
  let partQuestions=[];
  if(conversationBookScope&&conversationBookScope!==currentScope)conversationHistory=[];
  conversationBookScope=currentScope;
  beginDiagnostic(q);
  answering=true;updateButtons();sourceReader.reset();
  try{
    let token=turnstileToken;
    if(!token)token=await nextTurnstileToken();
    const history=recentConversation();
    if(searchPlanningEnabled && !oldPilotFallback){
      // One extra bounded hosted AI call helps FIND source passages, not
      // invent answers. It consumes a single-use Turnstile token. A SECOND
      // fresh verification is required for the fingerprint-protected answer.
      turnstileToken='';
      setStatus('Looking across the collection for useful passages…');
      let planned=null,plannerFallback=false;
      try{planned=await requestSourcePlan(q,token,history);}
      catch(error){
        if(!canFallbackToDirectSearch(diagnosticState?.failureHttpStatus,
          diagnosticState?.failureCode))throw error;
        plannerFallback=true;
        if(diagnosticState){
          diagnosticState.fallbackMode=true;
          diagnosticState.failureHttpStatus=null;
          diagnosticState.failureCode='';
        }
      }
      partQuestions=Array.isArray(planned?.plan?.parts)?planned.plan.parts.map(part=>
        ({partId:part.id,question:part.question,sourceBookIds:part.sourceBookIds})):[];
      if(planned)setStatus('Gathering passages from across the collection…');
      const found=await retrieveSources(planned?.queries||null,{plannerFallback,
        plan:planned?.plan||null,partQuestions});
      if(!found)return;
      token=await nextTurnstileToken();
    }else{
      const found=await retrieveSources();
      if(!found)return;
    }
    const chosen=selectAnswerSources(candidates,q,token,{history,
      maxSources:MAX_ANSWER_SOURCES,
      plannedFacetCount:Math.max(0,(diagnosticState?.searches?.length||0)-1),
      partQuestions});
    if(!chosen.length){setStatus('No matching passages found. Try different wording or choose another book.');return;}
    if(diagnosticState){
      diagnosticState.submittedSources=chosen.map((source,index)=>({...source,id:'S'+(index+1)}));
      diagnosticState.stage='answering';
      refreshDiagnostic();
    }
    turnstileToken='';
    setStatus('Preparing an answer from the selected passages… This can take a little while.');
    const response=await fetch(API+'/api/pilot-answer',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:q,turnstileToken:token,
        history,bookId:bookFilter.value||'',plan:diagnosticState?.plannerPlan||undefined,
        sources:chosen.map(({bookId,page,text,candidatePartIds})=>({bookId,page,text,candidatePartIds}))})
    });
    let data;
    try{data=await response.json();}catch{
      if(diagnosticState)diagnosticState.failureCode='invalid-response';
      throw Error('The answer service returned an invalid response.');
    }
    if(diagnosticState){
      diagnosticState.answerWorkerVersionId=data.workerVersionId;
      diagnosticState.answerWorkerVersionTag=data.workerVersionTag;
      diagnosticState.answerWorkerVersionTimestamp=data.workerVersionTimestamp;
      diagnosticState.answerWorkerSourceBuild=data.workerSourceBuild;
      refreshDiagnostic();
    }
    if(!response.ok){
      if(diagnosticState){
        diagnosticState.failureHttpStatus=response.status;
        diagnosticState.failureCode=diagnosticFailureCode(response.status,'answer',data.failureCode);
        diagnosticState.failureProviderClass=data.failureProviderClass||null;
        diagnosticState.failureProviderCode=data.failureProviderCode||null;
        diagnosticState.failureStage=data.failureStage;
        diagnosticState.failureProviderClass=data.failureProviderClass;
        diagnosticState.failureAnswerCharacters=data.failureAnswerCharacters;
        diagnosticState.failureDetail=data.failureDetail;
      }
      throw Error('The answer service could not prepare an answer.');
    }
    const responseCitations=Array.isArray(data.citations)?data.citations:[];
    const citationAudit=auditCitationIds(data.answer,responseCitations);
    if(citationAudit.inlineIdsWithoutSource.length){
      if(diagnosticState){
        diagnosticState.stage='failed';
        diagnosticState.failureCategory='answer-integrity-failed';
        diagnosticState.failureCode='citation-source-mismatch';
        diagnosticState.outcome=data.outcome;
        diagnosticState.coverage=data.coverage;
        diagnosticState.reviewStatus=data.reviewStatus;
        diagnosticState.reviewedEvidence=data.evidenceMap;
        diagnosticState.answer=data.answer;
        diagnosticState.citations=responseCitations;
        diagnosticState.evidenceHighlights=Array.isArray(data.evidenceHighlights)?
          data.evidenceHighlights.map(item=>({source_id:item.source_id,
            page:Number(item.page),quote:item.quote,quoteLocated:false,partialMatch:false})):[];
        refreshDiagnostic();
      }
      setStatus('The answer included citations without matching sources. Please try again.');
      return;
    }
    renderResponse(data,q);
    if(data.outcome==='verified-source-draft'&&typeof data.answer==='string'&&data.answer.trim())
      rememberTurn(q,data.answer);
    setStatus(data.outcome==='insufficient-evidence'?
      'These passages don’t provide enough evidence for a complete answer. Try different wording or choose another book.':'');
  }catch(error){
    console.error('Reading Companion request failed:',error);
    if(diagnosticState){
      const stage=diagnosticState.stage;
      diagnosticState.stage='failed';
      diagnosticState.failureCategory=stage==='planning'?'planner-request-failed':
        stage==='retrieving'?'retrieval-failed':'answer-request-failed';
      if(!diagnosticState.failureCode)
        diagnosticState.failureCode=stage==='retrieving'?'retrieval-error':'network-error';
      refreshDiagnostic();
    }
    setStatus(userFailureMessage(diagnosticState?.failureCode));
  }finally{
    answering=false;
    if(window.turnstile&&turnstileId!==null)window.turnstile.reset(turnstileId);
    updateButtons();
  }
}
if(diagnosticToggle&&diagnosticDetails)diagnosticToggle.addEventListener('change',()=>{
  diagnosticDetails.hidden=!diagnosticToggle.checked;
  if(diagnosticToggle.checked){diagnosticDetails.open=true;refreshDiagnostic();}
});
if(diagnosticCopy&&diagnosticOutput&&diagnosticCopyStatus)diagnosticCopy.addEventListener('click',async()=>{
  try{
    await navigator.clipboard.writeText(diagnosticOutput.textContent);
    diagnosticCopyStatus.textContent='Diagnostic report copied.';
  }catch{
    diagnosticCopyStatus.textContent='Copy is unavailable here. You can select and copy the report text below.';
  }
});
newConversationButton.addEventListener('click',startNewConversation);
form.addEventListener('submit',event=>{event.preventDefault();askQuestion();});
question.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.shiftKey||event.isComposing)return;
  event.preventDefault();
  if(!askButton.disabled)form.requestSubmit(askButton);
});
bookSearch.addEventListener('input',updateBookOptions);
bookFilter.addEventListener('change',()=>{
  const nextScope=bookFilter.value||'all';
  if(conversationBookScope&&conversationBookScope!==nextScope){
    conversationHistory=[];
    setStatus('Book scope changed; conversation context cleared.');
  }
  conversationBookScope=nextScope;
  if(bookFilter.value===''){
    bookSearch.value='';
    updateBookOptions();
  }
  updateButtons();
});
question.addEventListener('input',updateButtons);
(async()=>{await loadCoverage();await loadStatus();})();

