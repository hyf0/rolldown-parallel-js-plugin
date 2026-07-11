# Research Architecture

## Working model

There are two independent values to measure. Off-main-thread isolation can keep Node.js responsive or allow other JavaScript work to proceed even when total build time does not improve. Multi-worker throughput can shorten the build only when Rolldown exposes enough independent module work and the plugin's per-task cost is large enough to repay worker and coordination overhead.

The current Rolldown shape is approximately:

```text
concurrent Rust module tasks
  -> ordered plugin hooks for each module
    -> ParallelJsPlugin acquires a worker permit
      -> worker-local JS plugin instance and V8 isolate
        -> result returns through the Node-API thread-safe function bridge
```

Hook order remains sequential within one module and one resolution chain. The available speedup comes from different module or resolution tasks reaching the same plugin concurrently. `resolveId`, `load`, and `transform` must be treated separately because they have different call counts, early-return behavior, payloads, cache dependencies, and effects on graph discovery. Lifecycle hooks that need every instance use a whole-pool barrier and broadcast, which has different cost and state semantics from per-module hooks.

## Plugin adaptation bet

A general-purpose plugin object is unlikely to become safe and fast merely by constructing identical copies in several workers. The initial architecture bet is to split an adapted plugin into explicit roles:

- A main-thread coordinator handles configuration, Vite-only hooks, non-serializable integrations, global output decisions, and final reductions.
- A worker kernel performs expensive module-local work on serializable inputs and returns code, source maps, diagnostics, dependencies, and declared metadata.
- State is classified rather than hidden in closures: immutable replicated configuration, module-affine state, shared read-mostly cache, worker-local cache, or globally reduced state.
- The scheduler has an explicit policy for module affinity, worker count, lifecycle broadcast, cancellation, and reuse across builds.

This is a hypothesis to test against the real plugins. The project should preserve a simpler design if the adaptations show that fewer concepts are sufficient.

## Why Svelte and Vue are complementary cases

The current Svelte plugin already returns a list of task-specific plugin objects. Its expensive compile hook is comparatively isolated, and compiled CSS is passed through module metadata. That makes it a useful first case for testing a coordinator plus worker-kernel split, while also exposing whether metadata can cross worker instances correctly.

The current Vue plugin combines configuration, HMR, resolution, loading, SFC parsing, script and template compilation, and several descriptor caches. Later requests for an SFC's virtual submodules depend on state created by earlier hooks. It is the stronger test of module affinity and state ownership rather than a second copy of the Svelte experiment.

## Evidence levels

Each level answers a different question and must not be promoted into a stronger claim:

1. A hook microbenchmark measures fixed startup, dispatch, payload, and scheduling costs.
2. An isolated JavaScript compiler corpus measures the theoretical benefit when tasks are independent.
3. An adapted real plugin measures whether its state and hook semantics survive the execution model.
4. A pinned real application measures end-to-end build value, including other plugins, Rust work, output generation, and contention.
5. Repeated builds or watch mode measure whether worker reuse and cache behavior change the conclusion.

Technical quality is an equal evidence axis at levels three through five. A faster variant is not viable if it changes resolution order, loses virtual modules or metadata, duplicates diagnostics, leaks workers, deadlocks under reentrant plugin-context calls, or produces worker-count-dependent output.

## Optimization families to investigate only after attribution

- Avoid calls with Rust-side hook filters before changing the transport.
- Reuse or lazily create workers so startup and plugin import/JIT costs are not paid for every output build.
- Select worker count from workload and CPU contention rather than always creating the hardware-derived maximum.
- Route related module hooks to the same worker when state is module-affine.
- Move cross-worker module metadata into a shared Rolldown-owned representation or return it explicitly with hook results.
- Batch small hook calls when dispatch latency is material and hook ordering permits it.
- Make lifecycle broadcast and reduction semantics explicit instead of duplicating work on every instance by default.
- Measure memory and oversubscription before adding more workers because the Rust core is already concurrent.
