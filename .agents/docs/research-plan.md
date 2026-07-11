# Research Plan

This is a live research sequence, not an implementation commitment. Replace it as evidence changes.

## Confirmed order

1. Use direct Rolldown on the latest Node.js LTS release.
2. Run the retained ParallelPlugin `transform` path unchanged.
3. Repair only what blocks that path, preserving the unchanged failure and exact patch.
4. Measure the core transform path before adding a real plugin.
5. Use a direct-Rolldown pure-JavaScript Vue transform as the second case.
6. Optimize only a measured dominant cost.
7. Complete the required Svelte transform case, then the separate `resolveId` and `load` evidence needed for hook-specific conclusions.

Vite, watch, rebuild, development-server behavior, and HMR are outside the research scope.

## Phase 1: current transform path

- Pin current Rolldown main, the latest Node.js LTS patch, pnpm, Rust, operating system, CPU, and commands.
- Use an isolated Rolldown worktree because the primary checkout is not an experiment workspace.
- Build Rolldown and run the existing direct-Rolldown parallel no-op transform example unchanged. Record exit status, stdout and stderr, output artifact, worker initialization, first callback, and shutdown.
- Run the existing Babel transform example after the no-op path. Compare its output and errors with the ordinary single-thread plugin before trusting timing.
- Add bounded direct-Rolldown fixtures for plugin-factory initialization failure and synchronous and rejected transform failures. Require attributed errors, cleanup of peer workers, and clean process exit before calling the retained path usable.
- If unchanged current main fails, retain the failing command and logs. Apply the smallest research-only callback or worker-lifetime repair required to continue, and label every later result with that patch.
- Do not expand hook coverage, change the API, add Vite compatibility, or solve unrelated defects during this phase.

## Phase 2: core transform cost surface

- Create a controlled direct-Rolldown transform fixture only after the retained path runs. It must exercise real module-graph concurrency rather than call a compiler outside Rolldown.
- Compare ordinary main-thread execution, one-worker isolation, and several explicit worker counts. If the current API has no worker-count control, add the smallest research-only control and keep the default behavior unchanged.
- Vary graph width, module count, source and result bytes, per-module synchronous JavaScript work, and source-map output independently.
- Measure worker creation, module and plugin initialization, first-use JIT, queue wait, service time, Node-API conversion, copied bytes, total wall time, Node.js main-thread availability, CPU, peak RSS, and contention with Rolldown's Rust work.
- Keep fresh-process and independent warm operating-system-cache runs distinct. Both create new workers.
- Preserve output bytes, source maps, errors, diagnostics, hook order, and determinism across worker counts.
- Locate the crossover and retain negative cells. One worker answers isolation; multiple workers answer throughput.

## Phase 3: Vue second case

- Use `unplugin-vue/rolldown` under the direct Rolldown API. Do not run Vite or claim Vite-plugin parity. Count the Vite helper modules imported by the Rolldown entry as real plugin initialization and memory overhead.
- Pin `unplugin-vue` 7.2.0, Vue and `@vue/compiler-sfc` 3.5.39, and `cabinet-fe/icon` at `9cadad32c72d79424c75e3b6e56798f216bb0b06` as the initial real corpus. Its four JavaScript entries reach 166 small SFCs without style or external blocks.
- Use the unchanged full ordinary plugin as the correctness reference. Compare it with a thin ordinary and parallel adapter that exposes only `buildStart` and `transform`, applies the same declarative `.vue` filter, sets the same `.vue` module type, and uses production inline-template compilation.
- State the supported surface explicitly: script setup, TypeScript script compilation, HTML template compilation, component IDs, code generation, and errors. Do not claim styles, custom or external blocks, virtual-module hooks, source maps, function options, warnings, watch, or HMR.
- Compare ordinary, one-worker, and multiple-worker forms with identical compiler versions, options, inputs, outputs, and errors.
- Attribute compiler import and initialization, parse, script compilation, template compilation, returned bytes, queueing, memory, and end-to-end build time separately. The initial case disables source maps and makes no map-performance claim.
- Report every plugin change and state-ownership decision as part of the cost. If Vue does not improve, identify whether the limit is plugin share, graph concurrency, initialization, transfer, memory, or Rust CPU contention.
- Run every variant in a fresh Node.js process. Module-level descriptor and compiler caches make sequential variants in one process an invalid cold-start comparison.

## Phase 4: attributed optimization

- Change only the cost shown to dominate the core transform or Vue result: callback lifetime, worker count, lazy initialization, dispatch, batching, payload conversion, cache replication, state placement, module affinity, or CPU contention.
- Re-run the same pinned core and Vue cases after each optimization.
- Stop an optimization when its expected end-to-end benefit is smaller than its implementation and maintenance cost.

## Phase 5: required later cases

- Add a direct-Rolldown Svelte transform after Vue and preserve a reproducible ordinary, one-worker, and multi-worker comparison. Select its boundary and corpus from the earlier source audit, but do not run Vite.
- Add `resolveId` and `load` evidence after the transform verdict and measure each hook separately. Use the earlier surveys to select honest direct-Rolldown fixtures rather than artificial delay or Vite projects.
- A negative core or Vue result may narrow the later matrices, but it does not remove the required Svelte experiment or separate hook conclusions.

## Parallel defect track

- Reproduce defects that block or invalidate the direct-Rolldown production-build transform path on the pinned latest LTS release.
- Keep other source-backed defects in the inventory, but label Vite-specific, watch-only, rebuild-only, and other-Node-version items as outside the active runtime scope.
- Separate runtime defects from plugin-authoring limits and from experiment mistakes.
- Require every observed defect to retain a minimal command, environment, raw log, expected behavior, observed behavior, and fix condition.
