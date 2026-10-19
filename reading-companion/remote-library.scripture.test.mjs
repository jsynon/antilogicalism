import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary,hasExplicitScriptureReference} from './remote-library.mjs';

const driveId='ABCDEFGHIJKLMNOPQRSTUVWXY123456';
const biblePassage='1 John 4 7 12 Beloved let us love one another because love is from God and God sent his Son.';
const fixture={
 'manifest.json':{
  version:47,postings_encoding:'delta-json-v1',prefix_length:2,
  pages:3,page_books:[16,427,638],
  partitions:['jo','go','lo','an'],
  books:{
   '16':{title:'The City of God — Augustine of Hippo',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '427':{title:'Waiting for God — Simone Weil',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '638':{title:'The New Oxford Annotated Bible, Fully Revised Fifth Edition — edited by Michael D. Coogan',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
  }
 },
 'terms-jo.json':{john:[2]},
 'terms-go.json':{god:[0,1,1]},
 'terms-lo.json':{love:[0,1,1]},
 'terms-an.json':{another:[0,1,1]},
 'book-16.json':{pages:[{id:0,page:218,text:'John says God is love and people love one another in this passage about God and the saints.'}]},
 'book-427.json':{pages:[{id:1,page:112,text:'John says God is love and people love one another in this passage about God and the saints.'}]},
 'book-638.json':{pages:[{id:2,page:1821,text:biblePassage}]}
};

function fakeFetch(url){
 const key=String(url).split('/').pop().replace(/\.gz$/,'');
 return Promise.resolve(key in fixture?
  new Response(gzipSync(JSON.stringify(fixture[key])),{status:200}):
  new Response('Not found',{status:404}));
}

test('explicit Bible book chapter-and-verse references are recognized',()=>{
 assert.equal(hasExplicitScriptureReference('According to 1 John 4:7–12, what does “God is love” mean?'),true);
 assert.equal(hasExplicitScriptureReference('Compare Aristotle, Ethics II.1 with Darwin.'),false);
 assert.equal(hasExplicitScriptureReference('The book of John discusses love.'),false);
});

test('a cited Bible passage outranks topical books in an all-books search',async()=>{
 const library=new RemoteLibrary('https://example.test/v47/',fakeFetch);
 const result=await library.search('1 John 4:7-12 God love another',{maxBooks:2,pagesPerBook:2});
 assert(result.sources.some(source=>source.bookId==='638'&&source.page===1821));
 assert.match(result.sources.find(source=>source.bookId==='638').preview,/love one another/i);
});
