# Reading Companion public-library evaluation

The 30-case suite in `reading-companion-public-v1.json` tests global discovery across science, history, literature, philosophy, and politics/society. Each case contains a fixed two-facet search plan and expected source groups. It starts in **All books** scope and uses the deployed v47 corpus.

## Fully automated run

```sh
node reading-companion/public-library-evaluation.mjs
```

The run uses the website's actual `RemoteLibrary` search and `mergeFacetSearches` functions. It fetches the public corpus, current book fingerprint coverage, and exact fingerprint packets for candidate pages. No model, API key, Turnstile token, local book files, or paid service is needed. `--limit 1` runs a quick one-case check; `--output reports/reading-companion-public-evaluation.json` saves a JSON report.

GitHub Actions runs the suite for relevant pull requests, once each week, or on manual dispatch. Each run posts a summary and attaches the complete JSON report as a 30-day artifact. The test fails for source identity errors, fingerprint mismatches, or execution errors. Retrieval misses are reported without an arbitrary pass threshold so the first full run establishes a baseline.

## What the report measures

- Whether each expected book group appears in the merged candidate list.
- Whether it appears in the two passages selected by default.
- Whether exact indexed page text matches its published SHA-256 fingerprint.
- Whether each citation locator maps to the same book, title, and physical PDF page in the v47 manifest.
- Corpus records, distinct catalog title count, fingerprint coverage, and elapsed search time.

The remaining human step is judging whether an AI-generated interpretation is accurate and complete. The automated suite intentionally makes no answer-generation calls and does not treat a valid citation as proof that a claim is true.
