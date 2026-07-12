# Cloudflare Docs MDX Direct-Rolldown Experiment

This experiment adapts Cloudflare Docs' pinned production MDX transform chain to the direct Rolldown API. The original `astro build` remains a separate phase and behavior reference. Worker value is measured only by comparing the ordinary main-thread adapter with the otherwise identical ParallelPlugin adapter.

## Current result

Ten rotated local default-profile blocks over all 9,157 production MDX modules give a 63.089-second ordinary median, 26.779-second plugin-managed four-worker median, and 28.226-second Rolldown-managed four-worker median. The paired ordinary-to-Rolldown median is 2.178x with bootstrap 95% interval 2.129–2.369 and normalized output parity. The plugin-managed-to-Rolldown interval crosses parity. Host-policy and historical-provenance failures make this strong repeated local JavaScript-worker evidence, not clean formal confirmation or evidence of an incremental Rolldown-managed advantage. See the [full 2026-07-12 result](./2026-07-12-results.md).

All benchmark conclusions use processes launched on the local M3 Pro rather than a CI service. Direct artifacts record `RUN_LINK_CHECK=false`; the original Astro provenance additionally records `CI=null`, while the earlier kernel runner did not persist `CI`. The link-check profile exists only to demonstrate worker-local state loss and none of its timings are benchmark evidence.

## Current boundary

Pinned source analysis identifies 9,157 unique production content MDX modules under `src/content`: 6,719 docs, 1,449 partials, 988 changelog entries, and one compatibility-flags entry. The direct-Rolldown corpus contains exactly those paths. An instrumented local default-profile Astro build observed exactly 9,157 handler calls over 9,157 distinct IDs, all successful, and its sorted ID set exactly matches the selected corpus. Two other repository MDX files are not selected by production content loaders and remain excluded. The instrumented run is coverage evidence, not benchmark evidence.

The kernel case passes every selected MDX file as a real Rolldown entry, runs the initialized `@mdx-js/rollup` and `@astrojs/mdx-postprocess` chain, and externalizes every import emitted by MDX. It therefore measures real source, compiler, project remark/rehype, Starlight, Expressive Code, Astro postprocess, Rolldown parse, and Rolldown generation work. It is an upper-bound kernel case, not the full Cloudflare application graph or a replacement for static route generation. The separate graph adapter maps `~/*`, retains experiment-resolved project-local server edges, handles Astro modules, and fails a local miss under its declared boundary.

The kernel invokes the initialized compiler `transform` and `buildEnd` hooks but does not delegate the compiler plugin's `resolveId`; blanket import externalization hides that omission. The completed graph adapter resolves every project-local edge through its independent strict server-graph resolver and fails any local miss, but it still does not exercise the compiler plugin's own `this.resolve` context. Exact resolver-context parity therefore remains outside this transform-stage claim even though local graph reachability is proven.

The adapter does not execute a Vite build or use Vite to load `astro.config.ts`. It registers the pinned project's `tsx` loader plus a tiny loader for Starlight's `.jsonc?raw` themes, imports the config directly, runs Astro's validation and integration setup hooks, and extracts the configured MDX plugins. Astro's integration implementation still imports Vite utilities transitively; that dependency import is included in initialization cost, but no Vite builder or Vite module graph runs.

## MDX/server graph case

The independent graph runner preserves every project-local server edge emitted by the selected MDX modules: `~/*`, relative paths, `src/*` base-URL paths, JS/TS/TSX/JSON, raw imports, assets, and Astro components. Astro components are compiled with the pinned standalone `@astrojs/compiler`; their server imports remain internal. Local CSS and asset imports become explicit internal leaf modules. An unresolved project-local edge fails the build. Only Astro runtime imports, Node.js built-ins, and bare package imports are external.

The graph boundary excludes Astro's CSS virtual-module graph, CSS dependency traversal, hoisted and client scripts, hydration and client inputs, route rendering, final asset emission, and the production MDX plugin's own `resolveId` context. The result counts the Astro exclusions from standalone compiler metadata, including CSS blocks and bytes, client script kinds and bytes, local client edges, and hydration components. The smoke compares the ordinary plugin, a plugin-owned managed worker pool, and ParallelPlugin. Graph hashes, boundary hashes, and narrowly normalized generated-output hashes must match. Raw generated-output differences are localized to the recorded multipart-boundary nondeterminism. Raw per-module code hashes are retained but were neither normalized nor diff-localized, so module-code parity is not claimed. Ordinary and the plugin-owned pool must retain `meta.astro`; current ParallelPlugin loses it and records that semantic defect separately from graph and normalized-output parity.

Graph output records both raw bytes/hash and a correctness-only normalized bytes/hash. The normalizer runs only on output files whose source MDX contains an actual `playground` fence, decodes generated Workers Playground URLs, replaces only Undici's random multipart boundary, and re-encodes the URL. Raw differences remain in the result; formal cross-variant output parity uses the normalized hash. This does not normalize other output or hide unrelated nondeterminism.

This graph profile always uses `RUN_LINK_CHECK=false`, and every result records that fact. A separate local semantic probe enables the link validator because its rehype plugin writes a `globalThis` Map. ParallelPlugin workers each mutate an isolate-local Map that is not merged into the coordinator. This is a current semantic defect, not an omitted performance detail; correct behavior requires an explicit coordinator or reduction protocol. Timings from that probe are discarded.

The graph runner defaults to `instrumentation:false`, and the full wall profile requires it. JavaScript counters and Rolldown worker metrics are intentionally absent from those wall samples. Managed worker instrumentation is not implemented and is rejected rather than silently changing the comparison.

Run the checked five-entry ordinary/managed-2/worker-2 smoke:

```bash
node experiments/cloudflare-mdx/run-graph-smoke.mjs experiments/cloudflare-mdx/graph-smoke-config.json experiments/cloudflare-mdx/data/2026-07-12-graph-smoke.raw.json
```

The completed one-shot 9,157-entry graph result is `data/2026-07-12-graph-full-scan.raw.json`. It reaches 11,105 server-side modules, 26,357 static edges, and zero unresolved local edges, with graph, boundary, and normalized-output parity. Raw generated-output differences are localized to the recorded multipart boundary; raw module-code hashes also differ, but their cause was not diff-localized and no module-code parity claim is made. ParallelPlugin loses MDX metadata. Its timing is a single sample and is not a performance conclusion.

The first local five-block attempt was interrupted during the fourth block when the already swap-heavy host entered severe memory thrashing. No partial timing report was written, and the abort record is explicitly benchmark-ineligible. Re-run only after restarting the local host.

Run the local-only five-block graph matrix with the pinned Node binary. The runner refuses active CI markers, rotates the three variants, waits 15 seconds between processes, records host page and swap counters, and reports host-policy violations instead of hiding them:

```bash
node experiments/cloudflare-mdx/run-graph-matrix.mjs \
  experiments/cloudflare-mdx/graph-formal-matrix.json \
  experiments/cloudflare-mdx/data/graph-local.raw.json
node experiments/cloudflare-mdx/summarize-graph-matrix.mjs \
  experiments/cloudflare-mdx/data/graph-local.raw.json \
  experiments/cloudflare-mdx/data/graph-local.summary.json
```

## Pins

- Cloudflare Docs: `2b08a67a41da1a521aecbcf465893abae1e9a6df`.
- Node.js: `v24.18.0`.
- Rolldown research runtime: `research/parallel-js-plugin-core-transform` at `0aa600b5721b852cdc4095c7122a929a8cb4a798`.
- Binding SHA-256: `deec0b2cb7a12e507ff223e12535c3280ab5fe8371f2fcc92f9db206163f1c5d`.
- The runtime contains research-only worker keepalive, initialization cleanup, worker-count control, and transform instrumentation. It is not unchanged Rolldown main.

## Commands

Install the candidate's frozen dependencies in its isolated worktree, then restore any package-manager metadata written by the installer before recording provenance. Run all samples with the pinned Node binary and a clean candidate tree.

Generate the immutable corpus and runtime manifest:

```bash
node experiments/cloudflare-mdx/prepare-manifest.mjs \
  /Users/yunfeihe/Documents/github-opensource/.worktrees/cloudflare-docs-rolldown-build \
  /Users/yunfeihe/Documents/github-opensource/.worktrees/rolldown-parallel-js-plugin-core-transform/packages/rolldown
```

Run one ordinary full-corpus process:

```bash
node --expose-gc experiments/cloudflare-mdx/run-case.mjs '{"projectRoot":"/Users/yunfeihe/Documents/github-opensource/.worktrees/cloudflare-docs-rolldown-build","rolldownPackageRoot":"/Users/yunfeihe/Documents/github-opensource/.worktrees/rolldown-parallel-js-plugin-core-transform/packages/rolldown","variant":"ordinary","corpus":"production-mdx","limit":0,"instrumentation":false}'
```

Run a four-worker process:

```bash
ROLLDOWN_PARALLEL_PLUGIN_WORKERS=4 node --expose-gc experiments/cloudflare-mdx/run-case.mjs '{"projectRoot":"/Users/yunfeihe/Documents/github-opensource/.worktrees/cloudflare-docs-rolldown-build","rolldownPackageRoot":"/Users/yunfeihe/Documents/github-opensource/.worktrees/rolldown-parallel-js-plugin-core-transform/packages/rolldown","variant":"worker-4","corpus":"production-mdx","limit":0,"instrumentation":false}'
```

Run the checked smoke matrix and write a raw artifact:

```bash
node experiments/cloudflare-mdx/run-matrix.mjs experiments/cloudflare-mdx/smoke-matrix.json experiments/cloudflare-mdx/data/smoke.raw.json
```

Reproduce the original Astro MDX handler count only after verifying that `node_modules/@astrojs/mdx/dist/vite-plugin-mdx.js` has SHA-256 `35c1e5496f3ea29671bdad54e607aec07280e3fcf5cd4a162e52484d32f2e932`. Apply `astro-mdx-counter.patch` to that installed file, run `run-astro-reference.mjs <candidate-root> <empty-output-dir> default mdx-counter`, then reverse the patch and verify the original hash again. The runner accepts only the recorded original or instrumented hash and marks the counter run ineligible for benchmark conclusions.

`run-case.mjs` deletes `ASTRO_PERFORMANCE_BENCHMARK`, `BUILD_TARGET`, and `RUN_LINK_CHECK`, sets `NODE_ENV=production`, changes cwd before workers start, and uses the candidate's own pinned dependencies. It does not record or clear `CI`; the recorded ten-block matrix was launched locally, and the newer graph matrix runner explicitly refuses active CI markers. Uninstrumented wall runs leave both JavaScript and Rust metrics disabled. Instrumented runs set `instrumentation: true`; the matrix enables Rust metrics only for worker variants.

## Reproducibility limitations

The retained raw artifacts preserve source and runtime pins, commands, sample outputs, host snapshots, and the measurements used by this report, so the numerical summaries can be reconstructed. They do not permit an exact historical replay. The two original Astro provenance records hash earlier `run-astro-reference.mjs` sources as `9fa454b4ed4753b908726609b8180dca1510856226ea9ef8e3c7094e2758fa4b` and `1889f085e8ff4331732d2cd4bad88d55d4712acbec1483051ea719a1c671eefe`, but those exact sources were not retained. The ten-block kernel inputs do not record a runner hash, the parent CI-marker values, or `executionScope`. Current local matrix runners refuse active CI markers, record `executionScope: local-only`, capture their own source hash and effective environment, and summaries become benchmark-ineligible when provenance or host policy fails. A restarted quiet-host rerun with the final committed scripts is required for clean-host formal confirmation.

The adapter fixes `Date` at `2026-07-12T00:00:00.000Z` in every ordinary or worker isolate. Cloudflare's GraphQL Expressive Code plugin otherwise embeds the current date or time into generated links, so sequential ordinary and worker runs would differ even when execution semantics match. This normalization changes only that pre-existing time-dependent input and is identical across variants.

## Correctness gates

- The selected entry count must equal the instrumented JavaScript handler count.
- Ordinary and every worker count must emit the same chunk count, narrowly normalized bytes, and narrowly normalized SHA-256 from the same checkout path and prerender environment. Raw bytes and hashes remain recorded and differ only where the source-gated Undici multipart boundary is present.
- Graph hash, graph boundary, normalized output, and explicit omission counts must match across variants. Raw module-code and raw output parity are not claimed. The production compiler map is null, so this case makes no non-null map or source-map-chain claim.
- The graph runner directly observes `meta.astro` falling from 9,157 modules in ordinary and plugin-managed execution to zero under current ParallelPlugin. `meta.vite` travels through the same returned `meta` object but was not counted independently. This semantic defect blocks a production-behavior claim even when normalized output matches.
- Every worker count must match the requested lifecycle count and finish with no queued, outstanding, or in-flight calls.
- Formal diagnostics must compare a real invalid MDX input and retain the known ordinary-versus-worker attribution difference rather than hiding it.
- The completed graph case gates project-local module reachability, allowed externals, metadata coverage, normalized output, and its explicit boundary. Production `resolveId`, metadata consumption, diagnostics, and full lifecycle behavior remain outside that adapter.

## Interpretation

The uninstrumented local default-profile Astro reference completed in 689.01 seconds wall time and Astro reported 8,650 pages in 11m25s: 11.77 seconds of content and build-info setup, 4m40s for the server Vite/Rollup build, 12.21 seconds for the client build, 6m17s for static routes, and 495 ms for cached image output. Exact transfer of the direct-Rolldown kernel's 34.86-second median saving would illustrate only about a 5% reduction; it is not an integrated speedup or upper bound. The untouched 377-second static-route phase alone exceeds half of the reference build. Cloudflare supplies strong repeated local evidence for a greater-than-2x JavaScript transform-stage opportunity but cannot support a 2x complete-build claim under this adapter boundary.
