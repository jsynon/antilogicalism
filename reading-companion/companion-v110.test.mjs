import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {RemoteLibrary} from './remote-library.mjs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const client=readFileSync(new URL('./companion-v110.mjs',import.meta.url),'utf8');

test('v1.10 retains Book Lite and the site navigation',()=>{
 assert.match(html,/wp-content\/themes\/book-lite/);
 assert.match(html,/id="masthead"/);
 assert.match(html,/id="secondary"/);
 assert.match(html,/companion-v110\.mjs/);
});
test('v1.10 presents a clean ask-and-read flow while preserving answer sections',()=>{
 const answer=client.indexOf('Reading Companion answer');
 const explore=client.indexOf('Explore further',answer);
 const passages=client.indexOf('Key passages from the source books',explore);
 const sources=client.indexOf("'Sources'",passages);
 assert(answer>=0);
 assert(explore>answer);
 assert(passages>explore);
 assert(sources>passages);
 assert.doesNotMatch(html,/companion-suggested-questions|companion-find-button|Review passages/);
 assert.match(html,/id="companion-book-filter"/);
 assert.match(html,/id="companion-question"/);
 assert.doesNotMatch(html,/companion-passage-browser|companion-passage-list/);
 assert.match(client,/companion-follow-up-buttons/);
 assert.match(client,/question\.value=suggestion/);
 assert.match(html,/background:#fff;color:#111;border:1px solid #333/);
});
test('v1.10 uses original v47 retrieval, verified pilot endpoint and text-only output',()=>{
 assert.match(client,/new RemoteLibrary\(\)/);
 assert.match(client,/allowedBookIds:allowed/);
 assert.match(client,/\/api\/pilot-answer/);
 assert.match(client,/\.textContent/);
 assert.doesNotMatch(client,/innerHTML\s*=/);
 assert.doesNotMatch(client,/SOURCE_PROBE_TOKEN|TURNSTILE_SECRET|TEST_TOKEN/);
 assert.equal(typeof RemoteLibrary,'function');
});
test('v1.10 never claims unsupported books are ready if fingerprint index missing',()=>{
 assert.match(client,/oldPilotFallback=true/);
 assert.match(client,/bookList=\[FALLBACK_BOOK\]/);
 assert.match(client,/reader-fingerprints-v1\/coverage-v1\.json/);
});

test('public companion copy explains the pilot and keeps source reading controls',()=>{
 assert.match(html,/Answers draw on passages from the current pilot collection/);
 assert.match(html,/Citations open original PDF pages/);
 assert.match(client,/View full page text/);
 assert.match(client,/Read passage/);
 assert.match(client,/appendFullPage\(card,original\)/);
 assert.match(client,/appendFullPage\(row,original\)/);
 assert.match(html,/id="companion-turnstile" aria-label="Quick check"/);
 assert.match(html,/Complete the quick check below before asking a question/);
 assert.match(client,/turnstile\.render\(challengeBox/);
 assert.match(client,/callback:token=>/);
 assert.doesNotMatch(client,/Checked passages will guide the answer/);
 assert.doesNotMatch(client,/Answer ready below\./);
 assert.doesNotMatch(client,/lastSearch|selected\.size|selectionKey/);
 assert.doesNotMatch(html,/Answer ready below|Checked passages will guide the answer/i);
 assert.doesNotMatch(html,/SHA-256|v47 index|Automatic evidence planning|visitor verification/i);
 assert.doesNotMatch(client,/The verified answer is ready/);
});


test('Book Lite opening drop cap and small-caps apply only to the introductory paragraph',()=>{
 const base='#primary .entry-content #companion-pilot > p:first-child';
 assert(html.includes(base+'::first-line'));
 assert(html.includes(base+'::first-letter'));
 assert.match(html,/font-size:7\.03rem;/);
 assert.match(html,/line-height:43px;/);
 assert.match(html,/margin:9px 5px 0 0;/);
 assert.match(html,/<section id="companion-pilot"[^>]*>\s*<p>Ask questions/);
 assert(!html.includes('#companion-pilot .companion-answer-text::first-letter'));
});
