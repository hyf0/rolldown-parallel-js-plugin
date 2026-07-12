# Scale-Crossover Protocol Amendment 7: Correlated Initialization Attribution

Status: frozen on 2026-07-13 before any formal Vue or MDX attribution child or generic initialization timing child executes. This amendment supersedes only the attribution-runtime pins and initialization-attribution contract in Amendments 1 and 5. It does not change the lifecycle-fixed wall/correctness runtime, corpus, scale grid, worker or Rust-thread grid, host gate, performance or resource threshold, statistical rule, semantic gate, or local-only scope.

## Attribution runtime

The attribution-only runtime is Rolldown commit `41833e1294e5f80efdf90067fe3766b31b58435d`, release binding SHA-256 `2db2fd322eb0e0e57f5ff0a618e52ddac7acf64754cfcd90aa36345917cea711`, package-distribution SHA-256 `7931dffb49a5e7e0fb7470a7850242d8f50726ced7f4e56792f68012405083c6` over 17,211,634 bytes, and package entry SHA-256 `bbd277a14b695f2ec081a5b25781514b31727069ea1a2dba2f38924bee1fe993`. The lifecycle-fixed wall and correctness baseline remains `b144106882fe244b19b738fc0acf3ffa07c7c9f3` / `7b8863bb28aefd2e2eb7409f8be6dae57a252fe4a2688383007be7ea2f847bf7` / `1efffd0b63483e77cd2854fe716941000ae9548768691d7b5a64dceb011f3c45`. No metrics-on or metrics-off run from `41833e1` may substitute for that baseline.

Relative to the prior `8e35a2249b60b65120a44d1d896eeeed19dc703b` attribution artifact, the metrics-off main initializer functions and the plain static worker entry retain their existing behavior. Metrics mode uses a separate launcher and correlated records. This amendment therefore changes attribution observability, not the unchanged-runtime wall curve. Every elapsed field remains instrumented attribution and sets `timingEligible:false` and `conclusionEligible:false`.

## Correlated initialization contract

One positive `metricsId` must correlate JavaScript `createBundlerOptions`, native plugin materialization, parallel-pool initialization and termination, every worker launcher, every worker bootstrap, plugin factory, bindingification, registration, plugin count, and plugin index. Ordinary attribution emits one JavaScript option record and one native registration record with no worker lifecycle. Worker attribution additionally emits exactly one initialization/termination pair and one launcher/bootstrap chain for every requested worker. Missing, duplicated, mismatched, reordered, or out-of-bound records reject the run.

The common stage model separates metrics-runtime setup, input and output plugin normalization, output-options hooks, pool initialization, plugin-context construction, JavaScript bindingification, native registry transfer and `WorkerManager` construction, worker launcher import, runtime/native-binding import, implementation and transitive import, plugin factory/configuration/lifecycle, worker-local bindingification and registration, first ready worker, all ready workers, first-N cold transforms, steady-service windows, and termination. Nested stages are not added as independent critical-path wall time.

Process CPU windows use exact cumulative endpoints. `Worker.cpuUsage()` reads have asynchronous earliest/latest bounds and remain diagnostic; they are never subtracted from another interval to claim a Rust/native residual. Main and worker heap, event-loop utilization, and garbage collection retain their isolate scope. `process.memoryUsage().rss`, lifecycle RSS, sampled RSS, retained RSS, and `/usr/bin/time -l` peak RSS always describe the whole child process and are never assigned to one plugin, worker, isolate, factory, or cache.

The direct binding-module record corrects an earlier hypothesis without timing evidence. `#[napi_derive::module_init]` expands through a dynamic-library constructor, and the controlled processes emit one process-level record rather than one record per Node worker environment. Immediate started-thread counters are bounded scheduling snapshots; they do not establish final retained-thread ownership. Worker import, factory, heap, and RSS costs must be attributed through the explicit stages above.

## Generic initialization controls

The generic initialization matrix freezes ten balanced rotated blocks for one, two, four, and eight workers across five controls: bare worker creation, retained parent binding with empty workers, worker-local binding import, retained parent Rolldown package with empty workers, and worker-local complete package import. Formal mode uses the same restarted quiet-host gate as scale timing, disables the perturbing operating-system thread sampler, and reports within-block binding/package contrasts plus the package-layer difference-in-differences. Its raw, summary, and compact pointer must be committed and rederived before entering the verdict.

The generic controls do not measure a real plugin factory, first-N transforms, or plugin lifecycle. Vue and MDX attribution supply those stages. A cold-to-steady service difference is not labelled JIT proof because source costs differ; it is reported as an observed ordinal/service profile unless a separate same-input experiment isolates JIT.

## Admission and enablement

The controlled Vue and MDX attribution matrices use this exact runtime. The MDX full-corpus correctness artifact is `ec3281ff4c21ccb45f507a36fb8811f3d3cb195bba4de43378708f15c6b699b0`, the semantic sentinel is `048db637a863b9d980620ab15c89fe1ff1e6bade2df0bfa703b3304730da1e43`, and `scale-correctness-gate.json` is passed. The full 9,157-source ordinary/worker-four/worker-eight attribution matrix is therefore enabled. Its runner still refuses active CI, revalidates the correctness oracle, and applies every frozen pre-child and post-child host gate; enabling the matrix cannot bypass host admission.

The current host remains ineligible, so this amendment authorizes no timing result by itself. A later change to the attribution runtime, stage schema, resource ownership, cold/steady window, matrix scale or variants, or enablement gate requires another versioned amendment before affected execution.
