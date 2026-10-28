import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeKnownOcrArtifacts,stripWebCaptureFooters,readableParagraphs,locateCitedExcerpt,readablePageWithHighlight} from './source-text-format.mjs';
import {eligiblePages,renderHighlightedText} from './source-reader.mjs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const client=readFileSync(new URL('./companion-v110.mjs',import.meta.url),'utf8');
const clientV49=readFileSync(new URL('./companion-v112.mjs',import.meta.url),'utf8');
const source=readFileSync(new URL('./source-reader.mjs',import.meta.url),'utf8');

test('returns contiguous readable paragraphs without changing stored OCR text',()=>{
 const raw='One\\r\\nwrapped line on page.\\r\\nAnd the second line.\\r\\n\\r\\nA new paragraph.';
 const fixed=raw.replaceAll('\\r\\n','\r\n');
 assert.deepEqual(readableParagraphs(fixed),[
  'One wrapped line on page. And the second line.',
  'A new paragraph.'
 ]);
 assert.equal(fixed.includes('\r\n'),true,'The original text is not modified');
});
test('normalizes known NKJV OCR ligature substitutions only in the readable display',()=>{
 const raw='9 In this the love of God was manifested toward us, that God has sent His only begoƩen Son into the world, that we might live through Him. 10 In this is love, not that we loved God, but that He loved us and sent His Son to be the propiƟaƟon for our sins. 12 No one has seen God at any Ɵme. James was jusƟﬁed when he oﬀered Isaac; the Scripture was fulﬁlled.';
 const expected=raw.normalize('NFKC').replaceAll('Ɵ','ti').replaceAll('Ʃ','tt');
 assert.equal(normalizeKnownOcrArtifacts(raw,'335'),expected);
 assert.equal(normalizeKnownOcrArtifacts(raw,'638'),raw,'other books retain their exact indexed text');
 assert.match(expected,/James was justified when he offered Isaac; the Scripture was fulfilled/);
 const quote='that He loved us and sent His Son to be the propiƟaƟon for our sins. 12 No one has seen God at any Ɵme';
 const page=readablePageWithHighlight(raw,quote,'335');
 assert(page.match,'highlight matching normalizes both the page and the cited OCR quote');
 assert.equal(page.displayText,expected);
 assert.equal(page.displayText.slice(page.match.start,page.match.end),'that He loved us and sent His Son to be the propitiation for our sins. 12 No one has seen God at any time');
});
test('renders normalized NKJV text as readable paragraphs',()=>{
 const raw='9 In this the love of God was manifested toward us, that God has sent His only begoƩen Son into the world, that we might live through Him.\n\n10 In this is love, not that we loved God, but that He loved us and sent His Son to be the propiƟaƟon for our sins. 12 No one has seen God at any Ɵme.';
 const quote='10 In this is love, not that we loved God, but that He loved us and sent His Son to be the propiƟaƟon for our sins. 12 No one has seen God at any Ɵme';
 const element=tag=>({tag,children:[],append(child){this.children.push(child)},replaceChildren(){this.children=[]},set textContent(value){this._text=String(value);this.children=[]},get textContent(){return this._text??this.children.map(child=>child.textContent||'').join('')}});
 const originalDocument=globalThis.document;
 globalThis.document={createElement:element,createTextNode:value=>({textContent:String(value)})};
 try{
  const readable=element('div');
  const shown=renderHighlightedText(readable,raw,quote,'335');
  assert.equal(shown.matched,true);
  assert.equal(readable.children.length,2,'OCR paragraph breaks remain visible as paragraphs');
  assert.match(readable.textContent,/begotten/);
  assert.match(readable.textContent,/propitiation/);
  assert.match(readable.textContent,/at any time/);
  assert.doesNotMatch(readable.textContent,/begoƩen|propiƟaƟon|Ɵme|jusƟﬁed|oﬀered|fulﬁlled/);
 }finally{
  if(originalDocument===undefined)delete globalThis.document;
  else globalThis.document=originalDocument;
 }
});
test('renders multiple reviewer-approved exact excerpts from a cited page',()=>{
 const first='The first source passage explains how reason supports the opening claim in this paragraph.';
 const second='A separate source passage develops the second claim through a distinct example from history.';
 const raw=first+' '+second;
 const element=tag=>({tag,children:[],append(child){this.children.push(child)},replaceChildren(){this.children=[]},
  set textContent(value){this._text=String(value);this.children=[]},
  get textContent(){return this._text??this.children.map(child=>child.textContent||'').join('')}});
 const originalDocument=globalThis.document;
 globalThis.document={createElement:element,createTextNode:value=>({textContent:String(value)})};
 try{
  const readable=element('div');
  const shown=renderHighlightedText(readable,raw,[
   first,second
  ]);
  const marks=readable.children.flatMap(paragraph=>paragraph.children.filter(child=>child.tag==='mark'));
  assert.equal(shown.matched,true);
  assert.equal(shown.matchCount,2);
  assert.deepEqual(marks.map(mark=>mark.textContent),[
   first.slice(0,-1),second.slice(0,-1)
  ]);
 }finally{
  if(originalDocument===undefined)delete globalThis.document;
  else globalThis.document=originalDocument;
 }
});
test('removes standalone Acrobat capture footers while preserving ordinary web links',()=>{
 const footer='file:///C|/WINDOWS/Desktop/blahh/i.html (4 of 5) [2/20/2001 3:15:45 AM]';
 const quote='See https://example.org/history for more about the original account and its records.';
 const raw=quote+'\n'+footer+'\nA final sentence.';
 assert.equal(stripWebCaptureFooters(raw),quote+'\n\nA final sentence.');
 const page=readablePageWithHighlight(raw,quote);
 assert.match(page.displayText,/https:\/\/example\.org\/history/);
 assert.doesNotMatch(page.displayText,/file:\/\/\/C\|/);
 assert(page.match,'the cited passage still aligns after footer removal');
 const element=tag=>({tag,children:[],append(child){this.children.push(child)},replaceChildren(){this.children=[]},
  set textContent(value){this._text=String(value);this.children=[]},
  get textContent(){return this._text??this.children.map(child=>child.textContent||'').join('')}});
 const originalDocument=globalThis.document;
 globalThis.document={createElement:element,createTextNode:value=>({textContent:String(value)})};
 try{
  const container=element('div');
  const shown=renderHighlightedText(container,raw,quote);
  assert.equal(shown.matched,true,'actual source reader renderer keeps citation highlighting aligned');
  assert.match(container.textContent,/https:\/\/example\.org\/history/);
  assert.doesNotMatch(container.textContent,/file:\/\/\/C\|/);
 }finally{
  if(originalDocument===undefined)delete globalThis.document;
  else globalThis.document=originalDocument;
 }
});
test('identifies an exact quoted evidence passage despite OCR line wrapping',()=>{
 const raw='A short introductory sentence.\nThe nature of virtue and the role of practical wisdom\nin shaping good character and making our lives happy\nbecome clear through the actions a person chooses.';
 const readable=readableParagraphs(raw).join('\n\n');
 const quote='The nature of virtue and the role of practical wisdom in shaping good character and making our lives happy';
 const match=locateCitedExcerpt(readable,'…'+quote+'…');
 assert(match,'Cited passage must be located inside the source text');
 assert.equal(readable.slice(match.start,match.end),quote);
});
test('full-page text formatting returns a safe highlight range for the displayed text',()=>{
 const raw='Opening sentence.\nThe nature of virtue and the role of practical wisdom\n'+
  'in shaping good character and making our lives happy through the choices we make.';
 const quote='The nature of virtue and the role of practical wisdom in shaping good character and making our lives happy';
 const page=readablePageWithHighlight(raw,'…'+quote+'…');
 assert.equal(page.displayText,'Opening sentence. '+
  'The nature of virtue and the role of practical wisdom in shaping good character and making our lives happy through the choices we make.');
 assert(page.match,'the cited passage should be located in the formatted display');
 assert.equal(page.displayText.slice(page.match.start,page.match.end),quote);
 assert.equal(readablePageWithHighlight(raw,'words not present in the source').match,null);
});
test('refuses to make up a highlight where the quoted words are absent',()=>{
 const raw='The city grew stronger from trade and alliances. Its leaders sought a new political order against their rivals.';
 const quote='The nature of virtue and the role of practical wisdom in shaping good character and making our lives happy';
 assert.equal(locateCitedExcerpt(raw,quote),null);
});
test('previous/next reader navigation is defined by actually indexed physical PDF pages',()=>{
 const pages=eligiblePages({pages:[
  {page:13,text:'Book text thirteen'},
  {page:11,text:'Book text eleven'},
  {page:11,text:'Duplicate page'},
  {page:18,text:'Book text eighteen'},
  {page:12,text:''},
  {page:0,text:'Invalid page'}]});
 assert.deepEqual(pages.map(x=>x.page),[11,13,18]);
 assert.match(source,/active\.idx--/);
 assert.match(source,/active\.idx\+\+/);
 assert.match(source,/source\.page/);
});
test('reader is hidden initially, preserves original PDF links, and loads no new AI endpoint',()=>{
 const ids=['companion-source-reader','companion-source-title',
  'companion-source-meta','companion-reader-status',
  'companion-source-prev','companion-source-next','companion-close-source',
  'companion-source-pdf','companion-source-text'];
 for(const id of ids)assert(html.includes('id="'+id+'"'),id+' markup');
 assert.match(html,/id="companion-source-reader"[^>]+hidden/);
 assert.match(client,/Read highlighted passage/);
 assert.match(client,/Read source/);
 assert.match(client,/link\.href=source\.url/);
 assert.doesNotMatch(client,/View full page text|appendFullPage|companion-full-page/);
 assert.match(client,/sourceReader\.open\(\{\.\.\.source,excerpt\},read\)/);
 assert.match(clientV49,/import \{claimQuotesForCitation\} from '\.\/citation-evidence\.mjs'/,
  'the active client must use the exact claim-link helper');
 assert.match(clientV49,/const evidenceMap=Array\.isArray\(data\.evidenceMap\)/);
 assert.match(clientV49,/claimQuotesForCitation\(answer,citationGroup\.start,source\.id,evidenceMap\)/,
  'inline citations must resolve against reviewer-approved evidence for their source');
 assert.doesNotMatch(clientV49,/claimQuotesForCitation\(answer,citationGroup\.start,evidence\)/,
  'the compact page summary must not be an inline-citation fallback');
 assert.match(clientV49,/sourceReader\.open\(\{\.\.\.source,excerpts\},a\)/);
 assert.match(source,/isAllowedBook\(bookId\)/);
 assert.match(source,/getBook\(bookId\)/);
 assert.match(source,/function renderHighlightedText/);
 assert.match(source,/renderHighlightedText\(viewer,page\.text,quotations,source\.bookId\)/);
 assert.match(source,/meta\.textContent='Physical PDF page '\+page\.page/);
 assert.ok(source.includes('The matching cited passages are highlighted in yellow.'));
 assert.doesNotMatch(source,/v47 OCR text formatted as paragraphs|v47 OCR text/);
 assert.match(html,/#companion-pilot \.companion-source-reader\[hidden\]\{display:none!important\}/);
 assert.doesNotMatch(source,/companion-source-quote|quoteBox/);
 assert.doesNotMatch(html,/companion-source-quote|<blockquote/);
 assert.doesNotMatch(source,/originalLayout|original-ocr|companion-source-layout/);
 assert.doesNotMatch(html,/companion-source-layout|Original OCR layout|companion-layout-picker/);
 assert.match(source,/mark\.className='cited-highlight'/);
 assert.doesNotMatch(source,/\/api\/(?:pilot-answer|chat)/);
 assert.doesNotMatch(source,/innerHTML\s*=/);
});
test('reader controls inherit the Book Lite design',()=>{
 assert.match(html,/#companion-pilot\{font:inherit/);
 assert.match(html,/button\.companion-inline-read\{-webkit-appearance:none;appearance:none;display:inline/);
 assert.match(html,/button\.companion-inline-read:focus-visible\{outline:2px solid #111/);
 assert.doesNotMatch(html,/companion-follow-ups|companion-follow-up-buttons/);
 assert.match(html,/mark\.cited-highlight/);
});
