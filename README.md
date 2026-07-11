# Rolldown Parallel JS Plugin Research

This repository is the research workspace for determining when running JavaScript plugins on Node.js worker threads improves Rolldown builds, what changes plugin authors need to make, and which runtime overheads are worth optimizing.

The direction review is complete. Experiments use Rolldown directly on the latest Node.js LTS line, start with the retained ParallelPlugin `transform` path, use Vue and Svelte compiler cases after the controlled cost model, then measure `resolveId` and `load` separately. Vite, watch, rebuild, and HMR are outside the research scope.

## Questions

- Can the retained direct-Rolldown ParallelPlugin `transform` path run correctly on the latest Node.js LTS release?
- When does moving transform work off the Node.js main thread improve responsiveness without improving total build time?
- When do several worker-local plugin instances reduce total build time for independent transform calls?
- Which plugin state can be replicated, partitioned by module, moved into Rolldown, or reduced after parallel work?
- Where are the crossover points for worker startup, hook dispatch, string conversion, duplicated initialization, scheduling, and CPU contention with the Rust core?
- Can a direct-Rolldown JavaScript Vue transform preserve behavior while gaining enough performance to justify plugin and runtime changes?
- What different result does a prepared Svelte compiler kernel and a graph-preserving Svelte project subgraph add?
- When do `resolveId` and `load` gain synchronous CPU throughput, and when do filters, state, reentrancy, payload, serial graphs, or already-asynchronous work make the worker model worse?

## Starting point

Rolldown's experimental parallel JavaScript plugin implementation still exists. On Node.js 24.18.0, unchanged current main creates eight workers and then loses all of them after bootstrap, so the synthetic transform build fails. Research commit `75ba695d1` adds an explicit worker keepalive and restores byte-identical synthetic and Babel output; `8fe749827` separately fixes an initialization-error SIGABRT by awaiting and cleaning every worker. The retained design remains relevant: Rust already scans independent modules concurrently, while worker-owned callbacks can run synchronous JavaScript transforms outside the main Node.js environment.

Existing prototypes prove that this path can help sufficiently expensive work, but they do not answer the target question. The first test is therefore the current direct-Rolldown ParallelPlugin transform flow itself. The second case uses a real Vue SFC transform whose main compiler is JavaScript but whose TypeScript tail also invokes synchronous native Oxc.

The release-binding results now separate two kinds of value. In a one-worker measurement, a synthetic one-millisecond transform makes the complete build about 9.9% slower but reduces maximum Node.js main-loop delay from about 1.025 seconds to 2.44 milliseconds. In the controlled wide graph, sufficiently expensive transforms reach 4.19x with eight workers and 4.75x with twelve, while cheap calls, 32 modules, and a 512-module dependency chain all regress. Main-thread availability and end-to-end throughput are therefore distinct outcomes, and useful throughput requires both adequate per-call work and calls that Rolldown can make ready together. [Controlled release report](./experiments/core-transform/2026-07-11-controlled-release.md)

The same mechanism now has separate hook evidence. With 512 independent synchronous CPU-heavy calls, `resolveId` reaches 2.91x and `load` 2.74x at eight workers; one worker regresses but removes the half-second main-loop stall. Cheap, serial, cached-file-probe, and payload-only hooks regress. An ordinary async load overlaps 512 timers in about 22 ms, while worker-1 takes about 3.0 seconds because every pending Promise retains its permit. [Controlled hook report](./experiments/resolve-load/2026-07-11/README.md)

The source audit and runtime probes also found compatibility blockers independent of speed: missing hooks, discarded hook ordering, worker-local module metadata and resolver options, incomplete logging, output state split by availability-based routing with no affinity, and permit cycles. Native hook filters run only after a worker permit is acquired; a one-worker recursive resolve deterministically deadlocks; replicated closure state changes output; pending async hooks serialize through the permit count; and current parallel failures lose ordinary attribution. Watch-only findings remain recorded background but are outside runtime work. Restoring one callback is therefore only the start of the research, not a sufficient basis for a benchmark claim.

## Repository map

- [Project context](./.agents/docs/README.md) records the durable goal, research boundaries, and current plan.
- [Current-state evidence](./research/current-state.md) pins the source revisions and distinguishes verified facts from open checks.
- [Research dimensions](./.agents/docs/research-dimensions.md) keeps hook-specific value questions and technical defect discovery as equal workstreams.
- [Current defect inventory](./research/defect-inventory.md) distinguishes source-proven gaps, source-inferred failure paths, and historical reports awaiting reproduction.
- [First Node.js 24.18.0 transform evidence](./experiments/core-transform/2026-07-11-node-24.18.0-smoke.md) records the unchanged failure, minimal repairs, byte-identical synthetic and Babel controls, and failure-path behavior.
- [Initial worker-count matrix](./experiments/core-transform/2026-07-11-initial-wall-matrix.md) retains exploratory debug-binding synthetic and Babel results with raw per-run data.
- [Main-thread isolation measurement](./experiments/core-transform/2026-07-11-main-thread-isolation.md) separates one-worker event-loop availability from complete-build wall time with fresh-process samples and independently sampled peak RSS.
- [Controlled transform release result](./experiments/core-transform/2026-07-11-controlled-release.md), [Vue result](./experiments/vue-transform/2026-07-11-vue-icon-results.md), [isolated Svelte result](./experiments/svelte-transform/2026-07-11-svelte-results.md), and [controlled `resolveId`/`load` result](./experiments/resolve-load/2026-07-11/README.md) retain the formal evidence and raw data.
- [Vue and Svelte plugin case notes](./research/plugin-case-notes.md) retain the earlier Vite-plugin source analysis as background; they are not the current runtime plan.
- [`resolveId` and `load` candidate survey](./research/resolve-load-candidates.md) connects the controlled results to possible real-plugin cases and records why no clean whole-plugin resolver candidate was selected.
- [Confirmed direction](./research/framing-review.md) records the current scope and execution order.
- Reproducible runtime evidence, benchmark data, and exact commands are retained under [`experiments`](./experiments/).
