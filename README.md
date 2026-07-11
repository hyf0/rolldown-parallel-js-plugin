# Rolldown Parallel JS Plugin Research

This repository is the research workspace for determining when running JavaScript plugins on Node.js worker threads improves Rolldown builds, what changes plugin authors need to make, and which runtime overheads are worth optimizing.

The current phase is framing and evidence collection. This repository does not yet propose a production API or claim that parallel plugins are broadly faster.

## Questions

- When does moving a plugin off the Node.js main thread improve responsiveness without improving total build time?
- When do several worker-local plugin instances reduce total build time in `resolveId`, `load`, or `transform` work?
- Which plugin state can be replicated, partitioned by module, moved into Rolldown, or reduced after parallel work?
- Where are the crossover points for worker startup, hook dispatch, string conversion, duplicated initialization, scheduling, and CPU contention with the Rust core?
- Can realistic Vue and Svelte builds preserve behavior while gaining enough performance to justify plugin and runtime changes?

## Starting point

Rolldown's experimental parallel JavaScript plugin implementation still exists. Current main still gives all JavaScript callbacks the weak Node-API thread-safe-function mode that [PR #2135](https://github.com/rolldown/rolldown/pull/2135) explicitly reported would break `ParallelPlugin`; an unmerged Node 24 experiment later reported the worker closing before its first callback. This repository has not yet reproduced the current behavior across supported Node versions, so those historical reports remain separate from current source facts. The retained design is still relevant: Rust already scans independent modules concurrently; ordinary JavaScript plugin callbacks are associated with the main Node.js environment, while a parallel plugin creates one plugin instance in each Node.js worker and lets Rust route concurrent module hooks to free workers.

Existing prototypes prove that this path can help sufficiently expensive work, but they do not answer the target question. In particular, the recent Vue benchmark on a Rolldown branch mostly compares a Rust SFC compiler and bridge mechanisms, externalizes the real application graph, and substitutes empty modules on compile failure. The first real test must instead adapt the actual JavaScript Vue or Svelte plugin and run a correct end-to-end project build.

The source audit also found compatibility blockers independent of speed: missing hooks, discarded hook ordering, worker-local module metadata and resolver options, incomplete logging and watch context, output state split by availability-based routing with no affinity, and unreproduced permit-cycle paths. Restoring one callback is therefore only the start of the research, not a sufficient basis for a benchmark claim.

## Repository map

- [Project context](./.agents/docs/README.md) records the durable goal, research boundaries, and current plan.
- [Current-state evidence](./research/current-state.md) pins the source revisions and distinguishes verified facts from open checks.
- [Research dimensions](./.agents/docs/research-dimensions.md) keeps hook-specific value questions and technical defect discovery as equal workstreams.
- [Current defect inventory](./research/defect-inventory.md) distinguishes source-proven gaps, source-inferred failure paths, and historical reports awaiting reproduction.
- [Vue and Svelte plugin case notes](./research/plugin-case-notes.md) map real hook and state flows, provisional worker boundaries, correctness fixtures, and candidate projects.
- [`resolveId` and `load` candidate survey](./research/resolve-load-candidates.md) screens real candidates, overhead controls, and misleading native or I/O-heavy workloads before any adaptation is written.
- Reproducible benchmark harnesses, fixtures, and result artifacts will be added only after the research framing is reviewed.
