# Scale-Crossover Protocol Amendment 1: Runnable Baseline and Runtime Profiles

Status: frozen on 2026-07-12 before any new scale timing. This amendment changes only the runtime artifact admission and automatic-policy interpretation in the [frozen execution protocol](./scale-crossover-frozen-protocol.md). Corpora, scale points, host gates, pool grids, statistics, resource thresholds, semantics, and the prohibition on CI timing remain unchanged.

## Trigger: the historical artifact is not a self-sustaining baseline

A fresh adversarial reproduction removed every external timer from a direct ParallelPlugin build. Historical research artifact `0aa600b5721b852cdc4095c7122a929a8cb4a798`, binding SHA-256 `deec0b2cb7a12e507ff223e12535c3280ab5fe8371f2fcc92f9db206163f1c5d`, and distribution SHA-256 `e30311e764bae7fba9afe27665db741d556a7c3728eb67cfbe7ce0fed3135ebc` then exited with Node code 13 while the top-level build await was unsettled. The parent creates each Worker and immediately calls `unref()`. The pending N-API build promise does not keep the Node event loop alive. A ref'ed external timer makes the same build succeed; short timers that expire before transforms finish reproduce code 13.

This means prior successful harnesses can accidentally use event-loop-delay sampling, polling, or another timer as worker ownership. Their transform and output observations remain historical evidence, but success does not prove the runtime lifecycle. The historical artifact is no longer eligible for new formal wall timing, lifecycle claims, or worker-policy selection.

## Lifecycle-corrected wall baseline

The new wall baseline starts at `0aa600b5721b852cdc4095c7122a929a8cb4a798` and removes only the two parent-side `worker.unref()` calls in `initializeWorker` and `initializeWorkerWithMetrics`. Workers remain ref'ed until the existing explicit `stopWorkers()` termination. It changes no plugin kernel, worker count, permit scheduling, Rust pool, transform routing, or result handling.

The lifecycle-corrected branch is commit `b144106882fe244b19b738fc0acf3ffa07c7c9f3`, with release binding SHA-256 `7b8863bb28aefd2e2eb7409f8be6dae57a252fe4a2688383007be7ea2f847bf7` and distribution SHA-256 `1efffd0b63483e77cd2854fe716941000ae9548768691d7b5a64dceb011f3c45` over 17,095,091 bytes. A no-external-timer controlled smoke passed ordinary, worker-one, and worker-four in both metrics-on and metrics-off lanes with one normalized output hash across all six runs; metrics-off emitted no research lifecycle data. Every scale wall, correctness, allocation, and CPU-rate matrix requires this exact triple. The old `0aa600b` triple remains labelled `historical-0aa-artifact` only.

Removing the accidental dependency on an unrelated timer is a lifecycle prerequisite, not an initialization or service optimization. It nevertheless changes process liveness, so the artifact is versioned and all new wall data begins from it. No old timing is promoted into the amended baseline.

## Separate attribution artifact

Extended Rust transform events, main/worker CPU and heap snapshots, garbage-collection observation, binding-module initialization counters, and detailed initialization boundaries use research commit `8e35a2249b60b65120a44d1d896eeeed19dc703b`, release binding SHA-256 `6b7dfa175754ac57650768a68d7a567c5c0635a1bb47d47c5287914594c9795e`, and distribution SHA-256 `68f57be9a8883a4ca6f28b57a9bac6e16907d8c1d079686ab9921b407b132735` over 17,140,783 bytes. These pins are distinct from the lifecycle-corrected wall baseline. Instrumented elapsed time is never wall-performance evidence, even when the metrics flag is disabled.

The binding counter produced an early negative initialization result before formal timing. Actual worker-one and worker-four direct builds each emitted one process-level module-initialization record: the retained Tokio runtime started 18 worker threads and stopped none. `napi-derive` 3.5.9 expands `#[napi_derive::module_init]` through `napi::ctor::declarative::ctor!`, so this is a dynamic-library constructor, not a callback repeated for every Node worker environment. The earlier hypothesis that every worker constructed and discarded another Tokio runtime is refuted. Worker startup attribution must instead examine Worker/V8 environment creation, JavaScript module loading, plugin factory/configuration, bindingification, JIT, garbage collection, and retained state.

Each matrix declares one of three profiles and rejects all others:

- `historical-0aa-artifact`: replay or historical correctness only; no new performance or lifecycle claim.
- `lifecycle-corrected-baseline`: all uninstrumented scale, allocation, quota, and repeated wall evidence.
- `instrumented-attribution`: attribution only, with JavaScript and Rust instrumentation explicitly enabled and detailed-output buffers bounded by the runner.

JavaScript-only exact-source and semantic admission may execute against the lifecycle-corrected baseline. A matrix that requires extended Rust fields must use the attribution artifact. No metrics-off attribution binary may substitute for the wall baseline.

## Automatic policy conclusion that can be tested on the unchanged scheduler

The lifecycle-corrected baseline still fixes worker capacity before ready-queue history exists and has no ordinary fallback, resizing, or parking. Therefore this iteration evaluates two distinct questions:

1. Fixed automatic defaults are tested directly against the complete ordinary and worker-one-through-eight matrix. The hardware-only candidate is the existing `min(availableParallelism, 8)`, which selects eight on the local 12-CPU host. The conservative fixed candidate selects four. Either candidate fails if it violates the frozen five-percent oracle-regret, ten-percent CPU/RSS, or small-case regression gates on any held-out workload family or validated CPU-rate setting.
2. Queue persistence, arrival history, cold-window service, and completed transforms per second are evaluated as signals for a future progressive policy. Because the current runtime cannot act on those signals without paying the fixed pool cost and cannot return safely to ordinary execution, an offline trace fit is feasibility evidence only. It cannot pass the shippable automatic-selector gate in this iteration.

If neither fixed candidate passes every gate, the durable conclusion is ordinary by default plus an explicit fixed-count override and a separate worker-one isolation option. A progressive selector requires a later coordinator/kernel state contract and a new runtime experiment; this iteration must not infer it from an oracle-selected trace.

## Execution consequence

No new performance timing starts until both final runtime profiles are materialized, committed, pushed, and referenced by exact hashes in every Vue and MDX matrix. Correctness and harness admission may continue, but any successful run on the historical artifact records the possible timer-ownership confound. The restarted quiet-host requirement remains mandatory after the profiles are ready.
