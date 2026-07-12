# Scale-Crossover Protocol Amendment 2: MDX Correctness Admission and Map Capability

Status: frozen on 2026-07-12 before any lifecycle-fixed scale timing. This amendment changes only the MDX pre-performance admission and report-classification rules in the [frozen execution protocol](./scale-crossover-frozen-protocol.md). Corpus order, scale points, host gates, pool grids, statistical thresholds, and runtime pins remain unchanged.

## Trigger: the pinned MDX adapter has no source-map capability

The pinned Cloudflare MDX adapter calls the Astro MDX compiler's `configResolved` hook with `build.sourcemap: false` and returns `compiled.map ?? null`. The direct Rolldown generation lane also does not request source maps. A non-null map or source-map-chain parity claim is therefore impossible in this adapter without changing its behavior and invalidating the frozen baseline.

The mechanical MDX scale curve may proceed after deterministic code, normalized output, graph, exact transform coverage, lifecycle, semantic-sentinel, and structured invalid-input admission pass. The correctness artifact must record source maps as an explicit `product-failure` capability, not as a pass and not as an omitted field. Product crossover remains impossible for this adapter until a separately versioned map-capable implementation passes ordinary/worker map and chain parity.

## Hard admission gate

No MDX performance screen, refinement, confirmation, allocation, quota, or graph-placement matrix may execute until `scale-correctness-gate.json` is `passed` and pins both required artifacts by SHA-256:

1. A lifecycle-fixed full-corpus correctness artifact with two fresh ordinary and two fresh worker-four runs over the frozen 9,157-source prefix, exact transform coverage, four-run deterministic normalized output, and the explicit source-map capability failure. Every run retains one stable `{ id, hits, worker }` record per selected source plus factory, handler, per-worker, unknown-ID, missing-ID, duplicate-ID, null-map, and non-null-map counters. It must not retain wall-clock timestamps, elapsed or service durations, CPU fields, RSS fields, host snapshots, host deltas, or JavaScript/Rust timelines; therefore `measurementFieldsPresent: false` means no measurement field is present anywhere in the artifact rather than only that `/usr/bin/time` was skipped.
2. A lifecycle-fixed semantic artifact that executes the five frozen graph-smoke entries, all six playground sources, both fixed Mermaid sources, and the invalid-MDX fixture through ordinary, plugin-managed, and Rolldown-managed success paths and ordinary/Rolldown-worker diagnostic paths. It must retain exact entry and variant lists, graph/output parity, the observed `meta.astro` loss as a product failure, structured non-aborting errors, and any ordinary/worker diagnostic difference as a product failure. Diagnostic capture and comparison explicitly include `stackHasFixture`, `stackHasPluginName`, `pluginCode`, `line`, and `column`, and the artifact maps those values back to the exact fixture path and SHA-256.

The base screen remains disabled while either artifact or hash is missing. The gate is consumed by the performance runner, so changing only a matrix's `executionEnabled` field cannot bypass admission.

The correctness instrumentation mode increments only identity, hit, worker, map-result, and completion-state counters. It does not sample `performance.now`, `process.hrtime`, CPU, RSS, or host state; timeline and duration collection remains exclusive to separately classified attribution runs.

Correctness artifacts use a recursive exact-key schema rather than a denylist: every report, environment, matrix, run, counter, graph boundary, diagnostic, and provenance object must contain exactly its canonical fields. Unknown aliases and `rustMetrics` or `lifecycleMetrics` are rejected and those two fields are omitted from correctness serialization entirely.

The gate independently regenerates the scale manifest from the clean Cloudflare commit, rechecks all 9,157 source byte counts and hashes, recomputes the full selection and every frozen prefix, and then verifies the project commit, project source-manifest hash, runtime, pool values, exact counters, run blocks, and normalized-output equality in the pinned artifact. It does not accept artifact-authored `passed` booleans in place of those computations.

## Compiler and harness provenance

The compiler environment is frozen before performance execution: Node `v24.18.0`, installed dependency layout produced by `pnpm@11.12.0`, project `package.json` SHA-256 `9109282fc31d22ca3391f480cc993df5be41b834457f6ea04c0356320c205812`, `pnpm-lock.yaml` SHA-256 `f908eb3dab7cd3346887a6a6cc9b26c8f49015d891900612eb69b5bd94829e7c`, `pnpm-workspace.yaml` SHA-256 `456b838b834f7ee2d60d0835d099b94c0d205180869d188048d7327005b25dec`, and installed pnpm layout SHA-256 `60f64721c5cacfa8ec58d148e21b96a57096f3051cfd2ec6675e13bd3324edcd`. The resolved compiler packages are `@astrojs/mdx@6.0.3` tree `d285e9789d38b57ad2032056479becbe9c99199a530939e3ed3a77fcf0fdd30a`, `@mdx-js/mdx@3.1.1` tree `cb7ceda2117e895ea5c3edb4b653fe98cc0ea073e84f1696def46f58c4c6f3bd`, `@astrojs/markdown-remark@7.2.0` tree `6d5c17aea60bbd693c3decfbd87979e416ae5a5158a2f3d3dff12caee7175e34`, `astro@6.4.7` tree `01963858fd74530b7c506612d986fcc9dcead02192059656a1515e46316bd7cc`, `@astrojs/compiler@4.0.0` tree `29cc6b785e8cf5ffabe9bebfd4092113e742ee16c7d20434cc6fd4f123c930f4`, and `tsx@4.22.4` tree `c0034f2c67037e35d8489f568c171e9c48256e47243ddb8b5fa77980e9643f1e`.

Each correctness artifact records a deterministic source manifest of every `.mjs` file in the MDX harness plus the adapter patch, invalid fixture, and frozen scale manifest, including relative path, byte count, and SHA-256. The gate recomputes that manifest from the working tree and requires exact equality. This makes the artifact reproducible before the research branch has a final commit and prevents a later harness edit from silently inheriting the earlier correctness admission.

The compiler pin also walks the installed runtime dependency closure of the six resolved Astro/MDX/compiler/tsx roots through each package's actual Node resolution, hashes every package tree and every resolved edge, and freezes the resulting 309-package, 760-edge closure SHA-256 `3161bd51e7644136252a45c09b4c79e5a7abda901ce0c5e3f101f1c4abf3eeec`.

## Report classification

New matrix execution requires an explicit evidence kind and exact runtime profile. Historical `0aa/deec/e303` execution is allowed only as `historical-replay`, runs without timing collection, and cannot make lifecycle or performance claims. Unclassified legacy matrices are rejected by the new runner.

The performance summarizer accepts only repeated `performance-confirmation` reports that use the lifecycle-fixed baseline, pass the frozen host and correctness gates, contain finite wall/CPU/RSS values, and contain no validation or host-policy failures. It rejects correctness artifacts, one-shot screens, refinements, historical replays, and non-finite data instead of emitting `benchmarkEligible` summaries with null metrics.

## Graph placement ordering

The MDX graph-placement matrix remains disabled until the scale screen and repeated fixed-count selection finish. Enabling it requires both the confirmed crossover scale below 9,157 and the selected worker count. It must contain exactly two frozen-prefix cases in order: the confirmed crossover point with block indices 0–9 and the full 9,157-source point with block indices 10–19. Each case uses exactly ordinary, plugin-managed, and Rolldown-managed variants at the selected worker count for ten rotated blocks. The runner validates the exact prefix hashes, and the summarizer rejects a report unless both cases, all 20 blocks, and all 60 runs are present. Worker four is no longer hard-coded before selection.

Both performance summarizers recompute the complete current harness manifest and the exact runner and case-runner file hashes. The graph summarizer additionally recomputes graph, boundary, normalized-output, and metadata parity from all 60 raw runs and exact-compares that result with the report's parity claim.
