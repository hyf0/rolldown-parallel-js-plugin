# Framing Review Brief

Snapshot date: 2026-07-11. This is the short direction-review document for Phase 0. It contains no fresh runtime observation, prototype, or benchmark result.

## What the research is about

The subject is whether Rolldown should support an execution model in which selected JavaScript plugin work runs in Node.js workers. The retained `defineParallelPlugin` API is one implementation to study, not the boundary of the question.

There are two independent possible values:

1. One worker can move synchronous JavaScript work off the Node.js main thread and improve responsiveness even when total build time is unchanged or worse.
2. Several workers can reduce build wall time only when Rolldown exposes enough independent ready calls and the useful work repays worker startup, dispatch, conversion, copied state, memory, and contention with Rust work.

Every conclusion must keep those values separate and must report `resolveId`, `load`, and `transform` separately.

## What source inspection has established

- The parallel-plugin implementation has not been deleted. Rust can call callbacks created in worker Node environments directly through Node-API thread-safe functions; an individual hook does not take a main-thread `postMessage` detour.
- Current main still uses the weak callback configuration that an earlier Rolldown PR explicitly reported as breaking ParallelPlugin. A later unmerged Node 24 branch reported worker closure after bootstrap. Neither behavior has been reproduced on current main yet, so runtime viability remains unknown rather than proven broken.
- Rolldown already creates concurrent module and import-resolution tasks. The possible worker throughput comes from different graph tasks reaching a plugin at the same time; hook order within one plugin chain remains sequential.
- The retained wrapper forwards 9 of 20 JavaScript hooks, loses Rolldown hook-order metadata, has no Vite lifecycle or `enforce` surface, and gives each worker isolated JavaScript metadata, custom resolve receipts, caches, normalized options, and logging state.
- The current scheduler selects an available instance without module affinity. Output hooks have no built-in way to reconstruct state distributed across instances, while `moduleParsed` broadcasts every module to every instance.
- Hook filters are evaluated only after the wrapper acquires a worker permit. A miss can avoid the Node callback but still queue for the shared pool.
- The source-backed defect inventory currently contains 18 paths. Historical or call-graph-inferred failures remain explicitly unreproduced.

The detailed evidence is in [current-state evidence](./current-state.md) and the [defect inventory](./defect-inventory.md).

## Working architecture hypothesis

Constructing a complete ordinary plugin in every worker is unlikely to be the general answer. The provisional architecture to test is:

- A coordinator remains in the main Node environment for Vite lifecycle, non-serializable configuration, cheap routing and filters, global state, plugin communication, watch behavior, and reductions.
- A worker kernel receives explicit serializable tasks for expensive module-local work and returns code, maps, diagnostics, dependencies, and declared metadata.
- Whole-plugin replication remains a comparison case for genuinely stateless plugins, not the default assumption.
- State ownership must be explicit: immutable replicated configuration, worker-local cache, module-affine state, coordinator state, Rust-owned shared metadata, or globally reduced output.

This is a hypothesis rather than an API proposal. The amount of plugin code and maintenance needed to create the split is part of the result.

## Vue and Svelte source findings

- The current Svelte plugin already separates configuration, preprocessing, compilation, compiled-CSS loading, HMR, and optimizer behavior into cooperating plugin objects. Its compile transform calls the synchronous Svelte compiler on module-local input, but the ordinary lifecycle must first supply filters, parsed IDs, environment identity, resolved options, dynamic option callbacks, warning policy, and combined source maps. Compiled CSS then crosses into a later load through module metadata. This makes Svelte the smaller coordinator/kernel case, not an unchanged worker plugin.
- The current Vue plugin keeps configuration, SFC parsing, script and template compilation, virtual-block resolution and loading, HMR, and several descriptor and script caches in one stateful plugin. A main SFC transform creates state consumed by later script, template, style, and custom-block requests. Its own `resolveId` and common `load` paths are mostly identity or cache/metadata work; the transform path is the CPU candidate. Vue therefore tests whether coordinator ownership, shared metadata, or module-affine routing can preserve related-module behavior.

Both plugins can contain function-valued configuration and integration callbacks that cannot use the current structured-cloned options path unchanged. The current evidence scope can stay on production compilation. Watch state, invalidation, and HMR remain documented compatibility risks, but their runtime coverage is deferred.

## Hook-specific direction

| Hook | Current hypothesis | First useful evidence |
| --- | --- | --- |
| `transform` | Synchronous per-module compilers have the clearest headroom, but source maps, diagnostics, metadata, compiler initialization, and plugin lifecycle can dominate. | Svelte's prepared compile boundary is the first framework adaptation candidate; Vue follows as the module-affinity and descriptor-state case. |
| `load` | CPU-bearing loaders may benefit, but mixed async I/O holds a worker permit and miss traffic can dominate without filtering before dispatch. | Profile unchanged SVGR, `vite-svg-loader`, and `unplugin-icons` builds; admit an adapter only if the JavaScript share and ready-call concurrency justify it. |
| `resolveId` | Call volume is high, but Vite 8's main and tsconfig-path resolution is native and many remaining JavaScript resolvers are cheap, I/O-heavy, cached, or reentrant. | Keep Vue/Svelte identity hooks as overhead controls; profile NativeScript only with a Vite 8 match, PnP only with a real corpus, and use `node-resolve` first as a semantics and defect case. |

The source maps and project candidates are in [Vue and Svelte plugin case notes](./plugin-case-notes.md) and the [`resolveId` and `load` candidate survey](./resolve-load-candidates.md).

## Proposed sequence after approval

1. Reproduce runtime viability and lifecycle on pinned Rolldown across supported Node 20, 22, and 24 lines. Establish behavior fixtures before trusting timing.
2. Measure the current cost surface with ordinary execution, one worker, and several workers. Separate worker creation, plugin/module/compiler initialization, queue wait, service time, Node-API conversion, input and output copying, duplicated state and caches, worker count, CPU, RSS, and main-thread availability.
3. Profile unchanged real projects before writing adapters and apply the admission calculation below. The calculation selects fixtures and optional cases; it does not remove the required Vue and Svelte experiments when their expected result is negative.
4. Adapt Svelte as the first required framework `transform` coordinator/kernel case. In a separate lane, admit at most one lower-state `load` adapter if its profile passes the optional-case threshold. Do not parallelize several plugins in the same project until each is understood alone.
5. Adapt Vue as the second required framework case, specifically testing descriptor ownership, related virtual modules, metadata transport, and module affinity.
6. Admit cache-heavy loaders or real resolvers only when their own baselines qualify. Do not force a positive `resolveId` result by adding artificial delay or enabling an option the project does not use.
7. Optimize only the measured dominant cost, then repeat the same pinned production-build cases. Keep neutral and negative results.
8. Treat repeated builds and watch rebuilds as a separate follow-up only if the production-build verdict justifies continued investment; they are not a completion condition for the current scope.

## Proposed admission calculation

For a cheap throughput screen, let `s` be the fraction of end-to-end critical-path time attributable to movable synchronous JavaScript in the target hook, and let `p_peak` be the smaller of the proposed worker count and the peak count of simultaneously ready target-hook calls observed in a concurrency trace. The deliberately optimistic, overhead-free screening estimate is:

`screening_speedup(p_peak) = 1 / ((1 - s) + s / p_peak)`

The provisional optional-case rule is to write a loader or resolver adapter only when `p_peak > 1`, this screening estimate is at least `1.05x`, and replaying the full ready-call trace with measured movable service times through an ideal work-conserving scheduler also retains an end-to-end estimate of at least `1.05x`. The trace, replay method, and result must be retained with the baseline profile. Yunfei should confirm or replace the `1.05x` threshold. Startup, copying, queueing, duplicated state, and Rust contention can only reduce the observed result, so passing both screens admits an experiment rather than predicting a win.

Vue and Svelte remain required case studies. Their baseline bound selects the representative project and sets the expected result; if every valid project falls below the threshold, choose the most representative reproducible project and preserve the negative result rather than dropping that framework. A case that fails the throughput rule may still enter a separately labeled one-worker isolation experiment when main-thread availability is itself the question.

## Admission and evidence rules

- A repository file count nominates a project; reached calls and ready-call concurrency select it.
- Keep three distinct comparisons when a filter changes: unchanged ordinary plugin, filter-only ordinary plugin, and worker plugin with the equivalent early filter. Filter-only improvement is not attributed to workers.
- JavaScript CPU, async I/O wait, synchronous native work, and existing native worker pools are attributed separately.
- Fresh-process and warm operating-system-cache runs are separate production-build results. Reused watch workers are deferred to a possible follow-up.
- One worker answers main-thread isolation; several workers answer throughput.
- Wall time, event-loop availability, CPU, peak RSS, queueing, output bytes, and correctness are reported together.
- Production-build outputs, maps, metadata, diagnostics, errors, hook order, and determinism must match the ordinary plugin.
- Plugin adaptation code, unsupported configurations, new state ownership, and ongoing maintenance are reported as costs rather than hidden benchmark setup.
- Raw measurements, environment details, pinned revisions, commands, and reproduction instructions are retained with every result, including neutral and negative results.

## Important unknowns

- Whether current workers remain callable and shut down correctly on supported Node versions.
- The actual startup, Node-API conversion, queueing, payload, JIT, garbage-collection, and memory costs on current Rolldown.
- How much ready plugin concurrency real Vue, Svelte, SVG, icon, NativeScript, or PnP graphs expose.
- Whether fewer Node workers outperform the fixed cap because Rolldown's Rust work already consumes the same cores.
- The smallest Vite-visible coordinator shell that preserves lifecycle, `enforce`, plugin position, environment, and ordinary context behavior.
- Whether shared metadata, module affinity, cache ownership, or explicit reduction is sufficient for Vue without making the authoring model impractical.
- Whether any current real resolver has enough JavaScript work to justify workers after comparing filters, caches, batching, and native resolution.

## Provisional defaults for Yunfei to confirm or correct

1. Study the execution model, including coordinator plus worker kernel, rather than limiting the verdict to the retained API.
2. Use direct Rolldown for runtime, overhead, and defect evidence; use Vite 8 production builds for official Vue and Svelte plugin evidence.
3. Treat one-worker isolation and multi-worker wall-time improvement as separate outcomes of equal interest.
4. Keep production builds as the current performance and correctness scope. Record watch, rebuild, and HMR risks now, but defer their runtime coverage and do not make them a gate for the production-build verdict.
5. Start the required framework adaptation with Svelte, then use Vue to test state ownership and affinity. In parallel, admit at most one lower-state loader after unchanged profiling and the optional-case calculation.
6. Keep framework `resolveId` and ordinary `load` paths as overhead controls. Do not promise a positive resolver case; conditional candidates proceed only when their missing project or baseline requirement is satisfied.
7. Treat technical defects, plugin authoring changes, memory, and negative performance results as first-class outputs, not secondary notes.
8. Use `1.05x` as the provisional optimistic throughput bound for optional loader or resolver adaptation; keep one-worker isolation and the required Vue/Svelte cases outside that rejection rule.

No restoration patch, harness, adapter, or benchmark should begin until these defaults are reviewed.
