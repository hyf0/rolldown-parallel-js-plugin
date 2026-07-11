# Research Plan

This record separates the completed mechanism-scale sequence from the draft production-scale iteration. The next iteration is not an implementation commitment and must not start until Yunfei creates its `/goal`.

## Completed first-iteration order

1. Use direct Rolldown on the latest Node.js LTS release.
2. Run the retained ParallelPlugin `transform` path unchanged.
3. Repair only what blocks that path, preserving the unchanged failure and exact patch.
4. Measure the core transform path before adding a real plugin.
5. Use a direct-Rolldown Vue SFC transform as the second case, separating the JavaScript compiler work from its synchronous native Oxc tail.
6. Optimize only a measured dominant cost.
7. Complete the required Svelte transform case, then the separate `resolveId` and `load` evidence needed for hook-specific conclusions.

Vite, watch, rebuild, development-server behavior, and HMR are outside the research scope.

## Phase 1: current transform path

Status: complete. Unchanged current main failure, two minimal research repairs, successful controls, failure behavior, and source commits are preserved in the runtime evidence.

- Pin current Rolldown main, the latest Node.js LTS patch, pnpm, Rust, operating system, CPU, and commands.
- Use an isolated Rolldown worktree because the primary checkout is not an experiment workspace.
- Build Rolldown and run the existing direct-Rolldown parallel no-op transform example unchanged. Record exit status, stdout and stderr, output artifact, worker initialization, first callback, and shutdown.
- Run the existing Babel transform example after the no-op path. Compare its output and errors with the ordinary single-thread plugin before trusting timing.
- Add bounded direct-Rolldown fixtures for plugin-factory initialization failure and synchronous and rejected transform failures. Require attributed errors, cleanup of peer workers, and clean process exit before calling the retained path usable.
- If unchanged current main fails, retain the failing command and logs. Apply the smallest research-only callback or worker-lifetime repair required to continue, and label every later result with that patch.
- Do not expand hook coverage, change the API, add Vite compatibility, or solve unrelated defects during this phase.

## Phase 2: core transform cost surface

Status: complete. Release matrices now cover fresh-build fixed cost, task-cost crossover, worker count, graph width, chain serialization, payload, JavaScript and Rust timing, CPU, RSS, output hashes, and one-worker main-loop isolation. The [controlled release report](../../experiments/core-transform/2026-07-11-controlled-release.md) is the current result.

- Create a controlled direct-Rolldown transform fixture only after the retained path runs. It must exercise real module-graph concurrency rather than call a compiler outside Rolldown.
- Compare ordinary main-thread execution, one-worker isolation, and several explicit worker counts. If the current API has no worker-count control, add the smallest research-only control and keep the default behavior unchanged.
- Vary graph width, module count, source and result bytes, per-module synchronous JavaScript work, and source-map output independently.
- Measure worker creation, module and plugin initialization, first-use JIT, queue wait, service time, Node-API conversion, copied bytes, total wall time, Node.js main-thread availability, CPU, peak RSS, and contention with Rolldown's Rust work.
- Keep fresh-process and independent warm operating-system-cache runs distinct. Both create new workers.
- Preserve output bytes, source maps, errors, diagnostics, hook order, and determinism across worker counts.
- Locate the crossover and retain negative cells. One worker answers isolation; multiple workers answer throughput.

## Phase 3: Vue second case

Status: complete. Full-plugin and thin-adapter output parity holds, every tested worker count regresses in the 30-round 166-SFC confirmation, and worker-1 still improves main-loop responsiveness. Import, initialization, handler contention, CPU, RSS, and compiler-error semantics explain the result in the [Vue report](../../experiments/vue-transform/2026-07-11-vue-icon-results.md).

- Use `unplugin-vue/rolldown` under the direct Rolldown API. Do not run Vite or claim Vite-plugin parity. Count the Vite helper modules imported by the Rolldown entry as real plugin initialization and memory overhead.
- Pin `unplugin-vue` 7.2.0, Vue and `@vue/compiler-sfc` 3.5.39, and `cabinet-fe/icon` at `9cadad32c72d79424c75e3b6e56798f216bb0b06` as the initial real corpus. Its four JavaScript entries reach 166 small SFCs without style or external blocks.
- Use the unchanged full ordinary plugin as the correctness reference. Compare it with a thin ordinary and parallel adapter that exposes only `buildStart` and `transform`, applies the same declarative `.vue` filter, sets the same `.vue` module type, and uses production inline-template compilation.
- State the supported surface explicitly: script setup, TypeScript script compilation, HTML template compilation, component IDs, code generation, and errors. Do not claim styles, custom or external blocks, virtual-module hooks, source maps, function options, warnings, watch, or HMR.
- Compare ordinary, one-worker, and multiple-worker forms with identical compiler versions, options, inputs, outputs, and errors.
- Attribute compiler import and initialization, parse, script compilation, template compilation, returned bytes, queueing, memory, and end-to-end build time separately. The initial case disables source maps and makes no map-performance claim.
- Report every plugin change and state-ownership decision as part of the cost. If Vue does not improve, identify whether the limit is plugin share, graph concurrency, initialization, transfer, memory, or Rust CPU contention.
- Run every variant in a fresh Node.js process. Module-level descriptor and compiler caches make sequential variants in one process an invalid cold-start comparison.

## Phase 4: attributed optimization

Status: scoped and ranked by completed evidence. Worker-count reduction is insufficient for the 166-SFC Vue case because even two workers regress, while four workers are the best observed setting in both Svelte cases. The dominant Vue opportunity is a separately loadable compiler kernel that avoids full unplugin, Vite-helper, and released-binding replication. Svelte confirms that such a kernel can win at sufficient scale, but implementing one while preserving the complete Vue reference is a plugin architecture change rather than a bounded runtime optimization. The final ranking puts explicit worker count, pre-permit filtering, and a coordinator/kernel contract ahead of batching or broader whole-plugin compatibility work.

- Change only the cost shown to dominate the core transform or Vue result: callback lifetime, worker count, lazy initialization, dispatch, batching, payload conversion, cache replication, state placement, module affinity, or CPU contention.
- Re-run the same pinned core and Vue cases after each optimization.
- Stop an optimization when its expected end-to-end benefit is smaller than its implementation and maintenance cost.

## Phase 5: required later cases

Status: complete. The [isolated Svelte result](../../experiments/svelte-transform/2026-07-11-svelte-results.md) supplies a prepared-kernel upper bound: the 24-component fixture loses, the synthetic 1,340-component corpus reaches 1.36x at four workers, output code and maps match, and diagnostic parity fails. The [graph-preserving shadcn registry UI result](../../experiments/svelte-transform/2026-07-11-svelte-registry-graph-results.md) follows 425 real local modules from 56 barrels, reaches 1.117x at four workers across 15 winning pairs, improves main-loop responsiveness, and records its 2.84x user-CPU and 2.17x RSS costs. The separate [`resolveId` and `load` release result](../../experiments/resolve-load/2026-07-11/README.md) completes the hook evidence with synchronous CPU, cheap, serial, filesystem, async, payload, isolation, filter, state, reentrancy, and error cases.

- Add a direct-Rolldown Svelte transform after Vue and preserve a reproducible ordinary, one-worker, and multi-worker comparison. Select its boundary and corpus from the earlier source audit, but do not run Vite.
- Add `resolveId` and `load` evidence after the transform verdict and measure each hook separately. Use the earlier surveys to select honest direct-Rolldown fixtures rather than artificial delay or Vite projects.
- A negative core or Vue result may narrow the later matrices, but it does not remove the required Svelte experiment or separate hook conclusions.

## Draft next iteration: required high-frequency JavaScript transform

Status: not started. The complete scope, admission rules, execution models, seven sustained-operation questions, correctness gates, and success criteria are in [production-scale goal](./production-scale-goal.md). Existing Vue and Svelte results remain controls and mechanism evidence; their subsecond or two-second builds cannot satisfy this iteration.

### Phase A: candidate admission

- Find a representative direct-Rolldown build lasting 15–30 minutes with roughly 5,000 verified hits in an expensive required JavaScript transform or transform chain.
- Use the latest Node.js LTS available when the next `/goal` starts and pin its exact patch; do not run a version matrix.
- Reject physical module count, filter misses, cache bypasses, artificial delay, an externalized main graph, or a Rust/native substitute as evidence for the target.
- Pin why the plugin must remain JavaScript: behavior, configuration, callbacks, ecosystem extensions, ownership, or maintenance cost.
- Measure the ordinary target-transform time share and apply the stated overall-speedup formula before adapting the plugin. Reject a candidate that cannot mathematically reach a repeated 2x complete-build result.
- If the primary candidate contains one plugin, select a second real JavaScript transform on the same pinned graph for the independent shared-placement, colocated-failure, and optional pipeline case. It must not inflate or contribute to the primary 2x baseline.

### Phase B: ordinary production trace

- Record target-transform hit, miss, and cache-path counts; per-call cost distribution; ready-call width over time; queue-free ordinary service; Node main-thread CPU; Rust and native CPU where observable; RSS over time; garbage collection; source and source-map bytes; warnings; errors; output; and shutdown.
- Establish repeated absolute wall time and environmental variance before any worker change. The intended result is expressed as minutes, not only a ratio.
- Prove that the expensive time is synchronous JavaScript on the critical path and that the machine has CPU capacity workers can use.

### Phase C: worker execution and placement

- Compare ordinary execution, one-worker isolation, the Rolldown-managed shared group, and an explicitly exclusive group containing one or several workers.
- Use one global CPU and memory budget across shared groups, exclusive groups, Rolldown Rust work, and native compiler stages.
- Record sustained per-worker service, ready width, utilization, task assignment, per-plugin queueing, long-task imbalance, CPU, RSS, garbage collection, and complete-build wall time for each worker count and placement.
- When several high-frequency transforms exist, first measure ordinary separate hook crossings; compare same-worker placement and a combined worker-side ordered pipeline only if boundary conversion is material.
- Keep the primary 2x comparison separate from a companion multi-plugin case when the accepted production workload contains only one target plugin.

### Phase D: one-at-a-time sustained optimization

- Change only a measured dominant cost: worker placement, worker count, load balance, long-lived compiler or cache memory, per-call conversion, several-plugin pipeline execution, or cache ownership.
- Treat fresh worker startup as secondary for the 15–30 minute target unless the production trace contradicts the measured sub-0.05% bound.
- Repeat the same pinned ordinary, shared, and exclusive cases after every change. Stop changes whose expected complete-build benefit is smaller than their implementation and maintenance cost.

### Phase E: semantic and failure closure

- Prove exact code, source-map, output-shape, plugin-order, warning, error, metadata, state, cache-determinism, cancellation, and shutdown behavior.
- Inject worker exit, crash, synchronous throw, rejected task, and unresponsive task conditions with queued and in-flight work in shared and exclusive groups.
- Define retry only for behaviorally pure tasks; otherwise fail with ordinary-equivalent attribution and no partial state or leaked capacity.
- Finish with an updated investment verdict that either demonstrates repeated 30→15 or 15→7–8 minute behavior or names the measured reason the target is not achievable.

## Parallel defect track

- Reproduce defects that block or invalidate the direct-Rolldown production-build transform path on the pinned latest LTS release.
- Keep other source-backed defects in the inventory, but label Vite-specific, watch-only, rebuild-only, and other-Node-version items as outside the active runtime scope.
- Separate runtime defects from plugin-authoring limits and from experiment mistakes.
- Require every observed defect to retain a minimal command, environment, raw log, expected behavior, observed behavior, and fix condition.
