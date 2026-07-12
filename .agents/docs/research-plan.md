# Research Plan

This record separates the completed mechanism-scale sequence, the superseded candidate screen, and the completed 2026-07-12 Cloudflare Docs transform-stage study. Yunfei corrected the screen's requirement that every source project already use Rolldown. The completed adaptation keeps the original Astro build separate and measures worker value only between ordinary and worker-backed direct Rolldown. Its result and remaining product work are in [the Cloudflare adaptation record](./cloudflare-mdx-rolldown.md).

## Active scale, worker-policy, and initialization iteration

Status on 2026-07-13: all new work remains local, direct-Rolldown, Node.js 24.18.0, transform-first, and production-build-only. Frozen controlled Vue and feature-preserving MDX scale grids, independent small/medium/large Vue cases, formal worker-count/allocation/quota matrices, a generic initialization decomposition, runtime initialization correlation, and strict correctness/provenance gates now exist. Controlled Vue, independent Vue, and MDX correctness evidence has been refreshed after the attribution-source changes. The formal matrices have not begun because the unchanged frozen host policy rejects the current machine before the first child for uptime and swap, with transient load, CPU, and free-memory failures also present in the latest MDX snapshot. No new crossover, worker-four versus worker-eight cause, automatic worker default, or repeated initialization duration may be inferred from the untimed work.

The next executable action is not another harness or candidate project. Restart the local M3 Pro, admit the quiet host, then run the already frozen sequence: controlled Vue screen and repeated crossover confirmation; independent Vue screen and confirmation; MDX base screen and ordered crossover refinement; full MDX ordinary/worker-four/worker-eight attribution; Tokio, Rayon, and explicit CPU-rate matrices; and the ten-block generic initialization matrix. Feed only those committed raw artifacts into the fixed-policy evaluator and durable verdict. Svelte remains optional, and the 15–30 minute complete-build, shared/exclusive placement, multi-plugin pipeline, Vite, watch, rebuild, HMR, and cross-build reuse remain outside this iteration.

## Completed Cloudflare high-volume transform-stage study

Status: the Cloudflare study is complete for the local default profile; the production-scale complete-build goal is not. The adapter ran Cloudflare's production MDX chain over 9,157 distinct sources, added a plugin-managed worker control, completed ten rotated wall-time blocks, instrumented exact handler and worker behavior, retained the project-local server graph in a separate scan, and measured the original local Astro build. Four workers reduce the repeated direct stage by more than 2x, but do not make the complete Astro build 2x faster and do not establish an incremental Rolldown-managed advantage over the plugin-owned pool. Metadata, state reduction, diagnostic and failure parity, and resource policy remain blockers rather than hidden follow-up details.

The next iteration first establishes [scale crossover, worker selection, and initialization](./scale-crossover-worker-policy.md) instead of immediately adapting another large project. It maps required Vue and MDX cases across actual transform-hit scales, adds Svelte if feasible, measures every eligible worker count around the optimum, explains why higher counts regress, decomposes initialization, and tests whether a machine-bounded workload-aware policy can approach the best fixed count without hurting small projects. Only after that evidence should another 15–30 minute direct-Rolldown case enter the complete-build, shared/exclusive placement, and multi-plugin study. Vite, CI benchmarking, watch, rebuild, development servers, and HMR remain outside scope.

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

## Superseded production-scale candidate screen: required high-frequency JavaScript transform

Status: the frozen screen and its evidence remain complete, but its disposition is superseded for Cloudflare Docs. Gutenberg and Kibana remain unevaluated beyond the historical rule-1 rejection. Cloudflare proceeds through the separately recorded adapted build-stage sequence, and no result from that adaptation may be called an unchanged full-project build.

### Phase A: candidate admission

- Commit a candidate-search manifest that pins the search date, sources or indexes, queries or selection method, inclusion and exclusion rules, and initial longlist. Source-review and screen at most three credible candidates from that declared universe. If none passes admission, preserve each failed rule, mark later rules `not evaluated`, and finish with a pinned inconclusive-corpus record rather than continuing indefinitely or treating the absence of a workload as a negative ParallelPlugin verdict.
- Find a representative direct-Rolldown build lasting 15–30 minutes in one real project or monorepo using its original graph and production plugin configuration, with roughly 5,000 distinct project module IDs verified at the expensive JavaScript transform boundary.
- Use the latest Node.js LTS available when this `/goal` started and pin its exact patch; do not run a version matrix.
- Report distinct module IDs, total handler invocations, repeated target/output invocations, filter misses, and cache paths separately. Reject physical module count, duplicate files, joined unrelated repositories, manufactured outputs, filter misses, cache bypasses, artificial delay, an externalized main graph, or a Rust/native substitute as evidence for the target.
- Pin why the plugin must remain JavaScript: behavior, configuration, callbacks, ecosystem extensions, ownership, or maintenance cost.
- Define one primary direct-Rolldown invocation and module graph. If the production command runs several independent invocations, report single-graph and whole-command timing separately and compare top-level process parallelism.
- Measure the ordinary target-transform critical-path bound and apply the stated overall-speedup formula before adapting the plugin. Do not substitute accumulated handler time divided by wall time; use an ordinary wall baseline, an instrumented blocking timeline, and an exact-result replay bound. Reject a candidate that cannot mathematically reach a repeated 2x complete-build result.
- If the primary candidate contains one plugin, select a second real JavaScript transform on the same pinned graph for the independent shared-placement, colocated-failure, and optional pipeline case. It must execute over a substantial documented fraction of the same modules and consume material transform time; pipeline work additionally requires meaningful filter overlap and adjacency in plugin order. It must not inflate or contribute to the primary 2x baseline. If no qualifying companion exists, preserve an inconclusive multi-plugin axis rather than adding a trivial transform.

### Phase B: ordinary production trace

- Pin one dedicated representative local host, CPU and memory availability, power and thermal policy, background-load policy, and a no-swap requirement before formal measurement; do not throttle the host merely to reach the target duration. Before parallel runs, derive separate CPU-minute, peak-RSS, and retained-RSS acceptance or review thresholds from that host and its real headroom.
- Separate instrumented attribution from uninstrumented wall confirmation. Record target-transform hit, miss, and cache-path counts; per-call cost distribution; ready-call width over time; queue-free ordinary service; Node main-thread CPU; Rust and native CPU where observable; RSS over time; garbage collection; source and source-map bytes; warnings; errors; output; and shutdown in the attribution run, then quantify instrumentation overhead.
- Establish repeated absolute wall time and environmental variance before any worker change. The intended result is expressed as minutes, not only a ratio. Formal confirmation uses rotated blocks containing ordinary, the best eligible plugin-owned variant, and the best eligible Rolldown-owned variant. Run at least five blocks; if any required ordinary-to-variant 95% paired interval crosses the 2x target or the direct Rolldown-owned-to-plugin-owned interval crosses parity, continue to a maximum of ten, after which the affected wall or incremental-value claim remains inconclusive rather than being decided from the median alone.
- Prove that the expensive time is synchronous JavaScript on the critical path and that the machine has CPU capacity workers can use.

### Phase C: worker execution and placement

- Compare ordinary execution, one-worker isolation, a plugin-managed `worker_threads` pool, the Rolldown-managed shared group, and an explicitly exclusive group containing one or several workers. When adaptation requires a worker kernel, the plugin-managed and Rolldown-managed forms use the same JavaScript kernel, inputs, outputs, and worker count.
- Use one fixed CPU and memory envelope across plugin-managed workers, shared groups, exclusive groups, Rolldown Rust work, and native compiler stages. Record each Rust-thread and JavaScript-worker allocation and prohibit swap.
- Freeze placement for the lifetime of each fresh build. Use FIFO order within each plugin plus starvation prevention across plugins as the default shared reference; fail configuration if an exclusive request cannot be honored, and do not add dynamic instance migration in this iteration.
- Record sustained per-worker service, ready width, utilization, task assignment, per-plugin queueing, long-task imbalance, CPU, RSS, garbage collection, and complete-build wall time for each worker count and placement.
- Inventory clean-build lifecycle hooks and transform-time plugin-context calls. Keep global lifecycle and externally visible side effects coordinator-owned by default; include the latency and semantics of any required coordinator RPC.
- When several high-frequency transforms exist, first measure ordinary separate hook crossings; compare same-worker placement and a combined worker-side ordered pipeline only if boundary conversion is material and the transforms are adjacent in plugin order with substantial filter overlap.
- In the multi-plugin case, compare two plugin-owned pools with one Rolldown-managed shared group under the same total JavaScript-worker, Rust-thread, CPU, and memory budget. This comparison, rather than a single plugin-owned pool alone, determines whether Rolldown-wide cross-plugin coordination adds value.
- Keep the primary 2x comparison separate from a companion multi-plugin case when the accepted production workload contains only one target plugin.

### Phase D: one-at-a-time sustained optimization

- Change only a measured dominant cost: worker placement, worker count, load balance, long-lived compiler or cache memory, per-call conversion, several-plugin pipeline execution, or cache ownership.
- Treat initialization as several measured costs rather than one startup constant. It cannot create minute-scale savings by itself, but repeated per-isolate plugin setup, first-use JIT, and the decision to start any workers can determine the medium-project crossover and safe default policy. Compare each component with the matching ordinary initialization before calling it worker overhead.
- Repeat the same pinned ordinary, plugin-managed, shared, and exclusive cases after every adaptation-neutral change. For a Rolldown-specific change, preserve the unchanged plugin-managed control and repeat every affected Rolldown placement. Stop changes whose expected complete-build benefit is smaller than their implementation and maintenance cost.
- Classify every adaptation as whole-plugin, upstream-maintainable worker-entry/coordinator-kernel, or benchmark-only fork. Record changed lines, disabled capabilities, duplicated upstream logic, dual paths, configuration limits, and expected upgrade maintenance; a benchmark-only fork can establish an upper bound but not general product value.

### Phase E: semantic and failure closure

- Prove exact code, source-map, output-shape, plugin-order, warning, error, metadata, state, cache-determinism, cancellation, and shutdown behavior.
- Test whether colocated plugins observe shared ESM or CommonJS singleton state and whether shared versus exclusive placement changes behavior.
- Inject worker exit, crash, synchronous throw, rejected task, and unresponsive task conditions with queued and in-flight work in shared and exclusive groups.
- Fail a lost task and the build with ordinary-equivalent attribution and no partial state or leaked capacity. Record what a future purity contract would need, but do not implement automatic retry in this iteration.
- After a candidate passes admission, finish with an updated investment verdict that either demonstrates repeated 30→15 or 15→7–8 minute behavior, names the measured reason the target is not achievable, or records a formal interval that remains inconclusive after the predeclared maximum. When no candidate passes admission, finish instead with the bounded inconclusive-corpus verdict from Phase A.

## Parallel defect track

- Reproduce defects that block or invalidate the direct-Rolldown production-build transform path on the pinned latest LTS release.
- Keep other source-backed defects in the inventory, but label Vite-specific, watch-only, rebuild-only, and other-Node-version items as outside the active runtime scope.
- Separate runtime defects from plugin-authoring limits and from experiment mistakes.
- Require every observed defect to retain a minimal command, environment, raw log, expected behavior, observed behavior, and fix condition.
