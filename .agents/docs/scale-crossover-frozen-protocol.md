# Frozen Scale-Crossover Execution Protocol

Status: frozen before new benchmark timing or implementation changes on 2026-07-12. This protocol implements the planning rules in [scale crossover, worker selection, and initialization](./scale-crossover-worker-policy.md). [Amendment 1](./scale-crossover-protocol-amendment-1.md) supersedes the historical runtime artifact as a formal baseline after a no-timer worker-lifecycle failure; all other pins remain unchanged. A later change to a corpus, selection order, scale, acceptance threshold, host gate, runtime pin, or semantic gate requires a versioned amendment before affected timing is run. Correctness admission may reject a candidate, but it may not silently relax a gate or substitute a more favorable corpus.

## Scope and lifecycle

All evidence is local, direct Rolldown, Node.js 24.18.0, production mode, and fresh-process clean-build evidence. Vite runtime, CI timing, watch, rebuild, development servers, HMR, and cross-build worker reuse remain excluded. An active CI marker aborts a runner.

Every measured variant uses a fresh Node.js process and, when applicable, fresh worker isolates, plugin factories, and compiler state. A discarded process can warm filesystem and operating-system caches only; it is not a reused-isolate or JIT warmup. Uninstrumented wall confirmation, instrumented attribution, graph correctness, semantic probes, and CPU-rate-control runs remain separate lanes.

The unchanged runtime is Rolldown research commit `0aa600b5721b852cdc4095c7122a929a8cb4a798`, release binding SHA-256 `deec0b2cb7a12e507ff223e12535c3280ab5fe8371f2fcc92f9db206163f1c5d`, and package-dist SHA-256 `e30311e764bae7fba9afe27665db741d556a7c3728eb67cfbe7ce0fed3135ebc`. Baseline children explicitly pin `ROLLDOWN_WORKER_THREADS=18`, `RAYON_NUM_THREADS=12`, and `ROLLDOWN_MAX_BLOCKING_THREADS=4`; ordinary execution leaves `ROLLDOWN_PARALLEL_PLUGIN_WORKERS` unset and worker variants set it to an integer from one through eight. These values preserve the inferred existing defaults on this 12-CPU M3 Pro while making them durable. Tokio, Rayon, blocking, and JavaScript pools are separate configured capacities and must not be added as if every thread were simultaneously CPU-active.

## Host admission

Formal wall timing starts only after a restart and must pass every gate before each measured child:

- AC power, low-power mode off, and no recorded thermal or performance warning.
- Host uptime at matrix start at most 24 hours.
- One-minute load average at most 2.0 and summed pre-child process CPU at most 150%.
- `vm.swapusage` used bytes at most 512 MiB and `memory_pressure -Q` free percentage at least 50%.
- No active CI marker and no unrelated build, test, indexer, or benchmark owned by this study.
- Zero pageout and swapout delta during every measured child.

The runner waits in ten-second intervals for at most five minutes for transient load, CPU, and memory-pressure gates, then aborts rather than recording an ineligible sample. Power, low-power, thermal, uptime, and starting-swap violations abort immediately. A fixed cooldown does not override these gates. The current pre-protocol host has more than 19 GiB of used swap and more than 17 days of uptime, so it is explicitly ineligible for new wall evidence until restarted; correctness admission and harness verification may proceed but cannot be promoted to performance evidence.

## Controlled Vue corpus

The controlled same-kernel curve uses 4,540 content-unique real SFCs from four pinned MIT repositories. It is a prepared wide transform curve, not a representative project graph.

| Source | Commit | License SHA-256 | Eligible SFCs | Bytes |
| --- | --- | --- | ---: | ---: |
| [PrimeVue](https://github.com/primefaces/primevue/tree/d4374cb7c1267f35eba7cee5d0a266f50ca8ec84) | `d4374cb7c1267f35eba7cee5d0a266f50ca8ec84` | `39a2ce8d759cfcb59eccc49b0a417ad5c943f960c1bcdfba4720ca7547029af7` | 2,495 | 8,511,875 |
| [Element Plus](https://github.com/element-plus/element-plus/tree/85bdf740c1d550f3ca44472262e2a314039eab7d) | `85bdf740c1d550f3ca44472262e2a314039eab7d` | `0790118bb4d66681db1d63181f72ef68e632d632f6db0373ef87cf328561af27` | 725 | 1,942,309 |
| [TDesign Vue Next](https://github.com/Tencent/tdesign-vue-next/tree/dd334e2dc06d8ab48d1b6ebc5e9d4f6de67b16a2) | `dd334e2dc06d8ab48d1b6ebc5e9d4f6de67b16a2` | `b3dbcb89dcf4a11abf1b70d043795a3da0c458af16fefd2ff315d9ff5875312f` | 644 | 897,120 |
| [Vuestic UI](https://github.com/epicmaxco/vuestic-ui/tree/c5337ed8e7e24ea294221326fe2ca6af8d3b8e1b) | `c5337ed8e7e24ea294221326fe2ca6af8d3b8e1b` | `c44258bd026d8749142ac1b2cf0309f0b52655b3181c5ee4bfb6bd89103ab370` | 676 | 882,094 |

Eligibility uses `@vue/compiler-sfc` 3.5.39: parse succeeds, there are no style or custom blocks, and no template, script, script-setup, style, or custom block uses `src`. Exact duplicate contents are removed by source SHA-256, retaining the first UTF-8-sorted `repo/path`. The aggregate contains 4,540 distinct contents and 12,233,398 bytes: 1,796 script-setup, 2,049 ordinary-script, and 695 template-only SFCs. Its canonical aggregate SHA-256 is `4217a281a7b3f890d1a04e4849db02bcea43bf1d12f5eaf057e954bb04618edb`, computed over UTF-8-sorted `sourceKey + NUL + byteLength + NUL + contentSha256 + LF` records.

Nested order sorts by `SHA-256(aggregateSha256 + NUL + sourceKey)` with UTF-8 source key as tie-breaker. The frozen scale and selection hashes are:

| Scale | Selection SHA-256 |
| ---: | --- |
| 32 | `b2b820258de2d0909fa064de092754b6dbbcfdcafeafc8ac397b245a310f1eb5` |
| 128 | `326415bfe99fcd42e77d690b1262460f7f0c8049d84083de87f6e40fbcaa0e27` |
| 256 | `473bf5ce16454684a16717ae4a86a0d06ecb14b1ace9f69f7b0d2fc2b091fcfd` |
| 512 | `f90846b7797a992172f829d724c2d1a55a476f7a52d886ae95d7aef7d8af7507` |
| 1,024 | `4b4eef2247906c4af1f53f931c32f85d003a53cdacc59b3f36ee177b2d2a3f7c` |
| 2,048 | `73d71b4399a2f196eb310951bc5aa9336c57516c84c8bff401b3e3811c98c569` |
| 4,096 | `b5498c964fd1f04715742cd34f2bf53c38a1e3d86dae82977144412a982bca15` |
| 4,540 | `c052e929e5a8a155dcec0474e070d75a9512377a80a3aeeea1346ecc008e8206` |

Preparation and an untimed full-corpus ordinary/worker smoke must prove every selected source compiles, executes exactly once, and produces deterministic code and maps before timing. A compile failure is retained as an admission result; changing eligibility requires a protocol amendment and regenerated hashes. The generated entry exports each selected absolute SFC, `treeshake` is false, and imports emitted after each SFC transform are externalized so unrelated project graphs cannot change this controlled curve.

## Independent Vue projects

Independent-project evidence uses real entry roots and retains reached repository-local dependencies. Synthetic all-roots input never substitutes for this layer. The frozen admission order is:

1. Small: [Floating Vue](https://github.com/Akryum/floating-vue/tree/19857764c4f73dea7ed44a7d970adb968ee7ad90) at `19857764c4f73dea7ed44a7d970adb968ee7ad90`, entry `packages/floating-vue/src/index.ts`, four known package SFCs, MIT license SHA-256 `46e97d800fbd1540b43fed3720d378fa94a83226555438383a0fd26671470bf0`.
2. Medium: [cabinet-fe/icon](https://github.com/cabinet-fe/icon/tree/9cadad32c72d79424c75e3b6e56798f216bb0b06) at `9cadad32c72d79424c75e3b6e56798f216bb0b06`, its four existing real entries, 166 reached SFCs, 109,122 bytes, and manifest SHA-256 `9ae54c3311168ccd093c9da5a1e977c81654590ce040a5de63c2702ff0f3fedd`.
3. Harness bridge only: [PrimeVue](https://github.com/primefaces/primevue/tree/d4374cb7c1267f35eba7cee5d0a266f50ca8ec84) source entry `packages/primevue/src/index.js`, with 279 statically eligible package SFCs. This validates workspace resolution but is not the required large project.
4. First large admission: [GitLab frontend](https://github.com/gitlabhq/gitlabhq/tree/0ff224ddae1a652fffcee2f66ce3efc5fc816c03) at `0ff224ddae1a652fffcee2f66ce3efc5fc816c03`, license SHA-256 `62dfe4bdd76e08992c09cf335b2374b3e6acd4f2b959b4971760727d9b785ab4`, with 2,620 physical SFCs under `app/assets/javascripts`. Entry roots come from the pinned production `generateEntries` path in `config/webpack.config.js`, `config/webpack.helpers.js`, and `config/helpers/entry_points`; actual reached transforms, not physical files, define its scale.
5. Large fallback if and only if GitLab fails admission: [Vue Vben Admin](https://github.com/vbenjs/vue-vben-admin/tree/8b7c245bc7a2346764d98d26003a2faf67a98182) at `8b7c245bc7a2346764d98d26003a2faf67a98182`, MIT license SHA-256 `26bd1c47f2d85139581c82c7b0197785322a11217c762d65f10c04f1567450ee`, first using `apps/web-antd/src/main.ts`; the pin has 680 physical SFCs. Admission retains its reached workspace and application graph and must observe at least 512 matching SFC transforms to satisfy the large band.

GitLab admission must preserve compiler selection for its Vue 2.7.16 and Vue 3 compat/compiler 3.5.34 paths, aliases, custom-element settings, generated entries, GraphQL/assets, and every project-local loader replacement required by the selected graph. If ordinary direct Rolldown cannot preserve the graph, retain the exact failure and proceed to the frozen Vben fallback. If Vben also fails or reaches fewer than 512 matching SFCs, the independent large-project requirement remains incomplete and the search must continue under a protocol amendment; PrimeVue must not be relabelled as the large result. Admission failure does not erase the separate controlled 4,540-SFC curve.

## MDX corpus

The MDX curve pins Cloudflare Docs at `2b08a67a41da1a521aecbcf465893abae1e9a6df`, full source manifest SHA-256 `84077a08f660782274d5502be25f0ec9297cec9c52508e2c5e9e2a3e8bedc12b`, fixed date `2026-07-12T00:00:00.000Z`, default profile, and `RUN_LINK_CHECK=false`. The 9,157 production sources are 6,719 docs, 1,449 partials, 988 changelog entries, and one compatibility entry.

The old lexicographic `limit` is forbidden for scale evidence because its 32 through 512 prefixes contain only changelog entries. A committed ordered manifest uses `cloudflare-mdx-scale-v1`: the compatibility file is the first coverage anchor; remaining entries are split by collection, mutually exclusive feature class (`playground`, `mermaid`, `fence-5+`, `fence-2-4`, `fence-1`, `fence-0`), and four equal-count byte bands; paths inside a stratum sort by `SHA-256("cloudflare-mdx-scale-v1" + NUL + relativePath)`; deficit round-robin selection keeps collection and stratum proportions nested. Fences are parsed, not estimated from marker count. The manifest records the complete ordered path list, source hash, algorithm version, prefix hashes, and per-prefix collection, byte, line, fence, feature, and language summaries.

The frozen base scales and collection counts are:

| Scale | Docs | Partials | Changelog | Compatibility |
| ---: | ---: | ---: | ---: | ---: |
| 32 | 23 | 5 | 3 | 1 |
| 128 | 93 | 20 | 14 | 1 |
| 256 | 187 | 40 | 28 | 1 |
| 512 | 375 | 81 | 55 | 1 |
| 1,024 | 751 | 162 | 110 | 1 |
| 2,048 | 1,502 | 324 | 221 | 1 |
| 4,096 | 3,005 | 648 | 442 | 1 |
| 9,157 | 6,719 | 1,449 | 988 | 1 |

Allowed refinement points are `64, 96, 160, 192, 224, 320, 384, 448, 640, 768, 896, 1280, 1536, 1792, 2560, 3072, 3584, 5120, 6144, 7168, 8192`. Only points in the first direction-changing base interval may run, and they use the same frozen order. Rare syntax has a separate semantic sentinel containing the existing graph smoke, all six playground sources, fixed docs and partials mermaid sources, and an invalid-MDX diagnostic fixture; rare features are not forced into the 32-source performance prefix.

## Worker and allocation matrices

Every base scale first receives one uninstrumented rotated screen of ordinary and worker counts one through eight, with no discarded process. A screen selects work; it never establishes crossover or an optimum.

Repeated uninstrumented confirmation covers the lower endpoint before the first direction change, the candidate crossover, the next larger nested point, and the full corpus. At each point it includes ordinary, the best screened worker count, and its lower and higher eligible adjacent counts; a boundary count uses the one neighbor that exists. MDX uses ten rotated paired blocks. Vue uses fifteen blocks for runs below two seconds and ten blocks otherwise. The fixed-count optimum is the fastest repeated resource-eligible result, choosing the smaller count when bootstrap intervals overlap and the median wall difference is below two percent.

At confirmed crossover and full scale, compare the same selected count through ordinary, plugin-managed, and Rolldown-managed placement. Plugin-managed placement does not enter the complete one-through-eight screen.

Baseline allocation pins Tokio 18, Rayon 12, and blocking 4. At confirmed crossover neighbors and full MDX, screen Tokio counts `4, 8, 12, 18` against ordinary and JS counts one through eight while holding Rayon 12 and blocking 4. Repeat the best Tokio/JS pair and adjacent eligible JS counts; then screen Rayon `4, 8, 12` only for the repeated finalists. Ordinary runs at every Rust-pool setting. Configured pool sizes are allocation variables, not an OS quota or observed active CPU count.

## Aggregate CPU-rate control

The explicit macOS CPU-rate axis uses a locally built, pinned derivative of [opsengine/cpulimit](https://github.com/opsengine/cpulimit/tree/f4d2682804931e7aea02a869137344bb5452a3cd) at `f4d2682804931e7aea02a869137344bb5452a3cd`, only after its Apple build and iterator defects are fixed by a committed minimal patch and its source, compiler command, tests, patch hash, and binary SHA-256 are retained. It duty-cycles the whole Node process with `SIGSTOP` and `SIGCONT`; 400%, 800%, and 1,200% mean average aggregate CPU-rate ceilings, not four/eight/twelve-core affinity and not Performance/Efficiency placement.

Before project use, controlled multi-thread loads at 200%, 400%, 600%, and 800% must achieve target CPU-seconds per wall-second within five percent after controller startup. A rotated direct-versus-1,200% validation must keep target-process CPU and paired median wall within two percent, emit no stops after sampling stabilizes, and preserve output. The controller records stop count and stopped duration. Failure makes the explicit quota axis unavailable; configured thread pools must not be relabelled as quotas. Quota runs apply only to long MDX crossover/full wall-policy validation, never unthrottled service-latency or initialization attribution.

## Attribution and initialization

Instrumented traces retain, for every transform, stable ID and ordinal, wrapper arrival, permit acquisition, worker index, JavaScript kernel start/end, wrapper completion, result kind, and cancellation. Derived output includes time-weighted ready and in-flight width, per-worker kernel and permit-held p50/p95/max, fixed-window completion rate after a frozen cold window, busy intervals and idle gaps, worker counts and busy time, final completion per worker, and the last-arrival-to-last-completion tail.

Node 24.18 measurements use main `process.threadCpuUsage()` and worker `Worker.cpuUsage()`, `Worker.getHeapStatistics()`, and worker event-loop utilization at aligned ready and pre-termination snapshots. Process CPU minus measured main and worker thread CPU is labelled residual native/runtime CPU, not Rolldown-only CPU. Worker isolate heap is reported separately from shared process RSS. Each isolate observes garbage-collection count and duration; the parent samples process RSS over time; `/usr/bin/time -l`, `vm_stat`, `vm.swapusage`, and `memory_pressure -Q` supply process and host evidence. Profiles, `vmmap`, `footprint`, or `sample` are attribution-only.

Initialization uses matching ordinary and worker boundaries: process measurement start, adapter import, pool request, Worker constructor, Worker online, worker entry first statement, static bootstrap and binding imports, implementation/transitive import, plugin factory/configuration/lifecycle, bindingification, native registration, first ready, all ready, transforms 1/2/4/8/16/32 per worker, steady service, build end, termination, and post-GC retained state. Critical wall uses overlapping maxima; aggregate CPU is reported separately.

The existing worker timer starts after static binding imports. The current 1.997-second Cloudflare all-ready value, 1.842-second ordinary factory value, and approximately 155-millisecond single-pair difference remain prior observations rather than a stable startup estimate. A concrete baseline hypothesis is that each worker's static N-API binding import may construct and discard an unretained Tokio runtime before the current timer; this must be measured before any fix is claimed.

## Statistical and resource gates

Paired statistics use rotated blocks and 100,000 deterministic bootstrap resamples with seed `0x20260712`. Mechanical crossover is the smallest nested scale whose paired median speedup bootstrap 95% lower bound exceeds 1.0 and whose next larger nested point confirms the direction.

Resource-acceptable performance crossover additionally requires all of the following, frozen before timing:

- Paired median wall speedup at least 1.10 and bootstrap 95% lower bound at least 1.05.
- Median total-process CPU ratio at most 2.00.
- Median peak-RSS ratio at most 2.00 and absolute peak RSS below 27 GiB, 75% of host memory.
- No host-policy violation, output mismatch outside a pre-recorded normalized nondeterminism, incomplete lifecycle, error, or cancellation.

An automatic selector succeeds only if, on held-out workload families and CPU-rate settings, its wall is no more than five percent slower than the repeated resource-eligible fixed-count oracle, CPU and RSS are each no more than ten percent above that oracle, and an ordinary-best small case regresses by no more than three percent median with the paired regression bootstrap upper bound no greater than five percent. Any violation falsifies the selector even if its average improves. Worker-one isolation remains a separate explicit policy.

The unchanged runtime fixes pool size before ready-queue history exists and has no ordinary fallback, resizing, or parking. It can falsify hardware-only rules and evaluate an offline predictor without oracle leakage, but it cannot validate a real adaptive build-local policy. A complete negative result is permitted: keep ordinary as the default and an explicit fixed-count override if no selector meets every gate. Progressive calibration becomes a runtime claim only under an explicit coordinator/kernel state contract.

## Correctness and product boundary

Every controlled point verifies the selected manifest and prefix hash, exact distinct IDs, one handler hit per selected source, source/result bytes, graph or generated-entry module count, output chunks/assets/exports, code and normalized code hashes, maps where enabled, clean queue/in-flight state, no error/cancel, clean termination, and repeat determinism.

Representative Vue and MDX graph lanes retain every required project-local dependency and reject unresolved local edges. They record warnings and structured errors, metadata, state, hook order, lifecycle, failure cleanup, virtual modules, styles, custom/external blocks, and capability omissions. Cloudflare graph correctness runs at 32, 512, 2,048, confirmed crossover neighbors, and 9,157 with ordinary and selected worker/plugin-managed counts. Multipart-boundary normalization is the only pre-recorded raw-output exception; `meta.astro` loss and worker-local link-validation state remain product failures.

Mechanical and resource-acceptable curves may proceed after their stated correctness gates. Product crossover additionally requires code, source maps, metadata, diagnostics, state, hook order, lifecycle, virtual-module behavior, failure semantics, and shutdown parity. The current Vue transform-only and Cloudflare adapters are expected to remain non-product evidence unless those failures are actually repaired and reverified.

## Ordered execution and allowed changes

1. Commit this frozen protocol.
2. Add corpus preparation, immutable manifests, host enforcement, environment provenance, and untimed correctness admission only.
3. Add attribution instrumentation and verify that instrumentation is disabled for wall runs.
4. After a qualifying restart, run unchanged-runtime screens, refinement, and repeated confirmation.
5. Run allocation and validated CPU-rate matrices, then evaluate fixed and offline automatic policies against held-out cases.
6. Only after baseline attribution identifies a dominant component may one minimal research-only optimization be implemented. Any initialization or service change invalidates and repeats affected matrices.
7. Record raw data, negative results, remaining ambiguity, verdict, repository state, and completion audit before declaring this iteration complete.
