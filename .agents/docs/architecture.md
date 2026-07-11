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

## Execution models to compare

The research must not collapse distinct designs into one "parallel" number:

1. Ordinary plugin execution is the behavior and performance baseline; JavaScript callbacks run in the main Node environment.
2. One worker with one plugin instance isolates synchronous JavaScript CPU work from the main event loop but cannot provide multi-worker throughput.
3. The current prototype creates the complete plugin in every worker and sends each throughput hook to an available instance. This is the cheapest runtime model but requires state to be safely replicated or partitioned.
4. An adapted plugin can keep a main-thread coordinator and move only an explicit worker kernel. This is a later comparison only when the current whole-plugin path exposes a measured state or authoring limit.
5. Native or built-in execution is an alternative architecture and a possible performance bound. It must remain a separate result because it does not measure pure JavaScript plugin parallelization.

The controlled runtime comparison establishes models one through three. The Vue and Svelte adaptations then use model four as a measured research boundary without proposing a public API, because whole-plugin replication is not behavior-complete for either ecosystem plugin.

## Later adaptation options

A general-purpose plugin object may not remain safe when identical copies run in several workers. If the current path or Vue case proves that whole-plugin replication is the limiting mechanism, classify state before choosing a replacement:

- A main-thread coordinator can handle non-serializable configuration, plugin communication, global output decisions, and final reductions.
- A worker kernel performs expensive module-local work on serializable inputs and returns code, source maps, diagnostics, dependencies, and declared metadata.
- State is classified rather than hidden in closures: immutable replicated configuration, module-affine state, shared read-mostly cache, worker-local cache, or globally reduced state.
- The scheduler has an explicit policy for module affinity, worker count, lifecycle broadcast, and cancellation.

These are possible responses to evidence, not the starting architecture or a proposed API. Preserve the current simpler design when it is correct and sufficiently fast.

## Why Vue is second

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
