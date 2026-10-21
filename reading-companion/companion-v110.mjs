/* Antilogicalism Reading Companion v1.11.0 — staged verified-library alpha.
 * Real indexed v47 passages; no secrets, model keys or paid APIs in this file.
 * The Worker independently validates every submitted source page against v47
 * fingerprints before any inference. The verified scope comes from the
 * owner-published cohort manifest; expanding it does not change v47 OCR.
 */
import {RemoteLibrary,PRODUCTION_PAGES_PER_BOOK} from './remote-library.mjs';
import {createSourceReader} from './source-reader.mjs';
import {readablePageWithHighlight} from './source-text-format.mjs';
import {mergeFacetSearches,validSearchPlan,buildSearchFacets,selectAnswerSources,canFallbackToDirectSearch,matchExplicitBookIds,targetBooksForFacet} from './evidence-search.mjs';
import {auditCitationIds,createDiagnosticReport,diagnosticFailureCode,
  inlineCitationGroups,userFailureMessage} from './diagnostic-report.mjs';
import {filterBooksByText,sortBooksForSelector} from './book-order.mjs';
import {buildCitationNumbering,citationDisplayLabel,sortCitationsByNumber} from './citation-numbering.mjs';

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
const bookSearch=el('companion-book-search');
const bookSearchStatus=el('companion-book-search-status');
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
  answerBox.replaceChildren();
  question.value='';
  newConversationButton.hidden=true;
  diagnosticPanel.hidden=true;
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
  if(!diagnosticState)return;
  diagnosticOutput.textContent=JSON.stringify(createDiagnosticReport(diagnosticState),null,2);
}
function beginDiagnostic(questionText){
  diagnosticState={question:questionText,selectedBookId:bookFilter.value||'all',
    libraryVersion:47,fallbackMode:oldPilotFallback,stage:'planning',
    plannerQueries:[],searches:[],candidates:[],submittedSources:[],
    evidenceHighlights:[],failureHttpStatus:null,failureCode:'',
    plannerWorkerVersionId:null,plannerWorkerVersionTag:null,plannerWorkerVersionTimestamp:null,
    plannerWorkerSourceBuild:null,answerWorkerVersionId:null,answerWorkerVersionTag:null,
    answerWorkerVersionTimestamp:null,answerWorkerSourceBuild:null};
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
  scope.textContent='Verified search scope: '+title+'.';
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
      bookList.length+' books available.';
  }
}
function populateBooks(){
  updateBookOptions();
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
async function retrieveSources(plannedQueries=null,{plannerFallback=false}={}){
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
      // Until the expanded fingerprint publication reaches GitHub Pages, search the
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
      const searches=buildSearchFacets(q,plannedQueries,bookFilter.value);
      const namedBookIds=bookFilter.value?[bookFilter.value]:
        matchExplicitBookIds(q,bookList);
      const targetBookIds=namedBookIds.length?namedBookIds:[null];
      const foundSets=await Promise.all(searches.map(async term=>{
        const facetBookIds=targetBooksForFacet(term,bookList,targetBookIds[0]===null?null:targetBookIds);
        const targeted=await Promise.all(facetBookIds.map(bookId=>
          library.search(term,{...(bookId?{bookId}:{}),allowedBookIds:allowed,
            maxBooks:3,pagesPerBook:PRODUCTION_PAGES_PER_BOOK})));
        return {sources:targeted.flatMap(set=>Array.isArray(set.sources)?set.sources:[])
          .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0))};
      }));

      if(diagnosticState)diagnosticState.searches=foundSets.map((set,index)=>({
        query:searches[index]+(namedBookIds.length?' [named books: '+namedBookIds.join(', ')+']':''),
        resultCount:Array.isArray(set.sources)?set.sources.length:0,
        sources:(set.sources||[]).slice(0,8)
      }));
      // Keep a wider evidence pool for the final passage selector. The
      // verifier still receives at most four full pages; retaining more here
      // lets strong passages survive facet and author-wide diversity ordering.
      const results=foundSets.length>1?
        mergeFacetSearches(foundSets,12).filter(allowedPage):
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
function putCitationTokens(target,answer,citations,evidenceHighlights=[],numbering=new Map()){
  const byId=new Map(citations.map(s=>[s.id,s]));
  const groups=inlineCitationGroups(answer);
  let at=0;
  const appendCitation=(id)=>{
    const source=byId.get(id);
    if(source){
      const a=document.createElement('button');
      a.type='button';
      const label=citationDisplayLabel(id,numbering);
      a.textContent=label;a.className='companion-inline-citation';
      a.title=source.title+' PDF page '+source.page;
      a.setAttribute('aria-label','Open ['+label+'] in the page reader: '+
        source.title+', PDF page '+source.page);
      const evidence=evidenceHighlights.find(item=>item.source_id===source.id&&
        Number(item.page)===Number(source.page));
      a.addEventListener('click',async()=>{
        try{
          await sourceReader.open({...source,excerpt:evidence?.quote||''},a);
        }catch(error){setStatus('Source reader: '+error.message);}
      });
      target.append(a);
    }else target.append(document.createTextNode(citationDisplayLabel(id,numbering)));
  };
  for(const group of groups){
    if(group.start>at)target.append(document.createTextNode(answer.slice(at,group.start)));
    target.append(document.createTextNode('['));
    group.ids.forEach((id,index)=>{
      if(index)target.append(document.createTextNode(', '));
      appendCitation(id);
    });
    target.append(document.createTextNode(']'));
    at=group.end;
  }
  if(at<answer.length)target.append(document.createTextNode(answer.slice(at)));
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
  putCitationTokens(reply,answer,citations,highlights,numbering);
  turn.append(reply);
  if(data.missing)turn.append(node('p','What these passages don’t establish: '+data.missing,'companion-hint'));

  const highlightedSourceKeys=new Set();
  if(highlights.length){
    const panel=node('section',undefined,'companion-highlights');
    panel.append(node('h3','Key passages from the source books'));
    const orderedHighlights=highlights.slice(0,3).sort((a,b)=>
      (numbering.get(String(a.source_id))||Number.MAX_SAFE_INTEGER)-
      (numbering.get(String(b.source_id))||Number.MAX_SAFE_INTEGER));
    for(const item of orderedHighlights){
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
      a.textContent='['+citationDisplayLabel(item.source_id,numbering)+'] '+item.title+' · PDF p. '+item.page;
      const read=node('button','Read passage','companion-inline-read');
      read.type='button';
      read.addEventListener('click',async()=>{
        try{await sourceReader.open({...citation,excerpt:item.quote},read);}
        catch(error){setStatus('Source reader: '+error.message);}
      });
      card.append(quote,a,read);
      panel.append(card);
      highlightedSourceKeys.add(citation.id+'|'+Number(citation.page));
    }
    turn.append(panel);
  }
  const remainingCitations=orderedCitations.filter(source=>
    !highlightedSourceKeys.has(source.id+'|'+Number(source.page)));
  if(remainingCitations.length){
    const sources=node('section',undefined,'companion-citations');
    sources.append(node('h3','Additional sources'));
    for(const source of remainingCitations){
      const row=node('article',undefined,'companion-source-entry');
      const label=node('p');
      const link=document.createElement('a');link.href=source.url;
      link.target='_blank';link.rel='noopener noreferrer';
      link.textContent='['+citationDisplayLabel(source.id,numbering)+'] '+source.title+' · PDF page '+source.page;
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
      sources.append(row);
    }
    turn.append(sources);
  }
  turn.append(node('p','Citations link to the original PDF pages. Scanned text and interpretations can contain errors.','companion-hint'));
  if(diagnosticState){
    diagnosticState.stage='complete';
    diagnosticState.outcome=data.outcome;
    diagnosticState.coverage=data.coverage;
    diagnosticState.reviewStatus=data.reviewStatus;
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
    }
    throw Error(data.error||'Evidence search planning is unavailable');
  }
  if(!validSearchPlan(data.queries)){
    if(diagnosticState)diagnosticState.failureCode='search-planning-failed';
    throw Error('The evidence search plan was incomplete.');
  }
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
async function askQuestion(questionText){
  const q=String(questionText??question.value).trim();
  if(answering)return;
  if(questionText!==undefined)question.value=q;
  if(!pilotEnabled){setStatus('Answering is temporarily unavailable.');return;}
  if(q.length<5||q.length>400){setStatus('Please enter a question of 5–400 characters.');return;}
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
      let queries=null,plannerFallback=false;
      try{queries=await requestSourcePlan(q,token,history);}
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
      if(queries)setStatus('Gathering passages from across the collection…');
      const found=await retrieveSources(queries,{plannerFallback});
      if(!found)return;
      token=await nextTurnstileToken();
    }else{
      const found=await retrieveSources();
      if(!found)return;
    }
    const chosen=selectAnswerSources(candidates,q,token,{history,
      plannedFacetCount:Math.max(0,(diagnosticState?.searches?.length||0)-1)});
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
        history,
        sources:chosen.map(({bookId,page,text})=>({bookId,page,text}))})
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
    rememberTurn(q,data.answer||'');
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
newConversationButton.addEventListener('click',startNewConversation);
form.addEventListener('submit',event=>{event.preventDefault();askQuestion();});
question.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.shiftKey||event.isComposing)return;
  event.preventDefault();
  if(!askButton.disabled)form.requestSubmit(askButton);
});
bookSearch.addEventListener('input',updateBookOptions);
bookFilter.addEventListener('change',()=>{
  if(bookFilter.value===''){
    bookSearch.value='';
    updateBookOptions();
  }
  updateButtons();
});
question.addEventListener('input',updateButtons);
(async()=>{await loadCoverage();await loadStatus();})();
