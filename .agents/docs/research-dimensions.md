# Research Dimensions

Performance value and technical defects are parallel workstreams. The mechanism-scale iteration answers them for its recorded fixtures. A production investment direction still requires the draft [production-scale goal](./production-scale-goal.md).

Every hook result needs three kinds of attribution: how many calls were runnable at the same time, how long calls waited for a worker, and how long the selected plugin instance spent serving them. A long hook with no concurrent peers cannot gain multi-worker throughput; a short hook with many peers can still lose to dispatch and conversion cost.

## Value by hook

### `transform`

`transform` is the clearest CPU-bound candidate because JavaScript compilers often perform independent per-module work, but it is not the whole plugin cost. Measure compiler initialization, source size, source-map generation, diagnostics, metadata, cache behavior, ready-module concurrency, and the amount of downstream work changed by the transform. Keep pure JavaScript compilation separate from hooks that await native work already running outside the main thread. Declaring a synchronous JavaScript compiler wrapper `async` does not move its CPU work off the main thread.

The first fixture establishes the current ParallelPlugin path with controlled synchronous JavaScript work. It varies graph width, module count, source and result size, per-call work, and worker count. The second fixture uses direct-Rolldown Vue compilation. The isolated Svelte compiler-kernel case adds a larger pure compiler boundary, while the graph-preserving Svelte case covers a representative local project subgraph. All compare ordinary execution, one-worker isolation, and multi-worker throughput while preserving the strongest available outputs and diagnostics. The completed graph result reaches 1.117x at four workers but costs 2.84x user CPU and 2.17x peak RSS, while one worker isolates the main loop and eight workers lose. [Svelte graph result](../../experiments/svelte-transform/2026-07-11-svelte-registry-graph-results.md)

### `resolveId`

`resolveId` can be called much more often than source compilation and often returns nothing after a small amount of work. The controlled release evidence shows that 512 independent millisecond-scale synchronous CPU resolutions can reach 2.91x at eight workers, while cheap resolutions, 16 cached `existsSync` probes, and an equally expensive 512-module chain all regress. One worker slows the CPU case to 0.85x but reduces event-loop p99 from 484 ms to 1.31 ms. The opportunity therefore depends on synchronous service cost and simultaneously ready import records, not call count alone.

Real resolvers add stricter limits. Ordered first-result semantics still apply, caches become instance-local, and one-worker `this.resolve(..., { skipSelf: false })` now has a deterministic permit deadlock. The source survey found no clean current whole-plugin candidate that avoids native resolution, async I/O, recursive resolution, custom receipts, or shared cache ownership. The controlled result supports a prepared synchronous resolver kernel, not unmodified `@rollup/plugin-node-resolve` or a universal resolver speedup. [Controlled hook result](../../experiments/resolve-load/2026-07-11/README.md), [candidate survey](../../research/resolve-load-candidates.md)

### `load`

`load` can contain synchronous JavaScript, filesystem work, virtual-module generation, or already-asynchronous I/O. The controlled CPU case reaches 2.74x at eight workers and shows the same main-loop isolation value as transform and resolution. Cheap generation, a serial chain, and 64 KiB returned code without enough computation all regress.

Already-asynchronous work is a strong negative case. An ordinary plugin overlaps 512 five-millisecond timers in about 22 ms while keeping event-loop p99 below 4 ms. Parallel worker-1 takes about 3.0 seconds because each pending Promise holds its only permit; even worker-8 takes about 440 ms. The current model should target synchronous CPU kernels, not wrap async file or network I/O that the ordinary event loop already overlaps. Real load candidates still need their cache, filter, payload, native-stage, and cross-hook state measured separately. [Controlled hook result](../../experiments/resolve-load/2026-07-11/README.md)

### Cross-hook effects

A plugin can create state in `resolveId`, consume it in `load`, then attach metadata in `transform` for a later virtual module or output hook. Speeding one hook while distributing those calls among unrelated worker instances can break behavior. End-to-end attribution must therefore record both the time in each hook and the state edges between hooks.

Classify every important state edge as immutable replicated configuration, worker-local cache, module-affine state, Rust-owned shared state, main-thread coordinator state, or globally reduced output. The classification must describe who creates the state, who consumes it, its invalidation lifetime, and whether ordering matters.

## Production-scale transform dimensions

The next iteration targets a required JavaScript transform or transform chain with roughly 5,000 actual expensive handler hits in a repeated 15–30 minute direct-Rolldown build. Vue and Svelte remain controls rather than the product definition. File count, wrapper count, filter misses, artificial delay, and native substitutes do not satisfy the target.

### Sustained service

- Measure each worker's per-call service distribution throughout the build, not only aggregate time. Separate startup, JIT warmup, stable execution, cache growth, garbage collection, and late-build behavior, and report when adding workers makes every call slower.

### CPU ownership

- Attribute CPU over time among main-thread JavaScript, worker JavaScript, Rolldown Rust work, native stages, and the operating system. Compare worker counts under one process-wide CPU and memory budget so an exclusive group cannot manufacture a win by receiving more machine resources.

### Ready work and balance

- Record ready transform width, worker utilization, queue wait, task assignment, and task-duration distribution over time. One maximum outstanding value does not prove sustained parallelism, and one long final task can determine complete-build wall time after other workers become idle.

### Long-lived memory cost

- Record current, peak, and retained RSS, compiler and dependency copies, JIT and cache growth, garbage-collection pauses, and evidence of memory-bandwidth pressure. Correlate these with per-call slowdown rather than treating worker startup as the dominant cost of a 15–30 minute build.

### Shared and exclusive placement

- Compare the Rolldown-managed shared group with an explicitly exclusive worker group under the same global budget. Measure whether one long plugin blocks other plugins, whether shared workers reuse meaningful imports, how memory and garbage collection combine, how capacity is divided fairly, and which colocated plugins are affected by one worker failure.

### Several plugins in one worker

- Distinguish colocating plugin instances from executing several transforms in one combined request. A worker-side ordered pipeline must retain every intermediate code value, null result, source-map chain, hook order, metadata update, warning, error, and plugin identity before reduced boundary traffic can count as a gain.

### Cache determinism

- A worker-local cache may change speed only. Compare output, metadata, diagnostics, side effects, and ordering across worker counts, randomized assignment, repeated fresh runs, and cache warmth; move behavior-relevant state to a coordinator, shared graph, deterministic reduction, or explicit affinity.

### Failure behavior

- Exercise worker exit, crash, synchronous throw, rejected task, unresponsive task, queued cancellation, and shutdown in shared and exclusive groups. Preserve ordinary attribution, define which work fails, retry only proven-pure tasks, restore or reject capacity deterministically, and leave no permit, callback, worker, or partial state behind.

## Technical defect dimensions

### Runtime viability and lifecycle

- Weak or closing Node-API thread-safe functions, worker event-loop lifetime, startup failure, worker crash, shutdown delay, leaked workers, cancellation, and compatibility with the pinned latest Node.js LTS release.

### Hook and plugin-context compatibility

- Missing hooks that silently become no-ops, lost hook `order` metadata, missing plugin `api`, dummy input and output options, worker-local or discarded logging, incomplete `this.meta`, and ordinary plugin-context methods whose state does not cross workers.

### State consistency and determinism

- Random worker selection for related module requests, divergent caches, module metadata visible only in one worker, partial state in `generateBundle`, duplicated broadcast state, worker-count-dependent output, diagnostic ordering, and nondeterministic first-result behavior.

### Scheduling and reentrancy

- Non-atomic whole-pool acquisition, concurrent barriers, starvation among several parallel plugins, nested `this.resolve` or `this.load`, permit cycles, plugin hooks that wait on module work requiring the same pool, and interaction with Rust's Tokio or Rayon work.

### Configuration and ecosystem compatibility

- Structured-clone failures for functions, classes, custom objects, preprocessors, compiler plugins, and native addons; module singleton assumptions; process-global state; ESM or CommonJS loading; and packages that are not worker-safe.

### Errors, diagnostics, and observability

- Plugin initialization errors, thrown hooks, worker termination during a call, lost stacks, duplicated or missing warnings, attribution to the correct plugin and module, hook timing that double-counts broadcasts, and enough queue or worker telemetry to explain a regression.

### Resource cost

- Repeated V8 parse and JIT work, duplicated compiler instances and caches, peak and retained RSS, oversubscription against the Rust core, garbage collection pauses, and large source or source-map conversion across the Node-API boundary.

## Defect attribution

Separate defects in the retained prototype from limits inherent to multi-instance plugins and from adaptation mistakes in the direct-Rolldown Vue experiment. A source-proven missing hook is not the same kind of result as a plugin whose global state cannot be partitioned, and neither should be blamed on worker overhead.

The living source-backed inventory is [current defect inventory](../../research/defect-inventory.md). Source-inferred failure paths remain labeled as hypotheses until reproduced. Vite-specific and watch-only findings may remain as historical background but are not active runtime tasks.

## Required defect record shape

Each defect should state the pinned revision and environment, affected hook and lifecycle, expected and observed behavior, minimal reproduction or source evidence, severity, whether it is in the runtime or plugin contract, and the condition under which it can be considered fixed. Unreproduced historical reports remain labeled as such.
