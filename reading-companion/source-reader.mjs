/* v1.10.2 in-page source reader, adapted from the local Reading Companion.
 * It reads canonical v47 shards already hosted on GitHub Pages and only
 * displays excerpts. No AI calls, no secrets, no mutation of cited book text.
 */
import {normalizeKnownOcrArtifacts,stripWebCaptureFooters,readableParagraphs,locateCitedExcerpt} from './source-text-format.mjs';
import {sourceAttributionLabel} from './citation-numbering.mjs';

const PDF=/^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})\/(?:view|preview)(?:[?#]|$)/;
const byId=id=>document.getElementById(id);
const make=(tag,value)=>{
  const el=document.createElement(tag);
  if(value!==undefined)el.textContent=String(value);
  return el;
};
export function eligiblePages(shard){
  if(!Array.isArray(shard?.pages))throw Error('The indexed book is unavailable.');
  const seen=new Set();
  return shard.pages.filter(item=>{
    if(!Number.isSafeInteger(item.page)||item.page<1||item.page>10000||
       typeof item.text!=='string'||!item.text.trim()||seen.has(item.page))return false;
    seen.add(item.page);
    return true;
  }).sort((a,b)=>a.page-b.page);
}
export function renderHighlightedText(container,text,quote,bookId=''){
  const sourceText=normalizeKnownOcrArtifacts(stripWebCaptureFooters(text),bookId);
  const displayQuote=normalizeKnownOcrArtifacts(stripWebCaptureFooters(quote),bookId);
  const paragraphs=readableParagraphs(sourceText);
  const separator='\n\n';
  const display=paragraphs.join(separator);
  const match=displayQuote?locateCitedExcerpt(display,displayQuote):null;
  container.replaceChildren();
  let at=0,firstMark=null;
  for(const paragraph of paragraphs){
    const p=make('p');
    const from=at,to=at+paragraph.length;
    const a=match?Math.max(match.start,from):to;
    const b=match?Math.min(match.end,to):from;
    if(b>a){
      if(a>from)p.append(document.createTextNode(paragraph.slice(0,a-from)));
      const mark=make('mark',paragraph.slice(a-from,b-from));
      mark.className='cited-highlight';
      p.append(mark);
      if(!firstMark)firstMark=mark;
      if(b<to)p.append(document.createTextNode(paragraph.slice(b-from)));
    }else{
      p.textContent=paragraph;
    }
    container.append(p);
    at+=paragraph.length+separator.length;
  }
  return {matched:Boolean(match&&firstMark),mark:firstMark,partial:match?.partial===true};
}
export function createSourceReader({getBook,getManifest,isAllowedBook}){
  const root=byId('companion-source-reader');
  const title=byId('companion-source-title'),meta=byId('companion-source-meta');
  const status=byId('companion-reader-status'),viewer=byId('companion-source-text');
  const previous=byId('companion-source-prev');
  const next=byId('companion-source-next'),close=byId('companion-close-source');
  const pdf=byId('companion-source-pdf');
  if([root,title,meta,status,viewer,previous,next,close,pdf].some(x=>!x))
    throw Error('The in-page source reader markup is missing.');
  let active=null,requestId=0,returnFocus=null;

  function reset({restoreFocus=false}={}){
    ++requestId;root.hidden=true;active=null;viewer.replaceChildren();
    previous.disabled=true;next.disabled=true;pdf.removeAttribute('href');
    if(restoreFocus && returnFocus?.isConnected)returnFocus.focus();
    if(!restoreFocus)returnFocus=null;
  }
  function present(){
    if(!active)return;
    const {source,pages,idx,pdfId}=active;
    const page=pages[idx];
    const onCitedPage=page.page===source.page;
    const quotation=onCitedPage && typeof source.excerpt==='string'?source.excerpt:'';
    title.textContent=source.title||'Original source';
    const attribution=sourceAttributionLabel(source.provenance);
    meta.textContent='Physical PDF page '+page.page+(attribution?' · '+attribution:'');
    const shown=renderHighlightedText(viewer,page.text,quotation,source.bookId);
    if(quotation){
      status.textContent=shown.matched?
        'The matching cited passage is highlighted in yellow.':
        'The excerpt could not be located confidently on this page; no text has been highlighted.';
    }else{
      status.textContent=onCitedPage?'No highlighted passage was supplied for this citation.':
        'Adjacent indexed page — the cited passage is on PDF page '+source.page+'.';
    }
    previous.disabled=idx<=0;
    next.disabled=idx>=pages.length-1;
    pdf.href='https://drive.google.com/file/d/'+pdfId+'/view?usp=sharing#page='+page.page;
    viewer.scrollTop=0;
    if(shown.mark){
      // Scroll within the page-text panel rather than moving the whole site.
      viewer.scrollTop=Math.max(0,shown.mark.offsetTop-viewer.offsetTop-viewer.clientHeight/3);
    }
  }
  async function open(source,trigger=null){
    // Only expose books in the owner-published verified collection. The text is
    // published v47 data, not a generated model quote or a fabricated page.
    const bookId=String(source?.bookId??'');
    if(!/^[1-9]\d{0,3}$/.test(bookId)||!isAllowedBook(bookId)||
       !Number.isSafeInteger(source?.page)||source.page<1||source.page>10000){
      throw Error('This citation is not a supported book/page locator.');
    }
    const token=++requestId;
    if(trigger)returnFocus=trigger;
    root.hidden=false;
    root.scrollIntoView({block:'start',behavior:'smooth'});
    title.textContent='Loading source page…';
    status.textContent='Reading the original indexed book…';
    viewer.replaceChildren();
    previous.disabled=true;next.disabled=true;pdf.removeAttribute('href');
    try{
      const [shard,manifest]=await Promise.all([getBook(bookId),getManifest()]);
      if(token!==requestId)return;
      const pdfMatch=PDF.exec(manifest.books?.[bookId]?.drive_url||'');
      if(!pdfMatch)throw Error('The canonical PDF link is missing.');
      const pages=eligiblePages(shard);
      const idx=pages.findIndex(p=>p.page===source.page);
      if(idx<0)throw Error('The cited physical PDF page is absent from the v47 book shard.');
      active={source,pages,idx,pdfId:pdfMatch[1]};
      present();
      close.focus({preventScroll:true});
    }catch(error){
      if(token!==requestId)return;
      status.textContent='Unable to open indexed source: '+error.message;
      title.textContent='Source unavailable';
      active=null;
    }
  }
  previous.addEventListener('click',()=>{
    if(active&&active.idx>0){active.idx--;present();}
  });
  next.addEventListener('click',()=>{
    if(active&&active.idx+1<active.pages.length){active.idx++;present();}
  });
  close.addEventListener('click',()=>reset({restoreFocus:true}));
  return {open,reset};
}
