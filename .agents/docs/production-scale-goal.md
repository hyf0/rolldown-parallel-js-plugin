# Production-Scale Parallel JavaScript Transform Goal

Status: the Cloudflare high-volume transform-stage study completed locally on 2026-07-12, but this complete-build goal is not satisfied. Cloudflare reaches the distinct-module and repeated stage-speedup thresholds, fails the complete-build time-share gate, violates the intended clean-host policy, lacks shared/exclusive and multi-plugin evidence, and fails semantic closure. This document remains the durable specification for a later complete-build and placement iteration. [Cloudflare adaptation](./cloudflare-mdx-rolldown.md)

## Outcome

Determine whether Rolldown can preserve a required JavaScript plugin or JavaScript transform chain and use worker threads to reduce a representative direct-Rolldown production build from roughly 30 minutes to 15 minutes, or from 15 minutes to 7–8 minutes, without replacing the measured JavaScript work with Rust or another native implementation.

The target workload has roughly 5,000 distinct project module IDs that actually execute the expensive transform. Discovered files that do not execute the handler, repeated target or output invocations, filter misses, cache hits that avoid the expensive path, synthetic delay, and an externalized main graph do not count toward that target.

The product question is broader than Vue or Svelte. Projects cannot reasonably rewrite every user- or ecosystem-owned JavaScript plugin in Rust. This iteration asks whether a bounded JavaScript worker contract can retain that extension surface while turning sustained, module-local JavaScript transform work into multi-core throughput.

The product claim must separate the value of JavaScript worker execution from the additional value of Rolldown-owned coordination. A plugin-managed `worker_threads` pool using the same JavaScript kernel is therefore an alternative baseline, not an implementation detail that may be omitted.

## First production-stage disposition

Cloudflare's 9,157 real production MDX transforms pass the volume and JavaScript-work gates. Ten rotated local default-profile blocks show a 2.178x paired median speedup for Rolldown-managed four-worker execution and 2.386x for a plugin-managed four-worker pool, with normalized output parity. The host violated the predeclared pageout, swapout, and background-load policy, so this is strong repeated local evidence rather than clean-host formal confirmation. The direct stage falls from a 63.089-second median to 28.226 seconds, but the original local Astro reference is 689.01 seconds and route rendering dominates much of the remainder. The workload therefore cannot support the requested 15→7–8 or 30→15 minute complete-build result.

The run also fails the semantic and product gates: ParallelPlugin observably drops Astro metadata, isolate-local link-validation state is not reduced, Cloudflare diagnostics and crash semantics remain untested, earlier fixtures show degraded attribution, resource use rises, and eight workers regress. Before returning to the complete-build and placement goal, the [scale crossover and worker-policy iteration](./scale-crossover-worker-policy.md) must locate the required Vue and MDX performance thresholds, add Svelte if feasible, explain higher-count regression, decompose initialization, and test an automatic default against fixed worker counts. Shared versus exclusive placement, several-plugin execution, deterministic reduction, and ordinary-equivalent errors remain primary requirements after that step. All timing comparisons were launched locally; the direct artifacts record `RUN_LINK_CHECK=false`, but the earlier kernel runner did not persist `CI`.

## Why another iteration is required

The completed cases establish execution mechanics, fixed cost, crossover, main-thread isolation, state risks, and opposite real-compiler outcomes. They are too short to answer the intended production-scale question: the 166-SFC Vue build is about 316 ms, the graph-preserving Svelte build about 596 ms, and the isolated 1,340-SFC Svelte fixture about 2.1 seconds ordinary.

The controlled near-empty build adds roughly 47–98 ms of fixed wall time as worker count grows; it still includes one entry, one generated module, and two transform calls, so it is not a pure worker-startup microbenchmark. Vue and Svelte pool readiness ranges roughly 113–503 ms as compiler imports grow. Cloudflare reaches about 1.997 seconds because every worker repeats a production factory that ordinary execution already runs in about 1.842 seconds. In the single instrumented attribution pair, those intervals differ by about 155 ms; this is not a repeated estimate or a pure measure of Node.js worker overhead. Eliminating the measured initialization critical path in the current cases cannot produce minute-scale savings on a 15–30 minute build, but repeated configuration work and the complete pool's roughly 1 GB RSS increase can decide whether a medium workload crosses into a gain and whether an automatic default is safe. Aggregate initialization CPU was not isolated. The next iteration therefore measures initialization alongside sustained throughput, CPU allocation, ready work, memory pressure, cache semantics, multi-plugin execution, and failure behavior.

## Workload admission gate

A candidate enters adaptation when source evidence and an initial ordinary reference prove all of the following:

- It has a pinned production reference with enough real duration and transform volume to justify adaptation, and the experiment can express the target build stage through direct Rolldown on the latest Node.js LTS patch. If the source project uses another bundler, preserve that command as a separate reference and establish ordinary direct Rolldown before ParallelPlugin; never attribute migration or graph-adaptation gains to workers. Artificial CPU throttling or memory pressure introduced only to reach the duration does not qualify. This iteration does not run a Node.js version matrix.
- It is one real project or monorepo build using the original module relationships and production plugin configuration. It does not join unrelated repositories, duplicate source files, manufacture extra outputs, or otherwise add work only to reach the target duration.
- A required JavaScript plugin or transform chain owns the expensive path. The plugin is retained because its JavaScript behavior, configuration, callbacks, ecosystem extensions, or maintenance model makes a wholesale Rust rewrite an unrealistic product answer.
- Roughly 5,000 distinct project module IDs execute the target expensive transform. Each hit is counted at the actual handler boundary; total invocations, repeated target or output invocations, misses, and bypassed cache paths are reported separately and cannot substitute for the distinct-module count.
- The target transform occupies enough of the build time that a 2x complete-build result is mathematically possible.
- Multiple target transforms are ready for meaningful portions of the build, not only at one instantaneous peak.
- The ordinary build is not already spending the relevant time in asynchronous I/O or a native thread pool that workers would merely wrap.
- Source, lockfile, plugin versions, inputs, outputs, warnings, errors, source maps, and environment can be pinned and redistributed or otherwise reviewed by maintainers.

The primary performance unit is one pinned direct-Rolldown invocation and module graph. If the real production command contains several independent Rolldown invocations, report the single-graph and whole-command results separately and compare top-level process parallelism before attributing an orchestration-level win to ParallelPlugin.

The primary 2x candidate may contain one required JavaScript plugin or a real transform chain. If it contains only one, the same pinned real graph must also provide a separate multi-plugin case using at least one additional real JavaScript transform with no artificial delay. The companion transform must execute on a substantial documented fraction of the same modules and consume material transform time; if pipeline fusion is evaluated, the two transforms must also have meaningful filter overlap and be adjacent in ordinary plugin order. That companion case supplies shared-placement fairness, colocated failure, and optional ordered-pipeline evidence; it cannot be counted toward the primary 2x claim or used to inflate the primary baseline. If no qualifying companion exists, report the multi-plugin axis as inconclusive rather than substituting a trivial plugin.

The time-share gate uses `overall speedup = 1 / ((1 - p) + p / s)`, where `p` is the fraction of ordinary build time that determines completion and is spent in the target transform, and `s` is the measured transform-stage speedup. A 2x complete-build target requires at least 92% transform share when `s = 2.2`, 75% when `s = 3`, 67% when `s = 4`, and 57% when `s = 8`. Reject the candidate before adaptation when its measured share cannot reach the target.

## Candidate search and terminal outcomes

Before screening, commit a candidate-search manifest that pins the search date, public sources or indexes, queries or selection method, inclusion and exclusion rules, and initial longlist. Screen at most three serious candidates from that declared universe whose source, production configuration, transform path, and approximate scale have already passed a source review. Preserve each candidate's failed admission rule and mark later rules `not evaluated` after a decisive early rejection. If fewer than three credible candidates exist in the manifest, preserve that bounded result. Do not keep broadening the search until an artificial positive appears.

The iteration has four valid terminal outcomes:

1. A positive result: an admitted candidate reaches the wall-time target under the pinned resource and correctness envelope.
2. A bounded negative result: an admitted candidate does not reach the target, and the measured critical path, throughput, resource, semantic, or authoring limit explains why.
3. A formal inconclusive result: an admitted candidate reaches the predeclared maximum confirmation blocks while a required interval still crosses the 2x target or plugin-owned parity. This records the unresolved claim without selecting a conclusion from the median.
4. An inconclusive corpus result: no credible candidate in the predeclared search universe, up to the screening limit of three, passes admission. This completes the bounded search and records an evidence gap; it must not be presented as proof that ParallelPlugin has no value.

## Execution models

Every accepted workload compares the same JavaScript behavior under these runtime placements:

1. Ordinary main-thread execution is the correctness and wall-time baseline.
2. One worker measures main-thread isolation without claiming transform throughput.
3. A plugin-managed `worker_threads` pool measures how much of the result a plugin author can obtain without Rolldown-managed placement or direct Rust-to-worker scheduling. When an explicit worker kernel is required, this baseline uses the same kernel, worker count, task inputs, task outputs, and global resource envelope as the Rolldown-managed forms and counts its main-thread relay and plugin-owned scheduling costs.
4. A Rolldown-managed shared worker group is the default parallel policy. Several plugins may reside in the same workers under one global CPU and memory budget.
5. An explicitly exclusive worker group gives the target plugin dedicated capacity. Exclusive means that no unrelated plugin resides or runs in that group; the group may contain several workers and remains owned by Rolldown.
6. When the primary workload contains several high-frequency JavaScript transforms, an optional worker-side ordered pipeline may compare running them sequentially for one module inside one worker against returning to Rust after every plugin. If the primary candidate contains one plugin, run this comparison only in the separate real companion case. This is a separate transport and scheduling model because it changes source-map chaining and error attribution responsibilities.

Runtime placement and plugin adaptation are separate axes. Attempt each worker placement with the least invasive adaptation that preserves the production behavior: whole-plugin execution first, then an upstream-maintainable coordinator plus worker kernel only when whole-plugin replication is not viable. A benchmark-only fork is an upper bound, not a comparable product model. The detailed adaptation levels appear below.

The separate multi-plugin comparison includes two plugin-owned pools versus one Rolldown-managed shared group under the same total JavaScript-worker, Rust-thread, CPU, and memory budget. This is the comparison that can establish whether Rolldown-wide scheduling, placement, and cross-plugin coordination add value beyond each plugin parallelizing itself.

No public configuration syntax is decided here. The required semantics are default shared placement, an explicit exclusive-group request, an explicit or automatic worker count constrained by a global Rolldown resource budget, and a deterministic visible outcome when requested placement cannot be honored. For this iteration, placement is fixed after initialization for the lifetime of the fresh build, and an exclusive request that cannot be honored fails configuration rather than silently sharing. Dynamic migration and replacement of a live plugin instance are deferred because they change state, JIT, cache, and failure semantics.

Before formal shared-group measurement, freeze the queue and fairness policy in the executable record. The default reference is FIFO order within each plugin plus starvation prevention across plugins; any different policy must be justified and held constant across the formal comparison.

## Questions the iteration must answer

### Sustained transform throughput

- What is each worker's transform service-rate distribution after startup, during steady execution, and near the end of a 15–30 minute build?
- Does per-call service slow as worker count rises, and does that slowdown change after JIT warmup, garbage collection, cache growth, or memory pressure?
- Which worker count maximizes complete-build wall improvement rather than isolated handler throughput?

### CPU allocation with Rolldown

- How much CPU is used by main-thread JavaScript, worker JavaScript, Rolldown Rust work, native compiler stages, and the operating system over time?
- Does adding workers consume otherwise idle cores or compete with Rust and native work that already uses them?
- What global worker budget and exclusive-group size improve wall time without unacceptable total CPU or machine interference?

### Ready work and load balance

- How many target transforms are ready at each point in the build, how long does that width persist, and how often are workers idle while work remains blocked on graph discovery or preceding hooks?
- Are long modules distributed evenly, or does one worker determine the end of the build while others finish early?
- Does shared-pool traffic from other plugins delay the target plugin, and does exclusive placement remove enough delay to justify its reserved capacity?

### Memory, JIT, caches, and garbage collection

- How do current, peak, and retained RSS change throughout the build for each worker count and placement policy?
- How much compiler code, dependency state, JIT code, heap data, and cache content is duplicated per worker?
- Do garbage-collection pauses, cache growth, or memory-bandwidth pressure explain service slowdown or late-build regressions?
- Does colocating plugins reuse meaningful module dependencies, or does it only increase one worker's heap and pause time?
- Can two colocated plugins observe shared ESM or CommonJS singleton state through the worker's module cache, and can shared versus exclusive placement therefore change behavior?

### Several transform plugins in one worker

- Can several high-frequency JavaScript transforms run in ordinary plugin order inside one worker for the same module and reduce repeated Node-API conversion?
- Can the worker preserve each intermediate code value, source-map chain, null result, plugin identity, hook order, warning order, and error attribution?
- Is same-module worker placement sufficient, or does the gain require a worker-side pipeline with one combined request and response?
- Does one long transform prevent unrelated plugins in a shared worker from making progress, and what scheduling or exclusive placement prevents that behavior?
- Are the candidate transforms adjacent in ordinary plugin order and selected for many of the same modules? If a main-thread or nonparallel transform sits between them, the experiment must retain that boundary instead of claiming a fused pipeline.

### Clean-build lifecycle and plugin context

- Which `buildStart`, `buildEnd`, output-stage, and other clean-build lifecycle behavior must remain in one coordinator even though watch and rebuild are excluded?
- Which target transforms call `this.parse`, `this.resolve`, `this.load`, `emitFile`, `addWatchFile`, `getModuleInfo`, logging, or metadata APIs, and which calls can be represented as explicit inputs or structured results without changing semantics?
- When a plugin-context call requires coordinator RPC, what reentrancy, ordering, serialization, and latency does it add, and can that cost erase the transform gain?
- The default adaptation keeps global lifecycle, graph mutation, and externally visible side effects in the coordinator. A worker kernel performs module-local CPU work and explicitly returns code, source maps, diagnostics, dependencies, assets, and metadata for ordered application.

### Worker-local cache semantics

- Which caches are performance-only, and can every hit or miss produce identical output, metadata, diagnostics, and side effects?
- Are output hashes and diagnostics stable across worker counts, randomized task assignment, repeated fresh builds, and different cache-warmth states?
- When a cache affects behavior, can ownership move to the coordinator, Rolldown graph state, deterministic reduction, or explicit module affinity?

### Worker and task failure

- When a worker exits, crashes, rejects a task, or becomes unresponsive, which in-flight and queued transforms fail and how are their plugin name, hook, module ID, message, code, location, frame, and stack reported?
- In a shared group, which colocated plugins are affected by one worker failure, and can Rolldown restore capacity without silently changing plugin state?
- What contract would be required before a pure task could be retried without duplicate side effects? The primary iteration does not automatically retry a crashed or lost task; it fails the build with ordinary-equivalent attribution and leaves retry design for later evidence.
- Do cleanup, cancellation, and shutdown leave no pending permits, registered callbacks, workers, or partial coordinator state?

## Resource and success envelope

Pin one dedicated representative local host before formal runs, including its CPU availability, memory limit, power mode, thermal conditions, operating-system version, and background-load policy. Do not throttle it merely to make the ordinary build last 15–30 minutes. The ordinary and every worker variant use the same total CPU and memory envelope, must not swap, and may redistribute that CPU budget between Rolldown Rust threads and JavaScript workers only through a recorded configuration.

The primary metric is complete-build wall time in minutes. CPU-minutes, peak RSS, retained RSS, and machine interference are co-equal resource results rather than caveats. Before parallel runs, derive separate CPU-minute, peak-RSS, and retained-RSS acceptance or review thresholds from the pinned local host and its real headroom; do not choose them after seeing the variants. A variant that needs a larger host allocation than the ordinary production target is a conditional resource-for-time result, not the primary 2x success. Report CPU and memory classifications separately rather than collapsing them into one resource label.

Main-thread event-loop isolation remains a secondary result. It may justify a one-worker mode for a different product need, but it cannot rescue a negative 2x production-build verdict.

## Measurement protocol

### Run classes

Keep three run classes separate:

1. Candidate screening uses source inspection and the minimum ordinary runs needed to decide admission.
2. Instrumented attribution runs record target-transform hits and paths; per-call and per-worker service distributions; ready-call width over time; queue wait; worker utilization; task assignment; Node-API input and result bytes; source-map bytes; initialization and import; CPU by relevant execution owner where observable; RSS over time; garbage-collection evidence; output and diagnostic hashes; host load; and clean shutdown.
3. Formal wall confirmation uses fresh processes with instrumentation disabled or reduced to a previously measured negligible level. It records absolute wall time, process-level CPU and memory, correctness hashes, environment, and variant order without claiming detailed attribution from that run.

Measure the instrumentation delta against an otherwise identical control. Do not require every formal wall run to carry the full profiler when the profiler can change scheduling, garbage collection, payload, or timing.

### Critical-path bound

Do not estimate `p` by dividing accumulated handler time by wall time: Rust, native, and JavaScript work can overlap, and summed callbacks can exceed the critical path. Establish the bound using all of the following:

- an uninstrumented ordinary wall baseline;
- an instrumented timeline that shows when Rolldown is blocked on target callbacks and when other work overlaps them;
- an exact-result replay that returns the pinned ordinary transform outputs without performing the expensive computation, preserving the same graph, IDs, outputs, source maps, diagnostics, and metadata as far as the plugin contract permits.

Treat replay as a counterfactual lower bound for the unaffected build rather than as a performance variant. Quantify any graph-discovery or scheduling change it introduces before using it in the Amdahl gate.

### Formal statistics and host control

Use fresh processes for the primary production-build comparison. Tuning and worker-count screening may use fewer runs, but formal confirmation uses complete rotated blocks containing ordinary, the best eligible plugin-owned variant, and the best eligible Rolldown-owned variant. Run at least five complete blocks, retain every sample, report absolute median wall time and paired speedups with bootstrap confidence intervals, and compare Rolldown-owned directly with plugin-owned as well as with ordinary.

After five blocks, stop early only when every required 95% paired ordinary-to-variant interval lies wholly above or wholly below the 2x target and, when both worker forms are eligible, the direct Rolldown-owned-to-plugin-owned interval excludes parity. Otherwise continue the same predeclared blocks to a maximum of ten. At ten blocks, an ordinary-to-variant interval that still crosses 2x is an inconclusive wall-target result, and a direct interval that still crosses parity leaves Rolldown's incremental wall-time value inconclusive; neither is decided from the median alone. Evaluate resource, fairness, lifecycle, and semantic differences separately. Do not discard an inconvenient block; annotate environmental interference and repeat the complete predeclared block only when the recorded host policy was violated.

A short smoke run may verify correctness but cannot support the target wall-time conclusion. Second-hardware replication, a Node.js version matrix, and cross-platform claims remain later work.

## Correctness requirements

- Exact chunks, assets, exports, imports, code, and source maps match the ordinary reference at the strongest practical level.
- Plugin order, per-module transform order, first-result behavior, and source-map chaining remain ordinary-equivalent.
- Warnings, errors, locations, frames, stacks, plugin names, hook names, and module IDs remain attributable.
- Establish whether the ordinary workload itself has stable diagnostic order. Require exact order when it is stable; otherwise preserve the same diagnostic set and per-module/plugin order under a documented deterministic normalization rather than accepting timing-dependent loss or duplication.
- Worker count, placement, scheduling order, cache warmth, and repeated runs do not change output or diagnostics.
- State created by one hook and consumed by another has one explicit owner and survives routing correctly.
- Shared and exclusive groups initialize, fail, cancel, close, and release resources deterministically.

## Adaptation cost and claim levels

Classify every result by the adaptation it required:

1. Whole-plugin execution retains the existing plugin object and supported behavior with only parallel placement metadata.
2. An upstream-maintainable worker entry or coordinator/kernel split preserves the production plugin behavior while making state ownership and worker inputs explicit.
3. A benchmark-only fork duplicates substantial plugin internals, removes production features, changes configuration, or bypasses plugin-context behavior.

Record changed lines, additional worker entry points, configuration restrictions, disabled capabilities, duplicated upstream logic, dual ordinary/parallel paths, and expected upgrade maintenance. Level 3 can establish a technical upper bound but cannot support a general product-value claim. Do not promote a speedup from one adaptation level to another.

## Success and completion criteria

When at least one candidate passes admission, the goal completes with a positive, bounded negative, or formal inconclusive conclusion, but it is not complete until all of the following exist:

- A pinned representative ordinary build lasting 15–30 minutes with roughly 5,000 distinct project module IDs verified at the expensive JavaScript transform boundary and a measured critical-path bound.
- A repeated ordinary versus parallel comparison using the same JavaScript behavior, with absolute evidence for or against 30→15 or 15→7–8 minutes.
- Ordinary, one-worker, plugin-managed worker-pool, Rolldown-managed shared-group, and explicit exclusive-group results under one documented global CPU and memory budget, or a precise semantic reason one model cannot run the same behavior.
- Evidence for all seven sustained-operation questions: throughput, CPU allocation, ready work and load balance, memory/JIT/cache/GC pressure, several plugins in one worker, cache determinism, and worker/task failure semantics, plus the clean-build lifecycle and plugin-context boundary. Multi-plugin evidence comes from the primary workload when it contains a real chain, otherwise from the separate real companion case and is not part of the primary 2x claim. That case compares two plugin-owned pools with one Rolldown-managed shared group under the same total budget; if no qualifying companion exists, it records an inconclusive multi-plugin axis with the failed selection evidence.
- Exact output, source-map, diagnostic, ordering, state, and shutdown checks.
- A classified resource result and an explicit account of plugin adaptation and continuing maintenance cost.
- Raw data, environment, source revisions, reproduction commands, negative results, and an updated investment verdict.

When no candidate passes admission, completion instead requires the predeclared candidate-search manifest, the screening record for every selected candidate up to the limit of three, pinned evidence for each candidate's failed admission rule with later unneeded rules marked `not evaluated`, and an explicit inconclusive-corpus verdict. It does not require implementation or a fabricated parallel matrix.

## Non-goals

- Rewriting the target transform in Rust or substituting another native implementation as proof of JavaScript worker value.
- Manufacturing a win with artificial delay, duplicated trivial files, an externalized main graph, swallowed diagnostics, or changed plugin behavior.
- Manufacturing the target duration by artificially throttling CPU, constraining memory, or selecting a nonrepresentative machine allocation.
- Treating 5,000 discovered files, repeated invocations of fewer modules, filter misses, or cache bypasses as 5,000 distinct modules executing the expensive transform.
- Optimizing only worker startup and presenting subsecond savings as evidence for a 15–30 minute target.
- Claiming arbitrary existing plugin objects are automatically safe in several workers.
- Treating a plugin-managed worker-pool result as proof of Rolldown-managed coordination value, or omitting that alternative when the same JavaScript kernel can run in it.
- Running Vite, watch, rebuild, development-server, or HMR workloads unless Yunfei explicitly expands the next goal.
- Starting new production-scale `resolveId` or `load` performance studies. Transform-time calls to `this.resolve` or `this.load` remain in scope only as coordinator-boundary, reentrancy, overhead, and correctness requirements for the admitted transform.
- Dynamic migration of a live plugin instance, public placement syntax, automatic crash retry, a purity-declaration API, and cross-process global worker management.
- Requiring second-hardware replication, a Node.js version matrix, or cross-platform generalization in this iteration.
- Using public CI timing or a CI-only plugin profile as a substitute for local benchmark data. CI-specific runs may expose semantic behavior, but their timing remains outside the local comparison.
