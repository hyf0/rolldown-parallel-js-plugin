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

Hook order remains sequential within one module. The first transform research slice therefore gets throughput only when different modules are ready at the same time. A narrow discovery chain can leave workers idle, while a wide graph can fill the pool. Other ordinary JavaScript plugins and serial build phases remain on the main thread, so moving one transform cannot remove their contribution to the critical path.

`resolveId` and `load` have different call shapes and will require separate evidence later. They must not be folded into the transform result, but they also must not delay the first transform verdict.

## Execution models to compare

The research must not collapse distinct designs into one "parallel" number:

1. Ordinary plugin execution is the behavior and performance baseline; JavaScript callbacks run in the main Node environment.
2. One worker with one plugin instance isolates synchronous JavaScript CPU work from the main event loop but cannot provide multi-worker throughput.
3. The current prototype creates the complete plugin in every worker and sends each throughput hook to an available instance. This is the cheapest runtime model but requires state to be safely replicated or partitioned.
4. An adapted plugin can keep a main-thread coordinator and move only an explicit worker kernel. This is a later comparison only when the current whole-plugin path exposes a measured state or authoring limit.
5. Native or built-in execution is an alternative architecture and a possible performance bound. It must remain a separate result because it does not measure pure JavaScript plugin parallelization.

The immediate comparison stops at models one through three. The research must first establish what the retained ParallelPlugin itself does before designing a more general replacement.

## Later adaptation options

A general-purpose plugin object may not remain safe when identical copies run in several workers. If the current path or Vue case proves that whole-plugin replication is the limiting mechanism, classify state before choosing a replacement:

- A main-thread coordinator can handle non-serializable configuration, plugin communication, global output decisions, and final reductions.
- A worker kernel performs expensive module-local work on serializable inputs and returns code, source maps, diagnostics, dependencies, and declared metadata.
- State is classified rather than hidden in closures: immutable replicated configuration, module-affine state, shared read-mostly cache, worker-local cache, or globally reduced state.
- The scheduler has an explicit policy for module affinity, worker count, lifecycle broadcast, and cancellation.

These are possible responses to evidence, not the starting architecture or a proposed API. Preserve the current simpler design when it is correct and sufficiently fast.

## Why Vue is second

The first experiment uses a controlled JavaScript transform so the runtime path and its costs are observable without plugin integration variables. The second case uses the real `unplugin-vue/rolldown` transform path under Rolldown's API. A thin adapter exposes only `buildStart` and `transform`, applies the same declarative `.vue` filter and module type to ordinary and parallel variants, and keeps the unchanged full ordinary plugin as the correctness reference.

`unplugin-vue` imports some Vite helper code even through its Rolldown entry. No Vite runtime is invoked; the duplicated import and memory cost is counted as real plugin initialization overhead. The transform-only case does not claim styles, external blocks, virtual modules, source maps, function-valued configuration, or full Vite-plugin parity.

Svelte is the required later transform comparison after Vue. Its experiment should emphasize the compiler, state, or task-granularity differences that make it more than a duplicate of the Vue matrix.

## Evidence levels

Each level answers a different question and must not be promoted into a stronger claim:

1. The unchanged existing example or test establishes whether the retained path can execute at all on the latest Node.js LTS release.
2. A controlled direct-Rolldown transform fixture measures startup, dispatch, payload, scheduling, isolation, and crossover without claiming real-plugin value.
3. A direct-Rolldown Vue transform measures whether compiler initialization, source maps, diagnostics, and realistic SFC work survive the execution model.
4. A pinned direct-Rolldown application graph measures end-to-end build value, including Rust work, output generation, and contention.
5. The required direct-Rolldown Svelte case follows Vue, then separate `resolveId` and `load` evidence completes the hook-specific conclusions. Earlier results may narrow these later matrices but do not remove them.

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
