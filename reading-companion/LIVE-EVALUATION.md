# Live answer evaluation

The normal PR and scheduled `Reading Companion library evaluation` runs two retrieval-only suites: 31 all-books questions and 6 selected-book questions spanning philosophy, science, history, literature, and religion. Both search the published index and verify source-page identity/fingerprints; they make **zero Cloudflare AI calls**. The selected-book suite also checks that retrieval stays inside the chosen book. It does not add cases to the metered live-AI benchmark.

The live-answer workflows must use the same corpus release as `remote-library.mjs`: v48 data with `reader-fingerprints-v2/coverage-v2.json`. Startup checks that both manifests identify v48 before retrieval or any live AI call. A version mismatch aborts early and reports the coverage and corpus versions it found. The separate public-library evaluation already validates v48 page fingerprints.

`Reading Companion live answer evaluation` is a separate, manually dispatched workflow. It requires a live-AI confirmation checkbox. The `planner` mode is a low-cost, two-question check: it asks the live Worker planner for one selected-book plan and one All Books cross-work plan, then runs retrieval to see whether the expected books appear. It makes two planner inference calls and skips answer generation. It does not assess passage relevance or answer quality.

The default smoke run asks three questions: the 1 John 4:7–12 retrieval case, the Hawking black-hole case, and Aristotle on habituation. Choose `full` only when you want the complete 30-question benchmark; the full mode has a second confirmation checkbox. Runs are serialized and API requests are spaced at least 30 seconds apart to stay within the pilot's rate limits.

The `quality` mode defaults to the cases’ selected-book scope and uses two fixed, curated queries per case, so its seven questions spend calls on answer composition and review instead of planning. Its `plannerSkipped` field is true in that mode. Choose the quality scope `all-books` to run all seven questions without a selected-book restriction and use the live planner for each; this estimates 21 baseline inference calls (7 planner + 14 answer/review), plus conditional repairs. This is the mode to use when validating changes to planner query facets against the full seven-question set. The report records `searchScope` and whether planning was skipped. Smoke costs roughly 9 inference calls and the full suite 90, before conditional repairs. This workflow is never attached to pull requests or a schedule.

Quality reports separate expected-book retrieval from source use: for each requested part, `partEvidenceAudit` shows whether its evidence IDs resolve to the review map, cited source, and submitted page. `sourceGroups` then shows whether each required work is linked to a supported part. `answerCoverageConsistent` checks that reported coverage matches the part statuses and flags explicit prose that denies a comparison marked supported. These are structural checks only. They cannot determine whether the cited passage semantically supports the claim or whether the interpretation is correct; inspect `answerText`, `evidenceMap`, highlights, and cited page text manually. The automated `passed` count is a review signal, not an AI truth grade.

## Focused source-selection checks

The `focused` mode is separate from the stable seven-question `quality` baseline and always runs against All Books with the live planner. It is available in both manually dispatched live-answer workflows. To run the whole five-question set in one job and one artifact, choose **mode `focused`** and **case ID `all`**. Choose one focused `case_id` only when diagnosing a single question. The cases are Kant on transcendental idealism, Kierkegaard on faith, Nietzsche on Christianity, sunyata, and a carefully qualified inference about what Nietzsche might think of Kierkegaard. Focused questions do not carry hard-coded expected book IDs where the required corpus records have not yet been confirmed; judge the actual works retrieved and cited from the trace and source text.

With `with-review`, one focused case estimates three baseline Worker AI calls (planner, composition, review); all five in `focused` + `all` estimate 15, plus conditional repairs. `compose-only` uses two baseline calls per question, while paired review ablation estimates four. The `scope` control does not narrow focused mode: focused cases always use All Books. Use `focused` + `all` for a consolidated five-case regression run, or one case ID for a lower-cost diagnosis.

Reports separate `searches[].sources` (top indexed hits per query), `retrievalCandidates` (the bounded hydrated pages eligible for packet selection), and `submittedSources` (the pages actually sent to the Worker). For a two-author comparison, if one planned source-side search is empty while its counterpart has results, retrieval makes one best-effort retry using the counterpart's topical terms, restricted to the empty side's planned book IDs. A result from the broad question query does not suppress this retry: it may be an incidental mention that never becomes eligible evidence for the missing side's answer part. A successful retry records `fallbackFrom` and `fallbackReason: "empty-source-side-facet"` on that search. It adds one local index search, but no model call and no page/citation budget; a failed retry leaves the side empty so the answer can still abstain safely. The retrieval-complete progress event reports `retrievalFallbackCount` when this recovery runs. Live workflow logs also show candidate and submitted page IDs at retrieval completion. Compare these lists in order to see whether a useful passage was absent from search, dropped during candidate assembly, or omitted from the final answer packet. Each artifact candidate includes matched facets, part links, score, and a bounded excerpt.

The report also records final citation sources, question-part/evidence links, and each highlight's exact-text location result. Citation records preserve bounded provenance fields when the Worker supplies them: credited author/editor/translator, planner role, page-section hint, and title-guarded work/page voice metadata. `quoteLocated` verifies textual location only. Use each case's `reviewFocus` rubric and cited page text to judge semantic support, accuracy, source sufficiency, and highlight relevance. Do not score source quality by citation count alone, and do not treat an exact quote match as semantic validation. These are focused diagnostics, not a replacement or expansion of the baseline suite.

## Recheck a saved quality report without AI or network calls

The standalone `recheck-live-answer-evaluation.mjs` script reapplies the current structural audit to a saved quality JSON report. It does not contact the Worker, retrieve books, or call a model. First extract `reading-companion-live-answer-evaluation.json` from the GitHub Actions artifact ZIP, then run:

```powershell
node .\reading-companion\recheck-live-answer-evaluation.mjs `
  --input .\downloaded-artifact\reading-companion-live-answer-evaluation.json `
  --output .\downloaded-artifact\reading-companion-live-answer-evaluation.offline-rechecked.json
```

The new `offlineRecheck` fields preserve the original report and show the corrected structural score alongside it. This can correct evaluator false negatives, but it does not change the generated answer or verify factual truth. Run its regression tests with `node --test .\reading-companion\live-answer-evaluation.test.mjs`.

## One-time setup

After Worker PR #62 (manual evaluation authorization) is merged and deployed:

1. In the deployed Worker environment, set `PILOT_EVALUATION_ENABLED` to `true`.
2. Create a random secret of at least 32 characters, set it with `wrangler secret put PILOT_EVALUATION_TOKEN`, and add the exact same value as the GitHub Actions repository secret named `PILOT_EVALUATION_TOKEN`.
3. Dispatch **Reading Companion live answer evaluation** from GitHub Actions. Smoke is the default. Select `planner` for the two-call planner/retrieval check, or `focused` with case ID `all` to run the five focused source-selection cases together. Check the live-AI confirmation for any mode. For the full 30, also select `full` and check the full-run confirmation.

The bearer token is read only from the Actions secret and is not written to the report or console. Keep the Worker flag off when you are not actively running an evaluation. The route remains subject to the pilot's request validation, rate limits, source fingerprints, and byte limits.

Local use is also opt-in:

```sh
PILOT_EVALUATION_TOKEN='your-token-from-the-worker-secret-manager' \
CONFIRM_LIVE_AI=true \
node reading-companion/live-answer-evaluation.mjs --confirm-live-ai true --mode smoke
```

Use `--mode planner` for the two planner-only cases. It still requires the live-AI confirmation and evaluation token, but makes no answer-stage inference calls.

Add `CONFIRM_FULL_30=true` to the environment and choose `--mode full` to allow all 30 live questions. Never commit either secret.

## Fresh holdout questions

`Reading Companion holdout answer evaluation` is a separate, manually dispatched seven-question set. It does not replace or edit the original `quality` baseline. The holdout uses new prompts across history, literature, philosophy, scripture, and cross-work comparisons:

| Case | Scope | What it tests |
|---|---|---|
| Herodotus on Helen in Egypt | One book | Separating reported testimony from the narrator’s judgment |
| Hamlet’s “To be, or not to be” soliloquy | One book | Supporting interpretation with the right passage and rhetorical context |
| Aristotle on soul, body, form, and matter | One book | Explaining a conceptual relation without overclaiming |
| James on faith and works | One book | Complete passage coverage and distinct examples |
| Hume and Kant on causal necessity | All Books | Accurate two-source comparison |
| Plato and Rousseau on political order | All Books | Distinguishing authors’ arguments while synthesizing |
| Wollstonecraft and Du Bois on social conditions | All Books | Cross-discipline comparison with careful attribution |

The default `selected-books` run keeps the four one-book cases restricted to their selected work and uses curated fixed queries for all seven; the three comparison cases still search across books. It estimates 14 baseline answer/review inference calls, plus any conditional Worker repairs. The `all-books` option uses the live planner for each question and estimates 21 baseline calls (7 planner + 14 answer/review), plus conditional repairs. You can select one case to keep a diagnostic run smaller. Both choices require the live-AI confirmation. Review answer text and cited passages manually; the automated checks remain structural and do not establish semantic accuracy.

## October 25, 2026: run #41 provenance and visible-passage follow-up

The five-case focused, all-books, with-review run [40176637186](https://github.com/jsynon/antilogicalism/actions/runs/40176637186) completed all cases on site revision `d1f0e5607639a5e4d8eb42ccd14823cac1ef8ea5` and Worker version `0aa5a623-f687-406b-bb97-f4f467dbfc83` (`public-gateway-evidence-selection-v3`, corpus v47). It used the expected 15 calls, with no request failures or planner fallbacks, and passed structural checks for four of five cases. Kant on transcendental idealism and sunyata moved from partial in run #40 to full. Kierkegaard on faith remained partial; retain that outcome unless its evidence supports the missing scope rather than forcing a full label.

Run #41 exposed a user-visible evidence-selection mismatch: the sunyata answer cited the defining passage as S4, but the browser highlighted S1–S3 because the Worker took the first three citations in retrieval order. It also showed that provenance context reached the model prompts but was absent from final citation rows and the saved artifact. The next candidate carries guarded provenance through final citations and evaluation artifacts, orders up to three visible highlights by the answer's inline citation order, and only highlights exact reviewer-verified spans. If a cited page has no verified span, the interface will disclose that without substituting a generic preview. The source UI will distinguish curated pseudonymous publication context and the confirmed Dilworth introduction page, while leaving uncertain page voices unlabelled.

This candidate does not change retrieval scope, source fingerprints, reviewer acceptance, the six-page packet, or the established 15-call estimate. Its regressions cover inline-order selection, missing/unverified anchors, title-guarded provenance, visible attribution labels, and artifact serialization. Paired PRs [#231](https://github.com/jsynon/book-chatbot/pull/231) and [#197](https://github.com/jsynon/antilogicalism/pull/197) are open. GitHub checks are in progress: Worker contract run [40178784774](https://github.com/jsynon/book-chatbot/actions/runs/40178784774) and website smoke run [40178790921](https://github.com/jsynon/antilogicalism/actions/runs/40178790921). After both checks pass and the paired changes are deployed, rerun the same five focused cases. Inspect whether citations now expose voice/section context, sunyata highlights start with S4, every visible excerpt matches a reviewed span, and the Kierkegaard/faith partial remains evidence-led. Then manually test the live page for both the answer and page-reader attribution. Keep the unseen acceptance set frozen until those source-level checks pass.

## October 25, 2026: v48 live-workflow preflight correction

After the v48 browser client was merged in PR [#200](https://github.com/jsynon/antilogicalism/pull/200), the user attempted the confirmed holdout workflow. It stopped during setup with `Published v47 coverage or corpus is incompatible.` No retrieval or live AI request had started. The browser and `RemoteLibrary` were already on v48 (`data-v48/` and fingerprint schema v2), while `live-answer-evaluation.mjs` still fetched v1 coverage and required both manifests to be v47. This was a workflow version mismatch, not a chatbot answer failure.

The follow-up aligns the live evaluator with the deployed v48 corpus and v2 coverage manifest. Its preflight now reports the actual coverage and corpus versions when they do not match and remains fail-closed before retrieval or AI calls. The regression test accepts a matching v48 pair and rejects mixed v47/v48 pairs. This changes no prompt, retrieval policy, citation rule, or model-call estimate. After the PR is merged, retry the same workflow configuration; successful startup is only a prerequisite, and the resulting answer artifact still needs source-level review.
# October 25, 2026: run #40 follow-up

Run [40173370353](https://github.com/jsynon/antilogicalism/actions/runs/40173370353) completed all five focused, all-books, with-review cases on site revision `f5d56b2cf0ff3cf713121c35c45918bf3f3ce87e` and Worker version `b9ea08ea-3123-4cd1-87c1-64fe169c658f`. It used the normal 15-call estimate and had no request failures or planner fallbacks. Three cases passed structural checks. Two failures were caused by reviewer response formatting; the Sunyata case also exposed that an OCR index page could reach composition.

The next paired candidate keeps the same six-page source limit and model-call count. On the Worker, the review request and output now use one `claims` field; a narrow adapter also recovers the run's complete `answers`-alias response and an omitted part status only when all individual claim statuses are present. JSON recovery unwraps a fenced object and tolerates the observed extra closing `]}` while retaining the full source-ID, claim-ID, and exact-span checks. The same reviewer output still cannot validate a sentence unless it selects a valid span from every cited source.

The answer and review inputs now carry separate credited-author, editor, translator, planner-role, and page-heading context. This gives the model attribution clues while explicitly warning that bylines and planner roles do not prove the voice of an individual page. The source prompts distinguish primary text, pseudonymous voice, quoted/reported speech, narration, editorial introductions, translator notes, and commentary. Site retrieval also filters OCR index pages with a printed folio and `INDEX` heading appearing after the first index entries. Drive inspection established that *Forgotten Truth*, p. 193, is index matter; p. 66 is the direct sunyata definition. The p. 18 passage in Nishida's *Last Writings* is in David A. Dilworth's introduction, and *Fear and Trembling* identifies Johannes de Silentio as its pseudonymous voice.

Offline validation reports 235 passing Worker tests and 175 passing website tests. The shared Worker/site reader contract is byte-identical. Paired PRs [#230](https://github.com/jsynon/book-chatbot/pull/230) and [#196](https://github.com/jsynon/antilogicalism/pull/196) are open; repository checks are pending, and neither PR is merged or deployed. The next live gate is another run of the same five cases, checking the recovered reviewer results, whether p. 193 is absent from retrieval, whether cited commentary and pseudonymous voices are described accurately, and whether each visible highlight corresponds to its answer claim. Structural pass alone is not semantic acceptance; keep the unseen suite frozen until source-level review is complete.

## October 25, 2026: run #45 review truncation and page-voice follow-up

Focused all-books with-review workflow [40183728454](https://github.com/jsynon/antilogicalism/actions/runs/40183728454) completed the five focused questions on corpus v48. Four cases passed structural checks. Nietzsche on Christianity failed only at review formatting: the reviewer echoed its large input and was cut off at the 1,800-token answer-stage limit. The Worker correctly left that answer unverified and exposed no evidence map or highlights. The follow-up sends a smaller claim-and-span packet, uses a compact span-ID decision format, lowers only the review output cap to 1,200 tokens, and preserves fail-closed handling with the specific `review-output-truncated` code. It adds no model calls and retains exact per-source span validation.

Drive inspection confirmed that *The Portable Nietzsche* page 578 is Walter Kaufmann's editorial commentary; inspected pages 547 and 582 contain direct Nietzsche text. The shared Worker/site reader contract marks only page 578 under the exact v48 book ID and title. The source citation label will say “Editorial commentary by Walter Kaufmann · Work credited to Friedrich Nietzsche.” This page-specific note must not spread to other pages in the volume. The same paired change also tells answer composition and review to preserve a known pseudonymous voice when the supplied provenance identifies one.

Offline checks pass: 243 Worker tests and 180 site tests; the shared reader contract is byte-identical. The 15-call baseline and six-page answer packet are unchanged. This candidate is not yet merged or deployed. After both checks pass and both repositories are deployed, rerun the five-case focused all-books with-review workflow and inspect the raw review output, failure stage, cited page text, and visible attribution. Structural success alone is not semantic acceptance; keep the unseen acceptance suite frozen until that review is complete.

## October 25, 2026: focused run #46 review-format regression

[Focused all-books with-review run #46](https://github.com/jsynon/antilogicalism/actions/runs/40211508465) used site revision `16e770e3d59425342f7af840d90390a87ed6a8c6`, Worker version `4b4e359d-408f-4169-83ab-100c27d39a3f`, and corpus v48/fingerprint v2. All five cases ran with no request failures, planner fallbacks, or skips, using the 15-call baseline. Structural results were 4/5, so the workflow failed its gate.

The compact reviewer handoff resolved the prior Nietzsche-on-Christianity truncation: that answer is now structurally verified. The remaining Nietzsche/Kierkegaard failure is a different format defect. The reviewer stopped normally after 586 output tokens, but emitted invalid JSON: one unanswered claim used a malformed `spansBySource` key, and part status values appeared in a non-contract `parts_status` map. Its response did mark the final hypothetical inference claim unanswered. The Worker correctly rejected the malformed review and returned an unverified draft with no highlights or evidence map.

The other four cases passed. The Kierkegaard answer now names Johannes de Silentio but does not distinguish Johannes Climacus and Anti-Climacus when it uses their works. Sunyata's definition is supported, but the answer extends through modern commentary, including Dilworth's introduction to Nishida, without enough qualification. The page-578 Kaufmann attribution added by PR #202 was not exercised: that page was retrieved but not cited in the Nietzsche/Christianity answer. The independent manual scores and cited-span notes are in the Worker milestone report linked above.

The next bounded validation is an exact-response regression for safe deterministic recovery of this JSON defect, followed by the same five-case focused run. Preserve exact per-source spans, fail closed on anything outside the recognized format case, and make no extra model call. Keep the unseen acceptance set frozen until the new run and source-level review are satisfactory.

## October 25, 2026: run #55 page-voice follow-up

Run #55 showed that the Worker can correctly reject a citation when any page cited for one claim lacks its own supporting span. Its Sunyata trace includes *Last Writings* p. 17 (page 26 of David A. Dilworth's introduction) and p. 48 (Nishida's authored essay); the latter does not support every specific statement on the former. The website's shared reader contract now tags p. 17 with the same title/page-guarded Dilworth attribution as p. 18, while leaving p. 48 as authorial text. This lets citation rows and evaluation artifacts preserve the distinction.

The corresponding Worker candidate also carries a named author's antecedent across up to three preceding supported claims in the same answer part, so a pronoun-led sentence cannot bypass the known editorial-page attribution check. Hypothetical answer prompts now request the smallest directly relevant set of premise pages, and the existing per-source reviewer gate still requires each cited premise to have its own span. These changes do not alter the website answer schema, retrieval packet, or model-call estimate. Website offline validation passes 181 tests; the paired Worker/site PRs and live five-case validation remain pending.
