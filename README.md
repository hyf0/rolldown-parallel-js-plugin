# Rolldown Parallel JS Plugin Research

This repository is the research workspace for determining when running JavaScript plugins on Node.js worker threads improves Rolldown builds, what changes plugin authors need to make, and which runtime overheads are worth optimizing.

The direction review is complete. Current experiments use Rolldown directly on the latest Node.js LTS line, start by running the retained ParallelPlugin `transform` path unchanged, and measure that core path before adding a real plugin. Vue is the second case. `resolveId` and `load` are deferred until the transform sequence; Vite, watch, rebuild, and HMR are outside the full research scope.

## Questions

- Can the retained direct-Rolldown ParallelPlugin `transform` path run correctly on the latest Node.js LTS release?
- When does moving transform work off the Node.js main thread improve responsiveness without improving total build time?
- When do several worker-local plugin instances reduce total build time for independent transform calls?
- Which plugin state can be replicated, partitioned by module, moved into Rolldown, or reduced after parallel work?
- Where are the crossover points for worker startup, hook dispatch, string conversion, duplicated initialization, scheduling, and CPU contention with the Rust core?
- Can a direct-Rolldown JavaScript Vue transform preserve behavior while gaining enough performance to justify plugin and runtime changes?

## Starting point

Rolldown's experimental parallel JavaScript plugin implementation still exists. On Node.js 24.18.0, unchanged current main creates eight workers and then loses all of them after bootstrap, so the parallel no-op build fails. Research commit `75ba695d1` adds an explicit worker keepalive and restores byte-identical no-op and Babel output; `8fe749827` separately fixes an initialization-error SIGABRT by awaiting and cleaning every worker. The retained design remains relevant: Rust already scans independent modules concurrently, while worker-owned callbacks can run synchronous JavaScript transforms outside the main Node.js environment.

Existing prototypes prove that this path can help sufficiently expensive work, but they do not answer the target question. The first test is therefore the current direct-Rolldown ParallelPlugin transform flow itself. Only after its behavior and cost are understood will the research add a pure-JavaScript Vue transform as the second case.

The first repeated results already separate two kinds of value. Multiple workers reduce complete build time for both the synthetic Three10x transform and Babel/Rome, while one worker is slower in both. In a separate one-worker measurement, however, the maximum Node.js main-loop delay falls from about 1.03 seconds to 4.9–8.3 ms. Main-thread availability is therefore a measured benefit even where whole-build throughput regresses; startup, queueing, bridge conversion, and task size still need the controlled decomposition now in progress.

The source audit also found compatibility blockers independent of speed: missing hooks, discarded hook ordering, worker-local module metadata and resolver options, incomplete logging, output state split by availability-based routing with no affinity, and unreproduced permit-cycle paths. Watch-only findings remain recorded background but are outside runtime work. Restoring one callback is therefore only the start of the research, not a sufficient basis for a benchmark claim.

## Repository map

- [Project context](./.agents/docs/README.md) records the durable goal, research boundaries, and current plan.
- [Current-state evidence](./research/current-state.md) pins the source revisions and distinguishes verified facts from open checks.
- [Research dimensions](./.agents/docs/research-dimensions.md) keeps hook-specific value questions and technical defect discovery as equal workstreams.
- [Current defect inventory](./research/defect-inventory.md) distinguishes source-proven gaps, source-inferred failure paths, and historical reports awaiting reproduction.
- [First Node.js 24.18.0 transform evidence](./experiments/core-transform/2026-07-11-node-24.18.0-smoke.md) records the unchanged failure, minimal repairs, byte-identical no-op and Babel controls, and failure-path behavior.
- [Initial worker-count matrix](./experiments/core-transform/2026-07-11-initial-wall-matrix.md) records repeated no-op and Babel wall-time, CPU, and provisional memory results with raw per-run data.
- [Main-thread isolation measurement](./experiments/core-transform/2026-07-11-main-thread-isolation.md) separates one-worker event-loop availability from complete-build wall time with fresh-process samples and independently sampled peak RSS.
- [Vue and Svelte plugin case notes](./research/plugin-case-notes.md) retain the earlier Vite-plugin source analysis as background; they are not the current runtime plan.
- [`resolveId` and `load` candidate survey](./research/resolve-load-candidates.md) is deferred until the transform path and Vue case are understood.
- [Confirmed direction](./research/framing-review.md) records the current scope and execution order.
- Reproducible runtime evidence, benchmark data, and exact commands are retained under [`experiments`](./experiments/); the controlled transform cost model is the active addition.
