# Goal

## Outcome

Produce an evidence-backed verdict on the value of Rolldown parallel JavaScript plugins: the build scenarios where they help, the plugin architecture changes they require, the scenarios where overhead or serialization removes the benefit, and the runtime optimizations with the highest measured leverage.

The verdict must cover realistic Vue and Svelte projects, not only synthetic hook calls or isolated compiler invocations. A result that shows no useful speedup is successful research if it identifies the limiting mechanism and the conditions under which the conclusion holds.

## Audience

- Rolldown and Vite maintainers deciding whether this capability deserves further product and API investment.
- Vue, Svelte, and other JavaScript plugin authors deciding whether a parallel form is practical to maintain.
- Tool authors deciding whether off-main-thread isolation, multi-worker throughput, native offload, or no change is the right execution model for their plugin.

## Questions the project must answer

- How much of a representative build is actually spent executing the target JavaScript plugin on the Node.js main thread?
- How many `resolveId`, `load`, and `transform` calls occur, how expensive are their hit and miss paths, and which of those calls block useful Rust-side module concurrency?
- Does moving one plugin instance to one worker improve main-thread availability even when total build time stays flat or regresses?
- At what module count, per-module cost, payload size, and worker count does replication across workers improve total build time?
- Which state patterns require module affinity, shared state, a reduction step, Rust-owned metadata, or a main-thread coordinator?
- How much startup, module import and JIT, hook dispatch, data conversion, duplicated cache, memory, and CPU-oversubscription cost does the current design add?
- Which runtime changes improve the result enough to matter on a real Vue or Svelte build?
- Which correctness, lifecycle, compatibility, determinism, and failure-handling defects does the parallel execution model introduce or expose?

## Success criteria

- A pinned, source-backed description of the current Rolldown execution model and its supported and unsupported plugin behavior.
- A cost model that separates worker startup, steady-state dispatch, plugin work, queueing, duplicated initialization, and contention with Rolldown's Rust work.
- Separate value and crossover results for `resolveId`, `load`, and `transform`, including realistic miss-heavy and hit-heavy paths.
- Correct and reproducible baseline, one-worker, and multi-worker variants for selected Vue and Svelte builds.
- Measurements of total wall time, plugin time, Node.js main-thread availability, CPU use, memory, worker count, cold start, warm reuse, and correctness.
- A plugin-authoring model grounded in the Vue and Svelte adaptations rather than invented before them.
- A ranked list of optimization opportunities and a clear recommendation to invest, narrow the scope, redesign the capability, or stop.
- A source-backed defect inventory with reproductions or explicit unverified status, severity, affected lifecycle, and the design condition needed to fix or avoid each defect.

## Current non-goals

- No production implementation or API proposal before the framing and evidence baseline are reviewed.
- No claim that worker threads are valuable merely because hook execution can be distributed.
- No use of a Rust-backed transform benchmark as proof that a CPU-bound pure JavaScript compiler will behave the same way.
- Initial experiments target production builds. Development-server and HMR behavior are recorded as constraints but are not the first performance target because their cross-build state and event routing are substantially harder.
- Replacing the Vue or Svelte compiler with a Rust compiler is a separate question. It may establish a performance ceiling but does not answer the value of parallelizing the existing JavaScript plugin.
