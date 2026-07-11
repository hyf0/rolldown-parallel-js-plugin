# `resolveId` and `load` Candidate Survey

Snapshot date: 2026-07-11. This is a source-only candidate screen, not benchmark evidence. It was completed before runtime hook work and kept `resolveId` and `load` behind the direct-Rolldown transform and Vue sequence. The later [controlled hook result](../experiments/resolve-load/2026-07-11/README.md) now establishes the CPU, cheap, serial, filesystem, async, payload, filter, state, and reentrancy mechanisms; this survey connects those mechanisms to possible real plugins without promoting a Vite-dependent case into the Rolldown-only fixture scope.

## Selection rules

A positive value case should satisfy all of the following before adaptation work begins:

- The material work still executes as JavaScript in a Node.js isolate. A hook that mainly awaits native resolution, libuv filesystem work, a native addon, or Rust is not evidence for JavaScript-worker throughput.
- The real build exposes enough independent reached calls to occupy more than one worker. Repository file counts and import counts only nominate a project; the later trace must report reached calls and runnable concurrency.
- Per-call useful work can plausibly repay worker selection, Node-API conversion, result copying, worker-local initialization, and cache duplication.
- The plugin has a correctness oracle and a bounded adaptation path. A benchmark-only rewrite that removes state, diagnostics, ordering, watch behavior, or plugin-context interactions is a different plugin.
- The plugin and project are current enough to represent a decision Rolldown users still face. A JavaScript plugin superseded by a native Vite or Rolldown feature can remain an overhead or historical control but should not be the flagship value case.
- The project already uses the plugin and the expensive option being studied. Adding a plugin, enabling an unused compiler mode, or inserting artificial delay would measure a constructed workload rather than the plugin's current value.
- The unchanged baseline gives the hook enough share for even ideal parallelism to produce a decision-relevant end-to-end gain. The study should state that Amdahl-style upper bound before paying the cost of an adaptation.

Candidates have three distinct roles:

- A **value candidate** has plausible JavaScript CPU headroom and a real project with sufficient call volume.
- An **overhead control** contains little useful work and should expose dispatch, filtering, initialization, or result-copy cost.
- A **contract stress case** is selected because state, reentrancy, hook ordering, or lifecycle behavior can reveal defects even if wall time does not improve.

## Current shortlist

| Hook | Candidate | Role | Source-only expectation |
| --- | --- | --- | --- |
| `load` | `vite-plugin-svgr` on ZenML Dashboard | High-volume CPU-bearing candidate to profile, with a mixed native stage | Per-file SVGR and Babel work is synchronous JavaScript CPU, followed on Vite 8 by a synchronous Oxc call into Rust. Attribution must keep those stages separate. |
| `load` | `vite-svg-loader` on `vue-pure-admin` | Lower-state Vue CPU-bearing candidate to profile | Per-file SVGO and Vue template compilation are synchronous JavaScript CPU after an async file read; the plugin has little cross-file state. |
| `load` | `unplugin-icons` on `vue-pure-admin` | Cache-cost and CPU-bearing candidate to profile | Many loads generate Vue render code, while raw icon loads form a cheaper control. Independent worker isolates duplicate Iconify collection caches and Vue compiler initialization. |
| `resolveId` | NativeScript platform-file resolver | Synchronous-filesystem candidate to profile | It performs a small bounded set of synchronous platform-file probes per relative import with little plugin state; RPC, filtering, caching, or native resolution may be better than workers. |
| `resolveId` | `@gjsify/rolldown-plugin-pnp` | Direct-Rolldown synchronous resolver candidate awaiting a real corpus | Yarn PnP performs substantial synchronous JavaScript and virtual-filesystem resolution, but every worker would duplicate its dependency graph and caches. |
| `resolveId` | `@rollup/plugin-node-resolve` on a direct Rolldown build | Contract stress case; value remains unproven | It has high call volume and nontrivial JavaScript resolution logic, but much of the cold path is asynchronous filesystem work and its shared caches plus recursive `this.resolve` make naive replication unsafe. |
| `resolveId` | Vue, Svelte, alias, and icon ID mappings | Overhead controls | These hooks mainly recognize or normalize an ID and should normally lose to worker dispatch unless a native filter avoids the callback entirely. |

No current `resolveId` plugin passed the screen as a clean flagship value case. That remains a valid result: modern Vite resolution has moved into Rolldown, while several remaining JavaScript resolvers are either I/O-heavy, stateful, recursively call the plugin driver, or are being replaced by native resolution. The completed controlled cost surface and semantics probes therefore establish a bounded resolver-kernel conclusion without manufacturing expensive work inside a production plugin to force a real-plugin win.

## `load` profile candidate: `vite-plugin-svgr`

Pinned sources:

- `vite-plugin-svgr` `5.2.0` at [`8ff69f4a228b86c8f4d141d31f371fa1e105644d`](https://github.com/pd4d10/vite-plugin-svgr/tree/8ff69f4a228b86c8f4d141d31f371fa1e105644d).
- ZenML Dashboard at [`0e5afda6b62c815103cfdeb3bb9493d2f95488ae`](https://github.com/zenml-io/zenml-dashboard/tree/0e5afda6b62c815103cfdeb3bb9493d2f95488ae), pinned to Vite `8.0.16` and `vite-plugin-svgr` `5.2.0` in its lockfile.
- SVGR at [`975215efe85805cecafc920c103a827d864d2580`](https://github.com/gregberge/svgr/tree/975215efe85805cecafc920c103a827d864d2580), the current source snapshot used to classify its JavaScript compiler path.

ZenML uses the plugin's default configuration. The pinned source contains 414 active `?react` import sites in 252 source files, resolving to 117 distinct tracked SVG modules with 230,803 input bytes. Those are source-reachability candidates rather than observed build calls, but they provide the largest current load-hook corpus found in this survey. [Project configuration](https://github.com/zenml-io/zenml-dashboard/blob/0e5afda6b62c815103cfdeb3bb9493d2f95488ae/vite.config.ts#L1-L16) [Project versions](https://github.com/zenml-io/zenml-dashboard/blob/0e5afda6b62c815103cfdeb3bb9493d2f95488ae/package.json#L63-L95)

Each matching `load` does three separable kinds of work:

1. It asynchronously reads the SVG.
2. SVGR parses the SVG, creates and transforms a Babel AST, and generates JSX. `@svgr/plugin-jsx` ultimately runs Babel's synchronous `transformFromAstSync`, so this stage contains real main-thread JavaScript CPU in the ordinary plugin. [Plugin hook](https://github.com/pd4d10/vite-plugin-svgr/blob/8ff69f4a228b86c8f4d141d31f371fa1e105644d/src/index.ts#L20-L76) [SVGR JSX plugin](https://github.com/gregberge/svgr/blob/975215efe85805cecafc920c103a827d864d2580/packages/plugin-jsx/src/index.ts#L38-L87)
3. When `this.meta.rolldownVersion` is present, the plugin calls Vite's `transformWithOxc`. The project's pinned Vite `8.0.16` implements that async-looking wrapper with synchronous `transformSync` in Rolldown's native utilities. Worker concurrency can therefore parallelize some synchronous Rust/Oxc work too; that time must not be reported as JavaScript-worker acceleration. [Vite Oxc wrapper](https://github.com/vitejs/vite/blob/f94df87ff03b40b65e29bacdc04cc18c7bccaa4a/packages/vite/src/node/plugins/oxc.ts#L120-L158)

The plugin has little application-level shared state and returns code with `map: null`. Its only hook-context dependency is `this.meta.rolldownVersion`, which selects Oxc rather than the older esbuild path. Correct worker metadata is therefore part of output and backend parity, not only instrumentation. It does not recursively call the plugin driver, emit files, or maintain output state.

The case still needs an explicit adaptation boundary:

- `enforce: 'pre'` is a Vite plugin-level classification, not a Rolldown object-hook `order`. The current parallel marker exposes only `_parallel`, so Vite cannot classify it as a pre plugin. A Vite-visible metadata shell must preserve the original position before the built-in asset plugin; otherwise the asset loader can claim `?react` SVG IDs first. Current ParallelPlugin's separate failure to forward Rolldown hook metadata still needs fixing for plugins that declare object-hook order. [Parallel marker](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/packages/rolldown/src/plugin/parallel-plugin.ts) [Vite 8.0.16 plugin order](https://github.com/vitejs/vite/blob/f94df87ff03b40b65e29bacdc04cc18c7bccaa4a/packages/vite/src/node/plugins/index.ts#L56-L121)
- `createFilter` runs inside a plain function hook. Every nonmatching module can be dispatched to a worker before that check unless an equivalent native filter or coordinator prefilter is added to both variants.
- A worker permit is held across the file read, dynamic compiler imports, possible runtime SVGR config search, JavaScript compilation, and Oxc. Whole-hook routing and a coordinator-read plus worker-kernel form have different I/O concurrency and transfer costs.
- Default ZenML options are plain data, but general SVGR configuration supports custom templates, plugin functions, and Babel plugins that cannot be structured-cloned. [SVGR configuration](https://github.com/gregberge/svgr/blob/975215efe85805cecafc920c103a827d864d2580/packages/core/src/config.ts#L9-L49)
- SVGR's default runtime configuration lookup and compiler module caches are per isolate. Current evidence must report cold worker initialization, duplicated config search, and Babel module memory. Persistent-worker reuse remains a deferred lifecycle question.

This is the strongest high-volume hypothesis, not automatically the first implementation. Its unchanged baseline must split read wait, SVGR/Babel JavaScript CPU, Oxc native CPU, returned bytes, and critical-path share. If the JavaScript share alone has no useful end-to-end upper bound, it should not be promoted merely because the combined JS-plus-Oxc hook is expensive.

## `load` profile candidate: `vite-svg-loader`

Pinned sources:

- `vite-svg-loader` `5.1.1` at [`b6b5e73b102b5bc5a629967ee7fd1f872f9a68b6`](https://github.com/jpkleemans/vite-svg-loader/tree/b6b5e73b102b5bc5a629967ee7fd1f872f9a68b6).
- `vue-pure-admin` at [`2ad835b1093572edebc24750b4e66f4dac592c9f`](https://github.com/pure-admin/vue-pure-admin/tree/2ad835b1093572edebc24750b4e66f4dac592c9f), pinned to Vite `8.0.10` and `vite-svg-loader` `5.1.1` in its lockfile.

The loader's dependency resolves to SVGO `3.3.3` and the app resolves Vue compiler-sfc `3.5.38`. The app's separate SVGO `4.0.1` dependency serves an explicit asset-cleanup script and is not the compiler used by the Vite loader build; those versions must not be conflated. [Candidate lockfile](https://github.com/pure-admin/vue-pure-admin/blob/2ad835b1093572edebc24750b4e66f4dac592c9f/pnpm-lock.yaml)

The plugin has one `load` hook with `enforce: 'pre'`. For a component SVG it asynchronously reads the source, synchronously runs SVGO unless disabled, rewrites style tags, synchronously calls Vue `compileTemplate`, and returns generated JavaScript. [Hook source](https://github.com/jpkleemans/vite-svg-loader/blob/b6b5e73b102b5bc5a629967ee7fd1f872f9a68b6/index.js#L18-L62)

This is comparatively close to a whole-plugin worker candidate, but it is not an unchanged drop-in for the current API:

- The app passes no function-valued options, and the hook has no cross-file closure state, plugin-context calls, or output-phase reduction.
- The synchronous SVGO and Vue compiler calls happen after the file read and remain on the calling JavaScript thread. Declaring the hook `async` does not move that CPU work off the main thread.
- The hook returns generated JavaScript without a source map or metadata. Returned bytes still need measurement, but this avoids two large transport dimensions in the first loader case.
- `enforce: 'pre'` is observable Vite plugin-level behavior rather than Rolldown object-hook order. Vite 8.0.10 places pre user plugins before its asset plugin and normal user plugins after it. Because the current marker contains only `_parallel`, a direct replacement becomes normal; Vite's asset hook can then turn `.svg?component` into a URL module before the worker loader runs. The experiment therefore needs a Vite-visible metadata shell that preserves `enforce` and the original position. [Vite plugin order](https://github.com/vitejs/vite/blob/32c29780404c353f5a7c5ba4d06fc5e676741714/packages/vite/src/node/plugins/index.ts#L75-L121) [Asset load filter](https://github.com/vitejs/vite/blob/32c29780404c353f5a7c5ba4d06fc5e676741714/packages/vite/src/node/plugins/asset.ts#L188-L219)
- The source declares a plain `load` method rather than a native hook filter, so every module can reach JavaScript before the regular expression rejects it. Dispatching all of those misses to workers may erase the hit-path gain. If the adaptation adds an equivalent native filter, the ordinary baseline must receive the same filter and its standalone effect must be reported.
- A worker permit remains occupied while `fs.promises.readFile` is pending. Ordinary async hooks can have more reads in flight than the worker count, while all workers share the process's libuv filesystem pool. The measurement must pin and report `UV_THREADPOOL_SIZE`. A coordinator-read plus worker-kernel design could preserve read concurrency but is a different runtime or API model, not a free variant expressible by the current whole-plugin marker.
- `vite-svg-loader` imports `vue/compiler-sfc` and SVGO at module initialization, so every worker loads and initializes both before its first call. The main thread still needs Vue's compiler for `@vitejs/plugin-vue`; worker copies are additional CPU and RSS, not relocated existing initialization. Default project options are cloneable, but SVGO also permits custom plugin `fn` implementations, so the successful default case would not cover the complete ordinary configuration surface. [SVGO custom plugins](https://github.com/svg/svgo/blob/bbab162534d89654ac51c30dd6e62d7163b48a5e/lib/svgo.js#L27-L45)

The pinned app contains 59 active source-level `?component` import sites resolving to 46 distinct tracked SVG modules with 64,004 input bytes. The size distribution is highly skewed: 39 of 46 inputs are smaller than 1 KiB, 42 are smaller than 2 KiB, and the four largest account for 42,016 bytes. Those counts do not prove that every module is reached by the production entry graph or ready concurrently; several large files sit behind lazy views. The later baseline must isolate `vite build` from the repository's post-build version-generation script and record reached calls, input sizes, SVGO time, Vue compile time, read time, returned bytes, and ready-call concurrency.

This case can answer whether a mostly stateless, CPU-bearing `load` hook crosses the worker threshold. It cannot by itself answer whether cache-heavy or virtual-module loaders remain beneficial.

## `load` cache-cost profile candidate: `unplugin-icons`

Pinned sources:

- `unplugin-icons` `23.0.1` at [`0bbf1cfdb1812a711d3e8b77268b16dab1272ee5`](https://github.com/unplugin/unplugin-icons/tree/0bbf1cfdb1812a711d3e8b77268b16dab1272ee5).
- `@iconify/utils` `3.1.3` at [`14e346a69699414d8df9169dd2e1e6ce1c4082f5`](https://github.com/iconify/iconify/tree/14e346a69699414d8df9169dd2e1e6ce1c4082f5/packages/utils), matching the candidate project's lockfile.
- The same pinned `vue-pure-admin` project configures `unplugin-icons` `23.0.1` with the Vue 3 compiler and scalar options.

The plugin's `resolveId` only normalizes virtual icon IDs and is an overhead control. Its matching `load` calls `generateComponentFromPath`, loads and customizes an SVG through Iconify, then invokes the selected framework compiler. The Vue 3 compiler dynamically imports `@vue/compiler-sfc` and calls `compileTemplate` for every non-raw icon. [Plugin hooks](https://github.com/unplugin/unplugin-icons/blob/0bbf1cfdb1812a711d3e8b77268b16dab1272ee5/src/index.ts#L7-L62) [Loader](https://github.com/unplugin/unplugin-icons/blob/0bbf1cfdb1812a711d3e8b77268b16dab1272ee5/src/core/loader.ts#L56-L116) [Vue compiler](https://github.com/unplugin/unplugin-icons/blob/0bbf1cfdb1812a711d3e8b77268b16dab1272ee5/src/core/compilers/vue3.ts)

The pinned app has 173 active icon import sites and 108 distinct textual icon specifiers across four collections: 76 Remix Icon, 29 Element Plus, two Bootstrap Icons, and one Lucide icon. Thirty-five distinct specifiers use `?raw`; the remaining 73 request Vue components. This supplies a useful within-project contrast: raw loads still traverse icon lookup, customization, and SVG generation but skip the framework compiler, while the first access to each worker-local collection can also load and parse its JSON. The later trace must confirm reached and deduplicated module counts rather than treating these static counts as hook counts.

This candidate exposes costs that the stateless SVG loader does not:

- `@iconify/utils` caches a promise for each collection under each current working directory in module-global state. Every worker isolate owns a separate cache. Availability-based routing can cause every worker to read and parse the same collection JSON, multiplying cold work and retained memory. [Collection cache](https://github.com/iconify/iconify/blob/14e346a69699414d8df9169dd2e1e6ce1c4082f5/packages/utils/src/loader/fs.ts#L8-L42)
- Every worker separately imports, initializes, and JITs the Vue compiler. A cold-build regression is expected evidence, not noise to remove from the result; whether cross-build worker reuse changes it is deferred.
- Routing icons from one collection to the same worker could reduce cache replication but may create load imbalance because this app's collection distribution is highly skewed. Affinity, cache ownership, and scheduling therefore need separate attribution.
- The app's raw scalar options are structured-cloneable, but the plugin also supports function-valued custom collections, icon customizers, transforms, and custom compilers. A successful default configuration must not be generalized to those authoring modes.
- The source uses Unplugin's function-valued `loadInclude` precheck and `enforce: 'pre'`. In the pinned Unplugin `2.3.11` Rolldown adapter, `loadInclude` is wrapped around the JavaScript handler rather than converted to a native Rolldown hook filter. A worker form that leaves this unchanged can dispatch every module only to reject most of them inside the worker. If the adaptation adds an equivalent native ID filter, the ordinary baseline needs the same filter and the filter-only delta must remain separate from worker value. [Unplugin adapter](https://github.com/unjs/unplugin/blob/b84b899dcdae23c36c8770c0cdb682a0109d47ef/src/rollup/index.ts#L37-L57)
- Moving the cheap `resolveId` together with the expensive `load` would add worker traffic without useful CPU. The likely boundary keeps ID normalization on the coordinator and exposes only a filtered load-generation kernel to workers; that authoring change is part of the result.

This should follow the lower-state SVG loader because it introduces additional explanations for either a gain or a regression. The first result does not decide this one: the icon case has more source-level calls and may have greater total headroom, while its cache replication and initialization may also dominate. Its baseline profile must decide admission independently.

## Common loader integration prerequisites

Converting a function check into a Rolldown object-hook filter is necessary but not sufficient in the retained runtime. `ParallelJsPlugin::load` currently acquires a worker permit before calling the selected `JsPlugin`; that selected instance applies its native filter afterward. A miss can therefore avoid a Node callback yet still queue for and briefly occupy the shared worker pool, delaying real hits. The wrapper or coordinator needs filter data before permit acquisition if miss traffic is to disappear from worker scheduling. [Permit acquisition](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/crates/rolldown_binding/src/options/plugin/parallel_js_plugin.rs#L116-L131) [Instance filter](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/crates/rolldown_binding/src/options/plugin/js_plugin.rs#L205-L231)

The ordinary and parallel variants must receive the same early filter, and a filter-only ordinary run must report how much work disappears without workers. Vite integration must separately retain plugin-level `enforce` and position. These are semantic and routing prerequisites, not optional tuning discovered after a timing win.

Initial attribution should move only one loader at a time. `vue-pure-admin` also uses `@vitejs/plugin-vue` and `unplugin-icons`, all of which load Vue compiler code; parallelizing several together would mix compiler initialization, pool contention, and cache ownership before the first case is understood.

## Provisional `resolveId` profile candidates

### NativeScript platform-file resolution

NativeScript's current Vite 8 work is pinned to [`f6156ed41e1fdffcd741463d1be8399fb7c3b6af`](https://github.com/NativeScript/NativeScript/tree/f6156ed41e1fdffcd741463d1be8399fb7c3b6af), package version `8.0.0-alpha.65` on its Vite-improvements branch. Its `vite:nativescript` pre resolver ignores bare IDs and entries without an importer, then tries `.ts` and `.js`; for each extension, the platform-file utility synchronously probes a platform-specific file, a platform-specific index, and the ordinary file. A miss therefore performs at most six `existsSync` checks, returns only a path or null, does not recurse into the plugin driver, and has little closure state beyond the selected platform. [Resolver](https://github.com/NativeScript/NativeScript/blob/f6156ed41e1fdffcd741463d1be8399fb7c3b6af/packages/vite/helpers/resolver.ts#L16-L44) [Platform probes](https://github.com/NativeScript/NativeScript/blob/f6156ed41e1fdffcd741463d1be8399fb7c3b6af/packages/vite/helpers/utils.ts#L40-L57)

This is a fair test of synchronous filesystem blocking but not a source-proven speed case. Two to six hot page-cache probes may cost less than one worker round trip, all imports currently reach the function hook, and the same Vite configuration already gives the native resolver platform-prioritized extensions. The comparison must include an early hook filter, a result or miss cache, and native resolution rather than assuming workers are the best optimization. [Native extension configuration](https://github.com/NativeScript/NativeScript/blob/f6156ed41e1fdffcd741463d1be8399fb7c3b6af/packages/vite/configuration/base.ts#L148-L165)

[`faktenforum/correctiv-app@d3571cc94afba61c4016d719c40218f0b0d7c8bd`](https://github.com/faktenforum/correctiv-app/tree/d3571cc94afba61c4016d719c40218f0b0d7c8bd) is a real NativeScript 9 and Vue 3 application with about 302 source-level relative specifiers across 86 TypeScript, Vue, and JavaScript files. It currently locks `@nativescript/vite` `2.0.3` and Vite 7, so it nominates the workload shape but cannot be paired silently with the Vite 8 branch. A parity-checked upgrade or a current branch fixture is required before baseline profiling. [Project Vite configuration](https://github.com/faktenforum/correctiv-app/blob/d3571cc94afba61c4016d719c40218f0b0d7c8bd/vite.config.ts#L1-L14)

The same NativeScript branch contains two useful cache counterexamples. Its package-platform resolver synchronously finds and parses package metadata on first use and then caches by package; worker replication can repeat that cold work. Its tsconfig-path resolver records thousands of calls and roughly a dozen filesystem probes on a cold alias hit, then uses no-match and filesystem caches. These paths are useful for comparing throughput with cache affinity, but they are not the low-state first case. [Package resolver](https://github.com/NativeScript/NativeScript/blob/f6156ed41e1fdffcd741463d1be8399fb7c3b6af/packages/vite/helpers/package-platform-aliases.ts#L10-L68) [Tsconfig-path resolver](https://github.com/NativeScript/NativeScript/blob/f6156ed41e1fdffcd741463d1be8399fb7c3b6af/packages/vite/helpers/ts-config-paths.ts#L240-L344)

### Yarn PnP resolution for direct Rolldown

[`@gjsify/rolldown-plugin-pnp` `0.17.0`](https://github.com/gjsify/gjsify/tree/67f01e6b58260ec7420f2a8c4c58aa2fa38549de/packages/infra/rolldown-plugin-pnp) is directly aimed at Rolldown. Its pre `resolveId` quickly rejects relative and absolute IDs, then synchronously calls Yarn's `pnpApi.resolveRequest` for bare imports. Yarn PnP resolution performs package-graph lookup, fallback and exports handling, path operations, and synchronous fake-filesystem probes; this is materially different from an async filesystem wrapper. [Plugin hook](https://github.com/gjsify/gjsify/blob/67f01e6b58260ec7420f2a8c4c58aa2fa38549de/packages/infra/rolldown-plugin-pnp/src/index.ts#L73-L180) [Yarn resolution](https://github.com/yarnpkg/berry/blob/0a230c14e71247576f6b51fa811ae08edb6608aa/packages/yarnpkg-pnp/sources/loader/makeApi.ts#L551-L934)

The same mechanism makes worker replication costly: the PnP runtime contains dependency-graph maps, fake and zip filesystem state, and caches that cannot be structured-cloned and would be rebuilt in each isolate. Its `node:` path also recursively calls `this.resolve`, so current reentrancy defects apply. Rolldown already has built-in PnP support, and the plugin mainly adds gjsify relay and polyfill semantics. Only the plugin's own fixture was found, not a large independent consumer, so it remains a direct-Rolldown mechanism candidate until a real project and a native baseline exist.

### Deprecated synchronous-resolution upper bound

Nx's current [`nxViteTsPaths`](https://github.com/nrwl/nx/blob/9f2d9bcb60b9d64aae07a1e6b3b4921c83d0b2a7/packages/vite/plugins/nx-tsconfig-paths.plugin.ts#L200-L235) can fall back to 11 extensions and probe both a file and an index for each, producing up to 22 synchronous checks per candidate. It is useful for locating an upper bound for old-style synchronous JavaScript resolution. The same source explicitly deprecates it for removal in Nx 24 in favor of `vite-tsconfig-paths`, so it is not evidence for a future-facing Rolldown product decision. [Probe loop](https://github.com/nrwl/nx/blob/9f2d9bcb60b9d64aae07a1e6b3b4921c83d0b2a7/packages/vite/src/utils/nx-tsconfig-paths-find-file.ts#L4-L26) [Deprecation](https://github.com/nrwl/nx/blob/9f2d9bcb60b9d64aae07a1e6b3b4921c83d0b2a7/packages/vite/plugins/nx-tsconfig-paths.plugin.ts#L64-L70)

## `resolveId` contract stress case: `@rollup/plugin-node-resolve`

Pinned source: `@rollup/plugin-node-resolve` `16.0.3` in `rollup/plugins` at [`639f45638234c1c3fabfb13615c78bebaef89ef2`](https://github.com/rollup/plugins/tree/639f45638234c1c3fabfb13615c78bebaef89ef2/packages/node-resolve).

The `post`-ordered hook handles package exports and imports, browser mappings, extension fallbacks, symlinks, package side effects, builtins, and optional module-source checks. It combines JavaScript path and export-map work with promisified filesystem stat, read, and realpath calls. It maintains per-instance package and ID maps plus module-global filesystem caches. [Plugin source](https://github.com/rollup/plugins/blob/639f45638234c1c3fabfb13615c78bebaef89ef2/packages/node-resolve/src/index.js) [Resolution pipeline](https://github.com/rollup/plugins/blob/639f45638234c1c3fabfb13615c78bebaef89ef2/packages/node-resolve/src/resolveImportSpecifiers.js) [Filesystem caches](https://github.com/rollup/plugins/blob/639f45638234c1c3fabfb13615c78bebaef89ef2/packages/node-resolve/src/cache.js)

After finding a result, the hook deliberately calls `this.resolve` with `skipSelf: false` and a custom `node-resolve.resolved` receipt so other plugins can add metadata, externalize the result, or replace the ID without causing uncontrolled recursion. This directly exercises current ParallelPlugin gaps around custom resolve options, reentrant pool acquisition, hook order, and worker-local plugin-context data. [Recursive resolution](https://github.com/rollup/plugins/blob/639f45638234c1c3fabfb13615c78bebaef89ef2/packages/node-resolve/src/index.js#L296-L342)

Naive whole-plugin replication also fragments or duplicates important state:

- Package, browser-map, and ID-to-package-info caches diverge across instances, while `getPackageInfoForId` exposes instance-local data as plugin API.
- Module-global filesystem caches exist once per worker isolate. `generateBundle` clears only the cache in the selected worker under current ParallelPlugin output-hook routing, leaving other isolates stale.
- `dedupe`, `resolveOnly`, and `preferBuiltins` can be functions. Valid ordinary-plugin configurations therefore cannot all pass through the current structured-cloned options channel.
- Async filesystem work may already overlap through libuv while Rolldown resolves graph edges concurrently. More Node workers can duplicate filesystem traffic and cache misses without shortening the critical path.
- Warm-cache runs may shift more of the hook toward JavaScript export-map and path processing, so cold and warm attribution can lead to different conclusions.

For those reasons, this is currently a real semantics and defect case, not a promised speed winner. It should run under direct Rolldown rather than Vite 8 because Vite's production resolver is now Rolldown's native `viteResolvePlugin`. Promote it to a positive value case only if a baseline trace shows material JavaScript service time, sufficient runnable concurrency, and a correct state model.

If source and baseline evidence justify an adaptation, the plausible boundary is not the complete current plugin object. A main-side coordinator would retain recursive plugin-driver communication, custom receipts, public plugin API, and cache lifecycle, while a worker kernel would perform the package-resolution portion. That split is itself authoring and coordination cost and must be compared with the ordinary plugin rather than treated as free benchmark plumbing.

Three other current resolvers belong in the defect suite rather than the value shortlist:

- `@vitejs/plugin-rsc` resolves bare imports through `this.resolve`, writes package-source state in the server environment, and has later load or transform paths consume it. Availability-based worker routing can split that state even when each call succeeds. [Source](https://github.com/vitejs/vite-plugin-react/blob/84693214ef8cccc3357561fe4654f401a30dab62/packages/plugin-rsc/src/plugin.ts#L1678-L1709)
- `@module-federation/vite` resolves against module-global registries, maps, sets, and weak maps, mutates shared state on hits, and recursively calls the plugin driver. It is a concrete case where generic replication changes semantics. [Source](https://github.com/module-federation/vite/blob/677c4df89bf40f721b9d15476332d3408f6718b5/src/plugins/pluginProxySharedModule_preBuild.ts#L233-L411)
- `@rollup/plugin-commonjs` coordinates resolution with `this.resolve`, `this.load`, module metadata, and a `currentlyResolving` guard. It is a direct reentrancy and permit-cycle fixture, while its material CPU remains in transform. [Source](https://github.com/rollup/plugins/blob/639f45638234c1c3fabfb13615c78bebaef89ef2/packages/commonjs/src/resolve-id.js#L52-L164)

## Current rejections and controls

### Vite core resolution and `vite-tsconfig-paths`

Vite current main at [`c961cae2868cc1521457ec60583867f0440e6949`](https://github.com/vitejs/vite/tree/c961cae2868cc1521457ec60583867f0440e6949) constructs its production resolver through `viteResolvePlugin` from `rolldown/experimental`. It also supports native `resolve.tsconfigPaths` and warns when `vite-tsconfig-paths` is installed. [Native resolver](https://github.com/vitejs/vite/blob/c961cae2868cc1521457ec60583867f0440e6949/packages/vite/src/node/plugins/resolve.ts#L1-L6) [Native tsconfig-path warning](https://github.com/vitejs/vite/blob/c961cae2868cc1521457ec60583867f0440e6949/packages/vite/src/node/config.ts#L1515-L1527)

The current `vite-tsconfig-paths` `7.0.0-alpha.1` source at [`6ac9476b60b4b2ca54259d475b7e23a9b77f8ef3`](https://github.com/aleclarson/vite-tsconfig-paths/tree/6ac9476b60b4b2ca54259d475b7e23a9b77f8ef3) sends actual path resolution to `oxc-resolver`, coalesces in-flight native calls, and caches results. Moving its JavaScript wrapper to Node workers would primarily measure native work, cache duplication, and bridge overhead. It is not a pure-JavaScript positive case, and its Vite role is being replaced by the native option.

### Official Vue and Svelte `resolveId` and ordinary `load`

The official Vue and Svelte hooks remain required overhead and correctness controls. Their identity-style `resolveId` paths and common cache-hit or metadata lookup `load` paths do not contain enough independent JavaScript CPU to justify an expected speedup. They are still important because a design that dispatches them indiscriminately can erase gains from the compiler hook and because related cross-hook state must remain correct. See [the plugin case notes](./plugin-case-notes.md).

### Official Rollup loaders

- `@rollup/plugin-image` synchronously reads and encodes images in `load`. It is a useful direct-Rolldown mechanism control for blocking filesystem work and output-copy size, but Vite projects normally use native asset handling and it is weaker than the current Vue ecosystem cases as a flagship application result.
- `@rollup/plugin-url` and `@rollup/plugin-wasm` mainly await filesystem work and native hashing, then carry mutable copy or emission state into output hooks. They are stronger state-fragmentation tests than JavaScript CPU value cases.
- `@rollup/plugin-virtual` and most data-URI paths are cheap map or object operations. They are dispatch controls unless a real project demonstrates unusually high virtual-module generation cost.
- `@rollup/plugin-typescript` resolves through a TypeScript module-resolution cache but coordinates one watch program and shared emitted-file maps. Its `load` waits for and reads that global compiler output rather than compiling one independent module. Replicating the complete plugin multiplies compiler programs and breaks ownership; extracting a compiler kernel would be a separate adaptation study.

Other tempting load cases were rejected for attribution or call-shape reasons:

- `vite-imagetools` performs its expensive image work through Sharp and libvips, while holding transform promises, generated-image state, filesystem caches, Vite server state, and output emissions. It is a native-work and fragmented-state control, not a JavaScript-worker value case. [Source](https://github.com/JonasKruckenberg/imagetools/blob/20ae3c380c4c35af1056b4f35ff2fe80564e32f9/packages/vite/src/index.ts#L77-L238)
- `@mdx-js/rollup` and `unplugin-vue-components` perform their material parsing and generation in transform, not load. Moving their light load behavior would test dispatch rather than the feature users care about.
- Svelte mode in `unplugin-icons` mainly generates a Svelte source string in load; the expensive Svelte compilation happens in the later official-plugin transform. It does not provide a second Svelte compiler case.
- Ordinary route generators, helper modules, virtual entries, and global UnoCSS virtual modules usually have one or a few aggregate IDs. A long single load can benefit one-worker main-thread isolation but supplies no multi-worker throughput.
- Vite worker loading recursively launches a complete worker build. Its low call count, nested build scheduling, and shared state make it a reentrancy case rather than ordinary per-module loading.

## Admission checks after the framing review

Before a candidate becomes benchmark evidence:

1. Pin the plugin, project, package manager, Node.js line, Vite or Rolldown revision, lockfile, build command, `UV_THREADPOOL_SIZE`, and other relevant environment variables.
2. Run an unchanged baseline and report reached hook calls, result and miss counts, ready-call concurrency, JavaScript CPU, native or I/O wait, returned bytes, and the hook's share of total wall time.
3. Compute the idealized end-to-end upper bound from that baseline share and reject the project as a value fixture if the target hook has no material headroom, even when the repository contains many matching files.
4. Establish production-build output, diagnostics, source-map, and watch-file-registration correctness before comparing worker counts. Defer invalidation and repeated-build execution.
5. Compare ordinary execution, one worker, and several workers. One worker answers main-thread isolation; multiple workers answer throughput.
6. Report worker creation, per-worker module loading and JIT, plugin and compiler initialization, worker-local cache warmup, queue wait, service time, CPU, peak RSS, and main-thread availability separately.
7. Keep fresh-process and newly recreated-worker runs with warm operating-system caches as different production-build modes. Defer reused watch-worker measurement.
8. For several parallel plugins, attribute shared-pool contention and test whether independently reasonable worker counts oversubscribe the Rust core.
9. Adapt and measure only one target plugin in the first run for a project. Add shared-pool combinations only after each plugin's initialization, filtering, cache, and service costs are understood alone.
