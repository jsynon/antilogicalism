# Reading Companion public-library evaluation

The 31-case suite in `reading-companion-public-v1.json` tests global discovery across science, history, literature, philosophy, politics/society, and religion. Each case contains a fixed two-facet search plan and expected source groups. It starts in **All books** scope and uses the deployed v48 corpus.

## Fully automated run

```sh
node reading-companion/public-library-evaluation.mjs
```

The run uses the website's actual `RemoteLibrary` search and `mergeFacetSearches` functions. It fetches the public corpus, current book fingerprint coverage, and exact fingerprint packets for candidate pages. No model, API key, Turnstile token, local book files, or paid service is needed. `--limit 1` runs a quick one-case check; `--output reports/reading-companion-public-evaluation.json` saves a JSON report.

GitHub Actions runs the suite for relevant pull requests, once each week, or on manual dispatch. Each run posts a summary and attaches the complete JSON report as a 30-day artifact. The test fails for source identity errors, fingerprint mismatches, or execution errors. Retrieval misses are reported without an arbitrary pass threshold so the first full run establishes a baseline.

## What the report measures

- Whether each expected book group appears in the merged candidate list.
- Whether it appears in the answer-source set of up to four verified passages selected by default.
- Whether exact indexed page text matches its published SHA-256 fingerprint.
- Whether each citation locator maps to the same book, title, and physical PDF page in the v48 manifest.
- Corpus records, distinct catalog title count, fingerprint coverage, and elapsed search time.

The remaining human step is judging whether an AI-generated interpretation is accurate and complete. The automated suite intentionally makes no answer-generation calls and does not treat a valid citation as proof that a claim is true.

## Live answer evidence handoff

The public retrieval suite checks expected-work discovery and fingerprint integrity. It does not exercise the later handoff from query facets to hydrated candidate pages and the bounded Worker packet. For that separate live path, the `focused` cases in `reading-companion-live-answer-evaluation` preserve the original seven-question quality baseline and expose `searches`, `retrievalCandidates`, and `submittedSources` as separate report stages.

The shared retrieval code now reserves the best page from each distinct work on a part-linked planner facet before reserving a second page from any one work. This addresses the observed Kant miss where relevant Copleston and Prolegomena pages appeared in search but repeated hits from other Kant works could fill the bounded candidate pool first. The verbatim-question facet keeps its top two passages so this diversity rule does not displace a directly relevant second passage. This is a selection policy regression fix, not a semantic relevance guarantee; validate the live focused Kant case and inspect candidate excerpts and submitted pages before judging answer quality.

The browser and live evaluator both call `retrieveEvidence` and `selectAnswerSources` from `reading-companion/evidence-search.mjs`, so this selection change applies to the website and the evaluation runner. It adds no model calls and does not relax page fingerprint checks, source allowlists, packet limits, or citation validation.
