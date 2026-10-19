# Live answer evaluation

The 30-case `Reading Companion library evaluation` remains the normal PR and scheduled check. It searches the published index and verifies source-page identity/fingerprints; it makes **zero Cloudflare AI calls**.

`Reading Companion live answer evaluation` is a separate, manually dispatched workflow. It requires a live-AI confirmation checkbox. The default smoke run asks three questions: the 1 John 4:7–12 retrieval case, the Hawking black-hole case, and Aristotle on habituation. Choose `full` only when you want the complete 30-question benchmark; the full mode has a second confirmation checkbox. Runs are serialized and API requests are spaced at least 16 seconds apart to stay within the pilot's rate limits.

The Worker performs one planner inference and two answer-pipeline inferences per question. Budget roughly 9 inference calls for smoke and 90 for the full suite. This workflow is never attached to pull requests or a schedule. It does not run an AI judge: the report captures the planner queries, selected books/pages, answer outcome, citation consistency, evidence-highlight counts, and expected-work coverage. Review the generated answers and sources before treating a case as successful; expected-work coverage is a retrieval signal, not a truth score.

## One-time setup

After Worker PR #62 (manual evaluation authorization) is merged and deployed:

1. In the deployed Worker environment, set `PILOT_EVALUATION_ENABLED` to `true`.
2. Create a random secret of at least 32 characters, set it with `wrangler secret put PILOT_EVALUATION_TOKEN`, and add the exact same value as the GitHub Actions repository secret named `PILOT_EVALUATION_TOKEN`.
3. Dispatch **Reading Companion live answer evaluation** from GitHub Actions. Smoke is the default. Check the live-AI confirmation. For the full 30, also select `full` and check the full-run confirmation.

The bearer token is read only from the Actions secret and is not written to the report or console. Keep the Worker flag off when you are not actively running an evaluation. The route remains subject to the pilot's request validation, rate limits, source fingerprints, and byte limits.

Local use is also opt-in:

```sh
PILOT_EVALUATION_TOKEN='your-token-from-the-worker-secret-manager' \
CONFIRM_LIVE_AI=true \
node reading-companion/live-answer-evaluation.mjs --confirm-live-ai true --mode smoke
```

Add `CONFIRM_FULL_30=true` to the environment and choose `--mode full` to allow all 30 live questions. Never commit either secret.
