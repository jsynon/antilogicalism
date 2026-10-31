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

export function parseAnswerMarkdown(value,{allowLists=false}={}){
 const blocks=[];let paragraph=[],listItems=[],listType='',listRun=false;
 const flushParagraph=()=>{
  const text=paragraph.join(' ').trim();
  if(text)blocks.push({type:'paragraph',text});
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
  .split('\n').flatMap(part=>splitInlineListMarkers(part).split('\n')));
 for(const original of lines){
  const line=original.trim();
  if(!line){flushAll();continue;}
  const standalone=line.match(/^(?:#{1,3}\s+(.+?)\s*|\*\*([^*\n]+)\*\*|__([^_\n]+)__)$/u);
  if(standalone){
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
