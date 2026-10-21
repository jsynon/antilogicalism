# Live answer evaluation

The normal PR and scheduled `Reading Companion library evaluation` runs two retrieval-only suites: 31 all-books questions and 6 selected-book questions spanning philosophy, science, history, literature, and religion. Both search the published index and verify source-page identity/fingerprints; they make **zero Cloudflare AI calls**. The selected-book suite also checks that retrieval stays inside the chosen book. It does not add cases to the metered live-AI benchmark.

`Reading Companion live answer evaluation` is a separate, manually dispatched workflow. It requires a live-AI confirmation checkbox. The `planner` mode is a low-cost, two-question check: it asks the live Worker planner for one selected-book plan and one All Books cross-work plan, then runs retrieval to see whether the expected books appear. It makes two planner inference calls and skips answer generation. It does not assess passage relevance or answer quality.

The default smoke run asks three questions: the 1 John 4:7–12 retrieval case, the Hawking black-hole case, and Aristotle on habituation. Choose `full` only when you want the complete 30-question benchmark; the full mode has a second confirmation checkbox. Runs are serialized and API requests are spaced at least 30 seconds apart to stay within the pilot's rate limits.

The `quality` mode uses two fixed, curated queries per case so its seven questions spend calls on answer composition and review instead of repeatedly planning known searches. As the report states, its `plannerSkipped` field will be true for those cases. Use `planner` separately when checking live query planning. Smoke costs roughly 9 inference calls and the full suite 90, before conditional repairs. This workflow is never attached to pull requests or a schedule. It does not run an AI judge: answer runs capture selected books/pages, answer outcome, citation consistency, evidence-highlight counts, and expected-work coverage. Review answers and source passages manually; book-level expected-work coverage is not a truth score.

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
