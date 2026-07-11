# Confirmed Research Direction

Direction confirmed by Yunfei on 2026-07-11. This record replaces the earlier provisional Phase 0 defaults.

## Confirmed scope

- Use the latest Node.js LTS line only. The pinned starting runtime is [Node.js 24.18.0](https://nodejs.org/en/blog/release/v24.18.0), the latest LTS patch at the direction date.
- Use Rolldown directly. Vite is not an experiment runtime, integration target, project harness, or source of the performance claim.
- Focus first on the retained ParallelPlugin itself. Run the existing path before exploring a coordinator, worker kernel, plugin protocol, or wider ecosystem cases.
- Prioritize `transform`. `resolveId` and `load` remain required separate later questions and must not delay the transform verdict.
- Use Vue as the second case after the core ParallelPlugin transform path is understood. The initial case uses `unplugin-vue/rolldown` under the direct Rolldown API, with no Vite runtime.
- Do not cover watch, rebuild, development-server behavior, or HMR.
- Choose the remaining implementation and measurement details according to what is necessary to answer the value question honestly.

## Source-established starting point

- Rolldown main `21d7b32827045e377a82c3cb681dafa51c244883` retains `defineParallelPlugin`, the Node worker bootstrap, the Rust worker registry and scheduler, and direct-Rolldown examples under `examples/par-plugin/`.
- No automated test currently exercises ParallelPlugin. The existing no-op example is the shortest direct transform smoke path; the existing Babel example is the shortest path that returns changed JavaScript.
- Rust already creates concurrent module tasks. Different ready modules can reach one parallel transform at the same time, while hook order for one module remains sequential.
- Rust invokes the Node-API thread-safe function created in a worker environment directly; individual calls do not take a main-thread `postMessage` round trip. Hook values still pay Node-API conversion and allocation, while plugin options are structured-cloned through `workerData` at initialization.
- Unchanged current main is now observed failing on Node.js 24.18.0 because all eight workers exit after bootstrap. Research commit `75ba695d1` adds an explicit keepalive and restores byte-identical no-op and Babel output without changing the weak callback type.
- Plugin-factory failure exposed a separate peer-initialization SIGABRT. Research commit `8fe749827` waits for every result and cleans all workers before returning the original error.
- The current runtime defaults to `min(os.availableParallelism(), 8)` workers. Research commit `30d992c39` adds a non-public environment control for one-worker and multi-worker measurements.
- The wrapper forwards 9 of 20 JavaScript hooks, loses hook-order metadata, and gives workers isolated JavaScript context state. These remain important defects, but only defects that block or invalidate the active direct-Rolldown transform path enter the first runtime work.
- `unplugin-vue` 7.2.0 has a real Rolldown entry and direct build example. Its transform can compile production inline templates with the official Vue 3.5.39 compiler, although the package imports Vite helper modules even when invoked by Rolldown. That import and memory cost remains part of the real-plugin result rather than a reason to switch to a synthetic compiler wrapper.

## Questions in order

1. Does the unchanged direct-Rolldown ParallelPlugin transform example initialize, receive callbacks, return results, report failures, and exit cleanly on Node.js 24.18.0?
2. If it fails, what is the smallest research-only repair that makes the same path usable without hiding the original failure?
3. What are the fixed and per-call costs of the core path: worker creation, module and plugin initialization, JIT, queueing, dispatch, Node-API conversion, copied bytes, memory, and CPU contention?
4. Does one worker improve Node.js main-thread availability even when wall time does not improve?
5. When do multiple workers shorten a complete direct-Rolldown transform build, and where is the crossover by graph width, module count, payload, and work per module?
6. Does a transform-only adapter around `unplugin-vue/rolldown` preserve the unchanged full ordinary plugin's output and errors while gaining isolation or throughput?
7. Which measured cost deserves optimization, and does the same optimization improve both the controlled transform and Vue case?
8. Only then: run the required Svelte case and gather separate `resolveId` and `load` evidence, using the earlier surveys to keep those later matrices narrow and honest.

## Working hypotheses

- Confirmed: unchanged current main fails before the first transform because workers exit after bootstrap; explicit worker lifetime is required.
- One worker can improve main-thread availability for synchronous JavaScript transforms even when startup and dispatch make total wall time worse.
- Multi-worker throughput requires simultaneously ready modules and enough JavaScript work per module to repay worker initialization, Node-API conversion, scheduling, and contention with Rolldown's Rust work.
- The fixed cost will make light transforms regress. The important result is the crossover and its frequency in realistic code, not a single winning heavy cell.
- Vue compiler initialization and duplicated compiler state can move the crossover upward. A correct negative Vue result is evidence against broad product investment.
- Whole-plugin replication may be sufficient for stateless transform kernels. Coordinator, affinity, or shared-state designs should be introduced only when the current path or Vue case proves why they are necessary.

## Experiment sequence and status

1. Completed: isolated worktree, pinned environment, build, unchanged no-op failure, byte-identical no-op and Babel controls, failure fixtures, two minimal runtime repairs, and explicit worker-count control.
2. Active: build the controlled transform crossover matrix and add the instrumentation required to explain it.
3. Next: implement the pinned `unplugin-vue/rolldown` transform case on the 166-SFC `cabinet-fe/icon` corpus.
4. Then optimize the dominant measured cost and repeat the same cases.
5. Complete the direct-Rolldown Svelte transform case, then the separate `resolveId` and `load` evidence required for the final hook-specific conclusions.

## Evidence rules

- Ordinary main-thread, one-worker, and multi-worker results are distinct. One worker answers isolation; multiple workers answer throughput.
- Every result pins source revisions, Node.js patch, package manager, Rust toolchain, machine, CPU availability, environment variables, worker count, command, input, output, and raw artifact.
- Record hook call count, ready-call concurrency over time, queue wait, service time, input and result bytes, total wall time, Node.js main-thread availability, CPU, peak RSS, worker startup, plugin initialization, and JIT.
- Compare output bytes or the strongest stable semantic representation, source maps, diagnostics, thrown errors, hook order, determinism, and process exit before comparing performance.
- Separate JavaScript CPU from native work, asynchronous I/O, and Rust work. A Rust compiler or native worker pool cannot prove the value of JavaScript plugin workers.
- Keep fresh-process and independent warm operating-system-cache runs separate. Both use newly created workers.
- Preserve neutral and negative results. Do not add artificial delay to a real plugin or remove behavior to make workers win.
- Label every result produced with a research-only Rolldown patch and retain the unchanged-main control.

## Explicitly outside scope

- Vite execution or Vite-plugin compatibility.
- Watch, rebuild, development-server behavior, HMR, and cross-build worker reuse.
- A Node.js version matrix beyond the latest LTS line.
- `resolveId` or `load` experiments before the transform and Vue results. They remain required later work.
- A production API proposal before the current runtime and measured costs justify one.
