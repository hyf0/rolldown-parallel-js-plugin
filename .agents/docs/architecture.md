# Research Architecture

## Working model

There are two independent values to measure. Off-main-thread isolation can keep Node.js responsive or allow other JavaScript work to proceed even when total build time does not improve. Multi-worker throughput can shorten the build only when Rolldown exposes enough independent module work and the plugin's per-task cost is large enough to repay worker and coordination overhead.

The retained Rolldown prototype has this shape:

```text
concurrent Rust module tasks
  -> ordered plugin hooks for each module
    -> ParallelJsPlugin acquires a worker permit
      -> Rust calls the selected worker's Node-API thread-safe function
        -> worker-local JS plugin instance runs in that worker's V8 isolate
          -> result returns through the same Node-API bridge
```

Hook calls do not take a per-call `postMessage` detour through the main thread. Rust queues the callback directly into the Node environment that created the thread-safe function. Plugin options are different: they are copied once per worker through `workerData` and therefore use Node's structured-clone rules. Hook arguments and results still pay Node-API conversion and allocation costs, including source and source-map strings.

One permit is retained for the complete JavaScript Promise lifetime. This preserves one active hook per worker instance, but it also caps already-asynchronous operations at the worker count. The controlled load case shows an ordinary event loop overlapping 512 timers while the worker form can keep only one, four, or eight pending. Releasing a permit before settlement would instead allow concurrent calls on one plugin instance and therefore requires a new state, ordering, reentrancy, cancellation, and shutdown contract.

Hook order remains sequential within one module. The first transform research slice therefore gets throughput only when different modules are ready at the same time. A narrow discovery chain can leave workers idle, while a wide graph can fill the pool. Other ordinary JavaScript plugins and serial build phases remain on the main thread, so moving one transform cannot remove their contribution to the critical path.

The separate `resolveId` and `load` evidence confirms the same synchronous CPU mechanism and exposes different failure modes. With 512 independent CPU-heavy calls, eight workers reach 2.91x for `resolveId` and 2.74x for `load`; one worker regresses in wall time but removes the roughly half-second main-loop stall. Cheap calls, serial chains, cached short filesystem probes, and large results without enough computation lose. An ordinary async `load` overlaps 512 timers in about 22 ms, while worker-1 serializes their pending Promises through one held permit and takes about 3.0 seconds. Hook shape therefore determines whether a worker isolates blocking CPU, duplicates an existing async scheduler, or introduces a new concurrency cap. [Controlled hook result](../../experiments/resolve-load/2026-07-11/README.md)

## Comparison axes

The research must not collapse plugin adaptation and runtime placement into one "parallel" number. They are independent axes.

### Adaptation form

1. Whole-plugin execution retains the existing plugin object and supported behavior with only placement metadata. The current prototype uses this form and requires replicated or partitioned state to be safe.
2. An upstream-maintainable coordinator plus worker kernel keeps global state and lifecycle on the main side and moves an explicit module-local JavaScript computation. Use this only when whole-plugin execution cannot preserve behavior or imports materially unrelated code.
3. A benchmark-only fork duplicates substantial internals, disables production behavior, or bypasses plugin-context semantics. It can establish an upper bound but cannot support a general product claim.

### Runtime placement

1. Ordinary execution is the behavior and wall-time baseline; JavaScript callbacks run in the main Node environment.
2. A Rolldown-managed group with one worker measures off-main-thread isolation without multi-worker throughput.
3. A plugin-owned `worker_threads` pool behind the ordinary transform hook measures whether the same JavaScript kernel can obtain throughput without Rolldown-managed placement, global scheduling, or direct Rust-to-worker dispatch; its main-thread relay and plugin-owned lifecycle remain part of the result.
4. A Rolldown-managed shared group lets several plugins compete for one managed capacity budget.
5. A Rolldown-managed exclusive group reserves one or several workers for one plugin under the same global budget.
6. An optional worker-side ordered pipeline is a separate multi-plugin transport and scheduling form that retains intermediate transforms in one worker.

Evaluate worker placements at the least invasive adaptation form that preserves production behavior, and never compare variants that silently use different plugin semantics. Native or built-in execution is a possible performance bound but remains a separate architecture because it does not measure JavaScript plugin parallelization.

The controlled first-iteration runtime evidence covers ordinary, one-worker, and the current replicated whole-plugin pool. Vue and Svelte then use the coordinator/kernel boundary without proposing a public API because whole-plugin replication is not behavior-complete for either ecosystem plugin. The production-scale iteration adds plugin-owned placement whenever the same kernel can run there; without that baseline, a positive result proves JavaScript worker value but not the additional value of Rolldown ownership.

## Worker placement for the next iteration

The current implementation already uses one shared `WorkerManager`: every parallel plugin is initialized in every worker, and calls from all parallel plugins compete for the same permits. It has no placement configuration, dedicated capacity, per-plugin concurrency policy, or global resource decision beyond the hardware-derived worker count.

The next iteration treats placement as a Rolldown-owned policy rather than assigning one worker to one plugin:

```text
Rolldown worker manager
  -> shared group by default
       -> plugin A instances
       -> plugin B instances
       -> plugin C instances
  -> exclusive group requested by a sustained heavy plugin
       -> one or several instances of plugin D
  -> one global CPU and memory budget across Rust and every JS group
```

For the companion multi-plugin case, compare two plugin-owned pools with one Rolldown-managed shared group under the same total JavaScript-worker, Rust-thread, CPU, and memory budget. A single plugin-owned pool is enough to measure worker execution but not enough to establish the value of Rolldown-wide coordination across plugins.

A shared group reduces the number of V8 isolates, can reuse module imports within each worker, and suits plugins whose work is intermittent or whose combined demand fits the pool. Sharing also creates interference: one long synchronous callback prevents other plugin callbacks in that worker from running, one plugin can occupy all group capacity, heap and garbage-collection pressure is combined, and a worker failure affects every plugin resident there. The scheduler therefore needs per-plugin queues or concurrency limits, measured fairness, and a rule for restoring or failing shared capacity.

Shared module loading is also observable state. Two plugins colocated in one worker can share an ESM or CommonJS singleton through that isolate's module cache, while the same plugins in separate or exclusive groups cannot. The production comparison must detect placement-dependent output, diagnostics, or side effects caused by this coupling rather than counting dependency reuse as a memory optimization alone.

An exclusive group reserves one or several Rolldown-managed workers for one plugin. Exclusive is a placement and resource guarantee, not permission for the plugin to own worker lifecycle, and it does not make replicated closure state safe. It is appropriate only when sustained CPU, resident compiler memory, predictable throughput, failure isolation, or protection from another plugin's long tasks repays the reserved capacity. A requested explicit worker count remains constrained by the global process budget.

Default sharing does not require every plugin to be loaded into every worker. A future manager may place a plugin on a subset of shared workers or load it after the first proven hit, but the resulting maximum concurrency and state model must be explicit. The first production-scale comparison fixes placement after initialization for the lifetime of one fresh build, uses FIFO task order within each plugin plus starvation prevention across plugins as the default reference policy, and fails configuration when an exclusive placement request cannot be honored. Dynamic instance migration, silent fallback to sharing, and replacement of a stateful live instance are outside this iteration.

Placing several plugins in one worker is distinct from running their transforms as one request. The current hook driver still returns each plugin result through Rust before invoking the next plugin. A worker-side ordered pipeline could keep intermediate code and source maps inside one worker and reduce repeated conversion, but it must reproduce ordinary plugin order, null results, source-map chaining, warnings, errors, and plugin attribution. It is a separate execution model and must be measured against shared placement without pipeline fusion. Only transforms that are adjacent in ordinary plugin order and select many of the same modules are eligible for fusion; an intervening main-thread or nonparallel transform preserves the Rust/JavaScript boundary.

## Clean-build coordinator boundary

The production-scale iteration parallelizes the expensive transform kernel, not the complete clean-build lifecycle by default. `buildStart`, `buildEnd`, output hooks, graph mutation, and externally visible side effects remain coordinator-owned unless exact evidence proves another owner safe. Watch, rebuild, and HMR stay excluded.

A worker kernel receives serializable module-local inputs and returns code, source maps, diagnostics, dependencies, assets, and metadata for ordered application by the coordinator. Calls such as `this.parse`, `this.resolve`, `this.load`, `emitFile`, `addWatchFile`, `getModuleInfo`, and logging must be inventoried for the admitted plugin. If a call requires coordinator RPC, its reentrancy, ordering, latency, failure, and serialization become part of the performance and correctness result rather than hidden adapter cost.

## Sustained production-scale behavior

The production target is not dominated by a few hundred milliseconds of worker startup. It requires evidence over a 15–30 minute build with roughly 5,000 distinct project module IDs executing the expensive JavaScript transform. Seven behaviors determine whether the mechanism retains value at that duration:

1. Per-worker transform service must be measured over time, including whether calls become slower after more workers are added, after JIT warmup, as caches grow, or during garbage collection.
2. Worker count must share CPU with Rolldown's Rust work and any native compiler stages. The useful count is the one that shortens complete-build wall time under a global resource budget, not the one that maximizes isolated JavaScript activity.
3. Ready transform width must be a time series rather than one maximum. Sustained width, worker utilization, task-duration distribution, and the last slow worker determine achievable parallelism and load balance.
4. Compiler, dependency, JIT, and cache copies create long-lived RSS, garbage collection, and memory-bandwidth pressure. Peak RSS alone is insufficient; retained memory and service slowdown over the build must be correlated.
5. Several high-frequency transforms may share one worker and execute in ordinary order for one module. Any attempt to avoid repeated Rust/JavaScript conversion must retain every intermediate code value, source-map chain, hook order, warning, and error attribution.
6. A worker-local cache is safe only when hit or miss changes speed but never output, metadata, diagnostics, side effects, or ordering. Randomized assignment, worker count, repeated builds, and cache warmth must not change results.
7. Worker crash and task failure must retain ordinary plugin, hook, module, message, location, frame, and stack information; reject affected queued and in-flight work; and leave no permit, callback, worker, or partial state behind. The first production-scale comparison fails the build rather than automatically retrying a lost task; safe retry remains deferred until a purity and side-effect contract exists.

The detailed admission gate, measurements, correctness requirements, and success criteria are in [production-scale goal](./production-scale-goal.md).

## Later adaptation options

A general-purpose plugin object may not remain safe when identical copies run in several workers. If the current path or Vue case proves that whole-plugin replication is the limiting mechanism, classify state before choosing a replacement:

- A main-thread coordinator can handle non-serializable configuration, plugin communication, global output decisions, and final reductions.
- A worker kernel performs expensive module-local work on serializable inputs and returns code, source maps, diagnostics, dependencies, and declared metadata.
- State is classified rather than hidden in closures: immutable replicated configuration, module-affine state, shared read-mostly cache, worker-local cache, or globally reduced state.
- The scheduler has an explicit policy for module affinity, worker count, lifecycle broadcast, and cancellation.

These are possible responses to evidence, not the starting architecture or a proposed API. Preserve the current simpler design when it is correct and sufficiently fast.

## Why Vue was second in the first iteration

The first experiment uses a controlled JavaScript transform so the runtime path and its costs are observable without plugin integration variables. The second case uses the real `unplugin-vue/rolldown` transform path under Rolldown's API. A thin adapter exposes only `buildStart` and `transform`, applies the same declarative `.vue` filter and module type to ordinary and parallel variants, and keeps the unchanged full ordinary plugin as the correctness reference.

`unplugin-vue` imports Vite helper code even through its Rolldown entry, and its TypeScript tail synchronously invokes native Oxc. No Vite runtime is invoked; the duplicated helper, binding, import, CPU, and memory cost is counted as real plugin overhead. The transform-only case does not claim styles, external blocks, virtual modules, source maps, function-valued configuration, or full Vite-plugin parity.

The measured 166-SFC result shows why a hook shell is not a worker kernel: all transforms are ready together, but every worker still imports the complete unplugin dependency graph, resolves a compiler, warms its own isolate and caches, and competes with Rust and native Oxc. A future coordinator/kernel design is justified only if it can preserve the full ordinary output and diagnostics while loading a materially smaller implementation in workers.

The isolated Svelte comparison supplies the positive real-compiler-kernel case that Vue did not. The same direct-Rolldown architecture loses for 24 components, crosses into a small gain at 256 components, and reaches a 1.36x paired median speedup at four workers for 1,340 independent real SFC sources. Four workers also use about 89% more user CPU and 235 MiB more peak RSS; eight and twelve add resources while reducing the wall benefit. This establishes that framework identity and file count are not sufficient selectors: total compiler work, ready width, import and JIT cost, payload, and contention determine the result.

The narrowed Svelte kernel is intentionally more parallel-friendly than a complete integration. It excludes preprocessing, dynamic callbacks, virtual CSS, and cross-hook metadata, and the corpus uses a wide synthetic entry with every SFC dependency externalized. Exact code and map parity passes, while warning and error parity fails. It is an upper-bound prepared-kernel result rather than representative-project evidence.

The completed graph-preserving Svelte case follows 425 project-local modules from 56 real shadcn-svelte registry barrels and keeps only explicit package boundaries external. Four workers reduce median wall from 596.4 ms to 540.8 ms with a 1.117x paired median speedup and 15 of 15 paired wins, but user CPU grows 2.84x and peak RSS 2.17x; eight workers lose. Median per-run maximum event-loop delay falls from 314.6 ms to 9.9 ms. This is representative project-subgraph evidence, not a full application or official-plugin result, and it still requires a coordinator/kernel split that returns structured diagnostics and module metadata explicitly. [Graph-preserving Svelte result](../../experiments/svelte-transform/2026-07-11-svelte-registry-graph-results.md)

## Evidence levels

Each level answers a different question and must not be promoted into a stronger claim:

1. The unchanged existing example or test establishes whether the retained path can execute at all on the latest Node.js LTS release.
2. A controlled direct-Rolldown transform fixture measures startup, dispatch, payload, scheduling, isolation, and crossover without claiming real-plugin value.
3. A direct-Rolldown Vue transform measures compiler initialization, diagnostics, output bytes, and realistic SFC work under the execution model; it disables source maps and makes no map claim.
4. A pinned direct-Rolldown project graph measures complete fixture-build value, including Rust work, output generation, and contention; the shadcn-svelte registry subgraph supplies this level without claiming a full application.
5. Separate direct-Rolldown `resolveId` and `load` fixtures establish hook-specific CPU, async, graph-shape, payload, state, and reentrancy conclusions without manufacturing a real-plugin win.
6. A required JavaScript transform or transform chain with roughly 5,000 distinct project module IDs verified at the expensive handler boundary and a repeated 15–30 minute ordinary baseline is required before making a production-scale investment claim or a 2x wall-time claim.

Technical quality is an equal evidence axis at every level. A faster variant is not viable if it changes output or source maps, loses metadata, changes diagnostics, leaks workers, deadlocks, or produces worker-count-dependent results.

A cold process includes worker creation, plugin import, compiler initialization, and first-use JIT. A separate warm operating-system-cache run still creates new workers. Watch, rebuild, HMR, and cross-build worker reuse are outside scope and must not appear as required lifecycle cells.

## Optimization families to investigate only after attribution

- Repair only the callback or worker-lifetime condition needed to run the current transform path, and preserve the unchanged failure as evidence.
- Lazily create or initialize workers only when startup is measured as dominant within a production build.
- Select worker count from workload and CPU contention rather than always creating the hardware-derived maximum.
- Route related module hooks to the same worker when state is module-affine.
- Move cross-worker module metadata into a shared Rolldown-owned representation or return it explicitly with hook results.
- Batch small hook calls when dispatch latency is material and hook ordering permits it.
- Make lifecycle broadcast and reduction semantics explicit instead of duplicating work on every instance by default.
- Measure memory and oversubscription before adding more workers because the Rust core is already concurrent.
- Compare default shared placement with an explicit exclusive worker group under one global CPU and memory budget; do not infer that one plugin must own one worker.
- Measure sustained per-worker service, ready width, RSS, garbage collection, cache growth, and failures over the full production build rather than extrapolating subsecond fixtures.
- Compare several sequential transforms colocated in one worker with and without a combined worker-side pipeline only when repeated boundary conversion is measured as material.
