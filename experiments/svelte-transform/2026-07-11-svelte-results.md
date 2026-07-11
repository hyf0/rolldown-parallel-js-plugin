# Direct-Rolldown Svelte Transform Results

Date: 2026-07-11. Rolldown fixture branch: `research/parallel-js-plugin-svelte-case`; the full confirmation report pins `20cbc043ccf1ab730ded962db1f413abde15753d`. Node.js is 24.18.0 on an Apple M3 Pro with 12 logical CPUs and 36 GiB of memory. The report pins the 16,311,136-byte native binding as SHA-256 `d5dfc108c1267f08555dd4652f785bca40ad053fc573996bf1799ee714dddee1`; the runner records the executed release-profile claim but does not infer a Cargo profile from the binary.

## Outcome

Parallel Svelte compilation shortens the complete fresh fixture build once the corpus contains enough real SFC work. In the 1,340-component confirmation, two, four, eight, and twelve workers have paired median speedups of 1.20x, 1.36x, 1.27x, and 1.11x. Four workers are best. They reduce median wall time from 2054 ms to 1509 ms while raising user CPU from 3008 ms to 5689 ms and peak RSS from 748 MiB to 983 MiB.

The gain has a clear observed scale boundary. With 24 real components, every tested worker count from one through eight regresses. With 256, two and four workers provide only 1.05x and 1.13x, while eight regress to 0.91x. In the full corpus, maximum outstanding Rust wrappers reaches 1,340 and every configured worker is saturated. The aggregate synchronous compiler work repays worker and compiler startup, but adding workers beyond four increases per-call contention, CPU, and memory faster than useful throughput.

The output code and source maps are identical across ordinary and parallel forms, but plugin semantics are not fully equivalent. A warning fixture emits two structured Svelte accessibility warnings in ordinary mode and none in worker mode. A compile-error fixture fails both builds, but the worker form loses plugin and hook attribution, retains only a relative filename and position instead of the complete module path, and changes the structured error format.

## Exact case

- Compiler: Svelte 5.56.4, source commit [`eae50dfd1c2269e37258ef5c09527003bcf61573`](https://github.com/sveltejs/svelte/tree/eae50dfd1c2269e37258ef5c09527003bcf61573).
- Real corpus: [`huntabyte/shadcn-svelte`](https://github.com/huntabyte/shadcn-svelte/tree/efcf8a4ef2c6a3a21ee2fd4db905519f8d4c8e63/docs/src/lib/registry) at `efcf8a4ef2c6a3a21ee2fd4db905519f8d4c8e63`, extracted by the committed manifest under its retained MIT license.
- Selection: `docs/src/lib/registry/**/*.svelte`, excluding 26 files whose source contains literal `<svg` to avoid unrelated icon and logo material. This deliberately simple rule has a known false positive for type text such as `SVGAttributes<SVGSVGElement>`.
- Corpus: 1,340 SFCs, 64,392 lines, 1,946,145 bytes, 1,314 TypeScript-script files, 616 rune users, no `<style>` tags, and 1,322 unique contents.
- Corpus aggregate SHA-256: `ea584b2189062d5986cb4c15f344bcb42cbee8b7089277ee95d5d7ab9f49b8e8`.
- Full deterministic selection hash: `23d7134d98a9b8ff9f87a9229900e67362b77d174fef5e0b4028bc7a69c59e47`.

The parent creates one synthetic fan-out entry in a temporary directory, importing a deterministic hash-ordered selection of the real SFCs. Imports reached from inside an SFC are externalized so the measurement stays on Svelte compilation rather than SvelteKit, Vite, dependency installation, or package resolution. `treeshake: false` retains every compiled module. Corpus extraction and fan-out entry creation occur outside the measured child.

## Adapter boundary

There is no current official direct-Rolldown Svelte plugin. The experiment uses one shared kernel for ordinary and parallel variants. It imports `compile` from `svelte/compiler`, filters `.svelte`, and calls the same synchronous compiler with cloneable scalar options: client output, production mode, injected CSS, disabled version disclosure, and a corpus-relative filename. It returns compiled JavaScript and its source map. The corpus root is used by the adapter to normalize filenames; it is not passed as a Svelte compiler option.

This is a real compiler transform and a fair ordinary-versus-worker comparison, but it is not a full Svelte or SvelteKit build. It excludes preprocessors, `.svelte.js` and `.svelte.ts` `compileModule`, SSR, external CSS, virtual CSS `resolveId` and `load`, SvelteKit configuration, warning policy callbacks, watch, rebuild, HMR, and Vite runtime. The source corpus has no style tags, so it cannot test the state edge where a transform stores CSS for a later load hook.

The narrowed kernel is stateless across files. Svelte resets compiler module state for every synchronous call, and each worker runs one call at a time. Every worker still imports the full compiler and owns its own V8 isolate, JIT state, and memory.

## Correctness gates

The [full smoke report](./data/2026-07-11-full-smoke.json) compares ordinary and worker-4 over all 1,340 SFCs. Both produce 5,465,989 output code bytes and 3,123,695 output map bytes. Their normalized code SHA-256 is `74632c9311245ef6bb64e0b59d279301b298006ea0bd721eadb13c59cf481a34`; map SHA-256 is `8af02de1db25c2663eef3ca6f62c00304df79160e83f8714e65ab3a2bcc3198b`.

Instrumented variants all record exactly 1,340 matching handler calls, 1,946,145 input bytes, 5,679,104 returned code bytes, and 3,323,933 returned serialized-map bytes. Rust records 1,342 wrapper calls: 1,340 value results and two filter misses. Handler, permit, wrapper, worker, byte, error, cancellation, output code, and output map gates all pass.

The [semantics report](./data/2026-07-11-semantics-final.json) records two intentional incompatibilities:

- Ordinary compilation emits two structured accessibility warnings with Svelte codes, plugin, hook, ID, location, and frame; worker-2 emits no logs while producing identical code and map hashes. The worker's no-op logger silently discards diagnostics.
- Ordinary invalid markup reports `[plugin svelte-transform]`, the normalized module path, `CompileError`, frame, and Svelte error URL. Worker-2 reports an extra generic `Error:`, only the relative filename and position, and no plugin or hook attribution. Both fail cleanly, but error structure is not equivalent.

## Scale and worker count

The seven-round scale matrix is the source for the 24- and 256-component boundaries. The ten-round full confirmation replaces the noisy first full batch.

| Corpus and variant | Median wall | Paired median speed | Wins against paired ordinary | User CPU | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 24 ordinary | 213 ms | 1.00x | — | 291 ms | 155 MiB |
| 24 worker-1 | 237 ms | 0.86x | 0 / 7 | 298 ms | 158 MiB |
| 24 worker-2 | 232 ms | 0.90x | 0 / 7 | 523 ms | 208 MiB |
| 24 worker-4 | 244 ms | 0.82x | 0 / 7 | 974 ms | 294 MiB |
| 24 worker-8 | 364 ms | 0.60x | 0 / 7 | 2175 ms | 466 MiB |
| 256 ordinary | 531 ms | 1.00x | — | 853 ms | 288 MiB |
| 256 worker-1 | 628 ms | 0.86x | 0 / 7 | 906 ms | 276 MiB |
| 256 worker-2 | 499 ms | 1.05x | 5 / 7 | 1314 ms | 331 MiB |
| 256 worker-4 | 480 ms | 1.13x | 6 / 7 | 2149 ms | 423 MiB |
| 256 worker-8 | 585 ms | 0.91x | 1 / 7 | 3700 ms | 693 MiB |

The [scale raw report](./data/2026-07-11-wall.json) and [summary](./data/2026-07-11-wall-summary.json) retain these negative and near-crossover cells.

| Full confirmation variant | Median wall | MAD | Paired median speed | Wins against paired ordinary | User CPU | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ordinary | 2054 ms | 19 ms | 1.00x | — | 3008 ms | 748 MiB |
| worker-1 | 2644 ms | 369 ms | 0.89x | 1 / 10 | 3487 ms | 706 MiB |
| worker-2 | 1941 ms | 265 ms | 1.20x | 7 / 10 | 4195 ms | 829 MiB |
| worker-4 | 1509 ms | 26 ms | 1.36x | 10 / 10 | 5689 ms | 983 MiB |
| worker-8 | 1626 ms | 48 ms | 1.27x | 10 / 10 | 8627 ms | 1341 MiB |
| worker-12 | 1876 ms | 61 ms | 1.11x | 10 / 10 | 10626 ms | 1800 MiB |

The [confirmation raw report](./data/2026-07-11-wall-confirm.json) and [summary](./data/2026-07-11-wall-confirm-summary.json) are the final full-corpus speed sources. Worker-4 saves about 545 ms wall but uses about 89% more user CPU and 235 MiB more peak RSS. Worker-8 is slower than worker-4 while using 52% more user CPU and another 358 MiB RSS. Worker-12 retains only a small gain and reaches 1.8 GiB RSS.

The high MAD in worker-1 and worker-2 means their exact full ratios are less stable than worker-4 and worker-8. Their paired direction and win counts support the broad conclusion: worker-1 loses, worker-2 is near the positive boundary, and four workers are the best observed configuration.

## Cost attribution

The [instrumented report](./data/2026-07-11-instrumented.json) is explanation evidence only. It records a maximum of 1,340 outstanding wrappers and confirms that active handler count reaches every configured worker. The total is 1,342 wrappers: 1,340 matching values and two filter misses, so the data does not prove that all 1,340 matching handlers themselves were simultaneously outstanding.

| Variant | Pool initialization | Implementation import per worker | Handler time per SFC | Permit-held time per wrapper | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| ordinary | — | main import is in setup | 1.37 ms | — | 755 MiB |
| worker-1 | 164 ms | 120 ms | 1.39 ms | 1.58 ms | 713 MiB |
| worker-4 | 264 ms | 212 ms | 2.32 ms | 2.56 ms | 981 MiB |
| worker-8 | 301 ms | 227 ms | 4.79 ms | 5.57 ms | 1350 MiB |
| worker-12 | 503 ms | 386 ms | 6.75 ms | 8.30 ms | 1712 MiB |

Per-call compilation slows substantially as isolates compete for CPU and memory, but the full corpus has enough total work that four workers still reduce the critical path. Eight and twelve show the saturation mechanism: higher handler and permit service, import, CPU, and memory overwhelm added parallel slots.

The difference between handler and permit-held time approximates native filter, dispatch, worker scheduling, Node-API conversion, and return processing together; it is not pure serialization. Queue wait averaged across all 1,342 concurrently submitted wrappers is also not build wall time and must not be summed into an overhead claim.

## Main-thread isolation

The [isolation report](./data/2026-07-11-isolation.json) includes compiler import, factory, build, generate, and close in the event-loop monitor boundary.

| Variant | Median wall | Paired median speed | Median per-run maximum event-loop delay | Event-loop p99 | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| ordinary | 2225 ms | 1.00x | 1108 ms | 1.82 ms | 749 MiB |
| worker-1 | 2482 ms | 0.90x | 2.91 ms | 1.89 ms | 707 MiB |
| worker-4 | 1618 ms | 1.40x | 3.48 ms | 2.04 ms | 949 MiB |
| worker-8 | 1832 ms | 1.26x | 5.72 ms | 3.03 ms | 1303 MiB |

Ordinary has one very long blocking interval in each run while most recorded ticks remain short, which is why the median per-run maximum delay is 1.1 seconds while p99 remains about 1.8 milliseconds. Worker execution removes that long main-thread stall. At four workers the fixture achieves both goals: faster build and responsive main loop.

## Comparison with Vue

Vue and Svelte use the same direct-Rolldown worker architecture and both expose enough wrapper concurrency to saturate every configured worker, but their total useful work differs. Vue has 166 small SFCs and about 125 ms of measured ordinary handler work; every tested worker count regresses. The synthetic Svelte corpus has 1,340 SFCs and about 1.84 seconds of aggregate ordinary handler work in the instrumented run; four workers can amortize a much heavier compiler import and pool startup.

This comparison supports a workload rule rather than a framework verdict. The 24-component fixture loses, the sufficiently large synthetic Svelte corpus wins, and a heavier Vue corpus could cross later. File count alone is also insufficient: source size, compiler path, per-call distribution, generated map payload, native work, and ready concurrency all matter.

## Optimization implications

The immediate Svelte lever is worker-count selection: four is materially better than the default eight for this corpus, and workloads resembling the 24-component fixture should stay ordinary or use one worker only when main-loop isolation is itself valuable. Compiler import and JIT remain large fixed costs, so a reusable pool could improve repeated lifecycles, but watch and rebuild are outside the current goal.

A production Svelte integration still needs a coordinator/kernel boundary. Configuration, preprocessors, dynamic compile options, warning policy, virtual CSS resolve/load, metadata, and SvelteKit state remain coordinated; workers receive a serializable compiler task and return code, CSS, maps, dependencies, metadata, and structured diagnostics. The current warning loss proves that output bytes alone are not enough.

The real `rollup-plugin-svelte` external-CSS path also stores transform results in an instance `Map` that later `resolveId` and `load` consume. Random worker routing can send those hooks to a different instance and miss the entry. This corpus has no style tags and intentionally does not mask that state-model blocker with a performance number.

## Reproduction

On the Svelte research branch, use Node.js 24.18.0 and run the committed `prepare-corpus.mjs`, `full-smoke-matrix.json`, `wall-matrix.json`, `wall-confirm-matrix.json`, `instrumented-matrix.json`, `isolation-matrix.json`, and `run-semantics.mjs` from `examples/par-plugin/cases/svelte-transform`. The branch contains the research worker-lifetime, initialization-cleanup, worker-count, and instrumentation changes; it is not unchanged Rolldown main. The manifest, extraction rules, upstream license, compiler version, source bytes, entry selection, release-profile claim, binding hash, host, output hashes, and every raw sample are retained with the reports. No Vite, SvelteKit, watch, rebuild, or HMR runtime is involved.
