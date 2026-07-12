# Cloudflare Docs MDX Direct-Rolldown Experiment

This experiment adapts Cloudflare Docs' pinned production MDX transform chain to the direct Rolldown API. The original `astro build` remains a separate phase and behavior reference. Worker value is measured only by comparing the ordinary main-thread adapter with the otherwise identical ParallelPlugin adapter.

## Current result

Ten rotated local default-profile blocks over all 9,157 production MDX modules give a 63.089-second ordinary median, 26.779-second plugin-managed four-worker median, and 28.226-second Rolldown-managed four-worker median. The paired ordinary-to-Rolldown median is 2.178x with bootstrap 95% interval 2.129–2.369 and normalized output parity. The plugin-managed-to-Rolldown interval crosses parity. Host-policy and historical-provenance failures make this strong repeated local JavaScript-worker evidence, not clean formal confirmation or evidence of an incremental Rolldown-managed advantage. See the [full 2026-07-12 result](./2026-07-12-results.md).

All benchmark conclusions use processes launched on the local M3 Pro rather than a CI service. Direct artifacts record `RUN_LINK_CHECK=false`; the original Astro provenance additionally records `CI=null`, while the earlier kernel runner did not persist `CI`. The link-check profile exists only to demonstrate worker-local state loss and none of its timings are benchmark evidence.

## Current boundary

Pinned source analysis identifies 9,157 unique production content MDX modules under `src/content`: 6,719 docs, 1,449 partials, 988 changelog entries, and one compatibility-flags entry. The direct-Rolldown corpus contains exactly those paths. An instrumented local default-profile Astro build observed exactly 9,157 handler calls over 9,157 distinct IDs, all successful, and its sorted ID set exactly matches the selected corpus. Two other repository MDX files are not selected by production content loaders and remain excluded. The instrumented run is coverage evidence, not benchmark evidence.

The kernel case passes every selected MDX file as a real Rolldown entry, runs the initialized `@mdx-js/rollup` and `@astrojs/mdx-postprocess` chain, and externalizes every import emitted by MDX. It therefore measures real source, compiler, project remark/rehype, Starlight, Expressive Code, Astro postprocess, Rolldown parse, and Rolldown generation work. It is an upper-bound kernel case, not the full Cloudflare application graph or a replacement for static route generation. The separate graph adapter maps `~/*`, retains experiment-resolved project-local server edges, handles Astro modules, and fails a local miss under its declared boundary.

The kernel invokes the initialized compiler `transform` and `buildEnd` hooks but does not delegate the compiler plugin's `resolveId`; blanket import externalization hides that omission. The completed graph adapter resolves every project-local edge through its independent strict server-graph resolver and fails any local miss, but it still does not exercise the compiler plugin's own `this.resolve` context. Exact resolver-context parity therefore remains outside this transform-stage claim even though local graph reachability is proven.

The adapter does not execute a Vite build or use Vite to load `astro.config.ts`. It registers the pinned project's `tsx` loader plus a tiny loader for Starlight's `.jsonc?raw` themes, imports the config directly, runs Astro's validation and integration setup hooks, and extracts the configured MDX plugins. Astro's integration implementation still imports Vite utilities transitively; that dependency import is included in initialization cost, but no Vite builder or Vite module graph runs.

## MDX/server graph case

The independent graph runner preserves every project-local server edge emitted by the selected MDX modules: `~/*`, relative paths, `src/*` base-URL paths, JS/TS/TSX/JSON, raw imports, assets, and Astro components. Astro components are compiled with the pinned standalone `@astrojs/compiler`; their server imports remain internal. Local CSS and asset imports become explicit internal leaf modules. An unresolved project-local edge fails the build. Only Astro runtime imports, Node.js built-ins, and bare package imports are external.

The graph boundary excludes Astro's CSS virtual-module graph, CSS dependency traversal, hoisted and client scripts, hydration and client inputs, route rendering, final asset emission, and the production MDX plugin's own `resolveId` context. The result counts the Astro exclusions from standalone compiler metadata, including CSS blocks and bytes, client script kinds and bytes, local client edges, and hydration components. The smoke compares the ordinary plugin, a plugin-owned managed worker pool, and ParallelPlugin. Graph hashes, boundary hashes, and narrowly normalized generated-output hashes must match. Raw generated-output differences are localized to the recorded multipart-boundary nondeterminism. Raw per-module code hashes are retained but were neither normalized nor diff-localized, so module-code parity is not claimed. Ordinary and the plugin-owned pool must retain `meta.astro`; current ParallelPlugin loses it and records that semantic defect separately from graph and normalized-output parity.

Graph output records both raw bytes/hash and a correctness-only normalized bytes/hash. The normalizer runs only on output files whose source MDX contains an actual `playground` fence, decodes generated Workers Playground URLs, replaces only Undici's random multipart boundary, and re-encodes the URL. Raw differences remain in the result; formal cross-variant output parity uses the normalized hash. This does not normalize other output or hide unrelated nondeterminism.

This graph profile always uses `RUN_LINK_CHECK=false`, and every result records that fact. A separate local semantic probe enables the link validator because its rehype plugin writes a `globalThis` Map. ParallelPlugin workers each mutate an isolate-local Map that is not merged into the coordinator. This is a current semantic defect, not an omitted performance detail; correct behavior requires an explicit coordinator or reduction protocol. Timings from that probe are discarded.

The graph runner defaults to `instrumentation:false`, and the full wall profile requires it. JavaScript counters and Rolldown worker metrics are intentionally absent from those wall samples. Managed worker instrumentation is not implemented and is rejected rather than silently changing the comparison.

Run the lifecycle-fixed 32-source ordinary/managed-2/worker-2 graph correctness lane. The earlier five-entry config and artifact remain historical provenance rather than a new executable default:

```bash
node experiments/cloudflare-mdx/run-graph-smoke.mjs \
  experiments/cloudflare-mdx/scale-graph-smoke-config.json \
  experiments/cloudflare-mdx/data/scale-v1-32-lifecycle-fixed-graph-correctness.raw.json
```

The completed one-shot 9,157-entry graph result is `data/2026-07-12-graph-full-scan.raw.json`. It reaches 11,105 server-side modules, 26,357 static edges, and zero unresolved local edges, with graph, boundary, and normalized-output parity. Raw generated-output differences are localized to the recorded multipart boundary; raw module-code hashes also differ, but their cause was not diff-localized and no module-code parity claim is made. ParallelPlugin loses MDX metadata. Its timing is a single sample and is not a performance conclusion.

The first local five-block attempt was interrupted during the fourth block when the already swap-heavy host entered severe memory thrashing. No partial timing report was written, and the abort record is explicitly benchmark-ineligible. Re-run only after restarting the local host.

`graph-formal-matrix.json` is now a disabled post-screen template rather than an executable worker-four assumption. After the scale screen and repeated fixed-count selection finish, populate both its confirmed crossover point and selected worker count. The enabled matrix must contain exactly the confirmed crossover and full 9,157-source prefixes, with ordinary, plugin-managed, and Rolldown-managed placement at that count for ten rotated blocks per point. The runner validates exact prefix hashes and all 20 blocks; the summarizer rejects missing cases, variants, blocks, or any of the expected 60 runs. It also consumes the passed correctness gate, refuses active CI markers, and enforces the frozen host policy.

```bash
node experiments/cloudflare-mdx/run-graph-matrix.mjs \
  experiments/cloudflare-mdx/graph-formal-matrix.json \
  experiments/cloudflare-mdx/data/graph-local.raw.json
node experiments/cloudflare-mdx/summarize-graph-matrix.mjs \
  experiments/cloudflare-mdx/data/graph-local.raw.json \
  experiments/cloudflare-mdx/data/graph-local.summary.json
```

## Pins

- Cloudflare Docs: `2b08a67a41da1a521aecbcf465893abae1e9a6df`.
- Node.js: `v24.18.0`.
- Historical Rolldown research runtime: `research/parallel-js-plugin-core-transform` at `0aa600b5721b852cdc4095c7122a929a8cb4a798`.
- Historical binding SHA-256: `deec0b2cb7a12e507ff223e12535c3280ab5fe8371f2fcc92f9db206163f1c5d`; dist SHA-256: `e30311e764bae7fba9afe27665db741d556a7c3728eb67cfbe7ce0fed3135ebc`.
- This historical runtime contains the research worker-count and transform instrumentation but still unrefs the parent worker too early. It is retained for source provenance and historical correctness replay, not as the next formal baseline.
- Lifecycle-fixed scale baseline: `b144106882fe244b19b738fc0acf3ffa07c7c9f3`; binding SHA-256 `7b8863bb28aefd2e2eb7409f8be6dae57a252fe4a2688383007be7ea2f847bf7`; dist SHA-256 `1efffd0b63483e77cd2854fe716941000ae9548768691d7b5a64dceb011f3c45` over 17,095,091 bytes.
- Attribution-only runtime: `8e35a2249b60b65120a44d1d896eeeed19dc703b`; binding SHA-256 `6b7dfa175754ac57650768a68d7a567c5c0635a1bb47d47c5287914594c9795e`; dist SHA-256 `68f57be9a8883a4ca6f28b57a9bac6e16907d8c1d079686ab9921b407b132735`. Its checkout path is configurable, but `run-case.mjs` requires a clean checkout with the exact commit and artifacts.

## Frozen scale harness

Scale evidence uses the committed [`cloudflare-mdx-scale-v1` manifest](./data/cloudflare-mdx-scale-v1.json), never the earlier lexicographic `limit`. The manifest starts with the compatibility source, stratifies the remaining 9,156 sources by collection, parsed fenced-code feature class, and equal-count byte band, orders paths inside each stratum by a seeded SHA-256, and uses deterministic deficit round robin across collections and strata. It records every source hash plus frozen base/refinement prefix hashes and summaries. The 32-source prefix therefore contains 23 docs, five partials, three changelog entries, and the compatibility anchor rather than 32 changelog entries.

Regenerate the manifest from the clean pinned Cloudflare checkout, then verify byte-for-byte reproducibility, prefix hashes, source hashes, matrix definitions, and the rare-syntax sentinel without running a build:

```bash
node experiments/cloudflare-mdx/prepare-scale-manifest.mjs \
  /Users/yunfeihe/Documents/github-opensource/.worktrees/cloudflare-docs-rolldown-build
node experiments/cloudflare-mdx/verify-scale-harness.mjs \
  /Users/yunfeihe/Documents/github-opensource/.worktrees/cloudflare-docs-rolldown-build
```

The execution definitions are:

- `scale-smoke-matrix.json`: correctness-only 32-source ordinary/worker timeline admission.
- `scale-full-correctness-matrix.json`: the separate required full-corpus exact-once and deterministic-output admission, with two fresh ordinary and worker-four runs. Each run retains exact per-source hit/worker records and aggregate worker/map counters. Correctness runners launch Node directly without `/usr/bin/time` and emit no timestamps, durations, CPU, RSS, host samples, or timeline fields. The adapter's 9,157 null maps and zero non-null maps are an explicit product capability failure under protocol amendment 2, not a map-parity pass.
- `scale-correctness-gate.json`: remains blocked until lifecycle-fixed full-corpus and semantic artifacts exist and are pinned by SHA-256.

The correctness counter mode does not call `performance.now`, `process.hrtime`, CPU/RSS APIs, or host samplers. It records only exact identity, hit, worker, map-result, and completion-state counters; clock and duration columns are exclusive to attribution reports.
- `scale-base-screen-matrix.json`: one uninstrumented, no-warmup rotated screen of ordinary and worker counts one through eight at every base scale. It remains disabled until the correctness gate passes.
- `scale-refinement-matrix.json`: a deliberately non-executable catalog. Populate it only with points inside the first direction-changing base interval.
- `scale-attribution-matrix.json`: the disabled formal ordinary/worker-four/worker-eight attribution lane over the full 9,157-source prefix. It is never wall or correctness evidence and cannot execute before the correctness and host gates pass.
- `scale-graph-smoke-config.json`: the 32-source server-graph correctness lane.
- `scale-semantic-sentinel.json`: executable correctness-only coverage for the existing graph smoke, all six playground sources, fixed docs/partials Mermaid sources, and the invalid diagnostic fixture. It retains structured diagnostic differences as product failures.

Configuration can be checked without launching Rolldown:

```bash
node experiments/cloudflare-mdx/run-matrix.mjs --check-config \
  experiments/cloudflare-mdx/scale-base-screen-matrix.json
node experiments/cloudflare-mdx/run-graph-smoke.mjs --check-config \
  experiments/cloudflare-mdx/scale-graph-smoke-config.json
node experiments/cloudflare-mdx/run-semantic-sentinel.mjs --check-config \
  experiments/cloudflare-mdx/scale-semantic-sentinel.json
node experiments/cloudflare-mdx/verify-correctness-gate.mjs
node experiments/cloudflare-mdx/run-attribution-matrix.mjs --check-config \
  experiments/cloudflare-mdx/scale-attribution-matrix.json
node experiments/cloudflare-mdx/verify-attribution-harness.mjs
node experiments/cloudflare-mdx/verify-scale-followup.mjs
node experiments/cloudflare-mdx/verify-mdx-policy.mjs
```

Run the two untimed lifecycle-fixed admission artifacts before any performance matrix:

```bash
node experiments/cloudflare-mdx/run-matrix.mjs \
  experiments/cloudflare-mdx/scale-full-correctness-matrix.json \
  experiments/cloudflare-mdx/data/scale-v1-9157-lifecycle-fixed-correctness.raw.json
node experiments/cloudflare-mdx/run-semantic-sentinel.mjs \
  experiments/cloudflare-mdx/scale-semantic-sentinel.json \
  experiments/cloudflare-mdx/data/scale-v1-semantic-lifecycle-fixed-correctness.raw.json
```

Both are correctness-only and emit no build wall, CPU, `/usr/bin/time`, or peak-RSS evidence. After they pass, pin their SHA-256 values in `scale-correctness-gate.json`, change that gate to `passed`, re-run its verifier, and only then enable the base screen.

Every new runner child pins and records `ROLLDOWN_WORKER_THREADS=18`, `RAYON_NUM_THREADS=12`, and `ROLLDOWN_MAX_BLOCKING_THREADS=4`. Performance matrices additionally refuse active CI, require AC power, low-power mode off, no thermal/performance warning, no competing study build/test/indexer process, uptime at most 24 hours, starting swap at most 512 MiB, one-minute load at most 2.0, summed process CPU at most 150%, and `memory_pressure -Q` free percentage at least 50%. Transient load/CPU/memory failures are retried every ten seconds for at most five minutes; the other starting failures abort immediately. A child with any pageout or swapout delta aborts the matrix. The pre-restart host remains ineligible for performance evidence; manifest/configuration checks and explicitly untimed correctness admission may run, but their resource observations cannot be promoted to timing claims.

Correctness admission additionally pins Node `v24.18.0`, the `pnpm@11.12.0` recorded in the installed layout, the project package/lock/workspace files, the installed pnpm layout, and the resolved Astro/MDX/compiler/tsx versions and package-tree hashes. Each correctness artifact embeds a complete hash manifest of the executable MDX harness sources and frozen input files; the gate regenerates both environment and harness provenance instead of depending on an uncreated future commit.

Instrumented cases allocate five shared 64-bit columns per selected ID: exact hit count, service duration, worker index, process-wide monotonic kernel start, and kernel end. Each isolate also records a `performance.timeOrigin + performance.now()` epoch bracket around one `process.hrtime.bigint()` sample, including uncertainty, so JavaScript intervals can be aligned with Rust/lifecycle clocks without relying on the application-patched `Date`. The result retains every start/end nanosecond timestamp and derives concurrency, per-worker busy intervals, idle gaps, final completion, and the last-start-to-last-completion tail. Instrumented child capture is explicitly 64 MiB and `ENOBUFS` aborts instead of accepting a truncated trace. `verify-metrics-timeline.mjs` checks a two-worker overlap, epoch brackets, and that the uninstrumented wall lane bypasses the metrics wrapper. Instrumentation remains forbidden in wall matrices.

Runtime provenance is a separate frozen axis. Commit `0aa600b5721b852cdc4095c7122a929a8cb4a798`, binding SHA-256 `deec0b2cb7a12e507ff223e12535c3280ab5fe8371f2fcc92f9db206163f1c5d`, and dist SHA-256 `e30311e764bae7fba9afe27665db741d556a7c3728eb67cfbe7ce0fed3135ebc` remain classified `historical-0aa-artifact`: a fresh no-timer direct build reproduces the parent `Worker.unref()` code-13 early exit, while harness or plugin timers can accidentally keep it alive. Historical correctness success therefore makes no lifecycle claim. Runnable scale wall and correctness matrices pin `lifecycle-fixed-baseline` commit `b144106882fe244b19b738fc0acf3ffa07c7c9f3`, binding `7b8863bb28aefd2e2eb7409f8be6dae57a252fe4a2688383007be7ea2f847bf7`, and dist `1efffd0b63483e77cd2854fe716941000ae9548768691d7b5a64dceb011f3c45`; its sole runtime change from 0aa removes the early parent-worker unref behavior. The base screen remains blocked on lifecycle-fixed correctness. The separate attribution lane pins `8e35a2249b60b65120a44d1d896eeeed19dc703b`, binding `6b7dfa175754ac57650768a68d7a567c5c0635a1bb47d47c5287914594c9795e`, and dist `68f57be9a8883a4ca6f28b57a9bac6e16907d8c1d079686ab9921b407b132735`; it enables both JavaScript and Rust instrumentation and is never accepted as wall or correctness baseline evidence. The runner rejects the historical artifact as performance or lifecycle evidence and rejects the instrumented build used outside attribution; `verify-runtime-profile.mjs` and `verify-attribution-harness.mjs` exercise these gates.

After a passed base screen exists, generate the first confirmation matrix mechanically. The generator selects the fastest screened worker and adjacent eligible counts at each required scale, always includes worker four and worker eight as deduplicated fixed policy candidates, and emits ten no-warmup rotated blocks. Its decision exposes compact per-scale/per-variant policy evidence with wall, CPU, RSS, resource eligibility, paired regression upper bound, and the selected resource-eligible oracle count:

```bash
node experiments/cloudflare-mdx/generate-scale-followup.mjs confirmation \
  experiments/cloudflare-mdx/data/scale-base-screen.raw.json \
  --output experiments/cloudflare-mdx/scale-generated-confirmation-matrix.json
```

Run the generated matrix with `run-matrix.mjs`. Then feed the passed report back to `refine`; each invocation either emits the next one-shot refinement screen, emits the selected ten-block refinement confirmation after that screen passes, or returns an exact/censored terminal result. Add prior follow-up artifacts in execution order. `--validate-only` performs all provenance, host, output, block, frozen-prefix, best-worker, adjacency, artifact-chain, bootstrap, and next-step checks without writing a matrix or launching a build.

```bash
node experiments/cloudflare-mdx/generate-scale-followup.mjs refine \
  experiments/cloudflare-mdx/data/scale-base-screen.raw.json \
  experiments/cloudflare-mdx/data/scale-initial-confirmation.raw.json \
  --output experiments/cloudflare-mdx/scale-generated-next-matrix.json
node experiments/cloudflare-mdx/generate-scale-followup.mjs refine \
  experiments/cloudflare-mdx/data/scale-base-screen.raw.json \
  experiments/cloudflare-mdx/data/scale-initial-confirmation.raw.json \
  --validate-only
```

The attribution runner separately executes exactly one ordinary, worker-four, and worker-eight process. Every child must pass the frozen host gate and the lifecycle-fixed normalized-output oracle. The report retains process and main-thread CPU, cumulative CPU for every worker, residual native/runtime CPU, sampled and `/usr/bin/time` RSS, main and worker heap/ELU/GC, one process-level native module-init record, worker initialization and termination, raw Rust arrival/acquire/complete events, permit-to-thread identity, ready and busy intervals, service distributions, widths, and throughput. Its derived per-worker service profile exposes the frozen worker-local cold call ordinals 1, 2, 4, 8, 16, and 32 plus statistics for the last 256 completed calls as the steady-service window, so initialization and JIT analysis does not have to infer cold behavior from aggregate totals. Missing, empty, or non-derived records reject the run. Its output remains `timingEligible:false` and `conclusionEligible:false`.

After the MDX follow-up chain returns an exact terminal decision, the allocation generator derives the repeated lower, crossover, confirming, and full points directly from those artifacts. Pass the base screen once, every crossover artifact in order, and then each generated policy report in order. The first matrix screens Tokio `4/8/12/18` against ordinary and worker one through eight with Rayon 12 and blocking 4; subsequent matrices repeat both the selected Tokio pool and a different-pool runner-up, screen Rayon `4/8/12` at the repeated Tokio winner, and repeat both the selected Rayon pool and a different-pool runner-up. The exact base-screen execution template and a normalized-output oracle for every selected scale are carried by the crossover chain. `--validate-only` reloads and re-derives the complete chain without writing or executing a matrix.

```bash
node experiments/cloudflare-mdx/generate-mdx-policy.mjs allocation \
  --base-screen experiments/cloudflare-mdx/data/scale-base-screen.raw.json \
  --crossover experiments/cloudflare-mdx/data/scale-initial-confirmation.raw.json \
  --crossover experiments/cloudflare-mdx/data/scale-refinement-screen.raw.json \
  --crossover experiments/cloudflare-mdx/data/scale-refinement-confirmation.raw.json \
  --output experiments/cloudflare-mdx/mdx-generated-policy-matrix.json
node experiments/cloudflare-mdx/run-policy-matrix.mjs \
  experiments/cloudflare-mdx/mdx-generated-policy-matrix.json \
  experiments/cloudflare-mdx/data/mdx-policy-stage.raw.json
node experiments/cloudflare-mdx/summarize-policy-matrix.mjs \
  experiments/cloudflare-mdx/data/mdx-policy-stage.raw.json \
  experiments/cloudflare-mdx/data/mdx-policy-stage.summary.json
```

The quota generator additionally requires the exact passed schema-2 cpulimit calibration and derives only the crossover and full points. It first screens 400%, 800%, and 1,200% over ordinary and worker one through eight, then generates ten-block confirmations containing the unthrottled oracle, quota-screened best and adjacent counts, worker four, and worker eight. The runner starts `/usr/bin/time -l` directly around a stopped Node child and attaches cpulimit to that exact Node PID before build import. Controller target PID, control/stop cycles, stopped duration, aggregate CPU ceiling, direct Node wall/CPU/RSS, bounded attachment and cleanup, host paging, and the per-scale crossover output oracle are mandatory. Instrumentation is rejected, so these runs cannot be reused for service or initialization attribution. `node experiments/cloudflare-mdx/run-policy-matrix.mjs --verify-process-control` is the build-free smoke test for the direct timing wrapper plus ready- and attach-timeout cleanup.

```bash
node experiments/cloudflare-mdx/generate-mdx-policy.mjs quota \
  --base-screen experiments/cloudflare-mdx/data/scale-base-screen.raw.json \
  --crossover experiments/cloudflare-mdx/data/scale-initial-confirmation.raw.json \
  --crossover experiments/cloudflare-mdx/data/scale-refinement-screen.raw.json \
  --crossover experiments/cloudflare-mdx/data/scale-refinement-confirmation.raw.json \
  --calibration tmp/bench/cpu-rate-calibration.json \
  --output experiments/cloudflare-mdx/mdx-generated-quota-matrix.json
```

Every allocation and quota raw report is `timingEligible:true` but `conclusionEligible:false`; only the chain-aware summarizer emits the standard `policyEvidenceByCase`. Configured Tokio, Rayon, blocking, and JavaScript capacities remain exact input dimensions and are never summed or reported as observed CPU.

## Commands

Install the candidate's frozen dependencies in its isolated worktree, then restore any package-manager metadata written by the installer before recording provenance. Run all samples with the pinned Node binary and a clean candidate tree.

Generate the legacy full-corpus inventory and runtime manifest. This does not define scale prefixes:

```bash
node experiments/cloudflare-mdx/prepare-manifest.mjs \
  /Users/yunfeihe/Documents/github-opensource/.worktrees/cloudflare-docs-rolldown-build \
  /Users/yunfeihe/Documents/github-opensource/.worktrees/rolldown-parallel-js-plugin-core-transform/packages/rolldown
```

The old direct historical commands and unclassified `smoke-matrix.json` are intentionally rejected by the new runners. The `0aa/deec/e303` triple may be executed only by an explicitly classified, untimed `historical-replay`; retained historical artifacts remain the default source for those observations. New correctness uses the lifecycle-fixed matrices above, and new performance cannot execute until the correctness gate passes.

Reproduce the original Astro MDX handler count only after verifying that `node_modules/@astrojs/mdx/dist/vite-plugin-mdx.js` has SHA-256 `35c1e5496f3ea29671bdad54e607aec07280e3fcf5cd4a162e52484d32f2e932`. Apply `astro-mdx-counter.patch` to that installed file, run `run-astro-reference.mjs <candidate-root> <empty-output-dir> default mdx-counter`, then reverse the patch and verify the original hash again. The runner accepts only the recorded original or instrumented hash and marks the counter run ineligible for benchmark conclusions.

`run-case.mjs` deletes `ASTRO_PERFORMANCE_BENCHMARK`, `BUILD_TARGET`, and `RUN_LINK_CHECK`, sets `NODE_ENV=production`, changes cwd before workers start, and uses the candidate's own pinned dependencies. It requires an explicit evidence kind and runtime profile. Direct case execution still does not enforce the local host gate; scale evidence must use `run-matrix.mjs`, which refuses unclassified matrices, consumes the correctness gate, refuses active CI markers, clears them from children, pins every pool environment value, and performs admission before each measured child. Uninstrumented wall runs leave both JavaScript and Rust metrics disabled. Instrumented runs set `instrumentation: true`; the matrix enables Rust metrics only for worker variants.

## Reproducibility limitations

The retained raw artifacts preserve source and runtime pins, commands, sample outputs, host snapshots, and the measurements used by this report, so the numerical summaries can be reconstructed. They do not permit an exact historical replay. The two original Astro provenance records hash earlier `run-astro-reference.mjs` sources as `9fa454b4ed4753b908726609b8180dca1510856226ea9ef8e3c7094e2758fa4b` and `1889f085e8ff4331732d2cd4bad88d55d4712acbec1483051ea719a1c671eefe`, but those exact sources were not retained. The ten-block kernel inputs do not record a runner hash, the parent CI-marker values, or `executionScope`. Current local matrix runners refuse active CI markers, record `executionScope: local-only`, capture their own source hash and effective environment, and summaries become benchmark-ineligible when provenance or host policy fails. A restarted quiet-host rerun with the final committed scripts is required for clean-host formal confirmation.

The adapter fixes `Date` at `2026-07-12T00:00:00.000Z` in every ordinary or worker isolate. Cloudflare's GraphQL Expressive Code plugin otherwise embeds the current date or time into generated links, so sequential ordinary and worker runs would differ even when execution semantics match. This normalization changes only that pre-existing time-dependent input and is identical across variants.

## Correctness gates

- The selected entry count must equal the instrumented JavaScript handler count.
- Ordinary and every worker count must emit the same chunk count, narrowly normalized bytes, and narrowly normalized SHA-256 from the same checkout path and prerender environment. Raw bytes and hashes remain recorded and differ only where the source-gated Undici multipart boundary is present.
- Graph hash, graph boundary, normalized output, and explicit omission counts must match across variants. Raw module-code and raw output parity are not claimed. The production compiler map is null, so this case makes no non-null map or source-map-chain claim.
- The graph runner directly observes `meta.astro` falling from 9,157 modules in ordinary and plugin-managed execution to zero under current ParallelPlugin. `meta.vite` travels through the same returned `meta` object but was not counted independently. This semantic defect blocks a production-behavior claim even when normalized output matches.
- Every worker count must match the requested lifecycle count and finish with no queued, outstanding, or in-flight calls.
- Formal diagnostics must compare a real invalid MDX input and retain the known ordinary-versus-worker attribution difference rather than hiding it.
- The completed graph case gates project-local module reachability, allowed externals, metadata coverage, normalized output, and its explicit boundary. Production `resolveId`, metadata consumption, diagnostics, and full lifecycle behavior remain outside that adapter.

## Interpretation

The uninstrumented local default-profile Astro reference completed in 689.01 seconds wall time and Astro reported 8,650 pages in 11m25s: 11.77 seconds of content and build-info setup, 4m40s for the server Vite/Rollup build, 12.21 seconds for the client build, 6m17s for static routes, and 495 ms for cached image output. Exact transfer of the direct-Rolldown kernel's 34.86-second median saving would illustrate only about a 5% reduction; it is not an integrated speedup or upper bound. The untouched 377-second static-route phase alone exceeds half of the reference build. Cloudflare supplies strong repeated local evidence for a greater-than-2x JavaScript transform-stage opportunity but cannot support a 2x complete-build claim under this adapter boundary.
