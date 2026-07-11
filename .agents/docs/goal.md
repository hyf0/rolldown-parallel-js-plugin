# Goal

Status: completed mechanism-scale iteration. This record remains the scope and success criteria for the evidence committed through 2026-07-11. It must not be promoted into a production-scale investment verdict; the active next iteration is [production-scale parallel JavaScript transform goal](./production-scale-goal.md).

## Outcome

Produce an evidence-backed verdict on the value of Rolldown parallel JavaScript plugins: whether the current worker execution path can run correctly, when it keeps synchronous transform work off the Node.js main thread, when several workers shorten a complete Rolldown build, what overhead removes the benefit, and which runtime or plugin changes are worth making.

The immediate subject is the retained direct-Rolldown `defineParallelPlugin` execution path. Run that path before broadening the architecture. After its behavior and cost are understood, use a real Vue SFC transform as the second case and attribute its JavaScript compiler and synchronous native Oxc stages honestly. Svelte follows as the next transform case; `resolveId` and `load` follow after the transform evidence rather than starting in parallel.

A neutral or negative result is successful research when it identifies the limiting mechanism and the conditions under which the result holds.

## Confirmed scope

- Use Rolldown directly. Do not use Vite as the runtime, integration layer, project harness, or source of the performance claim.
- Use only the latest Node.js LTS line and pin the exact patch release in every artifact. At the 2026-07-11 scope review this is [Node.js 24.18.0](https://nodejs.org/en/blog/release/v24.18.0).
- Start with `transform`. Do not begin `resolveId` or `load` experiments until the core transform path and Vue case have answered the first-order value question.
- First run the current complete-plugin replication path. Consider a coordinator, worker kernel, affinity, shared metadata, or a new API only after the existing path exposes a measured cost or semantic limit.
- Use Vue as the second case and Svelte as the later required transform case. Address `resolveId` and `load` only after the transform sequence.
- Do not cover watch, rebuild, development-server behavior, or HMR in this research scope. Existing source findings may remain in the defect inventory as background, but they are not runtime tasks, correctness gates, or completion criteria.

## Audience

- Rolldown maintainers deciding whether this capability deserves further runtime or API investment.
- Vue and other JavaScript transform authors deciding whether a parallel form is practical to maintain.
- Tool authors deciding whether off-main-thread isolation, multi-worker throughput, native offload, or no change is the right execution model for their plugin.

## Questions the project must answer

- Does the current ParallelPlugin transform path initialize, execute, return results, report errors, and shut down correctly on the latest Node.js LTS release?
- How much of a representative direct-Rolldown build is spent executing the target JavaScript transform on the Node.js main thread?
- Does moving one plugin instance to one worker improve main-thread availability even when total build time stays flat or regresses?
- At what module count, per-module cost, payload size, and worker count does replication across workers improve total build time?
- How much runnable hook concurrency does the module graph actually expose, and how does a narrow dependency chain differ from a wide graph or a module with many imports?
- Which state patterns require module affinity, shared state, a reduction step, Rust-owned metadata, or a main-thread coordinator?
- How much startup, module import and JIT, hook dispatch, data conversion, duplicated cache, memory, and CPU-oversubscription cost does the current design add?
- How much plugin code and behavior must change for a correct parallel form, and is that maintenance cost justified by the measured benefit?
- Which runtime changes improve the result enough to matter on the direct-Rolldown Vue case?
- Which correctness, lifecycle, compatibility, determinism, and failure-handling defects does the parallel execution model introduce or expose?
- After the core and Vue evidence is clear, what different result does Svelte add, and what are the separate parallel potential and limits of `resolveId` and `load`?

## Success criteria

- A pinned, source-backed description of the current Rolldown execution model and its supported and unsupported plugin behavior.
- A reproducible latest-LTS result for the retained direct-Rolldown ParallelPlugin transform flow, including the unchanged failure when it does not run and the smallest research-only repair used to proceed.
- A cost model that separates worker startup, steady-state dispatch, plugin work, queueing, duplicated initialization, and contention with Rolldown's Rust work.
- A transform crossover result across ordinary main-thread execution, one-worker isolation, and several worker counts.
- A correct and reproducible direct-Rolldown Vue transform case after the core path is understood.
- A correct and reproducible direct-Rolldown Svelte transform case after Vue, with its differences from the Vue result explained.
- Measurements of total wall time, plugin time, Node.js main-thread availability, CPU use, memory, worker count, fresh-process cold start, warm operating-system-cache runs with newly created workers, and production-build correctness.
- A comparison of ordinary main-thread execution, one-worker isolation, and current multi-instance replication before any broader adapted execution model is claimed necessary.
- A plugin-authoring model grounded first in the current API and Vue experiment rather than invented before them.
- An explicit account of the required plugin changes, unsupported behavior, and ongoing maintenance burden for each successful or failed adaptation.
- A ranked list of optimization opportunities and a clear recommendation to invest, narrow the scope, redesign the capability, or stop.
- A source-backed defect inventory with reproductions or explicit unverified status, severity, affected production-build behavior, and the design condition needed to fix or avoid each defect.
- Separate evidence-backed conclusions for `resolveId` and `load` after the transform sequence. Later experiments may be narrower than the transform cases, but source surveys alone cannot substitute for the runtime evidence needed to support their final conclusions.

## Current non-goals

- No Vite runtime, Vite project harness, Vite lifecycle compatibility work, or Vite performance claim.
- No watch, rebuild, development-server, or HMR runtime work.
- No all-supported-Node-version matrix; use the latest LTS line only.
- No production implementation or API proposal before the current path and measured costs justify it.
- No claim that worker threads are valuable merely because hook execution can be distributed.
- No use of a Rust-backed transform benchmark as proof that a CPU-bound pure JavaScript compiler will behave the same way.
- Replacing the Vue or Svelte compiler with a Rust compiler is a separate question. It may establish a performance ceiling but does not answer the value of parallelizing the existing JavaScript plugin.
- Making a hook `async` without moving its CPU work off the main JavaScript thread is not a parallel execution model. Native async work may be a useful alternative baseline, but it cannot stand in for pure JavaScript worker execution.
