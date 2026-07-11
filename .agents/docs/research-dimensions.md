# Research Dimensions

Performance value and technical defects are parallel workstreams. The project must answer both before recommending a production direction.

Every hook result needs three kinds of attribution: how many calls were runnable at the same time, how long calls waited for a worker, and how long the selected plugin instance spent serving them. A long hook with no concurrent peers cannot gain multi-worker throughput; a short hook with many peers can still lose to dispatch and conversion cost.

## Value by hook

### `resolveId`

`resolveId` can be called much more often than source compilation and often returns nothing after a small amount of work. Its opportunity depends on the distribution, not the average: cache hits, cache misses, package or tsconfig lookup, filesystem checks, alias rules, and recursive `this.resolve` have different costs. Calls for different modules and distinct imports discovered in one module can overlap, but plugins in one resolution chain remain ordered and stop at the first result. Worker dispatch may therefore dominate lightweight misses while helping expensive synchronous resolvers.

Measure call count, result rate, position of the winning plugin, graph fan-out, concurrent-call high-water mark, cache warmth, time in JavaScript versus Rust resolution, recursive calls, queue wait, and the amount eliminated by Rust-side hook filters. Correctness checks must cover skip-self behavior, custom options, externalization, package metadata, hook order, stable ordering, and reentrancy.

### `load`

`load` can hide CPU-heavy virtual-module generation, synchronous filesystem work, decoding, preprocessing, or already-asynchronous I/O. A worker can make synchronous JavaScript work concurrent and keep the main thread free, but it cannot make an async I/O operation intrinsically faster and may add dispatch and data-transfer cost. The returned source can also be much larger than a resolution result.

Measure virtual and filesystem-backed paths, hit and miss rates, graph fan-out, synchronous and async forms, cache warmth, returned code size, source maps, metadata, emitted files, watch files, and calls to `this.load`. Correctness checks must cover virtual-module identity, dependency discovery, module type, metadata, watch invalidation, and error propagation.

### `transform`

`transform` is the clearest CPU-bound candidate because JavaScript compilers often perform independent per-module work, but it is not the whole plugin cost. Measure compiler initialization, source size, source-map generation, diagnostics, metadata, cache behavior, ready-module concurrency, and the amount of downstream work changed by the transform. Keep pure JavaScript compilation separate from hooks that await native work already running outside the main thread. Declaring a synchronous JavaScript compiler wrapper `async` does not move its CPU work off the main thread.

### Cross-hook effects

A plugin can create state in `resolveId`, consume it in `load`, then attach metadata in `transform` for a later virtual module or output hook. Speeding one hook while distributing those calls among unrelated worker instances can break behavior. End-to-end attribution must therefore record both the time in each hook and the state edges between hooks.

Classify every important state edge as immutable replicated configuration, worker-local cache, module-affine state, Rust-owned shared state, main-thread coordinator state, or globally reduced output. The classification must describe who creates the state, who consumes it, its invalidation lifetime, and whether ordering matters.

## Technical defect dimensions

### Runtime viability and lifecycle

- Weak or closing Node-API thread-safe functions, worker event-loop lifetime, startup failure, worker crash, shutdown delay, leaked workers, repeated build cleanup, watch lifetime, cancellation, and Node.js version compatibility.

### Hook and plugin-context compatibility

- Missing hooks that silently become no-ops, lost hook `order` metadata, unsupported Vite hooks, missing plugin `api`, dummy input and output options, worker-local or discarded logging, incomplete `this.meta`, and ordinary plugin-context methods whose state does not cross workers.

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

Separate defects in the retained prototype from limits inherent to multi-instance plugins and from adaptation mistakes in a particular Vue or Svelte experiment. A source-proven missing hook is not the same kind of result as a plugin whose global state cannot be partitioned, and neither should be blamed on worker overhead.

The living source-backed inventory is [current defect inventory](../../research/defect-inventory.md). Source-inferred failure paths remain labeled as hypotheses until reproduced after the framing review.

## Required defect record shape

Each defect should state the pinned revision and environment, affected hook and lifecycle, expected and observed behavior, minimal reproduction or source evidence, severity, whether it is in the runtime or plugin contract, and the condition under which it can be considered fixed. Unreproduced historical reports remain labeled as such.
