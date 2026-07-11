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

Hook order remains sequential within one module and one resolution chain. The available speedup comes from different module or resolution tasks reaching the same plugin concurrently. Rolldown also resolves the distinct imports discovered in one module concurrently, so `resolveId` can have more runnable calls than the module count alone suggests. The actual parallel supply still depends on graph shape: a narrow discovery chain can leave workers idle, while a wide graph or a module with many imports can fill the pool.

`resolveId`, `load`, and `transform` must be treated separately because they have different call counts, early-return behavior, payloads, cache dependencies, and effects on graph discovery. Lifecycle hooks that need every instance use a whole-pool barrier and broadcast, which has different cost and state semantics from per-module hooks. Other ordinary JavaScript plugins and serial build phases remain on the main thread, so moving one plugin cannot remove their contribution to the critical path.

## Execution models to compare

The research must not collapse distinct designs into one "parallel" number:

1. Ordinary plugin execution is the behavior and performance baseline; JavaScript callbacks run in the main Node environment.
2. One worker with one plugin instance isolates synchronous JavaScript CPU work from the main event loop but cannot provide multi-worker throughput.
3. The current prototype creates the complete plugin in every worker and sends each throughput hook to an available instance. This is the cheapest runtime model but requires state to be safely replicated or partitioned.
4. An adapted plugin keeps a main-thread coordinator and moves only an explicit worker kernel. This adds authoring work but can preserve configuration, Vite hooks, plugin communication, and global state.
5. Native or built-in execution is an alternative architecture and a possible performance bound. It must remain a separate result because it does not measure pure JavaScript plugin parallelization.

## Plugin adaptation bet

A general-purpose plugin object is unlikely to become safe and fast merely by constructing identical copies in several workers. The initial architecture bet is to split an adapted plugin into explicit roles:

- A main-thread coordinator handles configuration, Vite-only hooks, non-serializable integrations, global output decisions, and final reductions.
- A worker kernel performs expensive module-local work on serializable inputs and returns code, source maps, diagnostics, dependencies, and declared metadata.
- State is classified rather than hidden in closures: immutable replicated configuration, module-affine state, shared read-mostly cache, worker-local cache, or globally reduced state.
- The scheduler has an explicit policy for module affinity, worker count, lifecycle broadcast, cancellation, and reuse across builds. In the current scope, the cross-build reuse policy may explicitly be unsupported or deferred; it does not require runtime reuse evidence.

This is a hypothesis to test against the real plugins, not a proposed API. The project should preserve a simpler design if the adaptations show that fewer concepts are sufficient. If the current API cannot express the smallest correct split, the experiment should record that API gap rather than hide a coordinator or shared-state service inside benchmark-only code.

## Why Svelte and Vue are complementary cases

The current Svelte plugin already returns a list of task-specific plugin objects. Its expensive compile hook exposes a comparatively isolated boundary, and compiled CSS is passed through module metadata. It becomes a worker kernel only after a coordinator supplies the filter, options, ID parser, compile closure, Vite environment identity, and combined source map established by ordinary lifecycle and context; the current subplugin cannot move unchanged. That makes it a useful first case for testing a coordinator plus worker-kernel split, while also exposing whether metadata can cross worker instances correctly.

The current Vue plugin combines configuration, HMR, resolution, loading, SFC parsing, script and template compilation, and several descriptor caches. Later requests for an SFC's virtual submodules depend on state created by earlier hooks. It is the stronger test of module affinity and state ownership rather than a second copy of the Svelte experiment.

## Evidence levels

Each level answers a different question and must not be promoted into a stronger claim:

1. A hook microbenchmark measures fixed startup, dispatch, payload, and scheduling costs.
2. An isolated JavaScript compiler corpus measures the theoretical benefit when tasks are independent.
3. An adapted real plugin measures whether its state and hook semantics survive the execution model.
4. A pinned real application measures end-to-end build value, including other plugins, Rust work, output generation, and contention.
5. Repeated builds or watch mode would measure whether worker reuse and cache behavior change the conclusion. This evidence level is deferred and is not required for the current production-build verdict.

Technical quality is an equal evidence axis at levels three through five. A faster variant is not viable if it changes resolution order, loses virtual modules or metadata, duplicates diagnostics, leaks workers, deadlocks under reentrant plugin-context calls, or produces worker-count-dependent output.

Lifecycle terms must stay distinct even when some are deferred. A cold production build includes worker creation, plugin import, compiler initialization, and first-use JIT. A separate warm operating-system-cache run still creates new workers and is not worker reuse. A repeated `generate` or `write` on the current `RolldownBuild` also creates a new worker pool, while a watch rebuild reuses existing workers and worker-local caches; runtime evidence for those cross-build modes and any custom reused-worker harness is deferred.

## Optimization families to investigate only after attribution

- Use truthful hook usage and apply Rust-side filters before acquiring a worker permit, then quantify the no-op calls and queueing they eliminate before changing the transport.
- Lazily create or initialize workers when startup dominates a production build. Cross-build reuse remains a deferred optimization family until repeated-build or watch coverage enters scope.
- Select worker count from workload and CPU contention rather than always creating the hardware-derived maximum.
- Route related module hooks to the same worker when state is module-affine.
- Move cross-worker module metadata into a shared Rolldown-owned representation or return it explicitly with hook results.
- Batch small hook calls when dispatch latency is material and hook ordering permits it.
- Make lifecycle broadcast and reduction semantics explicit instead of duplicating work on every instance by default.
- Measure memory and oversubscription before adding more workers because the Rust core is already concurrent.
