# Research Dimensions

Performance value and technical defects are parallel workstreams. The project must answer both before recommending a production direction.

## Value by hook

### `resolveId`

`resolveId` can be called much more often than source compilation and often returns nothing after a small amount of work. Its opportunity depends on the distribution, not the average: cache hits, cache misses, package or tsconfig lookup, filesystem checks, alias rules, and recursive `this.resolve` have different costs. Calls for different modules can overlap, but plugins in one resolution chain remain ordered and stop at the first result. Worker dispatch may therefore dominate lightweight misses while helping expensive synchronous resolvers.

Measure call count, result rate, position of the winning plugin, cache warmth, time in JavaScript versus Rust resolution, recursive calls, queue wait, and the amount eliminated by Rust-side hook filters. Correctness checks must cover skip-self behavior, custom options, externalization, package metadata, stable ordering, and reentrancy.

### `load`

`load` can hide CPU-heavy virtual-module generation, synchronous filesystem work, decoding, preprocessing, or already-asynchronous I/O. A worker can make synchronous JavaScript work concurrent and keep the main thread free, but it cannot make an async I/O operation intrinsically faster and may add dispatch and data-transfer cost. The returned source can also be much larger than a resolution result.

Measure virtual and filesystem-backed paths, hit and miss rates, synchronous and async forms, cache warmth, returned code size, source maps, metadata, emitted files, watch files, and calls to `this.load`. Correctness checks must cover virtual-module identity, dependency discovery, module type, metadata, watch invalidation, and error propagation.

### `transform`

`transform` is the clearest CPU-bound candidate because JavaScript compilers often perform independent per-module work, but it is not the whole plugin cost. Measure compiler initialization, source size, source-map generation, diagnostics, metadata, cache behavior, and the amount of downstream work changed by the transform. Keep pure JavaScript compilation separate from hooks that await native work already running outside the main thread.

### Cross-hook effects

A plugin can create state in `resolveId`, consume it in `load`, then attach metadata in `transform` for a later virtual module or output hook. Speeding one hook while distributing those calls among unrelated worker instances can break behavior. End-to-end attribution must therefore record both the time in each hook and the state edges between hooks.

## Technical defect dimensions

### Runtime viability and lifecycle

- Weak or closing Node-API thread-safe functions, worker event-loop lifetime, startup failure, worker crash, shutdown delay, leaked workers, repeated build cleanup, watch lifetime, cancellation, and Node.js version compatibility.

### Hook and plugin-context compatibility

- Missing hooks that silently become no-ops, unsupported Vite hooks, missing plugin `api`, dummy input and output options, worker-local logging, incomplete `this.meta`, and ordinary plugin-context methods whose state does not cross workers.

### State consistency and determinism

- Random worker selection for related module requests, divergent caches, module metadata visible only in one worker, partial state in `generateBundle`, duplicated broadcast state, worker-count-dependent output, diagnostic ordering, and nondeterministic first-result behavior.

### Scheduling and reentrancy

- Whole-pool barriers, starvation among several parallel plugins, nested `this.resolve` or `this.load`, permit cycles, plugin hooks that wait on module work requiring the same pool, and interaction with Rust's Tokio or Rayon work.

### Configuration and ecosystem compatibility

- Structured-clone failures for functions, classes, custom objects, preprocessors, compiler plugins, and native addons; module singleton assumptions; process-global state; ESM or CommonJS loading; and packages that are not worker-safe.

### Errors, diagnostics, and observability

- Plugin initialization errors, thrown hooks, worker termination during a call, lost stacks, duplicated or missing warnings, attribution to the correct plugin and module, hook timing that double-counts broadcasts, and enough queue or worker telemetry to explain a regression.

### Resource cost

- Repeated V8 parse and JIT work, duplicated compiler instances and caches, peak and retained RSS, oversubscription against the Rust core, garbage collection pauses, and large source or source-map conversion across the Node-API boundary.

## Required defect record shape

Each defect should state the pinned revision and environment, affected hook and lifecycle, expected and observed behavior, minimal reproduction or source evidence, severity, whether it is in the runtime or plugin contract, and the condition under which it can be considered fixed. Unreproduced historical reports remain labeled as such.
