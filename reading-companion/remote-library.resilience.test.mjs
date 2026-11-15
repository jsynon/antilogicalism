import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary} from './remote-library.mjs';

// Audit fix C2: below the manifest, corpus load failures degrade and
// are recorded in the search result's loadIssues instead of rejecting
// the whole search and discarding what other files already produced.
const driveId = 'ABCDEFGHIJKLMNOPQRSTUVWXY123456';
const prose = (topic) => ('On ' + topic + ' the author writes at length, weighing ' +
  'courage and honor together and explaining how each shapes the choices ' +
  'a person makes when the outcome is uncertain and the cost is real.').repeat(2);
const corpus = {
  'manifest.json': {
    version: 49, postings_encoding: 'delta-json-v1', prefix_length: 2,
    pages: 3, page_books: [7, 7, 8], partitions: ['co', 'ho'],
    books: {
      '7': {title: 'First Book — Ann Alpha', drive_url: 'https://drive.google.com/file/d/' + driveId + '/view'},
      '8': {title: 'Second Book — Bob Beta', drive_url: 'https://drive.google.com/file/d/' + driveId + '/view'}
    }
  },
  'url-suppressions.json': {scopes: []},
  'terms-co.json': {courage: [0]},
  'terms-ho.json': {honor: [2]},
  'book-7.json': {pages: [
    {id: 0, page: 1, text: prose('the first topic')},
    {id: 1, page: 2, text: prose('a related topic')}]},
  'book-8.json': {pages: [
    {id: 2, page: 1, text: prose('the second topic')}]}
};
const makeLibrary = (failures = new Set()) => new RemoteLibrary(
  'https://example.test/data-v49/', async url => {
    const name = String(url).split('/').pop().replace(/\.gz$/, '');
    if (failures.has(name)) return new Response('Outage', {status: 503});
    return name in corpus
      ? new Response(gzipSync(JSON.stringify(corpus[name])), {status: 200})
      : new Response('Not found', {status: 404});
  });

test('a failed term partition degrades to an empty partition and is recorded (audit fix C2)', async () => {
  const healthy = await makeLibrary().search('courage honor');
  assert.deepEqual([...new Set(healthy.sources.map(s => s.bookId))].sort(), ['7', '8'],
    'the intact corpus answers from both books');
  const degraded = await makeLibrary(new Set(['terms-ho.json'])).search('courage honor');
  assert.deepEqual(degraded.loadIssues, ['partition:ho']);
  assert.ok(degraded.sources.length > 0, 'the surviving partition still produces sources');
  assert.ok(degraded.sources.every(s => s.bookId === '7'),
    'only the failed partition\'s book is missing');
});

test('a failed suppressions file degrades to no suppressions and is recorded (audit fix C2)', async () => {
  const degraded = await makeLibrary(new Set(['url-suppressions.json'])).search('courage honor');
  assert.deepEqual(degraded.loadIssues, ['url-suppressions']);
  assert.deepEqual([...new Set(degraded.sources.map(s => s.bookId))].sort(), ['7', '8'],
    'search proceeds without the secondary policy file');
});

test('a malformed candidate shard is skipped and recorded, keeping earlier books (audit fix C2)', async () => {
  const library = new RemoteLibrary('https://example.test/data-v49/', async url => {
    const name = String(url).split('/').pop().replace(/\.gz$/, '');
    if (name === 'book-8.json') return new Response(gzipSync(JSON.stringify({pages: 'not-an-array'})), {status: 200});
    return name in corpus
      ? new Response(gzipSync(JSON.stringify(corpus[name])), {status: 200})
      : new Response('Not found', {status: 404});
  });
  const result = await library.search('courage honor');
  assert.deepEqual(result.loadIssues, ['shard:8']);
  assert.ok(result.sources.length > 0 && result.sources.every(s => s.bookId === '7'),
    'the well-formed book still contributes its sources');
});
