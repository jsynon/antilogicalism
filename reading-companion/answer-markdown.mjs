// Small, intentionally limited Markdown reader for model answers. Keeping the
// tokenization separate lets tests exercise the exact formatting decisions
// used by the page without depending on browser globals.
const MAX_INLINE_ITALIC_LENGTH=140;

function addText(tokens,text){
 if(!text)return;
 const last=tokens.at(-1);
 if(last?.type==='text')last.value+=text;
 else tokens.push({type:'text',value:text});
}

function findClosingMarker(text,start,marker){
 for(let index=start;index<text.length;index++){
  if(text.startsWith(marker,index))return index;
 }
 return -1;
}

function parseInlineRange(text){
 const tokens=[];let index=0;
 while(index<text.length){
  const pair=text.slice(index,index+2);
  if(pair==='**'||pair==='__'){
   const end=findClosingMarker(text,index+2,pair);
   if(end>index+2){
    tokens.push({type:'strong',children:parseInlineRange(text.slice(index+2,end))});
    index=end+2;continue;
   }
  }
  const marker=text[index];
  if((marker==='*'||marker==='_')&&text[index+1]!==marker){
   let end=-1;
   for(let cursor=index+1;cursor<text.length;cursor++){
    if((marker==='*'&&text.startsWith('**',cursor))||
       (marker==='_'&&text.startsWith('__',cursor))){
     const nestedEnd=findClosingMarker(text,cursor+2,marker+marker);
     if(nestedEnd<0)break;
     cursor=nestedEnd+1;continue;
    }
    if(text[cursor]===marker&&text[cursor+1]!==marker){end=cursor;break;}
   }
   if(end>index+1){
    const inner=text.slice(index+1,end),children=parseInlineRange(inner);
    if(inner.length>MAX_INLINE_ITALIC_LENGTH)tokens.push(...children);
    else tokens.push({type:'em',children});
    index=end+1;continue;
   }
  }
  addText(tokens,marker);index++;
 }
 return tokens;
}

export function parseInlineMarkdown(value){
 return parseInlineRange(String(value||''));
}

// The Worker unwraps whole-paragraph bold at assembly (batch 9, B9-8); this
// is the same rule as a parser backstop for any payload that bypasses it. A
// paragraph counts as long — worth unwrapping — at two or more sentences or
// over 200 characters of inner text, mirroring the Worker's threshold.
//
// Evasion fix (2026-11-15), mirroring the Worker: the clean-pair rule
// refused any paragraph whose wrap contained further bold markers, which
// is exactly the shape that recurred live (a wrapped opening paragraph
// carrying bold label pairs inside it). Two readings, in order: the
// outer pair — paragraph ends with the marker, count even, inner text
// long, every span inside short — loses only its own two markers, so
// internal label and emphasis pairs survive as written; otherwise a
// pairwise span scan unwraps every long span from the opening marker.
// Orphaned single markers on long paragraphs are stripped, as the
// Worker strips them at assembly (the old backstop missed that shape).
function isLongWrappedText(text){
 const sentences=(text.match(/[.!?](?=\s|$)/gu)||[]).length;
 return text.length>200||sentences>=2;
}

function boldSpansOf(text,marker){
 const spans=[];let at=0;
 while(true){
  const open=text.indexOf(marker,at);
  if(open<0)break;
  const close=text.indexOf(marker,open+marker.length);
  if(close<0)break;
  spans.push(text.slice(open+marker.length,close));
  at=close+marker.length;
 }
 return spans;
}

function unwrapBoldWrappedParagraph(text){
 const marker=text.startsWith('**')?'**':text.startsWith('__')?'__':null;
 if(marker){
  if(text.endsWith(marker)&&(text.split(marker).length-1)%2===0){
   const inner=text.slice(marker.length,-marker.length).trim();
   if(inner&&isLongWrappedText(inner)&&
     boldSpansOf(inner,marker).every(span=>!isLongWrappedText(span)))return inner;
  }
  let result='';let rest=text;let unwrapped=0;
  while(rest.startsWith(marker)){
   const close=rest.indexOf(marker,marker.length);
   if(close<0)break;
   const inner=rest.slice(marker.length,close);
   if(!isLongWrappedText(inner))break;
   result+=inner;rest=rest.slice(close+marker.length);unwrapped++;
   const next=rest.indexOf(marker);
   if(next<0){result+=rest;rest='';break;}
   result+=rest.slice(0,next);rest=rest.slice(next);
  }
  if(unwrapped){
   let opened=result+rest;
   if(opened.endsWith(marker)&&(opened.split(marker).length-1)%2===1)
    opened=opened.slice(0,-marker.length);
   return opened;
  }
  if((text.split(marker).length-1)===1&&isLongWrappedText(text.slice(marker.length)))
   return text.slice(marker.length);
  return text;
 }
 const closer=text.endsWith('**')?'**':text.endsWith('__')?'__':null;
 if(closer&&(text.split(closer).length-1)===1&&isLongWrappedText(text.slice(0,-closer.length)))
  return text.slice(0,-closer.length);
 // A single marker stranded mid-paragraph is the boundary of a pair
 // whose other half never shipped — the live-open Kierkegaard case
 // (2026-11-15): a section title whose OPENING marker was lost,
 // leaving its closer glued between the title and the body text.
 // One marker can never form a pair, so on a long paragraph it is
 // removed wherever it sits; paired markers are untouched.
 for(const lone of ['**','__']){
  if((text.split(lone).length-1)===1&&isLongWrappedText(text)){
   const at=text.indexOf(lone);
   if(at>0&&at<text.length-lone.length)
    return text.slice(0,at)+text.slice(at+lone.length);
  }
 }
 return text;
}

function splitInlineListMarkers(line){
 // Split obvious model-emitted list markers when they follow prose on the same
 // line. Two or more spaces after a bullet marker are unambiguous; for the
 // captured single-space form, require a repeated run so an isolated italic
 // phrase is not mistaken for a list item. Bold/underlined labels and numbered
 // items retain their existing, narrower split rule.
 const singleSpaceBullet=/([.!?:])\s+([*+-])\s+(?=\S)/gu;
 const singleSpaceMatches=[...line.matchAll(singleSpaceBullet)];
 const normalized=singleSpaceMatches.length>=2
  ?line.replace(singleSpaceBullet,'$1\n$2 ')
  :line;
 return normalized
  .replace(/([.!?:])\s+(?=(?:[*+-]\s{2,})\S)/g,'$1\n')
  .replace(/([.!?:])\s+(?=(?:[*+-]\s+(?:\*\*|__)|\d+[.)]\s+))/g,'$1\n');
}

function splitInlineSectionHeadings(line){
 // Models sometimes place a bold section title after prose without a newline
 // or trailing colon. Split only at a sentence boundary, and only when the
 // title is a substantial label followed by a new sentence, so ordinary bold
 // emphasis inside a paragraph stays inline.
 return line.replace(/([.!?])\s+(?=(?:\*\*[^*\n]{3,90}:?\*\*|__[^_\n]{3,90}:?__)(?:\s+)(?=[\p{Lu}]))/gu,'$1\n');
}

function inlineHeading(line){
 const match=line.match(/^\s*(?:\*\*([^*\n]{3,90})\*\*|__([^_\n]{3,90})__)(?:\s+)(\S.*)$/u);
 if(!match)return null;
 const title=match[1]??match[2];
 // Bold sentence leads such as “In short,” stay in the paragraph.
 if(/[.!?;,]$/u.test(title.trim()))return null;
 return {title:title.trim().replace(/:$/u,'').trim(),body:match[3].trim()};
}

function cleanListItem(value,line,hasPriorListItem){
 let text=value.trim();
 // Some model answers wrap a run of bullets in one stray outer asterisk pair.
 // Once list markers are separated, the last bullet can retain only the
 // unmatched closing marker; remove it when the run itself establishes that
 // it is list punctuation, not an italic delimiter.
 if(hasPriorListItem&&/^\*\s+\*\*|^\*\s+__/u.test(line)&&/\s\*$/u.test(text))
  text=text.replace(/\s\*$/u,'');
 return text;
}

// Completion (2026-11-15), mirroring the Worker: a line carrying
// exactly ONE bold marker holds the boundary of a pair whose other
// half never shipped — the follow-up run's orphans sat on lines
// glued to the previous section inside blocks full of paired
// markers, where the per-paragraph rule cannot see them. Short
// lines are untouched (a stray label fragment is a different
// shape), and lines of pure marker characters carry no text.
function stripOrphanedLineMarker(line){
 if(line.trim().length<80||!/[A-Za-z0-9]/u.test(line))return line;
 for(const marker of ['**','__']){
  if((line.split(marker).length-1)!==1)continue;
  const at=line.indexOf(marker);
  return line.slice(0,at)+line.slice(at+marker.length);
 }
 return line;
}

// Completion (2026-11-15), mirroring the Worker: a paragraph block
// past the long threshold is re-broken at sentence boundaries into
// paragraphs of at most the target length, so a part composed as
// one flowing block never renders as a wall of text. Wording is
// untouched; abbreviations and initials do not end a sentence.
function splitLongParagraphText(text){
 if(text.length<=1200)return [text];
 const chunks=text.match(/[^.!?]+(?:[.!?]+["'”’)]*(?:\s*\[[^\]]{1,12}\])?|$)/gu)
  ?.map(chunk=>chunk.trim()).filter(Boolean)||[];
 if(chunks.length<2)return [text];
 const sentences=[];
 for(const chunk of chunks){
  const previous=sentences[sentences.length-1];
  if(previous&&/(?:\b(?:Mr|Mrs|Ms|Dr|St|vs|etc|al)|[A-Z])\.$/u.test(previous))
   sentences[sentences.length-1]=previous+' '+chunk;
  else sentences.push(chunk);
 }
 const paragraphs=[];let current='';
 for(const sentence of sentences){
  if(current&&(current.length+1+sentence.length)>700){
   paragraphs.push(current);current='';
  }
  current=current?current+' '+sentence:sentence;
 }
 if(current)paragraphs.push(current);
 return paragraphs.length?paragraphs:[text];
}

export function parseAnswerMarkdown(value,{allowLists=false}={}){
 const blocks=[];let paragraph=[],listItems=[],listType='',listRun=false;
 const flushParagraph=()=>{
  const text=paragraph.join(' ').trim();
  if(text)for(const piece of splitLongParagraphText(text))
   blocks.push({type:'paragraph',text:unwrapBoldWrappedParagraph(piece)});
  paragraph=[];
 };
 const flushList=()=>{
  if(listItems.length){
   if(allowLists)blocks.push({type:'list',ordered:listType==='ol',items:listItems});
   else for(const text of listItems)blocks.push({type:'paragraph',text});
  }
  listItems=[];listType='';
 };
 const flushAll=()=>{flushParagraph();flushList();listRun=false;};
 const rawLines=String(value||'').replace(/\r\n?/g,'\n').split('\n');
 const lines=rawLines.flatMap(line=>splitInlineSectionHeadings(line)
  .split('\n').flatMap(part=>splitInlineListMarkers(part).split('\n')))
  .map(stripOrphanedLineMarker);
 for(const original of lines){
  const line=original.trim();
  if(!line){flushAll();continue;}
  const standalone=line.match(/^(?:#{1,3}\s+(.+?)\s*|\*\*([^*\n]+)\*\*|__([^_\n]+)__)$/u);
  if(standalone){
   const wrappedLine=standalone[2]??standalone[3];
   if(wrappedLine!==undefined&&isLongWrappedText(wrappedLine.trim())){
    // A whole paragraph wrapped in one bold pair on a single line is not a
    // title: keep it as paragraph prose with the pair stripped, so it never
    // renders as one giant heading (batch 9, B9-8 backstop). Short bold
    // title lines still take the heading path below.
    flushAll();paragraph.push(wrappedLine.trim());continue;
   }
   flushAll();blocks.push({type:'heading',text:(standalone[1]??standalone[2]??standalone[3]).trim()});continue;
  }
  const heading=inlineHeading(line);
  if(heading){
   flushAll();blocks.push({type:'heading',text:heading.title});paragraph.push(heading.body);continue;
  }
  const bullet=line.match(/^(?:[*+-]|\d+[.)])\s+(.+?)\s*$/u);
  if(bullet){
   const type=/^\d/u.test(line)?'ol':'ul';
   flushParagraph();
   if(listType&&listType!==type)flushList();
   listType=type;listItems.push(cleanListItem(bullet[1],line,listRun));listRun=true;
   continue;
  }
  if(listRun){
   // A continuation line belongs to the last list item in the run.
   if(listItems.length)listItems[listItems.length-1]+=' '+line;
   else if(paragraph.length)paragraph[paragraph.length-1]+=' '+line;
   else paragraph.push(line);
   continue;
  }
  paragraph.push(line);
 }
 flushAll();
 return blocks;
}
