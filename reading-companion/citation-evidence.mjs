import {inlineCitationGroups} from './diagnostic-report.mjs';

/* Match an inline citation to the reviewed evidence for its own answer claim.
 * The compact page-summary highlights are for source cards; they are not a
 * safe fallback when a sentence's quote was left out of that summary.
 */
function normalizeClaimAnchor(value){
  return String(value||'').normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

export function claimQuotesForCitation(answer,citationStart,sourceId,evidenceMap=[]){
  const sourceQuotes=(Array.isArray(evidenceMap)?evidenceMap:[]).filter(item=>
    String(item?.id||'')===String(sourceId||'')&&item?.quoteVerified===true&&
    typeof item?.claimId==='string'&&item.claimId.trim()&&
    typeof item?.point==='string'&&item.point.trim()&&
    typeof item?.quote==='string'&&item.quote.trim());
  if(!sourceQuotes.length)return [];

  const before=String(answer||'').slice(0,Math.max(0,Number(citationStart)||0)).trimEnd();
  const sentence=(before.split(/(?:[.!?]+\s+|\n+)/u).at(-1)||before)
    .replace(/\[\s*S\d+(?:\s*,\s*S\d+)*\s*\]/gu,' ').trim();
  const anchor=normalizeClaimAnchor(sentence);
  if(!anchor)return [];

  // The Worker sets point to the composer's exact claim text. Normalization
  // ignores punctuation and citation markup, but avoids fuzzy matching that
  // could attach a sentence to a neighboring claim on the same page.
  const linked=sourceQuotes.filter(item=>{
    const point=normalizeClaimAnchor(item.point);
    return point&&point===anchor;
  });
  const claimIds=[...new Set(linked.map(item=>item.claimId))];
  if(claimIds.length!==1)return [];

  // Return only verified quotes for the matched claim and citation source.
  // The source reader independently locates these exact excerpts on the page.
  return [...new Set(sourceQuotes.filter(item=>item.claimId===claimIds[0])
    .map(item=>item.quote.trim()))];
}

/* Resolve claim-specific excerpts against the complete answer before Markdown
 * rendering splits it into paragraphs, list items, and emphasis spans. The
 * renderer consumes these groups in order so citation offsets stay tied to
 * the original answer and never fall back to another claim's page summary.
 */
export function citationExcerptsForAnswer(answer,evidenceMap=[]){
  const text=String(answer||'');
  return inlineCitationGroups(text).map(group=>Object.fromEntries(
    group.ids.map(id=>[id,claimQuotesForCitation(text,group.start,id,evidenceMap)])));
}
