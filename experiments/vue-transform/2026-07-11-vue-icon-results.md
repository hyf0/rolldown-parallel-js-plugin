# Direct-Rolldown Vue Transform Results

Date: 2026-07-11. Rolldown runtime and fixture: `research/parallel-js-plugin-core-transform` at `eaf4ab45635c9c8b421240f6f98f2b1396247738`; the 30-round confirmation matrix was added at `1c3790b1853250433665ea5b5db800902f151af8`. Node.js is 24.18.0 on an Apple M3 Pro with 12 logical CPUs and 36 GiB of memory. The binding is the same release artifact pinned by the [core environment manifest](../core-transform/data/2026-07-11-release-environment.json); no native runtime source changed between that build and this case.

## Outcome

Parallelizing this real Vue transform does not shorten the fresh direct-Rolldown build. In the 166-SFC confirmation, two, four, and eight workers have paired median speedups of 0.91x, 0.89x, and 0.75x. They beat their paired ordinary sample in only 8, 9, and 3 of 30 rounds. In the 12-SFC negative control, worker-1 is 0.75x and loses all 30 rounds.

The result is not caused by a narrow module graph: instrumentation shows all 166 matching transforms outstanding together and handler activity reaches the configured worker count. The limiting costs are repeated heavy implementation import, compiler resolution in every instance, per-isolate JIT and cache warmup, rapidly increasing CPU contention, and roughly 40–50 MiB of additional compiler-worker RSS after the first instance. The useful per-file compiler work is too small to repay those costs in this project.

One worker still provides main-thread isolation. It has a paired median build speed of 0.83x, but reduces median maximum event-loop delay from 183.1 milliseconds to 4.59 milliseconds while preserving identical output.

## Exact case

- Plugin: `unplugin-vue/rolldown` 7.2.0, source commit [`7815bee8367c19c31df244c7ccb188ceedef3a16`](https://github.com/unplugin/unplugin-vue/tree/7815bee8367c19c31df244c7ccb188ceedef3a16).
- Compiler and Vue: 3.5.39, source commit [`c0606e91798c8dca4f33d101e1dd836d672592c1`](https://github.com/vuejs/core/tree/c0606e91798c8dca4f33d101e1dd836d672592c1).
- Real corpus: [`cabinet-fe/icon`](https://github.com/cabinet-fe/icon/tree/9cadad32c72d79424c75e3b6e56798f216bb0b06/packages/vue) at `9cadad32c72d79424c75e3b6e56798f216bb0b06`, prepared from upstream by the committed runner rather than vendored.
- Full corpus: four real entries, 154 normal and 12 colorful SFCs, 109,122 input bytes, manifest SHA-256 `9ae54c3311168ccd093c9da5a1e977c81654590ce040a5de63c2702ff0f3fedd`.
- Negative control: the real colorful entry, 12 SFCs, 16,932 bytes, manifest SHA-256 `6b8c33346f17113a20a245c684cc38f8c9549db519a9d27809376b505ea4c083`.

Every SFC contains `<script setup lang="ts">` and an ordinary template, with no style, external source, or custom block. Production inline-template compilation therefore stays inside one transform call. The case covers SFC parse, script-setup macros, TypeScript, template compilation, component IDs, code generation, compiler errors, import, and JIT. It does not cover style and child virtual modules, `resolveId`, `load`, source maps in final output, function-valued compiler options, warnings, imported-type stress, watch, rebuild, HMR, or Vite as a runtime.

The plugin is not entirely JavaScript work. Its TypeScript tail calls Vite's synchronous `transformWithOxc`, which loads a released Rolldown native binding. A separate read-only stage estimate attributed about 83% of handler work to `compiler-sfc`, but the formal case treats the JavaScript compiler, native tail, imports, and memory as one real plugin cost and does not claim a pure-JavaScript speedup.

## Adapter change required

The unchanged full ordinary plugin is only the behavior reference. Timed ordinary and parallel variants use the same thin adapter, which instantiates the same `unplugin-vue` implementation but exposes only `buildStart` and `transform`, preserves `this`, and installs an identical declarative `.vue` filter. Both Rolldown options explicitly set `moduleTypes: { vue: 'js' }` because a parallel marker never runs the plugin's `options` hook. Worker options contain only structured-cloneable scalar data and an optional shared metrics buffer.

This is already a meaningful authoring change. It deliberately removes full-plugin `resolveId`, `load`, virtual-module behavior, plugin API, styles, external blocks, custom blocks, source-map configuration, Vite lifecycle, and non-cloneable compiler options. The experiment proves the narrowed whole-SFC transform surface, not that the full Vue plugin can be replaced by a parallel marker.

## Correctness gates

The [release smoke report](./data/2026-07-11-release-smoke.json) compares the unchanged full ordinary plugin, thin ordinary adapter, and one, two, four, and eight worker adapters in fresh processes. Every variant produces six chunks, 171,205 bytes, 499 aggregate exports, and raw SHA-256 `ff29988dfc1f0d902dfb4790700a33026f29727ed41f43b35b612bfd546ff98f`. The runner rejects any output byte, raw hash, normalized hash, call, byte, worker, permit, lifecycle, error, or cancellation mismatch.

Instrumented runs record exactly 166 JavaScript handler hits and 109,122 input bytes. They return 185,438 code bytes and 2,490 serialized map bytes. The Rust wrapper sees 171 calls: 166 values and five filter misses for non-SFC modules. Those misses confirm that the current native filter still runs only after the wrapper has acquired a worker permit.

The [error-semantics report](./data/2026-07-11-error-semantics.json) uses the same invalid SFC for the full ordinary plugin, thin ordinary adapter, and worker-1. Both ordinary forms preserve plugin name, module ID, `transform` hook, location, code frame, parser error code, and compiler stack. The parallel form fails cleanly but reduces the inner error to `GenericFailure`, loses structured plugin, ID, hook, location, parser code, and worker stack, and adds a second `Error:` prefix. Output parity therefore does not imply diagnostic parity.

## Wall result

The first 15-round matrix overlapped a separate release compile and had 20–27% median absolute deviation in several cells. It is retained as raw evidence but does not drive the conclusion. The dedicated 30-round confirmation ran after that compile finished, uses fresh processes, two discarded warmups, rotating variant order, and paired worker-to-ordinary ratios.

| Corpus and variant | Median wall | MAD | Paired median speed | Wins against paired ordinary | User CPU | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| colorful-12 ordinary | 149.3 ms | 9.0 ms | 1.00x | — | 169 ms | 125.9 MiB |
| colorful-12 worker-1 | 195.3 ms | 7.5 ms | 0.75x | 0 / 30 | 211 ms | 141.0 MiB |
| full-166 ordinary | 315.5 ms | 23.6 ms | 1.00x | — | 293 ms | 153.0 MiB |
| full-166 worker-2 | 361.9 ms | 33.1 ms | 0.91x | 8 / 30 | 642 ms | 213.9 MiB |
| full-166 worker-4 | 377.1 ms | 44.0 ms | 0.89x | 9 / 30 | 1197 ms | 298.8 MiB |
| full-166 worker-8 | 437.0 ms | 30.0 ms | 0.75x | 3 / 30 | 2244 ms | 462.1 MiB |

The confirmation [raw report](./data/2026-07-11-release-wall-confirm.json) and [summary](./data/2026-07-11-release-wall-confirm-summary.json) are the performance sources. Two workers more than double user CPU for a 9% paired regression; eight workers consume about 7.7 times ordinary user CPU and add about 309 MiB peak RSS for a 25% paired regression. More workers are not a free latency trade in a Rust bundler that is already using the machine.

## Cost attribution

The [instrumented raw report](./data/2026-07-11-release-instrumented.json) is not used for wall speed. Its medians explain why the uninstrumented result is negative.

| Variant | Pool initialization | Worker implementation import per instance | Handler time per SFC | Maximum handlers | Maximum outstanding | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ordinary | — | main-side import is in plugin setup | 752 µs | 1 | — | 152.7 MiB |
| worker-1 | 113.3 ms | about 72–76 ms | 757 µs | 1 | 166 | 165.1 MiB |
| worker-2 | 118.4 ms | about 75–83 ms | 957 µs | 2 | 166 | 213.5 MiB |
| worker-4 | 126.5 ms | about 83–85 ms | 1393 µs | 4 | 166 | 311.5 MiB |
| worker-8 | 163.2 ms | about 97–118 ms | 2813 µs | 8 | 166 | 473.6 MiB |

Each instance also runs `buildStart` to resolve the compiler. Aggregate measured `buildStart` work grows from about 33 ms ordinary to about 64 ms, 136–198 ms, and 374–445 ms across two, four, and eight workers. These are sums across concurrently running workers, not values to subtract directly from build wall time.

The matching SFCs are all outstanding and maximum JavaScript activity reaches every configured worker, so scheduler width is adequate. Instead, per-handler service becomes about 1.3x, 1.9x, and 3.7x slower at two, four, and eight workers. Shared-atomic instrumentation contributes some contention, but the corresponding user-CPU and wall results show that the underlying isolate, JIT, native Oxc, cache, and machine contention is real. The return payload is only about 188 KiB of code plus 2.4 KiB of maps, so large result transport is not the primary limit.

## Main-thread isolation

The [isolation report](./data/2026-07-11-release-isolation.json) includes plugin dynamic import, factory, buildStart, transform, generate, and close in the event-loop monitor boundary. With five fresh samples:

- Ordinary median wall is 321.4 ms; worker-1 is 407.0 ms, with paired median speed 0.83x.
- Ordinary median maximum event-loop delay is 183.1 ms; worker-1 is 4.59 ms.
- Ordinary median p95 delay is 154.8 ms; worker-1 is 1.24 ms.
- Ordinary peak RSS is 153.3 MiB; worker-1 is 168.4 MiB.
- Every output hash and byte count remains identical.

This confirms the core isolation result on a real compiler: the main thread stays responsive even when a one-shot build becomes slower.

## Why it does not speed up

1. The ordinary main-side plugin import and setup is about 84 ms in the quiet confirmation. Parallel main setup is small, but each fresh worker imports `unplugin-vue`, Vite helpers, compiler code, and the native Oxc path before it can transform anything.
2. Pool startup plus implementation import already consumes roughly 110–163 ms of wall time. The compiler resolution and cache initialization in `buildStart` is then repeated in every instance.
3. The 166 files are small. Ordinary measured handler work is about 125 ms total, leaving limited theoretical work to parallelize after fixed startup.
4. Per-call work slows under concurrency, while user CPU and RSS rise almost linearly or worse. The 12-logical-CPU machine is shared with Rolldown's Rust work and native Oxc rather than dedicated to JavaScript isolates.
5. The current API replicates a full plugin implementation module. The thin hook adapter does not create a thin dependency graph: worker import still loads the same unplugin and Vite machinery.

## Optimization implications

The most promising Vue-specific change is a real worker kernel boundary, not another wrapper around the full plugin module. A coordinator would resolve cloneable options and keep lifecycle, diagnostics, virtual modules, styles, metadata, and non-cloneable integrations. Workers would import a purpose-built whole-SFC compiler task without the unplugin adapter and unrelated Vite surface, then return code, map, normalized diagnostics, and explicit child-module payloads. It must preserve the full-reference output before its speed is measured.

Worker count remains a necessary policy but is not sufficient here: even two workers regress. Lazy initialization can help projects where few SFCs are reached, while pool reuse can amortize import and JIT in repeated output lifecycles; neither changes this fresh one-shot conclusion. Batching 166 tiny SFC tasks could reduce bridge scheduling, but measured bridge-only difference at one worker is small compared with import and compiler startup, so batching is lower priority.

If styles, external blocks, custom blocks, or child virtual modules are added, random worker routing is no longer a valid state model. The coordinator must own descriptors and child payloads or the runtime must provide stable owner-SFC affinity. That is a correctness requirement before it is a cache optimization.

## Reproduction

Use Node.js 24.18.0 and the release binding, then run `prepare-corpus.mjs`, `smoke-matrix.json`, `wall-confirm-matrix.json`, `instrumented-matrix.json`, `isolation-matrix.json`, and `run-failure-matrix.mjs` from `examples/par-plugin/cases/vue-icon` on the Rolldown research branch. The committed runner checks out the exact public upstream commit into ignored benchmark storage and verifies both corpus manifest hashes before starting a measured child. No Vite build, dev server, watch, rebuild, or HMR path is invoked.
