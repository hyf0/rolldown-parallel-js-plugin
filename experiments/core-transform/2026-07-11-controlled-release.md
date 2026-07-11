# Controlled Transform Release Results

Date: 2026-07-11. Runtime branch: `research/parallel-js-plugin-core-transform`. The primary reports use Rolldown `6e8d37e5b2a6a7daa57a66f0498d48faef175a9f`; the heavy confirmation uses `54fd0e241410a0e94256e7c26e320524abca49f8`, whose only intervening changes add the confirmation matrix and its README entry. Node.js is 24.18.0 on an Apple M3 Pro with 12 logical CPUs and 36 GiB of memory. The native binding was produced by `just build-rolldown-release`; its source commit and SHA-256 are pinned in the [environment manifest](./data/2026-07-11-release-environment.json).

## Outcome

Parallel JavaScript transform has two independently demonstrated values:

1. One worker can keep CPU-bound plugin code off the Node.js main thread. In the 1 ms synthetic transform case, worker-1 made the build about 9.9% slower but reduced maximum event-loop delay from about 1.025 seconds to 2.44 milliseconds with identical output.
2. Multiple workers can shorten the full build when Rolldown presents enough independent, sufficiently expensive transform calls. The controlled heavy case reached 4.19x at eight workers and 4.75x at twelve workers. Cheap calls, too few modules, or a serial dependency chain all regressed.

There is no hook-name-only or cost-only rule. The observed result depends jointly on fresh-build fixed cost, the number of calls that are ready together, JavaScript work per call, worker count, payload, per-isolate import and JIT work, memory, and CPU contention.

## Method and boundaries

Every controlled sample is a fresh Node.js child and, for parallel variants, a fresh worker pool. The parent generates one unique corpus before timing, runs one discarded warmup for each variant, rotates variant order across measured rounds, and validates raw and normalized output hashes. `totalElapsedMs` starts before the ordinary or parallel plugin import and main-side factory and ends after `build.close()`; it excludes Node process startup and the top-level Rolldown import. `/usr/bin/time -l` supplies child peak RSS. Wall-time claims use instrumentation-off runs only.

The handler performs a fixed number of observable JavaScript integer and string operations and returns the checksum. `workIterations` is an operation count, not a time. V8 tiering, scheduling, and CPU state make its duration nonlinear. The fixture is a favorable model for stateless synchronous CPU work; it is not a compiler, cache, source-map, diagnostic, asynchronous I/O, watch, or HMR model.

Instrumentation separately records matching JavaScript handler calls and time, every Rust wrapper call, permit queue and held time, wrapper concurrency, bytes, worker pool initialization, worker implementation import, factory, binding conversion, and termination. Instrumentation changes timing and is explanation evidence only. Summed queue wait across hundreds of concurrently waiting calls is not build wall time.

Primary artifacts: [wall raw](./data/2026-07-11-release-controlled-wall-primary.json), [wall summary](./data/2026-07-11-release-controlled-wall-primary-summary.json), [instrumented raw](./data/2026-07-11-release-controlled-instrumented-primary.json), [instrumented summary](./data/2026-07-11-release-controlled-instrumented-primary-summary.json), [crossover raw](./data/2026-07-11-release-controlled-wall-crossover.json), [crossover confirmation](./data/2026-07-11-release-controlled-wall-crossover-confirm.json), [secondary axes](./data/2026-07-11-release-controlled-wall-secondary.json), and [heavy confirmation](./data/2026-07-11-release-controlled-wall-heavy-confirm.json).

## Fresh-build fixed cost

The near-empty case contains an entry and one generated module, so it makes two transform calls. It is not a pure worker-startup microbenchmark.

| Variant | Median wall | Median peak RSS |
| --- | ---: | ---: |
| ordinary | 5.87 ms | 74.3 MiB |
| worker-1 | 53.78 ms | 88.1 MiB |
| worker-2 | 53.31 ms | 100.4 MiB |
| worker-4 | 55.82 ms | 125.2 MiB |
| worker-8 | 70.89 ms | 172.4 MiB |
| worker-12 | 104.23 ms | 219.2 MiB |

The observed near-empty fixed addition is roughly 47–50 ms for one through four workers, 65 ms for eight, and 98 ms for twelve. Instrumented pool initialization medians are about 42.9 ms, 48.8 ms, and 55.7 ms for one, four, and eight workers. Worker-local measurement explains only about 2.3–2.9 ms per worker; the remaining main-observed interval combines worker creation, scheduling, and static worker-script imports that begin before worker-local timing.

Peak RSS grows approximately 12 MiB per worker in this minimal controlled plugin. Real compiler workers are substantially larger, as the Vue and Svelte cases test separately.

## Task-cost crossover

With 512 generated modules and 513 matching transforms, every worker configuration loses through 100k fixed operations per call. The best observed worker configuration first crosses ordinary between the separately measured 100k and 125k points on this machine.

| Operations per call | Ordinary | worker-4 | Paired speedup | worker-8 | Paired speedup |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100k | 81.94 ms | 89.20 ms | 0.90x | 89.74 ms | 0.93x |
| 125k | 96.38 ms | 92.01 ms | 1.03x | 90.18 ms | 1.08x |
| 150k | 110.42 ms | 99.72 ms | 1.10x | 89.73 ms | 1.22x |
| 500k | 459.34 ms | 215.44 ms | 2.13x | 156.35 ms | 2.92x |

At 125k, worker-4 wins 14 of 15 rounds and worker-8 wins 12 of 15; worker-8 also has one pronounced losing outlier. The 100k and 125k cases were not interleaved in one matrix, so this is an observed interval, not a portable threshold. Worker-2 crosses later than worker-4 or worker-8. A plugin needs its own call-duration and ready-concurrency distribution rather than this operation count.

## Heavy work and worker-count saturation

The 15-round heavy confirmation is the stable source for the 2m-operation point.

| Variant | Median wall | Paired speedup | User CPU | Peak RSS |
| --- | ---: | ---: | ---: | ---: |
| ordinary | 1736.6 ms | 1.00x | 1745 ms | 111.1 MiB |
| worker-4 | 661.0 ms | 2.63x | 2565 ms | 162.6 MiB |
| worker-8 | 412.4 ms | 4.19x | 3085 ms | 210.1 MiB |
| worker-12 | 365.6 ms | 4.75x | 3547 ms | 257.2 MiB |

Twelve workers reduce wall time another 11.4% relative to eight, while adding about 15% user CPU and 47 MiB RSS. This is a clear marginal-return tradeoff, not evidence that the largest available pool is the right default. The earlier seven-round heavy batch was noisy enough to report materially different exact ratios, so speedup should be treated as a distribution tied to a batch and machine.

## Ready concurrency and graph shape

At 500k operations per call, increasing the number of independent tasks changes whether startup can be amortized and whether workers remain occupied.

| Generated modules | Matching calls | worker-4 | worker-8 |
| ---: | ---: | ---: | ---: |
| 32 | 33 | 0.71x | 0.68x |
| 128 | 129 | 1.70x | 1.81x |
| 512 | 513 | 2.13x | 2.92x |
| 2048 | 2049 | 2.44x | 2.80x |

This axis increases both task count and total work, so it does not isolate module count alone. It demonstrates that many independent equal-cost tasks can amortize startup and expose enough work for the pool.

The matched 512-module dependency chain is the decisive negative control: ordinary takes 490.3 ms, worker-1 518.1 ms, worker-4 691.2 ms, and worker-8 706.6 ms. Instrumentation reports maximum handler activity, permit occupancy, and wrapper outstanding all equal to one. When the graph does not make transforms ready together, more isolates cannot create throughput and instead add initialization, dispatch, import, and JIT cost.

## Payload

The payload matrix uses 128 generated modules, 129 calls, and 100k operations per call.

| Payload | Ordinary | worker-4 | worker-8 |
| --- | ---: | ---: | ---: |
| Small | 30.71 ms | 60.21 ms | 64.43 ms |
| 256 KiB source per file, about 33.8 MiB total | 66.49 ms | 78.82 ms | 78.94 ms |
| 256 KiB returned padding per call, about 33.9 MiB total | 55.64 ms | 71.16 ms | 73.48 ms |

All worker variants still lose. Larger payload makes ordinary slower too, so a ratio moving toward parity does not mean large payload favors worker execution. In instrumented worker-4 runs, permit-held time per wrapper grows from about 324 microseconds for small payload to 897 microseconds for large source and 613 microseconds for large result. These intervals include handler, Node-API conversion, worker scheduling, and Rolldown processing; they are not pure serialization measurements.

## Main-thread isolation

The isolation fixture's transform uses `performance.now()` to busy-wait for about one millisecond per call. Despite its historical directory name, it is not a no-op and is not part of the fixed-operation cost model.

| Metric | Ordinary median | worker-1 median |
| --- | ---: | ---: |
| Build wall | 3968.4 ms | 4362.1 ms |
| Event-loop maximum delay | 1025.0 ms | 2.44 ms |
| Event-loop p99 delay | 1014.0 ms | 1.18 ms |
| Mean event-loop delay | 20.49 ms | 1.13 ms |
| Peak RSS | 648.0 MiB | 662.6 MiB |

Output bytes and SHA-256 are identical in every run. The [raw isolation report](./data/2026-07-11-release-main-thread-runs.json) records Node, commit, host, CPU, RSS, event-loop distribution, output bytes, and hash. It supports a strong conclusion that one worker can preserve main-loop responsiveness even when end-to-end build time regresses. A wall-clock busy loop counts preemption as elapsed work, so it cannot establish a portable task-cost crossover.

## Babel as supporting real-plugin evidence

The restored Babel transform over the pinned Rome TypeScript corpus is useful supporting evidence that a real CPU-heavy JavaScript plugin can shorten wall time. In the ten-run confirmations, ordinary and worker-1 are both about 2.71 seconds, worker-2 is 1.80 seconds, worker-4 is 1.47 seconds, and worker-8 regresses to 1.89 seconds. Relative to the separate ordinary batch, these are approximately 1.51x, 1.85x, and 1.43x for two, four, and eight workers. Worker-4 uses about 80% more user CPU than ordinary; worker-8 uses about 208% more and is slower than worker-4.

These Hyperfine artifacts are secondary evidence: control and worker confirmations are separate invocations rather than one paired matrix, their JSON does not embed Node, Rolldown commit, host, binding hash, input hash, or output hash, and the exact ratios drift between batches. The environment and byte-identical Babel output are independently covered by the main-thread report and smoke gates, but the [Babel control](./data/2026-07-11-release-babel-confirm-control.json) and [worker](./data/2026-07-11-release-babel-confirm-workers.json) wall files do not prove those facts alone.

## Observed implementation costs and defects

- Node.js 24 workers exited immediately after bootstrap on unchanged current main. Research commit `75ba695d1` adds a keepalive; without it the feature is unusable.
- A factory initialization failure left peer workers active and could end in a Node-API `PendingException` and SIGABRT. Research commit `8fe749827` performs all-settled cleanup.
- A matching controlled transform has one extra Rust wrapper call for Rolldown's internal runtime. The wrapper acquires a worker permit before its native filter check, so filter misses still queue and occupy the pool even though the JavaScript handler does not run.
- Sync and rejected transform errors exit cleanly after the cleanup repair, but parallel errors lose plugin name, module ID, hook name, and worker stack context.
- One pool is shared by all parallel plugins, each worker initializes every plugin, and current public behavior fixes the pool at up to eight workers. A slow plugin can occupy permits needed by another, while startup and RSS grow with workers multiplied by plugins.
- Every worker owns a distinct plugin instance and JavaScript state. Random permit selection gives no module affinity, so the controlled stateless handler is a favorable compatibility case rather than proof that an arbitrary plugin can be replicated safely.

The complete compatibility surface and source-backed risks remain in the [defect inventory](../../research/defect-inventory.md).

## Optimization priorities supported by this phase

1. Make worker count a deliberate per-build or per-plugin choice. The best wall point varies, excess workers consume much more CPU and RSS, and one worker is still useful for isolation.
2. Reuse or lazily create workers when the lifecycle permits it. A fresh pool adds roughly 47–98 ms in the minimal fixture before real compiler import and JIT cost.
3. Apply declarative hook filters before acquiring a permit. This removes queue occupancy for known misses and benefits transform, load, and resolveId without changing plugin code.
4. Reduce repeated heavy module import and per-isolate warmup. Vue and Svelte determine how large this cost becomes for real compilers.
5. Add scheduling awareness for ready concurrency and task cost. A serial chain and a 32-module graph should not pay for a large pool; heavy wide graphs can use it.
6. Consider batching only after per-hook traces show many short ready calls. Batching can amortize bridge cost but complicates cancellation, diagnostics, ordering, and memory.
7. Treat affinity, shared state, and reduction as correctness architecture, not optional performance tuning. They are required before stateful whole-plugin replication can preserve ordinary plugin semantics.

## Reproduction

Build the optimized binding with Node.js 24.18.0, then run the committed matrices from `examples/par-plugin/cases/controlled-transform` on the Rolldown research branch. Each runner accepts a raw output path, and `summarize-matrix.mjs` derives the committed summaries. The fixture [README](https://github.com/rolldown/rolldown/tree/0aa600b5721b852cdc4095c7122a929a8cb4a798/examples/par-plugin/cases/controlled-transform) defines every timer, counter, correctness gate, and boundary.
