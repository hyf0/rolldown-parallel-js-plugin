# Scale Crossover, Worker Selection, and Initialization

Status: planning record for the next local-only performance iteration, requested by Yunfei on 2026-07-12. This record changes the research plan but does not authorize an implementation claim. The next work first maps Vue and MDX across workload scales, explains higher-worker regressions, tests whether worker count can be selected automatically, and separates generic worker startup from repeated plugin initialization. Svelte is the follow-up curve if the primary cases finish cleanly. CI timing, Vite as the comparison runtime, watch, rebuild, development servers, HMR, and cross-build worker reuse remain excluded.

## Product question

The current evidence supports a practical warning: worker overhead is high enough that parallel JavaScript transforms are most likely to help medium or large builds with frequent mandatory JavaScript work. Project size alone is not the selector. A large project with cheap or mostly skipped transforms can lose, while a smaller project with expensive synchronous transforms and sustained ready work can win.

The useful variables are the number of distinct modules that actually execute the handler, ordinary synchronous work per hit and in total, ready width over time, source and result bytes, worker-local initialization, service slowdown under concurrency, the transform's share of the complete-build critical path, and the CPU and memory left after Rolldown and native stages take their share. The next iteration must express crossover in those variables as well as in familiar project-size labels.

## Existing scale evidence

The existing local cases prove that worker value has a workload-dependent crossover, but they are too sparse to locate it for Vue or MDX or to define a general plugin policy. Only the prepared Svelte curve currently brackets a gain between tested scales, and even that bracket is too coarse for a threshold.

| Workload | Existing scale evidence | Current result | Missing evidence |
| --- | --- | --- | --- |
| Vue SFC | 12 and 166 real SFCs | Every tested worker count loses; the 166-SFC ordinary handler work is about 125 ms | A substantially larger real corpus, intermediate scales, and a graph-preserving small/medium/large comparison |
| Svelte compiler kernel | 24, 256, and 1,340 distinct real SFC sources in a prepared wide graph | All counts lose at 24; worker-4 reaches 1.13x at 256 and 1.36x at 1,340 | Denser points around the crossover and validation on growing real project graphs |
| Svelte project subgraph | 354 matching transforms in a 425-module graph | Worker-4 reaches 1.117x; worker-8 loses | Increasing real entry sets and a larger graph-preserving case |
| Cloudflare MDX | A 32-entry correctness smoke and one 9,157-entry performance scale | Worker-4 supplies strong repeated local stage evidence above 2x at 9,157; the 32-entry run is not performance evidence | A nested scale curve, dense worker counts, repeated crossover neighbors, and worker-8 attribution |

This evidence does not justify one universal statement such as "parallelize above N modules." The same module count can contain very different compiler work, and graph shape can expose or hide that work. The intended output is a family-specific curve plus a cross-family model stated in measured work and ready concurrency.

## Scale-curve protocol

All performance runs use the pinned latest Node.js LTS release, direct Rolldown, fresh local processes, the default production profile, and active-CI refusal. No CI duration enters a curve or threshold.

Use two complementary evidence layers:

1. A controlled same-kernel curve varies the number of distinct real sources while keeping compiler options, output gates, graph shape, and source selection rules fixed. This isolates amortization and service slowdown.
2. A representative-project curve uses real entry roots and retains every reached project-local dependency. This tests whether the controlled crossover survives graph discovery, serial phases, and realistic ready width. Graph preservation alone does not prove virtual-module, metadata, diagnostic, state, or ordering parity; each capability must have its own explicit gate, and an adapter that omits one remains performance-only evidence.

Never create scale by duplicating files, invoking the same module repeatedly, manufacturing delay, or counting filter misses. Use nested, deterministic selections of unique real sources so every larger point contains the smaller point. Freeze the selection before worker timing. When source cost varies widely, use several predeclared stable selections or a predeclared stratification from the ordinary run so one unusually heavy subset does not define the crossover.

The initial common scale grid is 32, 128, 256, 512, 1,024, 2,048, 4,096, and the complete available corpus. A workload may omit impossible points, and the screen should add denser points around the first repeatable crossover rather than treating this grid as a result. Every point records distinct handler IDs, total calls, ordinary handler-service distribution, ordinary handler CPU where observable, source and result bytes, ready-width distribution, graph modules, complete direct-Rolldown wall time, transform critical-path share where it can be attributed, total CPU, and RSS. Summed asynchronous handler elapsed is never treated as CPU or critical-path share; use thread/process CPU attribution, a blocking timeline, and exact-result replay where the handler awaits overlapping work.

Use a two-pass worker-count protocol:

1. Local screening covers ordinary execution and every eligible integer worker count through the safe policy cap, which means 1 through 8 for the current implementation. Counts 10 and 12 remain separate upper-bound probes only when the research build and memory policy allow them. Powers of two alone cannot establish whether 4, 5, 6, or 7 is the best fixed count.
2. Repeated rotated blocks cover the crossover scale neighbors and the best screened worker count together with its lower and higher eligible adjacent counts; at a worker-count boundary, repeat the one adjacent count that exists. Repeat these counts at the full corpus as well. The fixed-count optimum is the best repeated result, not the best one-shot screen. Plugin-managed and Rolldown-managed pools use the same kernel at the selected points so generic worker value remains separate from Rolldown scheduling value.

For Vue, do both forms of evidence: extend a controlled nested-source curve far beyond the current 166-source negative case, and compare at least three independent real Vue projects whose actual matching transform counts put them at small, medium, and large scales. Nested subgraphs from one project do not replace the cross-project comparison. For MDX, build nested selections from the 9,157-source Cloudflare corpus while preserving the docs, partials, changelog, compatibility, and expensive feature mix; retain graph-preserving checks at representative scales. After Vue and MDX establish the primary method, add the Svelte follow-up if feasible by filling the large gap between 256 and 1,340 unique sources and growing real graph entry sets in addition to the existing prepared fan-out curve.

Define the mechanical performance crossover as the smallest scale whose repeated paired 95% lower bound is above parity and whose next larger nested scale confirms the same direction. Define a separate resource-acceptable performance crossover using a material wall-improvement threshold and CPU/RSS/no-swap envelope frozen before timing; this record does not choose that acceptance margin. Reserve product crossover for a case that also passes code, source-map, metadata, diagnostic, state, hook-order, lifecycle, and failure-semantics gates. The current MDX and Svelte adapters do not yet meet that product gate. At each scale report the best count, the point where more workers stop increasing completed transforms per second, and the resource cost. Do not interpolate an exact crossover between sparse points or promote a one-shot screen to a threshold.

## Why four beats eight in the current real cases

Useful transform capacity is approximately worker count divided by service time per call. Moving from four to eight doubles the number of slots. If each call becomes about twice as slow under the added concurrency, sustained capacity does not improve, leaving no throughput gain to offset initialization and other build work. CPU ownership, memory pressure, JIT, garbage collection, scheduling, and native contention still require case-specific attribution.

The separate instrumented Vue and Svelte attribution runs support this explanation; they do not isolate every cause of the uninstrumented wall-time confirmations:

| Workload | Four-worker service | Eight-worker service | Capacity change from 4 to 8 | Wall and resource result |
| --- | ---: | ---: | ---: | --- |
| Vue, 166 SFCs | 1.393 ms/SFC | 2.813 ms/SFC | Approximately 1% lower | Wall +15.9%, user CPU +87.5%, RSS +54.7% |
| Svelte, 1,340-source fan-out | 2.32 ms/SFC | 4.79 ms/SFC | Approximately 3% lower | Wall +7.8%, user CPU +51.6%, RSS +36.4% |
| Svelte, real registry graph | 1.659 ms/component | 3.236 ms/component | Approximately 2.5% higher | The small calculated capacity gain is consistent with the wall regression once initialization and other work are included; wall +23.3%, user CPU +82.8%, RSS +61.5% |

The same host has a counterexample: the controlled heavy synthetic transform improves from 661.0 ms at four workers to 412.4 ms at eight and 365.6 ms at twelve. Its per-call service slows only modestly, so added slots still increase completed work per second. The machine therefore does not have a universal four-worker limit.

Cloudflare currently shows the symptom, not the cause. Its one-shot local screen moves from 25.007 s at four workers to 27.799 s at eight, about 11.2% slower, while total CPU rises from 123.512 s to 203.963 s, about 65.1%, and peak RSS rises from 5.265 GB to 5.622 GB, about 6.8%. The host was already noisy and swap-heavy, and only worker-4 has complete service instrumentation. Cloudflare therefore supports only this statement: eight workers consumed more CPU and memory without improving wall time. CPU competition, heterogeneous cores, Rust/native contention, JIT, garbage collection, memory bandwidth, scheduling, and tail imbalance remain hypotheses until worker-8 is instrumented on a quiet host.

The next attribution run must record worker counts 1 through 8; per-worker service p50/p95 and completed calls per second after warmup; time-weighted ready width; busy and idle intervals; task distribution and tail completion; CPU for main JavaScript, each worker, Rolldown Rust, and native stages where observable; current, peak, and retained RSS; V8 heap and garbage-collection evidence; pageout, swap, and memory-pressure events; initialization and first-call JIT; and the configured Rust-thread budget. Worker count and Rust-thread count form one joint CPU-allocation experiment, not independent maxima.

## Worker-count policy suitable for shipping

Machine information can define a safe upper bound but cannot choose the optimum alone. The current Apple M3 Pro host reports 12 available CPUs. The existing implementation caps the pool at eight, yet eight loses in every real compiler case above while twelve wins in the sufficiently heavy synthetic research case. Neither `min(availableParallelism, 8)` nor a fixed cap of four is a shippable rule.

A candidate automatic policy has three inputs:

1. A machine and process budget: available CPU quota, core topology when available, memory headroom, and an explicit reservation for Rolldown Rust work, the Node.js main thread, and native compiler work.
2. A workload budget: sustained ready width, measured completed transforms per second, per-call service after initial JIT, observed arrival and completion history, payload, and expected worker initialization cost. An estimate of remaining eligible work is usable only if Rolldown can expose a reliable signal.
3. A resource and semantic budget: incremental RSS and garbage collection, no swap or memory pressure, a stable worker-kernel state model, and ordinary-equivalent output and diagnostics.

The research should compare a conservative static cap with a build-local calibration policy. A possible calibration starts ordinary or with one or two workers, excludes initialization and a predeclared first-call warmup window, and adds capacity only while the ready queue remains sustained and measured completed transforms per second improves. Rolldown discovers the module graph incrementally, and transforms can discover more imports, so the policy cannot assume that the exact remaining hit count is known. The experiment must determine whether queue persistence and arrival history can make a conservative repayment decision, or whether an explicit graph-level forecast is required. If higher concurrency does not improve sustained throughput, active permits return to the previous best count. This is a hypothesis, not a selected design: progressive initialization, parking, termination, and mixing ordinary with worker execution can change plugin state and are valid only for an explicit coordinator/kernel contract.

Keep an explicit worker-count override and an ordinary fallback. Worker-1 remains a separate isolation policy when main-thread responsiveness matters despite a wall regression. Before shipping an automatic default, predeclare an allowed wall-time gap from the best eligible fixed count, acceptable extra CPU and RSS, and the maximum tolerated regression on negative small-project cases. The present iteration validates those bounds on the local M3 Pro under explicit CPU quotas across Vue, MDX, the controlled heavy case, and Svelte if feasible. Cross-machine topology portability is a later requirement and cannot be claimed from one host. CI timing is not a substitute for those local measurements.

## Initialization is several different costs

Initialization must be split into generic worker creation, worker bootstrap module loading, implementation and transitive imports, plugin factory and configuration or lifecycle work, binding registration, first worker ready, all workers ready, and first-call JIT. One combined pool-ready number cannot select an optimization.

Existing local evidence differs by plugin:

| Workload | Measured pool readiness or initialization | Dominant observed component |
| --- | ---: | --- |
| Minimal controlled worker | Approximately 47–98 ms of near-empty fixed wall cost as worker count grows | Combined worker, bootstrap, scheduling, and tiny build work; not separately isolated |
| Vue | Approximately 113–163 ms | 72–118 ms implementation import per instance plus repeated compiler resolution and cache setup |
| Svelte fan-out and graph | Approximately 164–503 ms | 120–386 ms compiler or TypeScript import per instance plus construction |
| Cloudflare MDX | Approximately 1.997 s for four workers to become ready | Approximately 1.94–1.95 s of full plugin factory/configuration work in every worker; implementation import itself is only about 1–2 ms |

The Cloudflare number needs a specific correction. Ordinary execution also spends about 1.842 s in the same production factory, while the four worker factories run concurrently and the pool becomes ready in about 1.997 s. In the single instrumented attribution pair, those elapsed intervals differ by about 155 ms; this is neither a repeated startup estimate nor a pure measure of Node.js worker overhead, and it is not four times two seconds of serial wall work. The duplication still matters: four isolates repeat factory and configuration work, while process RSS rises from about 130 MB before pool initialization to about 1.19 GB after readiness. Aggregate initialization CPU was not isolated, and the RSS delta includes isolates, bootstrap, modules, and factory state rather than measuring duplicated factory state alone. Whether that retained state contributes to later garbage collection or memory-bandwidth pressure is not yet measured.

The Cloudflare factory currently reloads and validates Astro configuration, constructs settings and logging, runs integration setup and completion hooks, selects the MDX plugins, and resolves plugin configuration in every worker. The first optimization question is therefore whether a coordinator can perform configuration and non-transform lifecycle work once and pass cloneable derived inputs to a smaller worker compiler kernel without changing plugin behavior. Shrinking the wrapper module alone is unlikely to change Cloudflare initialization because its measured import is about 1–2 ms, although a narrower or prebuilt entry can still matter for Vue and Svelte.

Other clean-build hypotheses are generic worker prestart overlapped with independent build work, exposing the first ready worker while later capacity initializes, lazy per-plugin placement, starting fewer workers for small and medium workloads, and sharing a managed worker group across plugins. Current workers and plugin factories already initialize concurrently, so "parallelize initialization" is not a new optimization. Lazy initialization does not remove Cloudflare's factory cost when 9,157 transforms certainly execute; without an ordinary fallback or progressive ramp, it merely moves the same delay to the first hit. Cross-build pool reuse remains outside scope.

The next initialization trace uses the same stage boundaries for ordinary and worker variants: pool request, worker online or first statement, bootstrap import, implementation import, factory/configuration/lifecycle, binding registration, first ready worker, all ready workers, first transform, first-N cold calls, and steady service. Record critical-path wall using maxima rather than summing overlapping workers, summed CPU separately, ready-time distribution, RSS before and after every stage, retained RSS, heap and garbage collection, page faults and I/O, termination, and how much initialization is removed versus merely hidden behind other work.

Every initialization optimization must move the local fresh-process crossover without changing code, source maps, metadata, diagnostics, hook order, state, failure cleanup, or results across worker counts and task assignment. A subsecond or two-second startup saving remains insufficient evidence for the 15–30 minute complete-build goal, but it can determine whether medium-scale Vue, MDX, or Svelte workloads should enter the worker path at all.

## Ordered next work

1. Freeze the scale selections, worker-count grid, Rust-thread grid, host policy, performance thresholds, and semantic correctness gates before any timing; then restart and quiet the local host.
2. Produce the required Vue and MDX scale curves and repeat the crossover neighbors; add the Svelte follow-up if feasible. Do not begin with a new runtime optimization.
3. Add worker-8 attribution for Cloudflare and use the cross-case service-capacity calculation to classify each regression.
4. Trace ordinary and worker initialization with matching stage definitions, then fit and validate a machine-cap plus workload-calibration policy against the unchanged-runtime fixed-count matrix. If it cannot stay within predeclared wall and resource bounds, retain a conservative default and explicit override rather than shipping a hardware-count guess.
5. Only after the unchanged-runtime baseline is complete, evaluate coordinator/kernel separation and narrower worker entries against the measured dominant component. Any architecture change that affects initialization or service invalidates the old calibration and requires the affected scale and fixed-count matrices to be repeated.
