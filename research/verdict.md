# Parallel JavaScript Plugin Mechanism-Scale Verdict

Snapshot: 2026-07-11, with a scope clarification added on 2026-07-12. This verdict covers the recorded direct-Rolldown mechanism, Vue, Svelte, `resolveId`, and `load` fixtures on Node.js 24.18.0. It does not prove value for a 15–30 minute build, roughly 5,000 expensive transform hits, Vite, watch, rebuild, development servers, HMR, cross-build pool reuse, or other Node.js versions.

## Recommendation

Continue research and bounded architecture investment, but narrow the capability around explicit worker kernels rather than treating the current whole-plugin marker as a generally compatible plugin mode. A production investment decision remains open until the next iteration measures the intended minute-scale workload.

The current design demonstrates two real values. A single worker can remove long synchronous plugin stalls from the Node.js main event loop even when the complete build becomes slower. Several workers can shorten a complete build when Rolldown exposes many independent calls and each call contains enough synchronous work to amortize pool startup, per-worker imports and JIT, scheduling, Node-API conversion, extra CPU, and memory. Neither value follows from the hook name or framework alone.

The current implementation is not ready for production use. Unchanged current main loses its workers after bootstrap on the pinned Node.js LTS release. Research-only lifecycle repairs make experiments possible, but warnings are discarded, errors lose attribution, filters acquire permits before rejecting, worker routing fragments state, reentrant resolution can exhaust the pool, lifecycle and output semantics are incomplete, and eleven supported JavaScript hooks silently become no-ops. A public feature should expose a deliberately smaller contract and reject unsupported behavior rather than silently approximating an ordinary plugin.

## Production-scale decision remains open

Yunfei clarified the intended product target on 2026-07-12: a project must retain a user- or ecosystem-owned JavaScript transform rather than rewrite it in Rust; roughly 5,000 modules actually execute its expensive handler; the ordinary direct-Rolldown build lasts 15–30 minutes; and the desired complete-build result is about 30→15 or 15→7–8 minutes. Vue and Svelte are boundary cases, not the product definition.

The measured real cases are orders of magnitude shorter and cannot settle that target. Their startup evidence also changes priority at production duration: removing a full 400 ms saves less than 0.05% of 15 minutes. The open decision depends on sustained per-worker service, worker and Rust CPU allocation, ready work over time, long-task balance, retained RSS, garbage collection, memory pressure, several-plugin execution, cache determinism, and worker or task failure semantics.

The next comparison uses a Rolldown-managed shared worker group by default and an explicitly requested exclusive group for a sustained heavy plugin, both under the same global CPU and memory budget. Exclusive means a dedicated group containing one or several workers, not one worker per plugin. Colocating several plugins in shared workers remains distinct from executing their transforms as one combined worker request. The full admission and success gates are in the active [production-scale goal](../.agents/docs/production-scale-goal.md); implementation remains gated on candidate admission.

## What has value

### Main-thread isolation

One worker is useful when the goal is keeping the host process responsive or allowing unrelated main-thread JavaScript to proceed. It is not a throughput mode by itself.

- The controlled one-millisecond transform becomes about 9.9% slower in wall time, from 3968 ms to 4362 ms, while maximum event-loop delay falls from 1025 ms to 2.44 ms and output remains identical.
- The 166-SFC Vue case reaches only 0.83x paired build speed with one worker, while maximum event-loop delay falls from 183 ms to 4.59 ms.
- The 1,340-SFC Svelte case reaches 0.90x paired build speed with one worker, while maximum event-loop delay falls from 1108 ms to 2.91 ms.
- The graph-preserving 425-module Svelte subgraph reaches 0.86x paired build speed with one worker, while median per-run maximum event-loop delay falls from 315 ms to 9.72 ms.

This value matters only when another main-thread activity exists to use the released time. A command-line build with no concurrent JavaScript consumer may prefer ordinary execution when wall time is the only objective.

### Multi-worker throughput

Throughput improves only when all of the following hold:

- several hook calls are ready at the same time on the real module graph;
- useful synchronous work per call is large relative to startup, import, JIT, dispatch, conversion, and result processing;
- the worker module, caches, and native addons do not multiply more cost than the calls save;
- the selected worker count fits the machine's CPU and memory budget alongside Rolldown's Rust work;
- plugin state, diagnostics, ordering, and output remain equivalent.

The controlled 512-module graph first crosses ordinary between the separately measured 100k and 125k operation points for worker-4 and worker-8 on this machine. At two million operations per call, worker-8 reaches 4.19x and worker-12 4.75x, but worker-12 buys only another 11.4% wall reduction for about 15% more user CPU and 47 MiB more RSS. The matched 512-module dependency chain never has more than one transform ready and regresses to 0.71x at four workers and 0.70x at eight.

The threshold is not portable. Operation count, source size, and file count are only proxies for the measured call-duration distribution and ready concurrency.

## Transform conclusion

`transform` is a strong candidate when it is a stateless or explicitly state-owned synchronous compiler kernel over many independently ready modules. It is a weak candidate for cheap rewrites, narrow dependency chains, small projects, large payloads without enough computation, native work that is already parallel elsewhere, or a complete plugin whose configuration and caches must be cloned into every isolate.

The controlled case establishes the mechanism, while Vue and Svelte show opposite real-compiler outcomes under the same runtime architecture.

| Case | Ordinary | Best measured worker result | Wall result | Resource and semantic result |
| --- | ---: | ---: | ---: | --- |
| Controlled, 512 generated modules and 513 calls at 2m operations | 1737 ms | worker-12, 366 ms | 4.75x | 3547 ms user CPU and 257 MiB RSS versus 1745 ms and 111 MiB; diminishing after worker-8 |
| Vue, 166 real SFCs | 316 ms | worker-2, 362 ms | 0.91x | all counts lose; worker-8 reaches about 2244 ms user CPU and 462 MiB RSS; output matches but errors degrade |
| Isolated Svelte fan-out, 24 real SFC sources | 213 ms | worker-2, 232 ms | 0.90x | every tested count loses |
| Isolated Svelte fan-out, 1,340 real SFC sources | 2054 ms | worker-4, 1509 ms | 1.36x | user CPU rises from 3008 ms to 5689 ms and RSS from 748 MiB to 983 MiB; code and maps match but warnings and errors do not |
| Graph-preserving shadcn-svelte registry subgraph, 425 local modules and 354 matching transforms | 596 ms | worker-4, 541 ms | 1.117x | all 15 pairs win, but user CPU rises from 913 ms to 2591 ms and RSS from 307 MiB to 666 MiB; worker-8 loses; code and maps match but errors degrade |

### Why Vue loses

All 166 transforms are ready together, so graph width is not the limit. The corpus has only about 125 ms of aggregate ordinary handler work. Every worker imports the complete `unplugin-vue` dependency graph, Vite helpers, compiler, and released native binding, then warms its own isolate and caches. Implementation import takes roughly 72–118 ms per worker; handler time per SFC rises from about 0.75 ms ordinary to 1.39 ms at four workers and 2.81 ms at eight as workers compete with Rolldown and native Oxc. The result is a real negative result for this project and adapter, not a general Vue verdict.

### Why Svelte wins at scale

The isolated Svelte case uses a much narrower module-local compiler kernel and 1,340 real component sources with about 1.84 seconds of aggregate ordinary handler work. A synthetic fan-out entry makes every SFC a root, maximum outstanding wrappers reaches 1,340, and active handler count reaches every configured worker. Four workers amortize their compiler imports and pool startup. Beyond four, per-call compilation slows from 2.32 ms at four workers to 4.79 ms at eight and 6.75 ms at twelve, while CPU and memory continue growing. The 24-component negative control and the 256-component near-crossover show that the positive full result comes from scale and task cost, not the framework name.

The graph-preserving case closes that evidence gap without manufacturing width. It passes 56 real shadcn-svelte registry barrels directly to Rolldown and follows every reached project-local edge across 425 modules, including 350 component compiles and four TypeScript rune-module adaptations. Four workers reduce median wall from 596.4 ms to 540.8 ms, win all 15 paired rounds at a 1.117x paired median, and reduce median per-run maximum event-loop delay from 314.6 ms to 9.9 ms. The gain costs 2.84x user CPU and 2.17x peak RSS, while eight workers lose because compiler and TypeScript import, duplicated memory, and per-call contention outrun the extra slots.

Together the cases establish a ceiling and a realistic subgraph result. The isolated 1.36x does not survive unchanged on the smaller real graph, but the graph still shows a repeatable complete-fixture wall reduction. Neither is a complete official Svelte plugin or application: preprocessing, dynamic options, virtual CSS, cross-hook metadata, SvelteKit, and Vite are excluded, and error or warning parity still fails. [Isolated result](../experiments/svelte-transform/2026-07-11-svelte-results.md), [graph-preserving result](../experiments/svelte-transform/2026-07-11-svelte-registry-graph-results.md)

## `resolveId` conclusion

`resolveId` has the same throughput potential as transform only when resolution contains substantial synchronous module-local CPU work and many import records are ready together. In the 15-round controlled confirmation with 512 independent calls and 500,000 fixed checksum operations each, worker-2, worker-4, and worker-8 reach paired median speedups of 1.50x, 2.32x, and 2.91x. Worker-1 reaches 0.85x but reduces event-loop p99 from 484 ms to 1.31 ms. The output hash and bytes match across variants.

The hook name alone predicts nothing. A cheap 512-call resolver falls to 0.26x even at the best worker setting. Sixteen cached `existsSync` probes per call remain too short and fall to 0.41x. The equally expensive 512-module dependency chain never has more than one handler, permit, or wrapper outstanding and every worker count regresses to 0.78–0.84x.

The controlled positive is a prepared resolver-kernel result, not evidence that a complete ecosystem resolver should move unchanged. Real resolvers often have native alternatives, async filesystem work, instance caches, ordered first-result behavior, custom receipts, and recursive resolution. The probe shows the state and scheduling risks directly: a closure counter is partitioned across workers and produces ten different output hashes in ten reruns, while same-plugin `this.resolve(..., { skipSelf: false })` deterministically deadlocks with one worker. No current surveyed real resolver qualifies as a clean whole-plugin positive case. [Controlled hook result](../experiments/resolve-load/2026-07-11/README.md), [source candidate survey](./resolve-load-candidates.md)

## `load` conclusion

`load` is valuable for wide synchronous CPU generation under the same conditions as transform. The matched 512-call confirmation reaches 1.45x, 2.18x, and 2.74x at two, four, and eight workers. Worker-1 reaches 0.86x but reduces event-loop p99 from 502 ms to 1.22 ms. Cheap generation, an equally expensive serial chain, and 64 KiB of returned code per call without enough computation all regress.

Every worker-2/4/8 confirmation round beats ordinary for both CPU hooks, so the direction is strong. The magnitude is noisy: worker-8 load spans 2.08x to 4.90x across rounds, and recorded one-minute host load averages are roughly 7.3–11.5 on 12 logical CPUs. The medians are evidence for this batch, not portable constants.

Already-asynchronous load work is a decisive negative in the controlled timer fixture. An ordinary plugin overlaps 512 five-millisecond timers and completes in about 22 ms; its isolation run already has event-loop p99 below 4 ms. Worker-1 takes about 3.0 seconds and worker-8 about 440 ms because every unresolved Promise retains one exclusive pool permit. This proves that the current permit lifetime can destroy concurrency already supplied by the event loop. Keep already-asynchronous stages ordinary by default and measure real filesystem or network loaders before generalizing; extract a separately measured synchronous stage only when it has material CPU work.

Real virtual loaders also need precise filters, cache ownership, input and result payload, native compiler stages, and state from `resolveId` or transform. The controlled evidence proves the CPU and permit mechanisms but does not establish a universal load crossover or a complete real-plugin win. [Controlled hook result](../experiments/resolve-load/2026-07-11/README.md)

## Overhead model

The measured costs are additive in mechanism but overlap on the critical path, so queue time and per-call intervals must not be summed into one wall-time estimate.

| Cost | Evidence | Implication |
| --- | --- | --- |
| Fresh pool and minimal plugin | Near-empty build adds about 47–50 ms for one to four workers, 65 ms for eight, and 98 ms for twelve | Small or low-hit plugins should not eagerly create a large pool |
| Minimal worker memory | About 12 MiB RSS per worker before a real compiler | Worker count must be a resource decision, not only a latency decision |
| Implementation import and JIT | Vue imports roughly 72–118 ms per worker; isolated Svelte imports roughly 120–386 ms; graph Svelte imports roughly 206 ms at one worker and 333 ms per worker at eight | A thin hook wrapper is insufficient if its transitive implementation remains heavy |
| Replicated compiler and caches | Vue peak RSS rises to 462 MiB at eight workers; isolated Svelte reaches 1341 MiB at eight and 1800 MiB at twelve; graph Svelte reaches 1076 MiB at eight | Whole-plugin replication can make memory the limiting resource |
| Permit queue and selection | Hundreds of calls can be outstanding; native filter misses still acquire permits | Evaluate known filters before pool scheduling and do not sum concurrent waits as wall time |
| Hook service under contention | Isolated Svelte handler time rises from 1.37 ms ordinary to 6.75 ms at twelve workers; graph Svelte component service rises from 0.80 ms ordinary to 3.24 ms at eight | More slots can reduce throughput when each call slows enough |
| Node-API conversion and result processing | Large source and result payloads increase permit-held time, but measured intervals also include handler and scheduling | Reduce payload only after attribution; current data is not a pure serialization benchmark |
| Rust and native-addon contention | Vue's native Oxc tail and Rolldown share CPU with workers | A JavaScript plugin that calls native code is not automatically a good worker target |
| State and diagnostic repair | Metadata, logs, errors, lifecycle, affinity, and reduction need extra communication | Correctness work is part of the architecture cost, not a benchmark afterthought |
| Pending asynchronous hooks | Ordinary async load overlaps 512 timers in about 22 ms; worker-1 serializes them in about 3.0 s | Keep async work coordinated or define separate pending-operation capacity and instance-concurrency semantics |

## Plugin authoring contract

The practical unit should be a worker-loadable module-local kernel, not an arbitrary existing plugin object. A safe kernel receives behavior-complete structured-cloneable input, performs deterministic work independent of task order, and returns code, maps, dependencies, metadata, and structured diagnostics explicitly.

Each state item needs one declared owner:

- immutable configuration may be replicated when it is cloneable and identical;
- performance-only caches may be worker-local only when cache hits cannot change output or diagnostics;
- module results must be returned to Rolldown-owned shared state or require explicit module affinity;
- build-global aggregates need a coordinator or deterministic reduction;
- shared mutable state needs an explicit synchronization and failure model;
- arbitrary closures, compiler objects, server objects, and process-bound integrations stay in the coordinator.

The kernel must not rely on worker-local `this.warn`, JavaScript-side module metadata, resolver receipts reaching another instance, output hooks seeing distributed closure state, or reentrant `this.resolve` and `this.load` until the runtime defines those semantics. Every worker must expose the same hook shape, and unsupported hooks or options must fail during configuration.

The complete authoring and verification rules are in [plugin authoring model](./plugin-authoring-model.md).

## First-iteration optimization priorities

Correctness repairs are prerequisites rather than optional performance optimizations: explicit worker ownership and shutdown, bootstrap and crash handling, structured diagnostics, truthful hook support, hook ordering, state ownership, and deterministic lifecycle semantics must come before production exposure.

After those gates, the performance work is ranked as follows:

1. Make worker count and isolation-only mode explicit per kernel. Expected impact: high; implementation cost: medium. Every formal case shows that the current hardware-derived default can be far from the best wall, CPU, or memory point.
2. Reject wrapper-visible hook filters before permit acquisition. Expected impact: high for miss-heavy `resolveId`, `load`, and transform plugins, otherwise low; implementation cost: low to medium. This removes provably unnecessary queue and worker selection without changing plugin results.
3. Introduce a coordinator and separately loadable worker-kernel contract. Expected impact: high for real compilers; implementation and ecosystem cost: high. Vue shows why copying a thin shell around a heavy complete dependency graph is insufficient, while Svelte shows that a narrowed compiler kernel can win.
4. Create workers lazily for kernels that receive a matching call and avoid initializing unused plugins in every worker. Expected impact: medium to high for small builds and conditional plugins; implementation cost: medium. Fresh fixed cost and per-compiler memory are already large.
5. Keep already-asynchronous hooks out of exclusive worker capacity or add a distinct pending-operation policy. Expected impact: very high for affected hooks; implementation cost: high because concurrent callbacks on one plugin instance change state, ordering, reentrancy, cancellation, and shutdown semantics.
6. Add workload-aware scheduling using observed ready concurrency, service time, CPU pressure, and memory budget. Expected impact: medium to high; implementation cost: high. It should keep serial chains and small cases ordinary, then expand only while marginal wall benefit justifies CPU and RSS.
7. Externalize module metadata and add explicit affinity or reduction only for kernels that require it. Expected performance impact: workload-dependent; correctness value: high; implementation cost: high. This enables stateful plugins but can constrain scheduling and complicate failure recovery.
8. Consider batching short ready calls only after pre-permit filtering and worker selection are fixed. Expected impact: medium for narrowly identified call shapes; implementation cost: high because ordering, cancellation, errors, payload memory, and first-result semantics must remain exact.

Cross-build pool reuse could remove startup and warmup cost, but it is outside this production-build-only scope because it changes invalidation and lifecycle requirements. It should not be used to explain the current fresh-build results.

## Next-iteration priority order

For the 15–30 minute target, preserve the first-iteration correctness prerequisites but measure and optimize in this order:

1. Sustained per-worker transform throughput, including service slowdown as workers, JIT state, caches, garbage collection, and memory pressure accumulate.
2. Worker count and placement under one CPU budget shared with Rolldown Rust work and native stages.
3. Ready transform width, worker utilization, task-duration distribution, and long-task load balance over the full build.
4. Current, peak, and retained RSS; compiler, dependency, JIT, and cache copies; garbage-collection pauses; and memory-bandwidth pressure.
5. Default shared placement versus an explicit exclusive worker group, including whether one long plugin blocks another and which colocated plugins are affected by one worker failure.
6. Several high-frequency JavaScript transforms in one worker, first as ordinary separate hook calls and then as an optional ordered worker-side pipeline that preserves intermediate code, source maps, hook order, and diagnostics.
7. Worker-local cache determinism across worker count, assignment, repeated runs, and cache warmth.
8. Worker exit and task failure behavior for queued and in-flight work, ordinary-equivalent attribution, pure-task retry, cleanup, and state consistency.

Worker startup, pre-permit filtering, and lazy initialization remain useful for small or miss-heavy workloads but cannot deliver minute-scale savings when the accepted production workload actually hits the expensive transform roughly 5,000 times.

## Technical defects and compatibility boundary

The [defect inventory](./defect-inventory.md) records twenty numbered families. The production blockers group into six mechanisms:

- lifecycle: workers close immediately on unchanged current main, partial initialization can abort, and later crash and cancellation ownership are undefined;
- incomplete plugin surface: unsupported hooks silently no-op, hook order is lost, and JavaScript-side lifecycle and API behavior are absent;
- isolated context and state: logs, options, plugin discovery, module metadata, resolver custom data, and output aggregates are incomplete or worker-local;
- availability routing: related module hooks and global hooks have no affinity, leader, or reduction semantics;
- scheduling: filters run after permit acquisition, pending async calls retain exclusive capacity, broadcasts multiply work, and nested hook calls can exhaust a shared pool;
- diagnostics and resources: warnings disappear, errors lose attribution, and compiler imports, caches, CPU, and memory multiply with worker count.

These defects mean that exact bundle-byte parity in a narrowed fixture is necessary but not sufficient. Production parity also includes warnings, errors, hook order, metadata, lifecycle, deterministic state, clean failure, and resource limits.

## Decision rule for a plugin

Use ordinary main-thread execution when the hook is cheap, mostly null, serial on the graph, already asynchronous or native-parallel, stateful across hooks without an explicit owner, or too small to amortize imports. Use one worker when main-loop responsiveness has independent value and the wall regression is acceptable. Use several workers only after a pinned trace proves enough ready module-local CPU work, output and diagnostic parity, a suitable worker count, and acceptable CPU and RSS.

Do not label a complete Vue, Svelte, or other ecosystem plugin parallel-safe merely because its compiler kernel fits this rule. The coordinator surface, state edges, callbacks, virtual modules, metadata, warnings, and errors must be designed and verified separately.

## Evidence and reproducibility

The primary evidence is the [controlled transform report](../experiments/core-transform/2026-07-11-controlled-release.md), [Vue report](../experiments/vue-transform/2026-07-11-vue-icon-results.md), [isolated Svelte report](../experiments/svelte-transform/2026-07-11-svelte-results.md), [graph-preserving Svelte report](../experiments/svelte-transform/2026-07-11-svelte-registry-graph-results.md), and [controlled `resolveId` and `load` report](../experiments/resolve-load/2026-07-11/README.md). Their raw reports retain Node.js version, host, source revisions, native binding and generated-distribution hashes where available, corpus manifests or generated-case definitions, worker counts, fresh-process samples, CPU, peak RSS, output hashes, and timing boundaries. Executable fixtures live on the pushed Rolldown research branches named by each report.

The conclusions are specific to an Apple M3 Pro with 12 logical CPUs and 36 GiB memory, Node.js 24.18.0, the pinned Rolldown research repairs, direct production builds, and the recorded corpora. Exact crossover points and best worker counts must not be generalized beyond those conditions.

The 2026-07-12 production-scale direction intentionally does not revise any historical measurement. It narrows what those measurements can support and defines the evidence still required before a minute-scale or 2x investment claim.
