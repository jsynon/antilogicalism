import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary,explicitScriptureReferences,hasExplicitScriptureReference} from './remote-library.mjs';

const driveId='ABCDEFGHIJKLMNOPQRSTUVWXY123456';
const biblePassage='1 John 4 7 12 Beloved let us love one another because love is from God and God sent his Son.';
const fixture={
 'manifest.json':{
  version:48,postings_encoding:'delta-json-v1',prefix_length:2,
  pages:5,page_books:[16,427,638,639,335],
  partitions:['jo','go','lo','an'],
  books:{
   '16':{title:'The City of God — Augustine of Hippo',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '427':{title:'Waiting for God — Simone Weil',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '638':{title:'The New Oxford Annotated Bible, Fully Revised Fifth Edition — edited by Michael D. Coogan',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '639':{title:'The New Oxford Annotated Bible, Fourth Edition — edited by Michael D. Coogan',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
   '335':{title:'New King James Version Bible — Various authors',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
  }
 },
 'terms-jo.json':{john:[2,1,1]},
 'terms-go.json':{god:[0,1,1,1,1]},
 'terms-lo.json':{love:[0,1,1,1,1]},
 'terms-an.json':{another:[0,1,1,1,1]},
 'book-16.json':{pages:[{id:0,page:218,text:'John says God is love and people love one another in this passage about God and the saints.'}]},
 'book-427.json':{pages:[{id:1,page:112,text:'John says God is love and people love one another in this passage about God and the saints.'}]},
 'book-638.json':{pages:[{id:2,page:1821,text:'Study notes for 1 John 4:7-12 explain that God is love and believers love one another.'}]},
 'book-639.json':{pages:[{id:3,page:2169,text:'Annotated notes for 1 John 4:7-12 explain that God is love and believers love one another.'}]},
 'book-335.json':{pages:[{id:4,page:5546,text:biblePassage}]}
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
 assert.deepEqual(explicitScriptureReferences('Read James 2:14–26 and John 3:16.'),
  ['James 2:14–26','John 3:16']);
});

test('a cited Bible passage prefers unannotated verse text over topical and annotated books',async()=>{
 const library=new RemoteLibrary('https://example.test/v48/',fakeFetch);
 const result=await library.search('1 John 4:7-12 God love another',{maxBooks:2,pagesPerBook:2});
 assert(result.sources.some(source=>source.bookId==='335'&&source.page===5546));
 assert.match(result.sources.find(source=>source.bookId==='335').preview,/love one another/i);
});

test('a James chapter-and-verse question cannot be narrowed to William James works',async()=>{
 const jamesFixture={
  'manifest.json':{
   version:48,postings_encoding:'delta-json-v1',prefix_length:2,
   pages:2,page_books:[39,335],partitions:['fa'],
   books:{
    '39':{title:'The Will to Believe — William James',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'},
    '335':{title:'New King James Version Bible — Various authors',drive_url:'https://drive.google.com/file/d/'+driveId+'/view'}
   }
  },
  'terms-fa.json':{faith:[0,1]},
  'book-39.json':{pages:[{id:0,page:12,text:'William James discusses religious faith and practical belief in his philosophical writing.'}]},
  'book-335.json':{pages:[{id:1,page:5546,text:'James 2 14 My brethren what does it profit if someone says he has faith but does not have works? Faith without works is dead. Abraham and Rahab illustrate this teaching.'}]}
 };
 const library=new RemoteLibrary('https://example.test/v48/',url=>{
  const key=String(url).split('/').pop().replace(/\.gz$/,'');
  return Promise.resolve(key in jamesFixture?
   new Response(gzipSync(JSON.stringify(jamesFixture[key])),{status:200}):
   new Response('Not found',{status:404}));
 });
 const result=await library.search(
  'According to James 2:14–26, how does James relate faith to works, and what do Abraham and Rahab illustrate?',
  {maxBooks:2,pagesPerBook:2});
 assert(result.sources.length>0);
 assert.equal(result.sources[0].bookId,'335');
 assert.match(result.sources.find(source=>source.bookId==='335').preview,/Abraham and Rahab/i);
});
