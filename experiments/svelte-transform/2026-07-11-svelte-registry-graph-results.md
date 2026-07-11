# Direct-Rolldown Svelte Registry UI Graph Results

Date: 2026-07-11. Rolldown fixture branch: `research/parallel-js-plugin-svelte-case`; all final reports pin clean commit `1074399c2e3b0858388e5a7dee586388c76c82f6`. Node.js is 24.18.0 on an Apple M3 Pro with 12 logical CPUs and 36 GiB of memory. The native binding is 16,311,136 bytes with SHA-256 `d5dfc108c1267f08555dd4652f785bca40ad053fc573996bf1799ee714dddee1`; the runner records source commit `54fd0e24112505443044a4bba5c41d1f4d9ba2aa` and a release-profile claim but cannot infer the binary's Cargo profile mechanically. The complete generated Rolldown distribution is 46 files and 17,095,127 bytes with aggregate SHA-256 `a32bf0f04334178874504f1b7bae36e86cbaba465d9d915768214d03ca6d2342`.

## Outcome

The current parallel transform path can shorten a graph-preserving direct-Rolldown Svelte project-subgraph build, but the best gain is modest and resource-expensive. In the 15-round confirmation, worker-4 reduces median wall time from 596.4 ms to 540.8 ms and has a 1.117x paired median speedup; it wins all 15 pairs and its worst paired result is still 1.061x. Worker-2 also wins all 15 pairs at 1.064x. Worker-1 and worker-8 lose every pair.

Worker-4 raises median user CPU from 912.5 ms to 2590.9 ms, or 2.84x, and peak RSS from 322,355,200 bytes to 698,318,848 bytes, or 2.17x. Worker-8 reaches 4.74 seconds of user CPU and 1.05 GiB peak RSS while becoming slower than ordinary. The throughput value therefore exists, but a hardware-derived eight-worker default is unsuitable for this workload and the 55.6 ms median wall saving does not justify the resource cost for every build environment.

Main-thread isolation is a separate, stronger result. In the five-run isolation matrix, the median per-run maximum event-loop delay falls from 314.6 ms ordinary to 9.7 ms with one worker and 9.9 ms with four. One worker still makes the build slower, while four workers retain a 1.123x paired median wall speedup. Moving synchronous compiler work off the main thread has value even when the selected worker count does not improve total build time.

This result closes the representative Svelte evidence gap left by the synthetic 1,340-component fan-out. It is a real, graph-preserving 56-entry shadcn-svelte registry UI subgraph, not a full shadcn-svelte monorepo, docs application, SvelteKit build, or official Svelte plugin result.

## Project and graph boundary

- Upstream source: [`huntabyte/shadcn-svelte`](https://github.com/huntabyte/shadcn-svelte/tree/efcf8a4ef2c6a3a21ee2fd4db905519f8d4c8e63) at `efcf8a4ef2c6a3a21ee2fd4db905519f8d4c8e63`, retaining the upstream MIT license.
- Prepared source snapshot: all 2,607 tracked files and 3,535,740 bytes under `docs/src`, aggregate SHA-256 `d7e6608eee8465062fae46ab0343837cdcee39838fadb0106ae24755030c3e4c`.
- Entries: the 56 real `docs/src/lib/registry/ui/*/index.ts` barrels passed directly to Rolldown as separate entries; there is no generated aggregator.
- Reached local graph: 425 modules and 376,418 source bytes, comprising 350 `.svelte`, four `.svelte.ts`, and 71 `.ts` modules; graph SHA-256 `b82afa21e77ec7fbe32148de0145e5f05648b28b41967d60028288664587cc80`.
- Local resolution: the external policy returns false for relative, absolute, and `$lib` IDs, unresolved `$lib` requests throw, and every formal run must match the exact expected local-module list, graph hash, and output hashes. `projectLocalExternalCount` is retained as telemetry but is not treated as an independent gate because the external recorder runs only after a bare-ID classification.
- Explicit package boundaries: three SvelteKit `$app/*` virtual modules, two `shadcn-svelte/*` workspace package exports, three Svelte runtime IDs, and 17 third-party bare IDs. Following the two workspace exports would require building and resolving the separate CLI workspace package and would add no Svelte component transforms, so they are recorded separately rather than described as third-party.

The hard `expected-graph.json` gate pins every local module, resolver count, external category, transform count and byte count, output shape, export count, logs, and code/map hash. Every formal ordinary and worker process reproduces 69 chunks, 58 source-map assets, 684 exports, 558,031 output code bytes, and 555,159 output map bytes. The source-map hash includes each chunk filename and map.

## Adapter boundary

There is no official direct-Rolldown Svelte plugin in this experiment. Ordinary and parallel variants call the same worker-loadable kernel. The fixture commit and lockfile pin Svelte 5.56.4 and TypeScript 6.0.3; the raw report records Svelte's configured version but does not independently record or hash the TypeScript package. The kernel uses Svelte `compile` for 350 components and `compileModule` for four rune modules. Because Svelte does not parse TypeScript syntax in `compileModule`, the same kernel imports TypeScript, runs `transpileModule`, and passes its source map into Svelte. TypeScript import, transpilation, map composition, and per-isolate memory are part of the measured adaptation cost; the handler timing is not pure Svelte compiler time.

The kernel receives corpus-relative filenames and cloneable scalar options and returns only code and source maps. No Svelte compiler `root` option or Rolldown `moduleType` result is used. The coordinator retains graph resolution, package-boundary policy, expected-graph validation, output/log validation, and process-level measurement.

The case excludes SvelteKit and Vite runtime, preprocessors, user callbacks, external CSS virtual modules, SSR, complete official-plugin state, watch, rebuild, and HMR. The reached components contain no style tags, so the case does not exercise the cross-hook CSS map used by some Svelte plugin designs.

## Correctness and diagnostic gates

Every ordinary, worker-1, worker-2, worker-4, and worker-8 sample matches output code SHA-256 `b7a593e16e164ff622b1410de0d9ad386a10dbc4649292e06ba852edf0072078` and map SHA-256 `69b9b4dfc3e750e395ad99e56e14d986df793300425e3c2e731cf757fb784d00`. All formal builds also match the complete local-module list, graph hash, output counts and bytes, resolver telemetry, transform counts, external categories, and empty build-log list.

The [semantics report](./graph-data/2026-07-11-semantics-final.json) intentionally compiles an invalid reached Svelte component. Both forms fail. Ordinary output retains `[plugin svelte-registry-graph-transform]` and the full normalized module path. The worker form retains the corpus-relative filename, Svelte error code, source frame, line, and column, but loses the plugin label, full path, and ordinary error formatting. Neither captured form exposes a separate structured hook field, so this probe does not independently establish hook-field loss. Output parity therefore passes while error parity fails.

This graph happens to emit no compiler warnings, so it cannot replace the isolated Svelte warning probe. That probe observes two structured ordinary warnings and none in worker mode because the current worker logger is a no-op. Taken together, the two cases show that exact bundles do not imply complete plugin semantics.

## Complete-build confirmation

Each reported sample is a fresh Node.js process and, for parallel variants, a fresh worker pool. The matrix runs one discarded fresh-process warmup per variant before 15 measured rounds, so measured rounds benefit from ordinary operating-system caches but never reuse a worker, V8 isolate, compiler instance, or JavaScript module cache. `totalElapsedMs` excludes Node startup, top-level Rolldown import, corpus verification, and result hashing. It includes adapter or worker setup, Svelte and TypeScript import, local resolution, compilation, Rolldown build/generate/close, and source-map processing. Peak RSS wraps the complete child process. The table uses the uninstrumented 15-round [raw report](./graph-data/2026-07-11-wall-confirm-final.json) and its [summary](./graph-data/2026-07-11-wall-confirm-final-summary.json).

| Variant | Median wall | MAD | Paired median speed | Paired minimum | Wins | User CPU | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ordinary | 596.4 ms | 8.0 ms | 1.000x | 1.000x | — | 912.5 ms | 307.4 MiB |
| worker-1 | 661.9 ms | 8.3 ms | 0.894x | 0.860x | 0 / 15 | 984.0 ms | 323.2 MiB |
| worker-2 | 554.5 ms | 9.0 ms | 1.064x | 1.025x | 15 / 15 | 1494.3 ms | 464.9 MiB |
| worker-4 | 540.8 ms | 9.9 ms | 1.117x | 1.061x | 15 / 15 | 2590.9 ms | 666.0 MiB |
| worker-8 | 667.0 ms | 10.2 ms | 0.894x | 0.856x | 0 / 15 | 4736.6 ms | 1075.5 MiB |

The absolute median reduction at worker-4 is 55.6 ms, about 9.3% of ordinary wall time. Paired speed is preferred because each round rotates execution order; the all-pair result and paired minimum establish the direction on this machine more strongly than the exact 1.117x magnitude.

## Cost attribution

The three-run [instrumented report](./graph-data/2026-07-11-instrumented-final.json) is explanation evidence, not the speed source. Each build records 426 transform wrappers: 354 value results from 350 `compile` and four `compileModule` calls, plus 72 filter misses. The wrappers carry 380,702 input bytes; matching handlers receive 271,896 bytes and return 511,904 code bytes and 468,144 serialized-map bytes. Maximum outstanding wrappers reaches 338, and active JavaScript handlers reach exactly the configured worker count.

| Variant | Pool initialization | Implementation import per worker | Component service per call | Rune-module adaptation and service per call | Max active handlers |
| --- | ---: | ---: | ---: | ---: | ---: |
| ordinary | — | main import is setup | 0.796 ms | 16.52 ms | 1 |
| worker-1 | 244.3 ms | 206.0 ms | 0.815 ms | 15.24 ms | 1 |
| worker-4 | 289.3 ms | 238.5 ms | 1.659 ms | 37.69 ms | 4 |
| worker-8 | 404.9 ms | 332.9 ms | 3.236 ms | 56.11 ms | 8 |

The pool and implementation-import intervals overlap across workers and must not be multiplied or added to queue totals as wall time. They show the mechanism: one worker cannot repay duplicated startup; four expose enough ready compiler work to save wall time; eight multiply compiler and TypeScript initialization, memory, and CPU contention until per-call service becomes roughly four times ordinary for components and 3.4 times ordinary for rune modules. A shorter permit queue at eight workers cannot compensate for slower service and higher startup.

The 72 null results also confirm that current native transform filters do not prevent wrapper scheduling or permit acquisition. Pre-permit filtering remains a concrete low-complexity optimization, although it cannot remove the dominant compiler import and contention costs in this graph.

## Main-thread isolation

The five-run [isolation report](./graph-data/2026-07-11-isolation-final.json) uses the same graph and output gates while monitoring the event loop. The values below are medians across runs; the maximum column is the median of each run's observed maximum, not the global maximum of a long-lived process.

| Variant | Median wall | Paired median speed | Event-loop mean | Event-loop p99 | Median per-run maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| ordinary | 596.8 ms | 1.000x | 8.44 ms | 26.57 ms | 314.57 ms |
| worker-1 | 688.0 ms | 0.863x | 1.10 ms | 1.93 ms | 9.72 ms |
| worker-4 | 547.6 ms | 1.123x | 1.12 ms | 2.08 ms | 9.91 ms |
| worker-8 | 656.1 ms | 0.893x | 1.23 ms | 3.14 ms | 10.16 ms |

The one-worker result isolates synchronous compiler work without claiming throughput. The four-worker result achieves both effects for this graph. These short-run p99 values describe the recorded fixture and are not steady-state service-latency percentiles.

## Relation to the isolated Svelte upper bound

The earlier 1,340-component case uses real SFC sources but a synthetic fan-out entry and externalizes every dependency reached from an SFC. Four workers reach 1.36x because about 1.84 seconds of ordinary handler work is made maximally wide. The graph-preserving case follows 425 real local modules and reaches only 1.117x at four workers. It has fewer matching transforms, graph scheduling and TypeScript work, and less total compiler work to amortize roughly 289 ms of pool initialization.

The difference is the useful conclusion rather than a failed replication. Prepared independent compiler kernels show the performance ceiling; representative graphs determine whether enough work is actually ready and whether the complete build has enough JavaScript share to matter. Neither the 1.36x upper bound nor the 1.117x graph result should be generalized to a full Svelte application or official plugin without preserving preprocessors, CSS and diagnostics.

## Reproduction

The executable fixture, source manifest, expected graph, ordinary and parallel adapters, matrices, summarizer, and full commands live at [`rolldown/rolldown@1074399c2/examples/par-plugin/cases/svelte-registry-graph`](https://github.com/rolldown/rolldown/tree/1074399c2e3b0858388e5a7dee586388c76c82f6/examples/par-plugin/cases/svelte-registry-graph). The commit is on the pushed `research/parallel-js-plugin-svelte-case` branch and includes research-only worker lifetime, cleanup, worker-count, and instrumentation changes; it is not unchanged Rolldown main. Begin from that exact commit with its frozen dependency graph:

```sh
git clone https://github.com/rolldown/rolldown.git
cd rolldown
git checkout --detach 1074399c2e3b0858388e5a7dee586388c76c82f6
pnpm install --frozen-lockfile
cd examples/par-plugin/cases/svelte-registry-graph
```

From the case directory, prepare the pinned upstream corpus, build the pinned release binding, then execute and summarize the matrices:

```sh
git clone https://github.com/huntabyte/shadcn-svelte.git /tmp/shadcn-svelte
git -C /tmp/shadcn-svelte checkout --detach efcf8a4ef2c6a3a21ee2fd4db905519f8d4c8e63
mise exec node@24.18.0 -- ./prepare-corpus.mjs --source /tmp/shadcn-svelte
mise exec node@24.18.0 -- just build-rolldown-release
mise exec node@24.18.0 -- ./prove-ordinary.mjs ./.results/ordinary-proof.json
mise exec node@24.18.0 -- ./run-semantics.mjs ./.results/semantics.json
mise exec node@24.18.0 -- ./run-matrix.mjs ./wall-confirm-matrix.json ./.results/wall-confirm.json
mise exec node@24.18.0 -- ./summarize-matrix.mjs ./.results/wall-confirm.json ./.results/wall-confirm-summary.json
mise exec node@24.18.0 -- ./run-matrix.mjs ./instrumented-matrix.json ./.results/instrumented.json
mise exec node@24.18.0 -- ./summarize-matrix.mjs ./.results/instrumented.json ./.results/instrumented-summary.json
mise exec node@24.18.0 -- ./run-matrix.mjs ./isolation-matrix.json ./.results/isolation.json
mise exec node@24.18.0 -- ./summarize-matrix.mjs ./.results/isolation.json ./.results/isolation-summary.json
```

Formal runners reject a dirty worktree, record hashes for the exact Node binary and native binding, hash the generated Rolldown distribution before each matrix and again afterward, and fail on any graph, output, or log mismatch. The external policy keeps all local-shaped IDs internal, unresolved aliases throw, and the exact expected local graph is a stronger gate than the retained local-external telemetry. The copied [graph data index](./graph-data/README.md) names every durable artifact used here.
