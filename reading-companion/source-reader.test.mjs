import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeKnownOcrArtifacts,readableParagraphs,locateCitedExcerpt,readablePageWithHighlight} from './source-text-format.mjs';
import {eligiblePages,renderHighlightedText} from './source-reader.mjs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const client=readFileSync(new URL('./companion-v110.mjs',import.meta.url),'utf8');
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
 const raw='9 In this the love of God was manifested toward us, that God has sent His only begoƩen Son into the world, that we might live through Him. 10 In this is love, not that we loved God, but that He loved us and sent His Son to be the propiƟaƟon for our sins. 12 No one has seen God at any Ɵme.';
 const expected=raw.replaceAll('begoƩen','begotten').replaceAll('propiƟaƟon','propitiation').replaceAll('Ɵme','time');
 assert.equal(normalizeKnownOcrArtifacts(raw,'335'),expected);
 assert.equal(normalizeKnownOcrArtifacts(raw,'638'),raw,'other books retain their exact indexed text');
 const quote='that He loved us and sent His Son to be the propiƟaƟon for our sins. 12 No one has seen God at any Ɵme';
 const page=readablePageWithHighlight(raw,quote,'335');
 assert(page.match,'highlight matching normalizes both the page and the cited OCR quote');
 assert.equal(page.displayText,expected);
 assert.equal(page.displayText.slice(page.match.start,page.match.end),'that He loved us and sent His Son to be the propitiation for our sins. 12 No one has seen God at any time');
});
test('renders normalized NKJV text while retaining raw OCR layout',()=>{
 const raw='9 In this the love of God was manifested toward us, that God has sent His only begoƩen Son into the world, that we might live through Him.\\n\\n10 In this is love, not that we loved God, but that He loved us and sent His Son to be the propiƟaƟon for our sins. 12 No one has seen God at any Ɵme.';
 const quote='10 In this is love, not that we loved God, but that He loved us and sent His Son to be the propiƟaƟon for our sins. 12 No one has seen God at any Ɵme';
 const element=tag=>({tag,children:[],classList:{toggle(){}},append(child){this.children.push(child)},replaceChildren(){this.children=[]},set textContent(value){this._text=String(value);this.children=[]},get textContent(){return this._text??this.children.map(child=>child.textContent||'').join('')}});
 const originalDocument=globalThis.document;
 globalThis.document={createElement:element,createTextNode:value=>({textContent:String(value)})};
 try{
  const readable=element('div');
  const shown=renderHighlightedText(readable,raw,quote,false,'335');
  assert.equal(shown.matched,true);
  assert.match(readable.textContent,/begotten/);
  assert.match(readable.textContent,/propitiation/);
  assert.match(readable.textContent,/at any time/);
  const original=element('div');
  const rawShown=renderHighlightedText(original,raw,quote,true,'335');
  assert.equal(rawShown.matched,true);
  assert.match(original.textContent,/begoƩen/);
  assert.match(original.textContent,/propiƟaƟon/);
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
  'companion-source-meta','companion-source-quote','companion-reader-status',
  'companion-source-prev','companion-source-next','companion-close-source',
  'companion-source-pdf','companion-source-layout','companion-source-text'];
 for(const id of ids)assert(html.includes('id="'+id+'"'),id+' markup');
 assert.match(html,/id="companion-source-reader"[^>]+hidden/);
 assert.match(client,/Read passage/);
 assert.match(client,/label\.append\(link\);row\.append\(label\)/);
 assert.doesNotMatch(client,/View full page text|appendFullPage|companion-full-page/);
 assert.match(client,/sourceReader\.open\(\{\.\.\.source,excerpt\},read\)/);
 assert.match(source,/isAllowedBook\(bookId\)/);
 assert.match(source,/getBook\(bookId\)/);
 assert.match(source,/function renderHighlightedText/);
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
