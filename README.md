# Rolldown Parallel JS Plugin Research

This repository is the research workspace for determining when running JavaScript plugins on Node.js worker threads improves Rolldown builds, what changes plugin authors need to make, and which runtime overheads are worth optimizing.

The mechanism-scale iteration is complete. Its experiments use Rolldown directly on Node.js 24.18.0, start with the retained ParallelPlugin `transform` path, use Vue and Svelte compiler cases after the controlled cost model, then measure `resolveId` and `load` separately. Those results establish behavior and cost but do not answer the production-scale target clarified on 2026-07-12.

## Active production-scale iteration

The production-scale `/goal` reached an inconclusive corpus result on 2026-07-12. Its finite candidate-search manifest was frozen before deep screening, with Cloudflare Docs, WordPress Gutenberg, and Elastic Kibana as the only selected candidates. All three failed the first admission rule because their production builds use Astro/Vite/Rollup, a multi-stage esbuild workflow, and webpack or Rspack respectively rather than direct Rolldown. No candidate entered adaptation, implementation, or timing. The intended workload remains a required user- or ecosystem-owned JavaScript transform that cannot reasonably be replaced wholesale with Rust, roughly 5,000 distinct project modules that execute its expensive handler, a repeated 15–30 minute ordinary direct-Rolldown build, and an end-to-end target of about 30→15 or 15→7–8 minutes. The bounded search did not find that workload and therefore does not decide ParallelPlugin's production value. [Production-scale goal](./.agents/docs/production-scale-goal.md), [candidate-search manifest](./.agents/docs/production-candidate-search.md), [candidate screening](./.agents/docs/production-candidate-screening.md)

The execution comparison includes ordinary main-thread execution, one-worker isolation, a plugin-managed `worker_threads` pool, a Rolldown-managed shared worker group that may host several plugins, and an explicitly exclusive group containing one or several workers. The companion multi-plugin case compares two plugin-owned pools with one shared Rolldown group under the same total budget. Every model uses the same pinned JavaScript behavior and global CPU and memory envelope. The iteration measures sustained per-worker service, CPU competition with Rust and native stages, ready work and load balance over time, RSS/JIT/cache/garbage-collection pressure, several ordered transforms in one worker, clean-build coordinator semantics, adaptation cost, cache determinism, and worker or task failure behavior.

Candidate source screening is active. An ordinary long-running trace is allowed only after source evidence leaves the duration, handler-count, or critical-path gate unresolved; plugin adaptation, parallel implementation, and the full plugin-managed/shared/exclusive matrix begin only after a candidate passes every admission rule.

## First-iteration questions

- Can the retained direct-Rolldown ParallelPlugin `transform` path run correctly on the latest Node.js LTS release?
- When does moving transform work off the Node.js main thread improve responsiveness without improving total build time?
- When do several worker-local plugin instances reduce total build time for independent transform calls?
- Which plugin state can be replicated, partitioned by module, moved into Rolldown, or reduced after parallel work?
- Where are the crossover points for worker startup, hook dispatch, string conversion, duplicated initialization, scheduling, and CPU contention with the Rust core?
- Can a direct-Rolldown JavaScript Vue transform preserve behavior while gaining enough performance to justify plugin and runtime changes?
- What different result does a prepared Svelte compiler kernel and a graph-preserving Svelte project subgraph add?
- When do `resolveId` and `load` gain synchronous CPU throughput, and when do filters, state, reentrancy, payload, serial graphs, or already-asynchronous work make the worker model worse?

## First-iteration evidence and results

Rolldown's experimental parallel JavaScript plugin implementation still exists. On Node.js 24.18.0, unchanged current main creates eight workers and then loses all of them after bootstrap, so the synthetic transform build fails. Research commit `75ba695d1` adds an explicit worker keepalive and restores byte-identical synthetic and Babel output; `8fe749827` separately fixes an initialization-error SIGABRT by awaiting and cleaning every worker. The retained design remains relevant: Rust already scans independent modules concurrently, while worker-owned callbacks can run synchronous JavaScript transforms outside the main Node.js environment.

Existing prototypes prove that this path can help sufficiently expensive work, but they do not answer the target question. The first test is therefore the current direct-Rolldown ParallelPlugin transform flow itself. The second case uses a real Vue SFC transform whose main compiler is JavaScript but whose TypeScript tail also invokes synchronous native Oxc.

The release-binding results now separate two kinds of value. In a one-worker measurement, a synthetic one-millisecond transform makes the complete build about 9.9% slower but reduces maximum Node.js main-loop delay from about 1.025 seconds to 2.44 milliseconds. In the controlled wide graph, sufficiently expensive transforms reach 4.19x with eight workers and 4.75x with twelve, while cheap calls, 32 modules, and a 512-module dependency chain all regress. Main-thread availability and end-to-end throughput are therefore distinct outcomes, and useful throughput requires both adequate per-call work and calls that Rolldown can make ready together. [Controlled release report](./experiments/core-transform/2026-07-11-controlled-release.md)

The real compiler cases bound that value. All worker counts regress for the 166-SFC Vue project because roughly 125 ms of ordinary handler work cannot repay repeated imports, compiler and native-binding initialization, and contention. An isolated 1,340-source Svelte fan-out reaches 1.36x at four workers as a prepared-kernel upper bound. The graph-preserving 56-entry shadcn-svelte registry subgraph reaches a smaller but repeatable 1.117x at four workers, winning all 15 pairs while using 2.84x user CPU and 2.17x peak RSS; eight workers regress. Its median per-run maximum event-loop delay falls from 314.6 ms to 9.9 ms. [Vue report](./experiments/vue-transform/2026-07-11-vue-icon-results.md), [Svelte graph report](./experiments/svelte-transform/2026-07-11-svelte-registry-graph-results.md)

The same mechanism now has separate hook evidence. With 512 independent synchronous CPU-heavy calls, `resolveId` reaches 2.91x and `load` 2.74x at eight workers; one worker regresses but removes the half-second main-loop stall. Cheap, serial, cached-file-probe, and payload-only hooks regress. An ordinary async load overlaps 512 timers in about 22 ms, while worker-1 takes about 3.0 seconds because every pending Promise retains its permit. [Controlled hook report](./experiments/resolve-load/2026-07-11/README.md)

The source audit and runtime probes also found compatibility blockers independent of speed: missing hooks, discarded hook ordering, worker-local module metadata and resolver options, incomplete logging, output state split by availability-based routing with no affinity, and permit cycles. Native hook filters run only after a worker permit is acquired; a one-worker recursive resolve deterministically deadlocks; replicated closure state changes output; pending async hooks serialize through the permit count; and current parallel failures lose ordinary attribution. Watch-only findings remain recorded background but are outside runtime work. Restoring one callback is therefore only the start of the research, not a sufficient basis for a benchmark claim.

## Repository map

- [Project context](./.agents/docs/README.md) records the durable goal, research boundaries, and current plan.
- [Active production-scale goal](./.agents/docs/production-scale-goal.md) records the iteration's bounded candidate search, required JavaScript workload, time and distinct-module gates, plugin-owned and Rolldown-owned worker baselines, resource and statistical protocol, adaptation cost, semantic requirements, and 2x success target.
- [Production candidate search manifest](./.agents/docs/production-candidate-search.md) freezes the active search universe, preliminary exclusions, latest-LTS pin, and three deep-screen candidates before any candidate clone or build.
- [Production candidate screening](./.agents/docs/production-candidate-screening.md) records each selected candidate's first failed admission rule, pins its evidence, marks later rules not evaluated, and preserves the remaining order.
- [Current-state evidence](./research/current-state.md) pins the source revisions and distinguishes verified facts from open checks.
- [Research dimensions](./.agents/docs/research-dimensions.md) keeps hook-specific value questions and technical defect discovery as equal workstreams.
- [Current defect inventory](./research/defect-inventory.md) distinguishes source-proven gaps, source-inferred failure paths, and historical reports awaiting reproduction.
- [First Node.js 24.18.0 transform evidence](./experiments/core-transform/2026-07-11-node-24.18.0-smoke.md) records the unchanged failure, minimal repairs, byte-identical synthetic and Babel controls, and failure-path behavior.
- [Initial worker-count matrix](./experiments/core-transform/2026-07-11-initial-wall-matrix.md) retains exploratory debug-binding synthetic and Babel results with raw per-run data.
- [Main-thread isolation measurement](./experiments/core-transform/2026-07-11-main-thread-isolation.md) separates one-worker event-loop availability from complete-build wall time with fresh-process samples and independently sampled peak RSS.
- [Controlled transform release result](./experiments/core-transform/2026-07-11-controlled-release.md), [Vue result](./experiments/vue-transform/2026-07-11-vue-icon-results.md), [isolated Svelte upper bound](./experiments/svelte-transform/2026-07-11-svelte-results.md), [graph-preserving Svelte result](./experiments/svelte-transform/2026-07-11-svelte-registry-graph-results.md), and [controlled `resolveId`/`load` result](./experiments/resolve-load/2026-07-11/README.md) retain the formal evidence and raw data.
- [Mechanism-scale verdict](./research/verdict.md) combines first-iteration hook-specific value, plugin suitability, authoring requirements, defects, and ranked optimization work while recording the production-scale evidence gap.
- [Vue and Svelte plugin case notes](./research/plugin-case-notes.md) retain the earlier Vite-plugin source analysis as background; they are not the current runtime plan.
- [`resolveId` and `load` candidate survey](./research/resolve-load-candidates.md) connects the controlled results to possible real-plugin cases and records why no clean whole-plugin resolver candidate was selected.
- [First-iteration direction](./research/framing-review.md) records the completed 2026-07-11 scope and execution order.
- Reproducible runtime evidence, benchmark data, and exact commands are retained under [`experiments`](./experiments/).
