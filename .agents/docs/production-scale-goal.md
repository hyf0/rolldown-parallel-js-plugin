# Production-Scale Parallel JavaScript Transform Goal

Status: draft for the next `/goal`; not started. Yunfei set this direction on 2026-07-12. The completed mechanism-scale research remains evidence, but it does not satisfy this goal.

## Outcome

Determine whether Rolldown can preserve a required JavaScript plugin or JavaScript transform chain and use worker threads to reduce a representative direct-Rolldown production build from roughly 30 minutes to 15 minutes, or from 15 minutes to 7–8 minutes, without replacing the measured JavaScript work with Rust or another native implementation.

The target workload has roughly 5,000 modules that actually execute the expensive transform. Physical module count, filter misses, cache hits that avoid the expensive path, synthetic delay, and an externalized main graph do not count toward that target.

The product question is broader than Vue or Svelte. Projects cannot reasonably rewrite every user- or ecosystem-owned JavaScript plugin in Rust. This iteration asks whether a bounded JavaScript worker contract can retain that extension surface while turning sustained, module-local JavaScript transform work into multi-core throughput.

## Why another iteration is required

The completed cases establish execution mechanics, fixed cost, crossover, main-thread isolation, state risks, and opposite real-compiler outcomes. They are too short to answer the intended production-scale question: the 166-SFC Vue build is about 316 ms, the graph-preserving Svelte build about 596 ms, and the isolated 1,340-SFC Svelte fixture about 2.1 seconds ordinary.

Measured fresh pool and plugin initialization is roughly 100–400 ms for the real compiler cases. Removing all 400 ms would save less than 0.05% of a 15-minute build and less than 0.03% of a 30-minute build. The next iteration therefore prioritizes sustained transform throughput, CPU allocation, ready work over time, memory pressure, cache semantics, multi-plugin execution, and failure behavior. Startup remains measured but cannot by itself satisfy the goal.

## Workload admission gate

A candidate enters adaptation only when the unmodified ordinary build proves all of the following:

- It uses Rolldown directly on the latest Node.js LTS available when the next `/goal` starts, pins the exact patch, and has a stable 15–30 minute production-build baseline under a pinned environment. This iteration does not run a Node.js version matrix.
- A required JavaScript plugin or transform chain owns the expensive path. The plugin is retained because its JavaScript behavior, configuration, callbacks, ecosystem extensions, or maintenance model makes a wholesale Rust rewrite an unrealistic product answer.
- Roughly 5,000 modules execute the target expensive transform. Each hit is counted at the actual handler boundary, and misses or bypassed cache paths are reported separately.
- The target transform occupies enough of the build time that a 2x complete-build result is mathematically possible.
- Multiple target transforms are ready for meaningful portions of the build, not only at one instantaneous peak.
- The ordinary build is not already spending the relevant time in asynchronous I/O or a native thread pool that workers would merely wrap.
- Source, lockfile, plugin versions, inputs, outputs, warnings, errors, source maps, and environment can be pinned and redistributed or otherwise reviewed by maintainers.

The primary 2x candidate may contain one required JavaScript plugin or a real transform chain. If it contains only one, the same pinned real graph must also provide a separate multi-plugin case using at least one additional real JavaScript transform with no artificial delay. That companion case supplies shared-placement fairness, colocated failure, and optional ordered-pipeline evidence; it cannot be counted toward the primary 2x claim or used to inflate the primary baseline.

The time-share gate uses `overall speedup = 1 / ((1 - p) + p / s)`, where `p` is the fraction of ordinary build time that determines completion and is spent in the target transform, and `s` is the measured transform-stage speedup. A 2x complete-build target requires at least 92% transform share when `s = 2.2`, 75% when `s = 3`, 67% when `s = 4`, and 57% when `s = 8`. Reject the candidate before adaptation when its measured share cannot reach the target.

## Execution models

Every accepted workload compares the same JavaScript behavior under these models:

1. Ordinary main-thread execution is the correctness and wall-time baseline.
2. One worker measures main-thread isolation without claiming transform throughput.
3. A Rolldown-managed shared worker group is the default parallel policy. Several plugins may reside in the same workers under one global CPU and memory budget.
4. An explicitly exclusive worker group gives the target plugin dedicated capacity. Exclusive means that no unrelated plugin resides or runs in that group; the group may contain several workers and remains owned by Rolldown.
5. A coordinator plus worker-side JavaScript kernel may be measured when the unchanged complete-plugin form cannot preserve state or imports too much unrelated code. This remains a JavaScript adaptation, not a Rust rewrite.
6. When the primary workload contains several high-frequency JavaScript transforms, an optional worker-side ordered pipeline may compare running them sequentially for one module inside one worker against returning to Rust after every plugin. If the primary candidate contains one plugin, run this comparison only in the separate real companion case. This is a separate model because it changes transport, scheduling, source-map chaining, and error attribution responsibilities.

No public configuration syntax is decided here. The required semantics are default shared placement, an explicit exclusive-group request, an explicit or automatic worker count constrained by a global Rolldown resource budget, and a deterministic visible outcome when requested placement cannot be honored. Rolldown must never silently place an explicitly exclusive plugin into a shared group.

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

### Several transform plugins in one worker

- Can several high-frequency JavaScript transforms run in ordinary plugin order inside one worker for the same module and reduce repeated Node-API conversion?
- Can the worker preserve each intermediate code value, source-map chain, null result, plugin identity, hook order, warning order, and error attribution?
- Is same-module worker placement sufficient, or does the gain require a worker-side pipeline with one combined request and response?
- Does one long transform prevent unrelated plugins in a shared worker from making progress, and what scheduling or exclusive placement prevents that behavior?

### Worker-local cache semantics

- Which caches are performance-only, and can every hit or miss produce identical output, metadata, diagnostics, and side effects?
- Are output hashes and diagnostics stable across worker counts, randomized task assignment, repeated fresh builds, and different cache-warmth states?
- When a cache affects behavior, can ownership move to the coordinator, Rolldown graph state, deterministic reduction, or explicit module affinity?

### Worker and task failure

- When a worker exits, crashes, rejects a task, or becomes unresponsive, which in-flight and queued transforms fail and how are their plugin name, hook, module ID, message, code, location, frame, and stack reported?
- In a shared group, which colocated plugins are affected by one worker failure, and can Rolldown restore capacity without silently changing plugin state?
- Can a pure task be retried without duplicate side effects, and how does the runtime distinguish it from a stateful task that must fail the build?
- Do cleanup, cancellation, and shutdown leave no pending permits, registered callbacks, workers, or partial coordinator state?

## Measurement requirements

Every performance run records absolute wall time in minutes as well as ratios; target-transform hit, miss, and cache-path counts; per-call and per-worker service distributions; ready-call width over time; queue wait; worker utilization; task assignment; Node-API input and result bytes; source-map bytes; initialization and import; CPU by relevant execution owner where observable; RSS over time; garbage-collection evidence; output and diagnostic hashes; host load; and clean shutdown.

Use fresh processes for the primary production-build comparison. Run enough repeated samples to establish the direction despite the long duration, rotate variant order, retain every raw result, and explain environmental interference. A short smoke run may verify correctness but cannot support the target wall-time conclusion.

## Correctness requirements

- Exact chunks, assets, exports, imports, code, and source maps match the ordinary reference at the strongest practical level.
- Plugin order, per-module transform order, first-result behavior, and source-map chaining remain ordinary-equivalent.
- Warnings, errors, locations, frames, stacks, plugin names, hook names, and module IDs remain attributable.
- Worker count, placement, scheduling order, cache warmth, and repeated runs do not change output or diagnostics.
- State created by one hook and consumed by another has one explicit owner and survives routing correctly.
- Shared and exclusive groups initialize, fail, cancel, close, and release resources deterministically.

## Success criteria

The goal succeeds with either a positive or a bounded negative conclusion, but it is not complete until all of the following exist:

- A pinned representative ordinary build lasting 15–30 minutes with roughly 5,000 verified expensive JavaScript transform hits and a measured time-share bound.
- A repeated ordinary versus parallel comparison using the same JavaScript behavior, with absolute evidence for or against 30→15 or 15→7–8 minutes.
- Shared-group and explicit exclusive-group results under one documented global CPU and memory budget.
- Evidence for all seven sustained-operation questions: throughput, CPU allocation, ready work and load balance, memory/JIT/cache/GC pressure, several plugins in one worker, cache determinism, and worker/task failure semantics. Multi-plugin evidence comes from the primary workload when it contains a real chain, otherwise from the separate real companion case and is not part of the primary 2x claim.
- Exact output, source-map, diagnostic, ordering, state, and shutdown checks.
- Raw data, environment, source revisions, reproduction commands, negative results, and an updated investment verdict.

## Non-goals

- Rewriting the target transform in Rust or substituting another native implementation as proof of JavaScript worker value.
- Manufacturing a win with artificial delay, duplicated trivial files, an externalized main graph, swallowed diagnostics, or changed plugin behavior.
- Treating 5,000 physical modules, filter misses, or cache bypasses as 5,000 expensive transform hits.
- Optimizing only worker startup and presenting subsecond savings as evidence for a 15–30 minute target.
- Claiming arbitrary existing plugin objects are automatically safe in several workers.
- Running Vite, watch, rebuild, development-server, or HMR workloads unless Yunfei explicitly expands the next goal.
- Running any candidate measurement before Yunfei starts the next `/goal`. After it starts, candidate screening and the ordinary long-running trace are allowed because they determine whether the admission gate passes; plugin adaptation, parallel implementation, and the full shared/exclusive matrix wait until that gate passes.
