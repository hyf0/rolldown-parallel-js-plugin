# Research Plan

This is a live research sequence, not an implementation commitment. Replace it as evidence changes.

The current experimental scope is production builds. Repeated builds, watch/rebuild, development-server behavior, HMR, and custom cross-build worker reuse remain documented compatibility and lifecycle questions, but their runtime coverage is deferred and does not gate the current production-build verdict.

## Phase 0: framing and evidence baseline

- Verify the current implementation and history from pinned source, and separate source-proven behavior from historical runtime reports that still need reproduction.
- Record which hooks, plugin context methods, metadata paths, options, and output plugins are supported rather than assuming the ordinary plugin contract carries over.
- Establish `resolveId`, `load`, and `transform` as separate performance workloads, with their own call counts, hit or miss distributions, state dependencies, and correctness checks.
- Start a technical defect inventory covering known current failures and defects discovered by source audit or reproduction; do not hide defects inside benchmark notes.
- Audit the old prototype and the unmerged native-bridge benchmark branch, preserving useful measurements while marking the claims they cannot support.
- Inspect the current Vue and Svelte plugins, map their hook and state edges, and identify candidate projects without selecting fixtures before profiling.
- Treat Vue and Svelte's cheap `resolveId` and ordinary `load` paths as valid overhead controls. If source and baseline profiles confirm that they contain no useful positive workload, select an additional real resolver or loader case instead of adding artificial work to these plugins.
- Screen current resolver and loader candidates by where their work actually runs. Keep Vite native resolution, Oxc, async filesystem waits, image native addons, and existing worker pools separate from JavaScript CPU rather than crediting all hook time to Node workers.
- Present the tradeoffs and a provisional recommendation for using Vite's Rolldown-powered production build for real-plugin evidence while using Rolldown directly for runtime overhead experiments.
- Present whole-plugin replication, a coordinator plus worker kernel, and a comparison of both as alternative real-plugin targets; make the selection at the framing review.
- Review this goal and architecture framing with Yunfei before writing a harness or adapter.

Phase 0 is source and design research only. Do not restore the prototype, write a harness, or run performance experiments before the review gate.

## Phase 1: runtime viability and current cost surface

- Reproduce the weak-callback failure and the separate worker-event-loop lifetime failure on pinned Rolldown revisions across the supported Node 20, 22, and 24 lines before choosing a restoration path.
- Use the smallest explicit lifecycle workaround only to make research possible; do not treat a keepalive timer or a successful first callback as a production lifecycle design.
- Establish behavior fixtures for hook order, missing hooks, plugin-context methods, metadata, diagnostics, shutdown, and worker failure before trusting timing results.
- Measure startup separately from steady state across worker counts, module counts, hook durations, payload sizes, and one or several parallel plugins.
- For `resolveId`, vary call volume, hit position in the ordered plugin chain, filesystem or package-resolution work, recursive `this.resolve`, and cache warmth.
- For `load`, vary virtual versus filesystem-backed modules, synchronous JavaScript CPU or I/O work, async I/O, returned payload size, and cache warmth. Record watch-file and invalidation semantics from source, but defer rebuild execution.
- For `transform`, vary source size, JavaScript CPU time, source-map and metadata output, and compiler cache behavior.
- Include one-worker mode to isolate off-main-thread value from multi-worker throughput.
- Capture queue wait, service time, total wall time, Node.js event-loop availability, CPU, and peak memory.
- Check whether Rust worker pools and Node.js workers compete for the same cores and whether fewer workers outperform the current cap.
- Keep a fresh process and first build separate from an independent run with warm operating-system and filesystem caches. Both create new workers; do not label the second run as worker reuse.

## Phase 2: pure JavaScript compiler bounds

- Run `@vue/compiler-sfc` and `svelte/compiler` over pinned, valid SFC corpora with identical outputs and errors in main-thread, one-worker, and multi-worker forms.
- Keep worker startup both included and excluded inside the isolated compiler experiment so the cold-task-set cost and steady-state compiler bound are visible without claiming cross-build worker reuse.
- Use this only to locate the possible crossover and upper bound; do not call it a plugin result.

## Phase 3: real plugin adaptation

- Admit loader adaptations only after unchanged profiles prove useful headroom. Prefer one lower-state JavaScript case such as `vite-svg-loader`; use high-volume `vite-plugin-svgr` only with Oxc time separated, and use `unplugin-icons` to test cache replication or affinity only if its own baseline qualifies.
- Give ordinary and worker variants the same declarative or coordinator-side hook filter. Report the filter-only change separately so skipping misses is not misattributed to worker execution.
- Start provisionally with the Svelte compile subplugin because its current task split provides a smaller semantic surface.
- Keep configuration, preprocessing integrations, HMR, and global coordination on the main side unless evidence shows they can move safely.
- Define how compiled CSS metadata, diagnostics, dependencies, and dynamic compile options cross the boundary.
- Adapt Vue next to test descriptor ownership, virtual submodule loads, plugin context use, and module-affine scheduling.
- Measure and document the plugin changes required by each adaptation, including duplicated logic, new state ownership, serialization rules, behavior fixtures, and maintenance obligations.
- Add production-build behavior fixtures before performance comparisons, including compiler errors, source maps, CSS, SSR or client mode, and custom preprocessors.
- Add targeted `resolveId` and `load` fixtures from the adapted plugins instead of assuming their cost is negligible beside compilation.
- Keep a real resolver or loader case separate if Vue and Svelte only provide negative controls, so a negative framework-plugin result is not generalized to every `resolveId` or `load` workload.
- Treat `@rollup/plugin-node-resolve` first as a coordinator, reentrancy, custom-option, and cache-lifecycle case. Promote a package-resolution worker kernel to a value experiment only after its baseline isolates material JavaScript CPU from async filesystem wait.
- Profile the low-state NativeScript platform resolver only after pairing it with a parity-checked Vite 8 project; compare early filtering, caching, and native extension resolution with workers. Admit the direct Rolldown Yarn PnP resolver only after finding a substantial independent consumer and retaining Rolldown's built-in PnP path as the baseline.

## Phase 4: real application builds

- Select projects only after a baseline profile shows that the target plugin consumes a material share of the build; popularity alone is not a selection criterion.
- Prefer pinned projects with many independently compilable SFCs, reproducible installs, successful Rolldown-powered builds, and outputs that can be compared.
- Include at least one project that represents a normal application shape; a generated flat import list may locate a crossover but cannot be the real-project result.
- Compare the ordinary plugin, one-worker isolation, and several worker counts on the same build.
- Report fresh-process and independent warm-cache production builds, plugin share, end-to-end speedup, main-thread availability, CPU, memory, and correctness together. Both lifecycle cases use newly created workers.
- Attribute improvements by hook so a total speedup cannot be incorrectly assigned to `transform` when resolution or loading changed.
- If no representative project has enough plugin cost to expose headroom, record that as a limit on the feature's practical value.

## Phase 5: optimize attributed costs

- Change only the cost shown to dominate by the previous phases: startup and reuse, dispatch and batching, worker selection, module affinity, shared metadata, cache replication, or CPU contention.
- Re-run the same pinned Vue and Svelte cases after each optimization and keep neutral or negative results.
- Finish with a scenario-based recommendation and a minimal plugin-authoring contract derived from the successful adaptations, or a recommendation not to productize the capability.

## Parallel defect track

- Keep a living inventory of correctness, lifecycle, compatibility, determinism, scheduling, observability, memory, and error-handling defects.
- Give every claimed defect a minimal reproduction, pinned source evidence, or an explicit `not yet reproduced` label.
- Test worker startup and shutdown, build failure, cancellation, worker crash, plugin initialization failure, nested `this.resolve` or `this.load`, and several parallel plugins sharing the pool. Keep repeated `generate` or `write` and watch rebuild execution in the deferred lifecycle backlog.
- Compare outputs, diagnostics, hook order, and plugin-visible state across worker counts and independent runs to catch races and worker-dependent behavior.
- Treat defects caused by the plugin-authoring contract separately from defects in Rolldown's runtime so the recommended fix lands at the right boundary.
- Require source-inferred deadlocks and lifecycle failures to gain a minimal reproduction before they are called observed defects; preserve the source reasoning if reproduction disproves or narrows it.
