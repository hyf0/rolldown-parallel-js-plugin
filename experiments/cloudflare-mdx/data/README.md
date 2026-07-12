# Raw Data

This directory stores generated JSON from the Cloudflare MDX direct-Rolldown experiment. Every artifact must retain its matrix, fresh-process samples, Node binary, host, output hashes, and peak RSS. Formal reports must distinguish uninstrumented wall data from instrumented attribution data.

Benchmark evidence is restricted to the local default profile with `CI` and `RUN_LINK_CHECK` unset:

- `2026-07-12-formal-kernel-10-blocks.raw.json` and its summary contain the 30 uninstrumented repeated kernel samples. The filename predates the host audit: every sample had pageouts, four Rolldown-worker samples had new swapouts, and several samples exceeded the background-CPU threshold, so it is not clean-host formal confirmation.
- `2026-07-12-full-instrumentation.raw.json` contains exact transform IDs, bytes, worker assignment, lifecycle, and queue attribution and is not wall-time evidence.
- `2026-07-12-graph-full-scan.raw.json` contains the one-shot graph-preserving correctness scan; its timings are not a repeated conclusion.
- `2026-07-12-graph-local-5-blocks.aborted.json` records why the first local-only repeated graph attempt was interrupted during severe memory thrashing. It contains no timing evidence. The runner refuses active CI markers and records every host-policy violation when a future clean run completes.
- `2026-07-12-astro-local-reference/` contains the uninstrumented original local Astro reference.
- `2026-07-12-astro-local-mdx-counter-run/` contains the instrumented original Astro handler count and is not benchmark evidence.
- `2026-07-12-astro-mdx-id-set-validation.json` records that the 9,157 sorted observed handler IDs exactly equal the 9,157 sorted production-content MDX paths.

`2026-07-12-link-check-semantic-smoke.raw.json` and `2026-07-12-link-check-semantic-full-scan.raw.json` are local `RUN_LINK_CHECK=true` semantic probes. Their only retained conclusion is that the link validator's `globalThis` state is not reduced from workers; none of their timing values may be used as benchmark data. The embedded historical case name still says `ci-link-check` because that is the candidate profile switch, not the execution venue.

Interrupted and invalid Astro CI-profile references were deleted rather than retained as evidence. Small smoke, screening, and superseded full-scan files remain only as adapter-development provenance and cannot override the classified artifacts above.

## Reproducibility limitations

The two raw files merged into `2026-07-12-formal-kernel-10-blocks.raw.json` predate the final provenance fields. They do not contain the runner source hash, parent CI-marker values, or `executionScope`; the merged artifact therefore records the scope as `unrecorded`, and its summary is explicitly benchmark-ineligible in addition to the host-policy failures. The samples were launched locally according to the operator record, but the artifacts alone cannot prove that environment after the fact.

The original Astro provenance files record runner SHA-256 values `9fa454b4ed4753b908726609b8180dca1510856226ea9ef8e3c7094e2758fa4b` and `1889f085e8ff4331732d2cd4bad88d55d4712acbec1483051ea719a1c671eefe`. The exact source text for those historical runner revisions was not retained, and the current runner has a different hash. The command outputs and observations remain evidence, but exact historical script replay is unavailable.

Current kernel and graph matrix runners refuse active CI markers and record `executionScope: local-only`, their own source hash, parent CI-marker values, and the child environment policy. Their summaries reject benchmark eligibility when execution provenance, validation, or any report-level or per-run host policy fails. A clean formal rerun must use those final committed scripts on a restarted, quiet local host.
