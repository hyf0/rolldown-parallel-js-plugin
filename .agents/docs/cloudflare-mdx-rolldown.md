# Cloudflare Docs MDX Direct-Rolldown Adaptation

Status: locally measured on 2026-07-12. The 9,157-module MDX kernel supplies strong repeated local evidence for a worker-throughput win, while host-policy and historical-provenance failures prevent clean formal confirmation. The complete local Astro build and graph-preserving scan show why the stage result does not imply a 2x application build. The current ParallelPlugin implementation is research-valuable but not production-compatible because it loses module metadata and isolate-local plugin state, and it has not shown an incremental wall-time advantage over a plugin-managed worker pool.

## Question and attribution boundary

Cloudflare Docs at `2b08a67a41da1a521aecbcf465893abae1e9a6df` supplies 9,157 real production content MDX modules: 6,719 docs, 1,449 partials, 988 changelog entries, and one compatibility-flags entry. The selected sources total 32,619,831 bytes and have manifest SHA-256 `84077a08f660782274d5502be25f0ec9297cec9c52508e2c5e9e2a3e8bedc12b`.

The experiment has three distinct comparisons. The unmodified local `astro build` is an end-to-end duration and behavior reference. The ordinary direct-Rolldown adapter is the main-thread baseline for the adapted MDX stage. The same adapter in Node.js workers measures worker value. Only ordinary direct Rolldown versus worker execution supports a worker speedup claim; the original Astro command is never compared with Rolldown to claim a bundler or ParallelPlugin speedup.

Every benchmark process in this record was launched on the local M3 Pro rather than a CI service. The direct artifacts record the default profile and `RUN_LINK_CHECK=false`; the original Astro provenance also records `CI=null`, while the earlier ten-block kernel runner did not persist the `CI` variable. A separate `RUN_LINK_CHECK=true` run is retained only because it exposed an isolate-state correctness defect; its timings are excluded from performance conclusions.

## Pinned environment and transform

- Host: Apple M3 Pro, 12 logical CPUs, 36 GiB RAM, arm64 Darwin.
- Runtime: Node.js `v24.18.0` from `/Users/yunfeihe/.vite-plus/js_runtime/node/24.18.0/bin/node`.
- Candidate: Cloudflare Docs `2b08a67a41da1a521aecbcf465893abae1e9a6df`, Astro `6.4.7`, `@astrojs/mdx` `6.0.3`, and its frozen lockfile.
- Rolldown runtime: research revision `0aa600b5721b852cdc4095c7122a929a8cb4a798`, binding SHA-256 `deec0b2cb7a12e507ff223e12535c3280ab5fe8371f2fcc92f9db206163f1c5d`, and aggregate distribution SHA-256 `e30311e764bae7fba9afe27665db741d556a7c3728eb67cfbe7ce0fed3135ebc`.
- Adapter: directly resolves the pinned `astro.config.ts`, runs Astro integration setup and completion hooks, then uses the initialized `@mdx-js/rollup` and `@astrojs/mdx-postprocess` transform pair. It does not run a Vite builder or Vite module graph.

The adapter fixes `Date` at `2026-07-12T00:00:00.000Z` in every isolate because Cloudflare's GraphQL Expressive Code plugin otherwise embeds the current time. A second production nondeterminism comes from Undici generating a random multipart boundary for Workers Playground URLs. Correctness comparison normalizes only seven URLs emitted from the six source files that contain real `playground` fences; raw output remains recorded, and no unrelated file is normalized. Production source maps are disabled, so this work makes no non-null source-map or map-chain claim.

## Repeated kernel result

The kernel makes every production MDX file a real Rolldown entry, applies the production transform pair, and externalizes imports emitted by MDX. This preserves the real source and transform cost but is an upper bound because it does not retain the project-local server graph.

Ten rotated local blocks ran ordinary, a plugin-managed four-worker `node:worker_threads` pool, and Rolldown-managed ParallelPlugin with four workers in fresh processes. Instrumentation was disabled, a 15-second cooldown separated samples, all 30 processes succeeded, and every sample produced 9,157 chunks, 166,149,564 normalized bytes, and normalized SHA-256 `1840488b4a0d37a15851ea5dbc41e33f17cb1e9722b23c3048535d4d62274484`.

| Variant | Median wall | Range | Median CPU | Median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Ordinary main thread | 63.089 s | 60.308–67.560 s | 78.956 s | 3.126 GB |
| Plugin-managed workers ×4 | 26.779 s | 23.014–43.915 s | 130.994 s | 3.938 GB |
| Rolldown-managed workers ×4 | 28.226 s | 24.954–36.703 s | 129.624 s | 4.133 GB |

The paired ordinary-to-plugin-managed median speedup is 2.386x with a bootstrap 95% interval of 2.234–2.578. The paired ordinary-to-Rolldown-managed median is 2.178x with a bootstrap 95% interval of 2.129–2.369. The plugin-managed-wall to Rolldown-managed-wall ratio has median 0.927 and bootstrap 95% interval 0.874–1.034, which crosses parity. This supplies strong repeated local evidence for worker value at this stage but does not establish an additional wall-time benefit from Rolldown-owned scheduling.

Workers purchase that wall reduction with more total work and memory. Relative to ordinary, the Rolldown-managed median CPU ratio is 1.648 and median peak-RSS ratio is 1.359; the plugin-managed ratios are 1.638 and 1.214. The host already had about 16 GiB of swap allocated and persistent background load. Every ten-block sample observed pageouts, four Rolldown-managed samples observed new swapouts, and several samples began above the background-CPU threshold. The observed repeated wall interval stays above 2x, but this is not a clean-host formal confirmation; precise resource ratios and the managed-versus-Rolldown comparison need a restarted, quiet local host.

## Worker count, initialization, and sustained execution

The local screening wall times were 59.47 s ordinary, 62.26 s with one worker, 38.63 s with two, 25.01 s with four, and 27.80 s with eight. One worker cannot repay isolation and transport, four workers are best on this 12-logical-CPU host, and eight regress while also using more CPU and memory. The screen does not isolate whether CPU competition, memory pressure, scheduling, JIT, or another interaction caused the regression.

The full instrumented four-worker run observed exactly 9,157 distinct handler IDs and 9,157 value results, with no missing, duplicate, unknown, errored, cancelled, queued, outstanding, or in-flight calls at shutdown. The four workers processed 2,367, 2,398, 2,350, and 2,042 modules. Pool readiness took about 2.0 seconds; each worker's production compiler factory took about 1.94–1.95 seconds. This is measurable but not the dominant cost at this scale. The run copied 32,619,831 input bytes and returned about 167.17 MB of transform code. Rolldown made almost the full corpus ready immediately: the permit queue peaked at 9,146 and only four transforms were in service at once.

Ordinary asynchronous handler overlap reached 701 because many transforms await shared compiler and plugin work; the summed ordinary handler elapsed time is therefore not CPU time and must not be used as a transform-share estimate. Worker-local compiler instances turn that overlapping work into four independent service lanes, but total CPU rises by about 65%.

## Graph-preserving result

The graph adapter retains all project-local server-side alias, relative, absolute, JS, TS, TSX, JSON, raw, asset, CSS-leaf, MDX, and Astro edges found by its strict experiment-owned resolver and fails on any unresolved local import. It does not execute the production MDX plugin's own `resolveId` or its plugin context. Its one-shot full scan reached 11,105 modules and 26,357 static edges: 6,907 project-local, 19,447 external, and three internal runtime edges. The graph contains 9,157 MDX modules, 137 Astro module instances from 110 physical files, 62 JavaScript modules, 1,733 asset leaves, 11 raw leaves, four data modules, and one CSS leaf. All variants emitted 9,232 chunks, 177,481,238 normalized bytes, normalized SHA-256 `ccd4c151531c0877150f7375bc83e6d24ae130ba9e619ff317bbb00b4e6a29f4`, the same graph hash, and zero unresolved local edges.

The boundary explicitly excludes Astro's CSS virtual-module graph, 54 compiled CSS blocks, 27 client-script blocks, nine client specifier edges, 26 hydrated components, route rendering, and final asset emission. It is therefore a Cloudflare MDX/server graph, not the full Astro application.

The one-shot local wall times were 65.462 s ordinary, 24.924 s plugin-managed four-worker, and 43.007 s Rolldown-managed four-worker. These samples establish that the graph adapter works and that plugin-managed workers can retain the graph, but one sample is not a performance conclusion. The 43-second Rolldown-managed result conflicts with the repeated externalized kernel, so repeated graph blocks are required before attributing that difference to scheduling rather than host noise or graph interaction.

A local-only five-block graph matrix was attempted with an active-CI refusal and per-sample host counters. It was interrupted without a partial timing artifact during the fourth block when the worker sample exceeded 103 seconds, load reached 38.51, free pages fell to about 56 MiB, and the host continued swapping. Those discarded samples support no timing claim; repeated graph performance remains unresolved until the local host is restarted.

## Original local build and whole-build interpretation

One uninstrumented local default-profile `astro build` completed successfully in 689.01 seconds wall time, 1,013.31 seconds user CPU, 78.27 seconds system CPU, and 7.86 GB maximum RSS with zero swaps reported for the process. Astro reported 8,650 pages in 11m25s: content and build-info setup 11.77 s, the server Vite/Rollup build 4m40s, the client build 12.21 s, and static route generation 6m17s. Cached generation of 1,632 image outputs took 495 ms.

A separate instrumented local default-profile build observed 9,157 MDX handler calls, 9,157 distinct IDs, 9,157 completions, and zero failures. Its sorted ID set exactly equals every `.mdx` path under the four selected production content collections, so the direct corpus is the real production handler set rather than only a source-count estimate. The handler window spanned about 71.8 seconds and reached 183 overlapping asynchronous calls; summed handler elapsed was about 461.8 seconds because awaits overlap. Instrumentation and cache state changed this run, so none of those timing values are used as benchmark data.

The direct kernel reduces its own median from 63.09 s to 28.23 s, an absolute saving of about 34.86 s. Transferring that saving exactly into the 689-second Astro reference would illustrate only about a 5% reduction, not an integrated speedup or upper bound, because the adapter does not establish that its 63-second ordinary work maps one-for-one to the production server-bundle phase. Under this adapter boundary, the untouched 377-second static-route phase alone exceeds half of the complete build. Cloudflare Docs demonstrates that 9,157 mandatory transforms and a 2x transform-stage win are still insufficient when the transform is not most of the application critical path.

## Semantic and product blockers

- ParallelPlugin drops returned metadata. The graph runner directly observes `meta.astro` falling from 9,157 modules in ordinary and plugin-managed execution to zero in Rolldown-managed execution. `meta.vite` uses the same returned object but was not counted separately. Normalized output parity in this adapter does not repair that semantic loss.
- `starlight-links-validator` stores per-module headings and links in a `globalThis` Map. Worker-local copies never reach the coordinator: the ordinary exploratory profile collected all entries while both worker models collected zero. A correct design must return per-module state for deterministic coordinator reduction or keep that stateful step on the main thread. The timings from this profile are not benchmark evidence.
- Random Undici multipart boundaries account for the diff-localized raw generated-output differences. Raw per-module code hashes also differ, but they were neither normalized nor diff-localized, so their cause and parity remain unproven. Correctness checks need a source-specific normalizer or the production plugin must accept an injected deterministic boundary.
- Cloudflare diagnostics parity is open. The original build attributes MDX, unused-import, `eval`, route-conflict, missing-entry, and plugin-specific warnings, while the direct runners silence normal diagnostics and no invalid-Cloudflare-MDX comparison ran. Separate controlled Vue, Svelte, transform, resolve, and load fixtures show that current ParallelPlugin failures lose ordinary hook and plugin attribution, but that mechanism evidence is not a Cloudflare-specific observation.
- Arbitrary closure state, module singletons, caches, output state, resolver context, lifecycle effects, crash behavior, and task failure are not transparently shareable across isolates. Worker-local caches are acceptable only when assignment and worker count cannot alter output.

## Current conclusion and next iteration

Parallel JavaScript plugins have strong repeated local value evidence when a build presents thousands of ready, mandatory, expensive, module-local JavaScript transforms: four workers more than halve this real MDX stage in the repeated noisy-host matrix. The value measured here comes from Node.js workers; current evidence does not show that Rolldown-owned placement is faster than a well-built plugin-owned pool. About two seconds of clean-build pool initialization can be optimized through lazy initialization or smaller worker modules, but sustained CPU allocation, worker count, load balance, compiler/JIT/cache duplication, metadata transport, state reduction, diagnostics, and failure semantics are larger product concerns. Garbage collection, memory bandwidth, and Rust-thread contention still need direct measurement.

Cloudflare Docs is a positive stage-level result and a negative whole-build candidate for the requested 15→7–8 or 30→15 minute outcome. The next production case should first prove that required JavaScript transforms occupy enough of a 15–30 minute direct-Rolldown critical path; module count alone is not an admission criterion. The next runtime study should compare a Rolldown-managed shared group, an explicit exclusive group, and plugin-owned pools under one CPU and memory budget, then test whether adjacent high-frequency transforms can run in order within one worker without breaking source-map chains, hook order, metadata, state, diagnostics, or error attribution.
