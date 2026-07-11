# Parallel JavaScript Plugin Authoring Model

Snapshot: 2026-07-11. This document describes what a JavaScript plugin must do to run safely and usefully in Rolldown's current replicated-worker model, and where that model cannot preserve an ordinary plugin contract. It is a research contract, not a proposed public API.

## The unit of parallelism

Rolldown does not split one hook call across workers. Concurrent Rust module tasks invoke independent hook calls; each call acquires one worker permit and runs the complete hook on one plugin instance in that worker's V8 isolate. A plugin gains throughput only when several calls are ready together and each call contains enough synchronous work to repay pool startup, implementation import, scheduling, Node-API conversion, return conversion, extra CPU, and memory.

One worker is a separate mode with a separate value: it moves synchronous JavaScript off the main Node.js event loop but cannot add hook throughput. The release synthetic, Vue, isolated Svelte, and graph-preserving Svelte results all show large main-loop responsiveness improvements even when one-worker total build wall time regresses.

## Required worker entry

The current marker sends an implementation module URL and `options` through Node `workerData`. Every worker imports that implementation and invokes the factory with the same options plus a `threadNumber`.

A safe worker entry therefore must:

- Use only structured-cloneable options. Functions, closures, compiler objects, class prototypes, accessors, and process-bound integration objects cannot cross unchanged.
- Expect the implementation module, its transitive imports, module singleton initialization, and first-use JIT to run once in every worker.
- Return the same hook shape in every worker. The current runtime infers global hook availability and plugin name from whichever instance registers first.
- Avoid process-global singleton assumptions unless separate copies are explicitly correct. Each worker has a separate module cache and V8 heap.
- Keep the worker module small enough that repeated import and memory are justified by later work. The Vue case shows that a thin hook wrapper still imports a heavy full plugin dependency graph.

If an ordinary plugin accepts non-cloneable options, a coordinator must evaluate them into a serializable task snapshot, or the worker module must load a separately named integration by URL. Silently dropping or stringifying those values is not parity.

## State classification

Every state item used by a worker hook needs one declared owner and lifetime.

| State class | Valid current placement | Requirement |
| --- | --- | --- |
| Immutable configuration | Replicated in every worker | Structured-cloneable and identical |
| Worker-local performance cache | One cache per instance | Cache hits may change speed but never output, diagnostics, or ordering |
| Module result state | Returned with the hook result or stored in shared Rolldown graph state | Any later hook can read it regardless of worker routing |
| Module-affine state | One designated worker per module | Requires affinity that the current availability scheduler does not provide |
| Build-global aggregate | Coordinator or explicit reduction | Output hooks cannot infer it from one arbitrary worker instance |
| Shared mutable state | Explicit shared memory or external service | Synchronization, failure, serialization, and contention are part of the contract |
| Watch or rebuild cache | Reused owner with explicit invalidation | Outside the current runtime scope and unsupported by ordinary main-side invalidation alone |

Undeclared closure or module-global state is worker-local by accident. Availability routing means `resolveId`, `load`, and `transform` for the same module may use different instances. The controlled resolver probe turns this into observable evidence: an ordinary closure counter produces one stable sequence, while ten worker-4 runs produce ten different output hashes. Even runs with the same per-worker call totals route different modules to those instances. `generateBundle` and `writeBundle` each choose one available instance, while `moduleParsed` broadcasts to all instances. A plugin that writes an instance map in transform and reads it in load or output cannot be converted safely without affinity, shared state, or reduction.

## Hook kernel requirements

The strongest current candidate is a module-local synchronous kernel:

- The call receives all behavior-relevant input in cloneable hook arguments and immutable options.
- It does not depend on another module's completion order.
- It returns code, map, dependencies, diagnostics, and metadata explicitly rather than hiding them in instance state.
- It produces the same result for every worker count, task order, and worker assignment.
- It does not depend on `this.warn`, `this.info`, or `this.debug`, because the current worker logger is a no-op.
- It does not depend on worker-local module metadata or custom resolver receipts reaching another instance.
- It does not call `this.resolve` or `this.load` unless the runtime has a proven reentrant scheduling rule. A same-plugin `this.resolve(..., { skipSelf: false })` call deterministically deadlocks with one worker because the outer Promise retains the only permit while the inner call waits for it.
- It does not move already-asynchronous work into an exclusive permit merely to call it parallel. An ordinary event loop can overlap many pending Promises in one plugin instance; the current worker pool caps them at its worker count.
- It treats cancellation and worker exit as explicit failures and can be retried only when the hook is pure and duplicate side effects are impossible.

The controlled transform kernel satisfies this model. The narrowed Vue whole-SFC adapter satisfies output determinism for its style-free, virtual-module-free corpus, but still loses ordinary compiler-error structure and imports too much code per worker. The isolated Svelte kernel tests the same model with a larger real compiler corpus and separately records warning and error incompatibility. The graph-preserving Svelte case shows that the kernel can still shorten a representative project-subgraph build, but its 1.117x four-worker gain costs 2.84x user CPU and 2.17x peak RSS and remains far below the 1.36x isolated ceiling.

## Lifecycle and global hooks

Current `buildStart`, `buildEnd`, and `moduleParsed` behavior is not the ordinary single-instance lifecycle. A worker-safe plugin must make every broadcast callback idempotent and safe to execute once per instance. Side effects, one-time warnings, file writes, counters, and registrations otherwise multiply by worker count.

Global output hooks need one of three explicit semantics:

1. Leader-only execution in a designated coordinator with complete shared state.
2. Per-worker partial results followed by a deterministic reduction.
3. Stateless execution using only hook arguments and shared Rolldown graph data.

The current arbitrary `run_single` selection for `generateBundle` and `writeBundle` provides none of these for closure state. A whole plugin that aggregates transform results is therefore incompatible even if its transform itself is parallel-safe.

## Filters and dispatch

Use declarative native hook filters whenever possible, but do not assume they remove current pool overhead. `resolveId`, `load`, and `transform` acquire a permit before the selected `JsPlugin` evaluates its filter. Dedicated and formal hook probes observe acquired permits and null results for filter misses that never invoke the JavaScript handler; the controlled transform and Vue traces show the same wrapper shape.

The runtime optimization is to evaluate wrapper-visible filters before permit acquisition. The authoring optimization is to expose a precise declarative filter rather than a JavaScript `include` function. Both ordinary and parallel baselines must use the same effective filter so filter improvement is not misreported as worker value.

## Diagnostics and errors

Output hash parity is not diagnostic parity. A safe production contract must preserve:

- plugin name and worker implementation identity;
- hook name and module or specifier ID;
- original error name, code, message, location, frame, and stack;
- warnings, info, and debug records with deterministic ordering or a documented multiset order;
- initialization, in-flight, queued, cancellation, and worker-exit context;
- clean termination of every peer after failure.

Current parallel Vue errors lose ordinary structured plugin and hook attribution, complete module identity, compiler-specific fields, and worker stack information. The Svelte probes retain a relative filename, code, source frame, and position but lose the plugin label, complete module path, ordinary formatting, and worker stack; the graph probe does not expose a separate structured hook field in either form. Worker warnings are discarded by the no-op logger. Plugin authors cannot repair these gaps inside an ordinary hook return because current worker-local module metadata does not reliably reach the coordinator.

## Worker-count policy

The current default creates up to eight workers for every parallel plugin and initializes every plugin in every worker. Measurements show no universal best count:

- One worker is useful for main-loop isolation but often slower in wall time.
- Minimal fresh-build overhead rises with worker count before any real compiler is imported.
- Heavy wide controlled work improves through twelve workers but has diminishing wall return and increasing CPU and RSS.
- Babel is best around four workers in the supporting corpus, while eight consumes more CPU and is slower.
- The 166-SFC Vue case regresses even at two workers and becomes much worse at eight.
- The isolated 24-SFC Svelte fixture regresses at every tested worker count, while the synthetic 1,340-SFC kernel case is best at four workers and degrades at eight and twelve despite filling every slot. Its project dependencies are externalized, so it is not representative-graph evidence.
- The graph-preserving 425-module Svelte registry subgraph is also best at four workers, where it wins all 15 paired rounds at 1.117x. Two workers provide a smaller 1.064x; one and eight workers lose every pair. Four workers consume 2.84x ordinary user CPU and 2.17x peak RSS, so the scheduler must weigh resource cost as well as wall time.
- CPU-heavy wide `resolveId` and `load` improve through eight workers in the controlled case, while one worker regresses but removes the main-loop stall. Cheap, serial, payload-only, and already-asynchronous versions lose; async worker-1 is about 126 times slower than ordinary because a pending Promise holds its permit.
- A serial dependency chain cannot use more than one worker regardless of hook cost.

A usable policy therefore needs plugin or kernel identity, fresh versus reused lifecycle, estimated synchronous cost, observed ready concurrency, CPU competition with Rolldown and native addons, memory budget, and whether isolation without throughput is desired. Hardware concurrency alone is insufficient.

## Suitability checklist

A hook is a strong candidate only when all of these are true:

- Most service time is synchronous JavaScript or isolate-local native work that is not already parallel outside the main thread.
- Many independent calls become ready together on the real graph.
- Per-call service is large relative to fixed startup and bridge work.
- The worker module and compiler are not disproportionately expensive to import and warm.
- Input and result payload are small relative to useful work, or transport has been measured and remains secondary.
- State is immutable, returned explicitly, safely worker-local, shared with defined synchronization, module-affine with runtime support, or globally reduced.
- Hook order, first-result semantics, errors, warnings, metadata, and output remain equivalent.
- The selected worker count improves the target objective within CPU and memory limits.

A hook is a weak candidate when it is a small string rewrite, frequent null return, pure asynchronous I/O wrapper, wrapper around a native thread pool, single large aggregate task, serial chain, cache-coherence boundary, reentrant resolver, or output aggregation point.

## Verification gates

Before using a performance result, compare ordinary and parallel forms with the strongest practical gates:

- fresh-process success and clean close;
- exact output bytes, chunks, assets, exports, imports, and source maps;
- repeated output hash stability across worker counts and task order;
- exact matching handler calls and input and returned bytes;
- filter misses, nulls, errors, and cancellations fully explained;
- maximum handler and permit concurrency within the configured pool;
- compiler warnings and errors compared as structured records;
- hook order and first-result behavior with neighboring ordinary plugins;
- state created in one hook and consumed in another;
- worker initialization failure, in-flight throw or rejection, crash, and queued cancellation;
- CPU, peak RSS, main-loop delay, pool initialization, implementation import, service, queue, and result conversion recorded separately.

The current whole-plugin API should reject a plugin surface that cannot meet these gates rather than silently installing a partial object with `HookUsage::all()`.
