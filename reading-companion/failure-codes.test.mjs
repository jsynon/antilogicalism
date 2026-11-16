import assert from 'node:assert/strict';
import {test} from 'node:test';
import {failureCodeForStatus,userFailureMessage} from './failure-codes.mjs';

// Moved from diagnostic-report.test.mjs (audit fix C6): the diagnostic
// pipeline is deleted, but the failure-code mapping is live behavior —
// it gates the direct-search fallback and selects the user message.
test('failure codes preserve useful status categories without raw error text',()=>{
 assert.equal(failureCodeForStatus(403),'visitor-or-origin-rejected');
 assert.equal(failureCodeForStatus(422),'source-verification-rejected');
 assert.equal(failureCodeForStatus(429),'rate-limited');
 assert.equal(failureCodeForStatus(502),'answer-generation-or-citation-failed');
 assert.equal(failureCodeForStatus(502,'answer','evidence-review-request-failed'),
   'evidence-review-request-failed');
 // New Worker reason codes survive without a frontend allowlist update.
 assert.equal(failureCodeForStatus(502,'answer','answer-quotation-not-source-verified'),
   'answer-quotation-not-source-verified');
 assert.equal(failureCodeForStatus(502,'answer','PRIVATE MODEL ERROR'),
   'answer-generation-or-citation-failed');
 assert.equal(failureCodeForStatus(502,'planner'),'search-planning-failed');
 assert.equal(failureCodeForStatus(502,'planner','ai-daily-free-allocation'),
   'ai-daily-free-allocation');
 assert.equal(failureCodeForStatus(503),'service-unavailable');
 assert.equal(failureCodeForStatus(null),'network-error');
});

test('user failure messages translate provider codes into reader prose',()=>{
 assert.match(userFailureMessage('ai-daily-free-allocation'),/daily free AI limit/);
 assert.match(userFailureMessage('ai-daily-free-allocation'),/try again tomorrow/);
 assert.match(userFailureMessage('ai-provider-usage-limit'),/AI usage limit/);
 assert.match(userFailureMessage('ai-credit-limit'),/AI usage limit/);
 assert.match(userFailureMessage('ai-capacity-unavailable'),/temporarily at capacity/);
 assert.match(userFailureMessage('ai-rate-limited'),/too many requests/);
 assert.equal(userFailureMessage('network-error'),
   'Could not prepare the answer. Please try again.');
 assert.equal(userFailureMessage(''),'Could not prepare the answer. Please try again.');
});
