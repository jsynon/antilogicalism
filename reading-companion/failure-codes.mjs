// Failure-surface helpers for the browser client (audit fix C6: moved
// out of diagnostic-report.mjs when the diagnostic pipeline was
// deleted; both functions are live behavior — the first feeds the
// direct-search fallback decision and the user-facing error message,
// the second translates Worker failure codes into reader prose).

const SAFE_FAILURE_CODE=/^[a-z][a-z0-9-]{0,63}$/;
function isSafeFailureCode(value){
  return typeof value==='string'&&SAFE_FAILURE_CODE.test(value);
}

// The Worker owns the failure-code field and emits stable, non-sensitive
// reason codes. Accept newly introduced codes without requiring a
// synchronized frontend allowlist; reject free-form messages.
export function failureCodeForStatus(status,requestStage='answer',serverCode=''){
  if(isSafeFailureCode(serverCode))return serverCode;
  if(!Number.isInteger(status)||status<100||status>599)return 'network-error';
  if(status===400)return 'request-rejected';
  if(status===401)return 'authorization-rejected';
  if(status===403)return 'visitor-or-origin-rejected';
  if(status===413)return 'request-too-large';
  if(status===422)return 'source-verification-rejected';
  if(status===429)return 'rate-limited';
  if(status===502)return requestStage==='planner'?
    'search-planning-failed':'answer-generation-or-citation-failed';
  if(status===503)return 'service-unavailable';
  return 'http-error';
}

export function userFailureMessage(code=''){
  if(code==='ai-daily-free-allocation')
    return 'Cloudflare Workers AI reported that this account reached its daily free allocation. If this Worker is on a paid Workers account, check that account’s Workers AI billing and usage; paid usage above the free allocation should be billed.';
  if(code==='ai-provider-usage-limit'||code==='ai-credit-limit')
    return 'Cloudflare Workers AI reported a usage or billing limit for the account serving this Worker. Check that account’s Workers AI usage and billing. The Reading Companion cannot verify the account’s plan or spending limit.';
  if(code==='ai-capacity-unavailable')
    return 'The AI service is temporarily at capacity. Please wait a moment and try again.';
  if(code==='ai-rate-limited')
    return 'The AI service is handling too many requests right now. Please wait a moment and try again.';
  return 'Could not prepare the answer. Please try again.';
}
