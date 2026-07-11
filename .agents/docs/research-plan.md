# Research Plan

This is a live research sequence, not an implementation commitment. Replace it as evidence changes.

## Phase 0: framing and evidence baseline

- Verify the current implementation and history, including whether the worker lifecycle works on supported Node.js versions.
- Record which hooks, plugin context methods, metadata paths, options, and output plugins are supported rather than assuming the ordinary plugin contract carries over.
- Establish `resolveId`, `load`, and `transform` as separate performance workloads, with their own call counts, hit or miss distributions, state dependencies, and correctness checks.
- Start a technical defect inventory covering known current failures and defects discovered by source audit or reproduction; do not hide defects inside benchmark notes.
- Audit the old prototype and the unmerged native-bridge benchmark branch, preserving useful measurements while marking the claims they cannot support.
- Review this goal and architecture framing with Yunfei before writing a harness or adapter.

## Phase 1: current cost surface

- Reproduce the current implementation on pinned Rolldown and Node.js revisions before changing it.
- Measure startup separately from steady state across worker counts, module counts, hook durations, payload sizes, and one or several parallel plugins.
- For `resolveId`, vary call volume, hit position in the ordered plugin chain, filesystem or package-resolution work, recursive `this.resolve`, and cache warmth.
- For `load`, vary virtual versus filesystem-backed modules, synchronous JavaScript CPU or I/O work, async I/O, returned payload size, watch dependencies, and cache warmth.
- For `transform`, vary source size, JavaScript CPU time, source-map and metadata output, and compiler cache behavior.
- Include one-worker mode to isolate off-main-thread value from multi-worker throughput.
- Capture queue wait, service time, total wall time, Node.js event-loop availability, CPU, and peak memory.
- Check whether Rust worker pools and Node.js workers compete for the same cores and whether fewer workers outperform the current cap.

## Phase 2: pure JavaScript compiler bounds

- Run `@vue/compiler-sfc` and `svelte/compiler` over pinned, valid SFC corpora with identical outputs and errors in main-thread, one-worker, and multi-worker forms.
- Keep worker startup both included and excluded so cold builds and reused workers are visible.
- Use this only to locate the possible crossover and upper bound; do not call it a plugin result.

## Phase 3: real plugin adaptation

- Start provisionally with the Svelte compile subplugin because its current task split provides a smaller semantic surface.
- Keep configuration, preprocessing integrations, HMR, and global coordination on the main side unless evidence shows they can move safely.
- Define how compiled CSS metadata, diagnostics, dependencies, and dynamic compile options cross the boundary.
- Adapt Vue next to test descriptor ownership, virtual submodule loads, plugin context use, and module-affine scheduling.
- Add behavior fixtures before performance comparisons, including compiler errors, source maps, CSS, SSR or client mode, custom preprocessors, and repeated builds where applicable.
- Add targeted `resolveId` and `load` fixtures from the adapted plugins instead of assuming their cost is negligible beside compilation.

## Phase 4: real application builds

- Select projects only after a baseline profile shows that the target plugin consumes a material share of the build; popularity alone is not a selection criterion.
- Prefer pinned projects with many independently compilable SFCs, reproducible installs, successful Rolldown-powered builds, and outputs that can be compared.
- Compare the ordinary plugin, one-worker isolation, and several worker counts on the same build.
- Report cold build, warm reused-worker build, plugin share, end-to-end speedup, main-thread availability, CPU, memory, and correctness together.
- Attribute improvements by hook so a total speedup cannot be incorrectly assigned to `transform` when resolution or loading changed.
- If no representative project has enough plugin cost to expose headroom, record that as a limit on the feature's practical value.

## Phase 5: optimize attributed costs

- Change only the cost shown to dominate by the previous phases: startup and reuse, dispatch and batching, worker selection, module affinity, shared metadata, cache replication, or CPU contention.
- Re-run the same pinned Vue and Svelte cases after each optimization and keep neutral or negative results.
- Finish with a scenario-based recommendation and a minimal plugin-authoring contract derived from the successful adaptations, or a recommendation not to productize the capability.

## Parallel defect track

- Keep a living inventory of correctness, lifecycle, compatibility, determinism, scheduling, observability, memory, and error-handling defects.
- Give every claimed defect a minimal reproduction, pinned source evidence, or an explicit `not yet reproduced` label.
- Test worker startup and shutdown, build failure, cancellation, repeated `generate` or `write`, watch rebuild, worker crash, plugin initialization failure, nested `this.resolve` or `this.load`, and several parallel plugins sharing the pool.
- Compare outputs, diagnostics, hook order, and plugin-visible state across worker counts and repeated runs to catch races and worker-dependent behavior.
- Treat defects caused by the plugin-authoring contract separately from defects in Rolldown's runtime so the recommended fix lands at the right boundary.
