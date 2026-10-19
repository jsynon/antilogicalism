import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readableParagraphs,locateCitedExcerpt} from './source-text-format.mjs';
import {eligiblePages} from './source-reader.mjs';

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
test('identifies an exact quoted evidence passage despite OCR line wrapping',()=>{
 const raw='A short introductory sentence.\nThe nature of virtue and the role of practical wisdom\nin shaping good character and making our lives happy\nbecome clear through the actions a person chooses.';
 const readable=readableParagraphs(raw).join('\n\n');
 const quote='The nature of virtue and the role of practical wisdom in shaping good character and making our lives happy';
 const match=locateCitedExcerpt(readable,'…'+quote+'…');
 assert(match,'Cited passage must be located inside the source text');
 assert.equal(readable.slice(match.start,match.end),quote);
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
 assert.match(client,/Read passage here/);
 assert.match(client,/label\.append\(link\);row\.append\(label\)/);
 assert.match(client,/appendFullPage\(row,original\)/);
 assert.match(client,/appendFullPage\(card,original\)/);
 assert.match(source,/isAllowedBook\(bookId\)/);
 assert.match(source,/getBook\(bookId\)/);
 assert.doesNotMatch(source,/\/api\/(?:pilot-answer|chat)/);
 assert.doesNotMatch(source,/innerHTML\s*=/);
});
test('reader and follow-up controls inherit the Book Lite design',()=>{
 assert.match(html,/#companion-pilot\{font:inherit/);
 assert.match(html,/\.companion-inline-read\{font-family:inherit;font-size:\.89em/);
 assert.match(html,/\.companion-follow-up-buttons button\{background:#fff;color:#111/);
 assert.match(html,/mark\.cited-highlight/);
});
