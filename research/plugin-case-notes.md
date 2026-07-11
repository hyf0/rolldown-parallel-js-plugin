# Vue and Svelte Plugin Case Notes

Snapshot date: 2026-07-11. These notes describe source shape and candidate experiments only. No project has been selected as a benchmark fixture until a successful pinned build and baseline trace prove that the target plugin owns enough time to matter.

## Integration baseline

Real official-plugin evidence should use a Vite production build. [Vite 8 uses Rolldown as its production bundler](https://vite.dev/blog/announcing-vite8), while both official plugins depend on Vite lifecycle and context beyond a direct Rolldown plugin object. Direct Rolldown remains the smaller environment for runtime viability, hook overhead, and defect reproductions.

## Vue

### Pinned source

- `@vitejs/plugin-vue` `6.0.7` at [`28d6889104e76c8f420910bee6d17a081b130f1d`](https://github.com/vitejs/vite-plugin-vue/tree/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue).
- `@vue/compiler-sfc` `3.5.39` at [`c0606e91798c8dca4f33d101e1dd836d672592c1`](https://github.com/vuejs/core/tree/c0606e91798c8dca4f33d101e1dd836d672592c1/packages/compiler-sfc).
- The plugin package explicitly marks direct Rolldown and Rollup use incompatible because it depends on Vite-specific APIs. A real baseline is therefore a Vite build or an explicit coordinator split, not `rolldown({ plugins: [vue()] })`. [Package declaration](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/package.json#L56-L65)

### Actual module and hook flow

For each reached main SFC, the main transform parses the final code received from preceding plugins, synchronously compiles the script, usually compiles a normal HTML template in the same transform, and emits imports for any required script, template, style, or custom-block virtual modules. [Main transform](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/main.ts#L30-L133) [Template path](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/main.ts#L335-L394) [Script path](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/main.ts#L397-L454)

```text
Foo.vue transform
  -> parse final source and create descriptor
  -> compileScript
  -> usually compile plain HTML template inline
  -> emit child virtual-module imports
       script when it cannot remain in the main module
       template for external or non-HTML templates
       one style module per style block
       one custom module per custom block
  -> child resolveId -> load -> transform reads owner descriptor and script state
```

For `N` reached main SFCs, `S` virtual scripts, `T` external or non-HTML templates, `Y` style blocks, and `C` custom blocks, the transform handler sees approximately `N + S + T + Y + C` calls. Only `N`, `T`, and `Y` normally perform substantial transformation; virtual script and custom-block calls still need correct state but often return nothing.

### Hook-specific value hypothesis

- `resolveId` recognizes the export helper or a `?vue` query and returns the same ID. [Implementation](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/index.ts#L394-L407) It is a negative control for worker dispatch and a positive case for a pre-JavaScript filter or coordinator-owned identity mapping, not a likely throughput win.
- `load` returns helper code, reads an external source synchronously, or retrieves the owner descriptor. A virtual script load calls `resolveScript`, which compiles on cache miss. [Implementation](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/index.ts#L410-L452) In the ordinary flow the main transform has already compiled that script, so load-time compilation introduced by worker distribution is duplicated work rather than headroom.
- `transform` contains the plausible CPU headroom: SFC parse, script and type processing, normal template compilation, SFC style transformation, source-map work, and wrapper generation. CSS preprocessor work already performed by Vite must not be credited to plugin-vue. [Style boundary](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/style.ts#L8-L76)
- Nested resolution of external blocks occurs inside the main transform through `this.resolve`; it must be attributed separately from the plugin's own cheap `resolveId` hook. [External-block path](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/main.ts#L567-L583)

### State and serialization constraints

- Descriptor, HMR, previous-descriptor, client-script, SSR-script, and type-dependency caches are process-local. [Descriptor caches](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/utils/descriptorCache.ts#L14-L20) [Script caches](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/script.ts#L6-L38)
- A descriptor cache miss can read raw source from disk even though the ordinary descriptor may contain source changed by an earlier plugin such as Vue Macros. Random routing can therefore change behavior rather than merely lose a cache hit. [Fallback explanation](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/utils/descriptorCache.ts#L82-L104)
- Virtual template compilation consumes script binding metadata, so template and script state cannot be assigned independently without an explicit snapshot. [Template dependency](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/template.ts#L85-L119)
- An `SFCDescriptor` contains a closure, and plugin/compiler options can contain a custom compiler module, component-ID functions, template compiler callbacks, node transforms, custom requires, and filesystem functions. These values cannot be sent unchanged through current `workerData`. [Descriptor construction](https://github.com/vuejs/core/blob/c0606e91798c8dca4f33d101e1dd836d672592c1/packages/compiler-sfc/src/parse.ts#L72-L96) [Plugin options](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/index.ts#L35-L176)
- `compiler-sfc` maintains parse, template-analysis, TypeScript resolution, tsconfig, and type-scope caches. Replicating them multiplies import, JIT, cache-warmup, and memory costs. [Parse cache](https://github.com/vuejs/core/blob/c0606e91798c8dca4f33d101e1dd836d672592c1/packages/compiler-sfc/src/parse.ts#L103-L118) [Type resolution caches](https://github.com/vuejs/core/blob/c0606e91798c8dca4f33d101e1dd836d672592c1/packages/compiler-sfc/src/script/resolveType.ts#L1079-L1175)
- Configuration, server and HMR hooks, plugin API state, logging, watchers, and type-dependency invalidation require a coordinator. [Vite lifecycle](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/index.ts#L221-L392) [HMR state](https://github.com/vitejs/vite-plugin-vue/blob/28d6889104e76c8f420910bee6d17a081b130f1d/packages/plugin-vue/src/handleHotUpdate.ts#L27-L179)

### Worker boundaries to compare later

1. Stable owner-SFC affinity routes the main module, child virtual modules, environment variant, and rebuilds to the same worker. It preserves local caches but constrains scheduling and makes worker restart or invalidation visible.
2. Whole-SFC compilation returns the child virtual-module payloads, dependencies, maps, diagnostics, and compact metadata to coordinator-owned storage. Later child loads become lookups and do not depend on worker identity, but external resolution and some style work still require a split.

Both designs keep trivial resolve/helper loading, Vite lifecycle, global type-dependency reduction, logging, and non-cloneable integrations in the coordinator. The second design is the stronger initial hypothesis because it reduces hook round trips and hidden cache dependencies, but this is not yet a settled direction.

### Candidate builds and correctness fixtures

- First real-build candidate: [`vbenjs/vue-vben-admin@8b7c245bc7a2346764d98d26003a2faf67a98182`](https://github.com/vbenjs/vue-vben-admin/tree/8b7c245bc7a2346764d98d26003a2faf67a98182). It has a direct Vite production build, pins Vite `8.0.10` and plugin-vue `6.0.7`, and has 680 tracked SFCs in a static repository scan. The actual `web-antd` reachable graph and plugin share remain unmeasured. [Build scripts](https://github.com/vbenjs/vue-vben-admin/blob/8b7c245bc7a2346764d98d26003a2faf67a98182/package.json#L27-L37) [Plugin configuration](https://github.com/vbenjs/vue-vben-admin/blob/8b7c245bc7a2346764d98d26003a2faf67a98182/internal/vite-config/src/plugins/index.ts#L51-L89)
- State-stress candidate: [`elk-zone/elk@d444a5988b93fdf632fd0a39195747be1c62e750`](https://github.com/elk-zone/elk/tree/d444a5988b93fdf632fd0a39195747be1c62e750). It has 255 SFCs under `app/`, uses Vue Macros, and builds both client and server through Nuxt, making it useful for transformed-source and environment-cache semantics. Its Vite 7/Nuxt build compatibility and actual reached work must be established before selection. [Configuration](https://github.com/elk-zone/elk/blob/d444a5988b93fdf632fd0a39195747be1c62e750/nuxt.config.ts#L33-L54)
- Correctness source: the official plugin-vue playground covers external blocks, preprocessors, CSS modules, imported types, custom blocks, source maps, SSR, client behavior, and HMR. These fixtures are behavior gates, not performance evidence. [Main fixture](https://github.com/vitejs/vite-plugin-vue/tree/28d6889104e76c8f420910bee6d17a081b130f1d/playground/vue) [Source-map fixture](https://github.com/vitejs/vite-plugin-vue/tree/28d6889104e76c8f420910bee6d17a081b130f1d/playground/vue-sourcemap) [SSR fixture](https://github.com/vitejs/vite-plugin-vue/tree/28d6889104e76c8f420910bee6d17a081b130f1d/playground/ssr-vue)

The existing Elk corpus benchmark pin remains useful only as an isolated compiler bound. It externalizes the application graph, stubs failures, and does not adapt the actual official plugin.

## Svelte

### Pinned source

- Latest `@sveltejs/vite-plugin-svelte` release `7.2.0` at [`02981fd9bb395b6aa5453e2bc3166778ae71e326`](https://github.com/sveltejs/vite-plugin-svelte/tree/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/vite-plugin-svelte). Current main `c9feef65f78bb42a1dc85c58522ca3c9bdfde01c` differs only in inspector runtime TypeScript changes; the audited hook and state files are identical.
- Svelte `5.56.4` at [`eae50dfd1c2269e37258ef5c09527003bcf61573`](https://github.com/sveltejs/svelte/tree/eae50dfd1c2269e37258ef5c09527003bcf61573/packages/svelte/src/compiler).
- The modular plugin split was introduced in [vite-plugin-svelte PR #1145](https://github.com/sveltejs/vite-plugin-svelte/pull/1145) to separate preprocessing and compilation, clarify responsibilities, use Vite environments, and improve hook filters for Rolldown-powered Vite. [PR #1154](https://github.com/sveltejs/vite-plugin-svelte/pull/1154) moved compiled CSS into module metadata and preprocessing dependencies into their owning plugin.

### Actual module and hook flow

The plugin already returns a list of task-specific plugins that share one mutable API object. `configResolved` initializes options, filters, the ID parser, and the compile closure used by later plugins. [Plugin list](https://github.com/sveltejs/vite-plugin-svelte/blob/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/vite-plugin-svelte/src/index.js#L24-L42) [Configuration](https://github.com/sveltejs/vite-plugin-svelte/blob/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/vite-plugin-svelte/src/plugins/configure.js#L25-L68)

```text
normal Component.svelte
  -> load-custom.load usually returns nothing
  -> preprocess.transform when configured
  -> other Vite transforms deliberately run here
  -> compile.transform runs svelte.compile
       returns compiled JavaScript
       stores compiled CSS in meta.svelte.css
       imports ?svelte&type=style&lang.css when CSS exists
  -> virtual-CSS resolveId returns the exact ID
  -> virtual-CSS load reads meta.svelte.css and returns CSS and map
```

The preprocessing-to-compilation order is documented public behavior. [Advanced usage](https://github.com/sveltejs/vite-plugin-svelte/blob/02981fd9bb395b6aa5453e2bc3166778ae71e326/docs/advanced-usage.md#L10-L48)

For `N` normal Svelte component transforms, `P` preprocessed transforms, `S` unique components with emitted CSS, and `M` `.svelte.js` or `.svelte.ts` transforms, the main source-derived paths are approximately `N` miss-heavy custom loads, `P` preprocess calls, `N` component compiles, `M` module compiles, and at most `S` virtual-CSS resolves and loads per environment. Client and server environments can compile the same physical file separately, so a trace must supply actual counts.

### Hook-specific value hypothesis

- `resolveId` for compiled CSS uses an exact filter and returns the same ID. [Implementation](https://github.com/sveltejs/vite-plugin-svelte/blob/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/vite-plugin-svelte/src/plugins/load-compiled-css.js#L27-L33) It is an overhead lower bound, not useful CPU work.
- The custom-extension `load` path runs for matching Svelte sources but usually misses in normal `.svelte` projects; its hit path uses `readFileSync`. [Implementation](https://github.com/sveltejs/vite-plugin-svelte/blob/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/vite-plugin-svelte/src/plugins/load-custom.js#L14-L45) Tightening the filter is likely more valuable than worker dispatch for the misses.
- The compiled-CSS `load` path reads `getModuleInfo(...).meta.svelte.css`, may retry through `this.resolve`, and has a persistent rebuild cache. [Implementation](https://github.com/sveltejs/vite-plugin-svelte/blob/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/vite-plugin-svelte/src/plugins/load-compiled-css.js#L34-L77) It should remain near coordinator-owned graph metadata.
- `compile.transform` is the primary candidate: it runs synchronous Svelte compilation, maps inputs and outputs, returns JavaScript, and publishes CSS metadata. [Compile plugin](https://github.com/sveltejs/vite-plugin-svelte/blob/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/vite-plugin-svelte/src/plugins/compile.js#L32-L65) [Compile utility](https://github.com/sveltejs/vite-plugin-svelte/blob/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/vite-plugin-svelte/src/utils/compile.js#L90-L151)
- `compileModule` is similarly clean but likely has too few real-project calls to change total build time. [Implementation](https://github.com/sveltejs/vite-plugin-svelte/blob/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/vite-plugin-svelte/src/plugins/compile-module.js#L17-L100)

### State and serialization constraints

- The compile subplugin is comparatively module-local and has no cross-file result cache. It consumes final code, ID, environment, and the combined source map, runs per-file `dynamicCompileOptions`, and returns JS, map, diagnostics, and CSS metadata. It still cannot be copied as an unmodified current ParallelPlugin because its filter, options, parser, compile closure, and environment are initialized through missing Vite lifecycle.
- Preprocessing owns arbitrary function-valued preprocessors, dependency maps, watcher/server state, `addWatchFile`, and source-map chaining. [Preprocess plugin](https://github.com/sveltejs/vite-plugin-svelte/blob/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/vite-plugin-svelte/src/plugins/preprocess.js#L20-L96) It is a separate and harder parallelization question.
- SvelteKit adds a function-valued warning preprocessor backed by a module-global `warned` set even when the application configures no user preprocessor. [SvelteKit integration](https://github.com/sveltejs/kit/blob/fa0966c798e913dee98fbd083cc50f5801a299b0/packages/kit/src/exports/vite/index.js#L99-L143) A full SvelteKit option object therefore cannot be structured-cloned, and replication can duplicate once-only warnings.
- The compile-to-load CSS edge is already explicit module metadata. This is helpful only if worker-produced `meta.svelte.css` becomes visible through the shared graph to the coordinator's later load hook. Current ParallelPlugin metadata does not satisfy that condition.
- HMR owns the final post-transform result cache and forces component transformation before CSS transformation. [HMR plugin](https://github.com/sveltejs/vite-plugin-svelte/blob/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/vite-plugin-svelte/src/plugins/hot-update.js#L14-L145) That state must remain coordinated.
- `svelte.compile` and `compileModule` are synchronous and reset module-global compiler state for each call. [Compiler entry](https://github.com/sveltejs/svelte/blob/eae50dfd1c2269e37258ef5c09527003bcf61573/packages/svelte/src/compiler/index.js#L23-L76) [Compiler state](https://github.com/sveltejs/svelte/blob/eae50dfd1c2269e37258ef5c09527003bcf61573/packages/svelte/src/compiler/state.js#L9-L148) One call at a time in each separate worker isolate fits that model, but each isolate pays compiler import, JIT, and memory.
- Resolved options can contain preprocessors, `dynamicCompileOptions`, `onwarn`, `cssHash`, warning filters, custom-element logic, Vite config/server objects, stats classes, and closures. Some per-file functions can be evaluated by the coordinator into scalar task options; `cssHash` and arbitrary side-effectful callbacks need an explicit worker-loadable contract or incompatibility rule.

### Initial worker boundary

Keep configuration, preprocessing, dynamic option evaluation, warning policy, virtual-CSS resolve/load, custom loading, HMR/watch state, optimizer and inspector behavior, and plugin API on the coordinator. Move a prepared `svelte.compile` task that receives plain code, ID, environment, scalar options, and combined input map, then returns plain JavaScript, CSS, maps, dependencies, metadata, and normalized diagnostics.

This is the provisional first adaptation because the expensive boundary is already visible and does not need module affinity for production compilation if CSS metadata becomes graph-global. Watch and HMR still need persistent centralized state, but their runtime coverage is deferred. Moving preprocessors later would be a separate authoring-model experiment rather than part of the first success claim.

### Candidate builds and correctness fixtures

- High-volume candidate: [`huntabyte/shadcn-svelte@efcf8a4ef2c6a3a21ee2fd4db905519f8d4c8e63`](https://github.com/huntabyte/shadcn-svelte/tree/efcf8a4ef2c6a3a21ee2fd4db905519f8d4c8e63), with 1,658 tracked SFCs in `docs/`, 100 MDSX `.md` files configured as Svelte extensions, and function-valued preprocessing. It is strong compile/preprocess stress but weak CSS-load stress. The current manifest and lockfile disagree on SvelteKit, so use parent `fda888bd2ac97cb3d0f7b36448b27fd8b1f13a39` or intentionally preserve a refreshed lockfile. Time its prepared Vite build separately from content and generation scripts. [Svelte config](https://github.com/huntabyte/shadcn-svelte/blob/efcf8a4ef2c6a3a21ee2fd4db905519f8d4c8e63/docs/svelte.config.js#L1-L81) [Build scripts](https://github.com/huntabyte/shadcn-svelte/blob/efcf8a4ef2c6a3a21ee2fd4db905519f8d4c8e63/docs/package.json#L6-L24)
- Representative official candidate: [`sveltejs/svelte.dev@93a400dd1ea459ed4c39530c0db75edf4f9ee45c`](https://github.com/sveltejs/svelte.dev/tree/93a400dd1ea459ed4c39530c0db75edf4f9ee45c), pinned to Vite `8.0.16` and Svelte `5.56.4`, with 514 tracked app SFCs plus workspace components. Many tutorial/example files may be data rather than reached modules, so the physical count is not a hook count. Time the prepared Vite build separately from package and content generation. [App package](https://github.com/sveltejs/svelte.dev/blob/93a400dd1ea459ed4c39530c0db75edf4f9ee45c/apps/svelte.dev/package.json#L1-L86)
- Small negative control: [`sveltejs/realworld@ec8552fee0d0b7e8ad3c6a6818f3fe9ee7d861f5`](https://github.com/sveltejs/realworld/tree/ec8552fee0d0b7e8ad3c6a6818f3fe9ee7d861f5), with 24 tracked SFCs. It currently uses Vite 7 and plugin-svelte 6, so it requires a pinned parity-checked Vite 8 upgrade before use. Multi-worker wall time is expected to regress at this size.
- Current correctness source: pin official production-build fixtures such as `kit-node`, `preprocess-with-vite`, `svelte-preprocess`, `css-treeshake`, `dynamic-compile-options`, `custom-extensions`, `import-queries`, and `kit-async` from plugin-svelte `7.2.0`. Retain `build-watch`, `hmr-css-first`, and `build-multiple` as named future sources rather than current runtime gates. [Fixture directory](https://github.com/sveltejs/vite-plugin-svelte/tree/02981fd9bb395b6aa5453e2bc3166778ae71e326/packages/e2e-tests)
