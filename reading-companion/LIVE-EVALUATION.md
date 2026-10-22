# Live answer evaluation

The normal PR and scheduled `Reading Companion library evaluation` runs two retrieval-only suites: 31 all-books questions and 6 selected-book questions spanning philosophy, science, history, literature, and religion. Both search the published index and verify source-page identity/fingerprints; they make **zero Cloudflare AI calls**. The selected-book suite also checks that retrieval stays inside the chosen book. It does not add cases to the metered live-AI benchmark.

`Reading Companion live answer evaluation` is a separate, manually dispatched workflow. It requires a live-AI confirmation checkbox. The `planner` mode is a low-cost, two-question check: it asks the live Worker planner for one selected-book plan and one All Books cross-work plan, then runs retrieval to see whether the expected books appear. It makes two planner inference calls and skips answer generation. It does not assess passage relevance or answer quality.

The default smoke run asks three questions: the 1 John 4:7–12 retrieval case, the Hawking black-hole case, and Aristotle on habituation. Choose `full` only when you want the complete 30-question benchmark; the full mode has a second confirmation checkbox. Runs are serialized and API requests are spaced at least 30 seconds apart to stay within the pilot's rate limits.

The `quality` mode defaults to the cases’ selected-book scope and uses two fixed, curated queries per case, so its seven questions spend calls on answer composition and review instead of planning. Its `plannerSkipped` field is true in that mode. Choose the quality scope `all-books` to run all seven questions without a selected-book restriction and use the live planner for each; this estimates 21 baseline inference calls (7 planner + 14 answer/review), plus conditional repairs. This is the mode to use when validating changes to planner query facets against the full seven-question set. The report records `searchScope` and whether planning was skipped. Smoke costs roughly 9 inference calls and the full suite 90, before conditional repairs. This workflow is never attached to pull requests or a schedule.

Quality reports separate expected-book retrieval from source use: for each requested part, `partEvidenceAudit` shows whether its evidence IDs resolve to the review map, cited source, and submitted page. `sourceGroups` then shows whether each required work is linked to a supported part. `answerCoverageConsistent` checks that reported coverage matches the part statuses and flags explicit prose that denies a comparison marked supported. These are structural checks only. They cannot determine whether the cited passage semantically supports the claim or whether the interpretation is correct; inspect `answerText`, `evidenceMap`, highlights, and cited page text manually. The automated `passed` count is a review signal, not an AI truth grade.

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
3. Dispatch **Reading Companion live answer evaluation** from GitHub Actions. Smoke is the default. Select `planner` for the two-call planner/retrieval check. Check the live-AI confirmation for any mode. For the full 30, also select `full` and check the full-run confirmation.

The bearer token is read only from the Actions secret and is not written to the report or console. Keep the Worker flag off when you are not actively running an evaluation. The route remains subject to the pilot's request validation, rate limits, source fingerprints, and byte limits.

Local use is also opt-in:

```sh
PILOT_EVALUATION_TOKEN='your-token-from-the-worker-secret-manager' \
CONFIRM_LIVE_AI=true \
node reading-companion/live-answer-evaluation.mjs --confirm-live-ai true --mode smoke
```

Use `--mode planner` for the two planner-only cases. It still requires the live-AI confirmation and evaluation token, but makes no answer-stage inference calls.

Add `CONFIRM_FULL_30=true` to the environment and choose `--mode full` to allow all 30 live questions. Never commit either secret.
