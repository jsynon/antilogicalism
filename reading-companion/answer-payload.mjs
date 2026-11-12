/* Pilot-answer submission payload for the live browser client.
 *
 * Serializes the bounded candidate packet for POST /api/pilot-answer. Each
 * source carries retrieval's per-facet ranks (stamped by evidence-search) so
 * the Worker's deterministic packing can reserve slots for each facet's
 * rank-1 anchor pages. Ranks are normalized to exactly {facet, rank}; a
 * source with no ranks sends no facetRanks key at all, which the Worker
 * treats as "no ranks" (absent ranks = no key). This mirrors the evaluation
 * harness's pilotAnswerSources in live-answer-evaluation.mjs so the live
 * client and the harness submit the identical source shape.
 */
export function pilotAnswerSources(candidates){
 return (Array.isArray(candidates)?candidates:[]).map(({bookId,page,text,candidatePartIds,facetRanks})=>({bookId,page,text,
  ...(Array.isArray(candidatePartIds)?{candidatePartIds}:{}),
  ...(Array.isArray(facetRanks)?{facetRanks:facetRanks.map(({facet,rank})=>({facet,rank}))}:{}),
  libraryVersion:49}));
}
