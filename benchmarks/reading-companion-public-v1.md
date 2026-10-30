# Reading Companion public-library evaluation

The 31-case suite in `reading-companion-public-v1.json` tests global discovery across science, history, literature, philosophy, politics/society, and religion. Each case contains a fixed two-facet search plan and expected source groups. It starts in **All books** scope and targets the deployed v49 corpus. The scheduled and PR retrieval-only evaluator verifies sources against v49 fingerprint coverage and makes no AI calls.

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
- Whether each citation locator maps to the same book, title, and physical PDF page in the v49 manifest.
- Corpus records, distinct catalog title count, fingerprint coverage, and elapsed search time.

The remaining human step is judging whether an AI-generated interpretation is accurate and complete. The automated suite intentionally makes no answer-generation calls and does not treat a valid citation as proof that a claim is true.

## Live answer evidence handoff

The public retrieval suite checks expected-work discovery and fingerprint integrity. It does not exercise the later handoff from query facets to hydrated candidate pages and the bounded Worker packet. For that separate live path, the `focused` cases in `reading-companion-live-answer-evaluation` preserve the original seven-question quality baseline and expose `searches`, `retrievalCandidates`, and `submittedSources` as separate report stages.

The shared retrieval code now reserves the best page from each distinct work on a part-linked planner facet before reserving a second page from any one work. This addresses the observed Kant miss where relevant Copleston and Prolegomena pages appeared in search but repeated hits from other Kant works could fill the bounded candidate pool first. The verbatim-question facet keeps its top two passages so this diversity rule does not displace a directly relevant second passage. This is a selection policy regression fix, not a semantic relevance guarantee; validate the live focused Kant case and inspect candidate excerpts and submitted pages before judging answer quality.

The browser and live evaluator both call `retrieveEvidence` and `selectAnswerSources` from `reading-companion/evidence-search.mjs`, so this selection change applies to the website and the evaluation runner. It adds no model calls and does not relax page fingerprint checks, source allowlists, packet limits, or citation validation.

If live planning fails, All Books direct fallback retains the exact question and adds a bounded 1 John 4:7–12 query for the recognized phrase “God is love.” The facet is reserved in the candidate pool before the unchanged six-page Worker packet is selected. Selected Books does not add a cross-book scripture search. The query is deterministic and makes no extra model call; the saved live-answer artifact exposes it under `searches` for offline diagnosis.
# Evaluation notes

An explicitly reviewed `general-context-answer` with full coverage and no expected source groups is structurally eligible without library citations. The report marks its evidence applicability as `not-applicable`; it does not treat the answer as library-supported or assign human quality scores. Cases with expected sources, unresolved inline citations, or failed review remain structural misses.

Standalone Markdown headings in an answer render as separate subsection headings rather than being folded into a neighboring paragraph. Actual lists remain opt-in when the reader asks for an enumeration. The in-progress status copy now describes the book search and answer preparation in reader-friendly language, while still making fallback and insufficient-evidence outcomes clear.

Answer rendering uses a small Markdown parser shared with regression tests. It separates inline bold labels and list items into readable blocks, preserves intentional short emphasis, handles nested emphasis without swallowing the rest of an answer, and flattens overlong italic spans while retaining any valid bold labels inside them. Lists remain semantic lists when the answer asks for an enumeration; otherwise list-like fragments are folded into prose. These are display-only repairs: the answer text sent to review and used for citations is unchanged. Fixtures cover the malformed inline heading/list shape seen in live output, unmatched emphasis markers, nested emphasis, and requested numbered lists.
