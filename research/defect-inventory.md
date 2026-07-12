# Current Defect Inventory

Snapshot: Rolldown `21d7b32827045e377a82c3cb681dafa51c244883` on 2026-07-11. This is a living source and runtime defect record. `Observed` means the behavior has a pinned reproduction in this repository. `Source-proven` means the behavior follows directly from current code or an explicit upstream statement. `Source-inferred` means the call graph contains a failure path that still needs reproduction. `Historical` means an earlier experiment reported the behavior and current reproduction is pending.

The 2026-07-11 mechanism-scale runtime scope was the direct-Rolldown production-build transform path on the latest Node.js LTS release and is complete. The 2026-07-12 Cloudflare adaptation subsequently added observed production metadata loss, isolate-local state loss, raw-output nondeterminism, and resource evidence over 9,157 transforms. It did not close shared/exclusive placement, multi-plugin execution, cache determinism, Cloudflare-specific diagnostics, crash handling, or the broader 15–30 minute complete-build goal. Vite-specific, watch-only, rebuild-only, HMR, and other-Node-version defects remain background and outside the active scope.

## D001: worker callbacks use the main-thread weak lifetime mode

- Status: source-proven configuration and explicit upstream breakage statement; the current Node.js 24.18.0 result narrows rather than independently reproduces the claim.
- Severity: blocker through its worker-lifetime interaction, but not independently fatal while the worker event loop has an explicit owner.
- Behavior: [`JsCallback`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/crates/rolldown_binding/src/types/js_callback.rs#L104-L105) instantiates napi-rs `ThreadsafeFunction` with `Weak = true` for every JavaScript callback. [PR #2135](https://github.com/rolldown/rolldown/pull/2135) explicitly says this breaks `ParallelPlugin` because worker callbacks cannot use that weak mode.
- Observed result: unchanged current main loses every worker after bootstrap and its first build fails. Research commit `75ba695d1` adds only a worker keepalive; callbacks then work without changing `Weak = true`, and the no-op and Babel outputs match their ordinary controls. [Evidence](../experiments/core-transform/2026-07-11-node-24.18.0-smoke.md)
- Impact: weak callbacks do not own the worker lifetime. ParallelPlugin therefore needs a separate explicit lifecycle owner even though the callback remains usable while that owner exists.
- Fix condition for the active research path: first and later transform callbacks, clean production-build shutdown, build failure, and worker failure pass on the pinned Node.js 24 LTS patch without keeping ordinary main-thread callbacks alive unnecessarily. Broader lifecycle fixes are outside the current experiment scope.

## D002: the worker event loop can close immediately after bootstrap

- Status: observed on current main and Node.js 24.18.0; matches the earlier unmerged [`ca6e746c3`](https://github.com/rolldown/rolldown/commit/ca6e746c3838e7ce843669a336909b536ae9c65d) report.
- Severity: blocker on unchanged current main; lifecycle design remains incomplete even with the research timer workaround.
- Behavior: current bootstrap [`unref()`s the worker and its parent port](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/packages/rolldown/src/parallel-plugin-worker.ts#L41-L48), while weak thread-safe functions do not keep the event loop alive. The unmerged workaround adds a long-lived timer and reports `Status::Closing` on the first callback without it.
- Observed result: all eight workers emit their end events immediately after bootstrap; the parallel no-op build exits 1 with two empty binding errors. Commit `75ba695d1` adds the historical timer-shaped keepalive and makes the same command succeed with byte-identical output. [Evidence](../experiments/core-transform/2026-07-11-node-24.18.0-smoke.md)
- Impact: a keepalive timer makes research possible but does not define worker ownership, crash handling, or shutdown semantics.
- Fix condition: an explicit lifecycle owner keeps workers callable while Rust holds their plugin callbacks and makes worker closure visible to in-flight and queued calls.

## D003: eleven supported JavaScript hooks silently become no-ops

- Status: source-proven.
- Severity: blocker for a general plugin contract; hook-dependent for a narrowed worker kernel.
- Behavior: [`ParallelJsPlugin`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/crates/rolldown_binding/src/options/plugin/parallel_js_plugin.rs#L80-L201) forwards 9 of the 20 hooks implemented by [`JsPlugin`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/crates/rolldown_binding/src/options/plugin/js_plugin.rs#L76-L676). `resolveDynamicImport`, `renderStart`, `banner`, `intro`, `outro`, `footer`, `augmentChunkHash`, `renderError`, `closeBundle`, `watchChange`, and `closeWatcher` fall through to default no-ops, while `register_hook_usage()` incorrectly returns `HookUsage::all()`.
- Impact: a plugin can appear registered while required behavior is absent, and the driver cannot detect the unsupported surface.
- Fix condition: the execution contract explicitly rejects unsupported hooks or implements each hook with defined single-instance, broadcast, or reduction semantics and truthful hook usage.

## D004: hook order metadata is discarded

- Status: source-proven.
- Severity: high because behavior can change silently in otherwise valid plugin configurations.
- Behavior: worker-side `JsPlugin` values contain each hook's `pre` or `post` metadata, but `ParallelJsPlugin` does not forward any `*_meta` method. The plugin driver therefore orders the wrapper as a normal plugin.
- Impact: parallelizing a plugin can change its Rolldown hook order relative to other plugins even when hook code and results are otherwise identical. This is separate from Vite's plugin-level `enforce` classification in D005.
- Fix condition: ordering metadata is available before the driver computes hook order, is consistent across instances, and behavior fixtures prove parity with the ordinary plugin.

## D005: JavaScript-side and Vite lifecycle hooks are absent

- Status: source-proven.
- Severity: blocker for whole-plugin Vue or Svelte adaptation.
- Behavior: [`getObjectPlugins`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/packages/rolldown/src/plugin/plugin-driver.ts#L71-L83) removes parallel markers before Rolldown calls `options`, `outputOptions`, and `onLog`. The marker is not a Vite plugin instance, so Vite lifecycle hooks and plugin `api` have no worker invocation path. It also exposes only `_parallel`, not Vite-level `enforce`, so [Vite sorts](https://github.com/vitejs/vite/blob/32c29780404c353f5a7c5ba4d06fc5e676741714/packages/vite/src/node/plugins/index.ts#L75-L121) a replacement marker as a normal user plugin rather than preserving `pre` or `post` placement.
- Impact: an official Vue or Svelte plugin cannot be converted by replacing its object with the current marker while preserving configuration and ecosystem behavior. For `vite-plugin-svgr` and `vite-svg-loader`, losing `enforce: 'pre'` places the marker after Vite's asset plugin, which can claim the SVG ID before the worker loader.
- Fix condition: the supported contract names the main-thread coordinator surface and worker surface, a Vite-visible shell preserves lifecycle, `enforce`, and plugin position where required, and unsupported hooks fail explicitly.

## D006: each plugin instance receives incomplete and isolated context data

- Status: source-proven; warning loss is observed in the pinned Svelte compiler case.
- Severity: blocker for plugins that require diagnostics, watch mode, plugin discovery, or output option callbacks.
- Behavior: [`parallel-plugin-worker.ts`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/packages/rolldown/src/parallel-plugin-worker.ts#L13-L38) creates a separate `PluginContextData` for every plugin in every worker, passes empty input and output options and plugin lists, uses a no-op logger, and hard-codes `watchMode = false`.
- Observed result: ordinary Svelte compilation emits two structured accessibility warnings with plugin, hook, ID, code, location, and frame. The worker form produces identical code and map hashes but emits no logs. [Evidence](../experiments/svelte-transform/2026-07-11-svelte-results.md#correctness-gates)
- Impact: `warn`, `info`, and `debug` are discarded; normalized option views are incomplete; plugin-to-plugin discovery is absent; watch behavior is misreported; output behavior that depends on JavaScript option functions can fail.
- Fix condition: every exposed context field either has ordinary-plugin semantics, has a documented parallel meaning, or is unavailable at type and runtime level.

## D007: module metadata and JavaScript-side module mutations are worker-local

- Status: source-proven.
- Severity: blocker for stateful cross-hook plugins and high risk for deterministic output.
- Behavior: structural module information comes from the shared Rust graph, but [`PluginContextData.moduleOptionMap`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/packages/rolldown/src/plugin/plugin-context-data.ts#L18-L24) supplies `meta` and JavaScript-side `moduleSideEffects`. `load`, `transform`, and `resolveId` update only the selected instance's map. Mutating `getModuleInfo().moduleSideEffects` in a worker does not reach the main-thread `deferSyncScanData` callback.
- Observed result: the Cloudflare graph adapter returns `meta.astro` and `meta.vite` from every MDX transform. The graph runner directly counts Astro metadata on all 9,157 MDX modules in ordinary and plugin-managed execution and zero in Rolldown-managed ParallelPlugin, even though the graph, boundary, and narrowly normalized generated output match. `meta.vite` uses the same returned object but was not counted independently. [Evidence](../experiments/cloudflare-mdx/2026-07-12-results.md#returned-metadata-is-lost)
- Impact: related hooks and broadcast `moduleParsed` calls can observe different metadata for the same module, and worker-count-dependent output is possible.
- Fix condition: module-scoped metadata has one explicit owner, survives routing across hooks and output phases, and has defined invalidation behavior.

## D008: generic `this.resolve(..., { custom })` data cannot cross plugin instances

- Status: source-proven.
- Severity: high for plugins that use custom resolver communication.
- Behavior: [`PluginContextImpl.resolve`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/packages/rolldown/src/plugin/plugin-context.ts#L328-L369) stores custom options in the caller's local `resolveOptionsMap` and passes Rust only a numeric receipt. The receiving plugin looks up that number in its own per-plugin, per-worker map.
- Impact: ordinary-to-parallel, parallel-to-ordinary, and parallel-to-another-instance resolver communication can lose generic custom options. Independent maps also reuse small numeric receipts, so a receiver can read unrelated custom data when the same number is active locally. The permit held by the caller prevents a recursive call from reusing that same worker instance.
- Fix condition: custom resolver data has build-wide identity and ownership, or the parallel contract explicitly removes this communication pattern.

## D009: availability-based routing fragments mutable plugin state

- Status: source-proven design behavior; observable closure-state divergence is reproduced by the controlled resolver probe.
- Severity: blocker for plugins that aggregate module or chunk state in output hooks.
- Behavior: [`run_single`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/crates/rolldown_binding/src/options/plugin/parallel_js_plugin.rs#L53-L57) selects the next available instance without module or output affinity. `generateBundle` and `writeBundle` each run on one available instance after earlier module and chunk work was distributed.
- Observed result: an ordinary resolver closure returns one sequence of 32 unique counter values and one stable output hash. Worker-4 distributes the same calls across four independent counters and changes the resolved IDs. Ten independent runs produce ten different worker output hashes and eight aggregate call distributions; even repeated `[8, 8, 8, 8]` distributions produce different hashes because the module-to-instance assignment changes. [Evidence](../experiments/resolve-load/2026-07-11/README.md#per-instance-mutable-state-changes-semantics)
- Production observation: Cloudflare's `starlight-links-validator` stores per-module headings and links in a `globalThis` Map. The ordinary exploratory profile collects all 9,157 entries, while plugin-managed and Rolldown-managed worker profiles leave the coordinator Map empty. Generated code still matches because the missing state is consumed later. The exploratory timings are discarded; this is semantic-defect evidence only. [Evidence](../experiments/cloudflare-mdx/2026-07-12-results.md#plugin-global-state-becomes-worker-local)
- Impact: module hooks can change output when closure state is replicated, and the selected output hook sees only one instance's partial state and can differ between hooks or runs.
- Fix condition: state is externalized and reduced before global hooks, or global hooks run in a designated coordinator with complete state.

## D010: `moduleParsed` multiplies work and concurrent pool-wide barriers may deadlock

- Status: broadcast amplification is source-proven; deadlock is source-inferred and unreproduced.
- Severity: high performance cost; blocker if the deadlock path reproduces.
- Behavior: every parsed module is sent to every plugin instance. [`acquire_all`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/crates/rolldown_binding/src/worker_manager.rs#L32-L41) receives permits one at a time without serializing competing pool-wide acquisitions. If some permits are still held by `run_single`, one pool-wide waiter can consume the currently free permits and suspend; another waiter can then join, and later permit returns may be split between them so neither reaches the full count. A completely idle pool does not have this interleaving because the first waiter can drain ready permits in one poll.
- Impact: callback work grows by the worker count, module throughput is blocked by a full-pool barrier, and concurrent barriers contain a circular-wait path.
- Fix condition: notification semantics avoid unnecessary replication, and any pool-wide acquisition is atomic or serialized with a regression test for concurrent notifications.

## D011: reentrant `this.resolve` and `this.load` can exhaust the shared worker pool

- Status: observed for same-plugin `this.resolve(..., { skipSelf: false })` with one worker; broader cross-plugin, load, broadcast, and cancellation paths remain source-inferred.
- Severity: blocker for the observed resolver pattern and any equivalent permit cycle.
- Behavior: `run_single` and `run_all` retain permits until the JavaScript promise resolves. `this.resolve` re-enters the shared plugin driver and `this.load` can start module work that reaches parallel hooks. All parallel plugins share one `WorkerManager`.
- Observed result: ordinary and worker-2 builds complete with the same output hash. Worker-1 retains its only permit while awaiting the inner resolve, whose wrapper waits for that same permit, and deterministically times out after two seconds. [Evidence](../experiments/resolve-load/2026-07-11/README.md#d011-same-plugin-reentrancy-can-deadlock)
- Impact: one worker, all workers occupied by reentrant calls, a broadcast calling another parallel plugin, or `moduleParsed` awaiting a new module can form a permit cycle. Default `skipSelf` only avoids one subset of resolver recursion, and merely increasing the pool does not bound recursive depth.
- Fix condition: nested scheduling has a proven non-blocking ownership rule or a separate reentrant path, with tests for same-plugin, cross-plugin, load, cancellation, and failure cases.

## D012: plugin options are limited by structured clone

- Status: source-proven by the worker constructor and [Node worker documentation](https://nodejs.org/api/worker_threads.html#new-workerfilename-options).
- Severity: blocker for whole-plugin options that contain functions; otherwise configuration-dependent.
- Behavior: [`pluginInfos` is passed through `workerData`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/packages/rolldown/src/utils/initialize-parallel-plugins.ts#L58-L73). Functions cannot be cloned, and class prototypes and accessors are not preserved.
- Impact: preprocessors, compiler plugins, callbacks, and other common configuration forms cannot be sent to the current plugin factory unchanged.
- Fix condition: the worker boundary accepts an explicit serializable snapshot, or non-serializable integrations remain in a coordinator and expose a defined proxy or task interface.

## D013: functional output filename options can panic during worker-side asset emission

- Status: source-inferred from a deterministic code path; reproduction pending.
- Severity: high for affected output configurations because the expected result is a process panic rather than a plugin diagnostic.
- Behavior: worker context has empty output options, so [`emitFile`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/packages/rolldown/src/plugin/plugin-context.ts#L371-L418) cannot call functional `assetFileNames` or `sanitizeFileName`. Rust's synchronous option path then `expect()`s the missing value in [`assetFileNames`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/crates/rolldown_common/src/inner_bundler_options/types/output_option/asset_filenames.rs#L28-L32) or [`sanitizeFileName`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/crates/rolldown_common/src/inner_bundler_options/types/output_option/sanitize_filename.rs#L39-L49).
- Impact: emitting an asset without an explicit `fileName` can panic for valid output configurations.
- Fix condition: option callbacks run in a defined owner before synchronous emission, or worker emission uses an async request to that owner and returns a normal diagnostic on failure.

## D014: worker count, replication, and reuse are not configurable

- Status: source-proven.
- Severity: medium for correctness, high for performance and resource predictability.
- Behavior: [`initializeParallelPlugins`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/packages/rolldown/src/utils/initialize-parallel-plugins.ts#L25-L45) creates `min(os.availableParallelism(), 8)` workers and initializes every parallel plugin in every worker. A normal `generate` or `write` stops the previous workers before creating a new pool; watch keeps its pool until close.
- Impact: lightweight plugins pay unnecessary startup and memory, heavy plugins can oversubscribe the Rust core, one plugin's long tasks can consume shared capacity needed by another, a single-worker isolation mode is unavailable, and repeated output builds cannot reuse compiler state.
- Production observation: the Cloudflare MDX screen measured 62.26 seconds with one worker, 38.63 seconds with two, 25.01 seconds with four, and 27.80 seconds with eight on an M3 Pro reporting 12 available CPUs. Four was the best tested count for this workload; eight regressed while total CPU rose about 65.1% and peak RSS about 6.8%, but the screen does not isolate the causal mechanism. The same host's sufficiently heavy controlled transform continues improving through twelve workers, so neither a static hardware-derived cap of eight nor a universal cap of four is valid. Pool readiness was about 1.997 seconds, while ordinary already spent about 1.842 seconds in the same production factory. [Evidence](../experiments/cloudflare-mdx/2026-07-12-results.md#worker-count-and-sustained-execution), [live policy study](../.agents/docs/scale-crossover-worker-policy.md)
- Fix condition: Rolldown owns one global CPU and memory budget; plugins use a managed shared worker group by default; a plugin can request an exclusive group containing one or several workers; worker count, per-plugin fairness, subset placement, reuse, failure effects, and shutdown follow explicit policies; and shared versus exclusive behavior is validated by the [production-scale goal](../.agents/docs/production-scale-goal.md).

## D015: bootstrap cleanup and post-bootstrap worker health have no explicit control path

- Status: partial-initialization cleanup failure observed; pre-message error and exit handling plus post-bootstrap health remain source-proven gaps.
- Severity: high for production use and fault attribution.
- Behavior: [`initializeWorker`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/packages/rolldown/src/utils/initialize-parallel-plugins.ts#L48-L87) waits for one bootstrap `message` but does not listen for `error` or `exit`, so a worker that fails before posting can leave initialization unsettled. If one worker reports an initialization error, the rejecting `Promise.all` path has no list with which to terminate other workers that already succeeded or are still starting. After bootstrap, there is no exit, replacement, cancellation, or worker-health state shared with Rust.
- Observed result: a plugin-factory error is initially reported, then a peer worker still registering the Node-API binding panics with `PendingException` and aborts the process with SIGABRT. Research commit `8fe749827` waits for every initialization result, awaits failed-worker termination, terminates successful peers, and converts the same fixture into a clean attributed exit 1. [Evidence](../experiments/core-transform/2026-07-11-node-24.18.0-smoke.md)
- Impact: bootstrap can abort, hang, or leave partially initialized workers, and a later worker crash can turn calls into bridge errors or unavailable capacity without a clear plugin diagnostic or pool repair.
- Fix condition: bootstrap resolves or rejects on message, error, and exit; partial initialization terminates every peer; worker exit invalidates or repairs its slot, rejects in-flight and queued hooks with attributed errors, and cannot leave permits or registry state inconsistent.

## D016: worker instances may expose inconsistent hook shapes

- Status: source-proven behavior; failure requires a thread-dependent factory and is unreproduced.
- Severity: medium because the current factory exposes `threadNumber` without requiring an identical plugin shape.
- Behavior: the wrapper uses `first_plugin()` to decide whether a hook exists and to obtain the plugin name. Workers enter the registry in bootstrap-completion order, not `threadNumber` order. A factory that conditionally exposes hooks by thread can therefore skip hooks globally or route a call to an instance without that hook.
- Impact: behavior depends on startup timing and cannot be described as either one designated coordinator instance or identical replicated instances.
- Fix condition: the contract requires and validates identical hook shapes, or the scheduler models designated instance roles explicitly instead of inferring them from the first registration.

## D017: watch invalidation does not reach worker-local context data

- Status: source-proven disconnected invalidation path; stale-state consequences are source-inferred and unreproduced.
- Severity: high for watch and repeated incremental builds.
- Behavior: watch keeps the worker pool alive, but each worker's `PluginContextData` is independent. The [`invalidateJsSideCache`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/packages/rolldown/src/utils/bindingify-input-options.ts#L92-L109) callback passed to Rust is bound to the main-thread `PluginContextData`, so its `clear()` cannot clear worker-local `loadModulePromiseMap` or `renderedChunkMeta` state.
- Impact: a reused worker can retain JavaScript-side context state across invalidations that the ordinary main-thread plugin path would clear; plugin closure caches add further adapter-specific invalidation requirements.
- Fix condition: every reused worker receives build and module invalidation events with defined ordering, and watch fixtures prove that worker-local and coordinator state matches ordinary-plugin rebuild behavior.

## D018: native hook filters run after worker-pool acquisition

- Status: observed for controlled `resolveId` and `load` misses on Node.js 24.18.0, in addition to the source path.
- Severity: workload-dependent performance defect; high when a hook has many fast misses or several parallel plugins share the pool.
- Behavior: [`ParallelJsPlugin::load`](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/crates/rolldown_binding/src/options/plugin/parallel_js_plugin.rs#L112-L120), `resolve_id`, and `transform` call `run_single` and acquire a worker permit before the selected [`JsPlugin` evaluates its filter](https://github.com/rolldown/rolldown/blob/21d7b32827045e377a82c3cb681dafa51c244883/crates/rolldown_binding/src/options/plugin/js_plugin.rs#L200-L220). A rejected call avoids the Node callback but still enters pool scheduling.
- Observed result: the dedicated resolver miss records one wrapper call, one acquired permit, one null result, and zero JavaScript handler calls. Formal 512-hit `resolveId` and `load` builds each record 513 acquired wrappers and one filter miss. The graph-preserving Svelte transform records 426 acquired wrappers, 354 values, and 72 native-filter nulls for 354 JavaScript handlers. [Hook evidence](../experiments/resolve-load/2026-07-11/README.md#d018-native-filters-run-after-permit-acquisition), [Svelte graph evidence](../experiments/svelte-transform/2026-07-11-svelte-registry-graph-results.md#cost-attribution)
- Impact: miss-heavy plugins can queue behind the shared worker pool and briefly occupy permits even when a Rust-side filter has enough information to reject them. Real hits can wait behind work that should never select a worker, and adding a native filter does not remove this queueing cost under the wrapper.
- Fix condition: wrapper-visible hook usage and filters reject calls before permit acquisition, ordinary and parallel variants use equivalent filters, and measurements prove that filter-only gains are not attributed to worker execution.

## D019: worker hook failures lose plugin, hook, and complete module attribution

- Status: observed for controlled synchronous and rejected transform failures, controlled `resolveId` and `load` failures, the pinned Vue compiler error, and the pinned Svelte compiler error on Node.js 24.18.0.
- Severity: medium for debugging and plugin compatibility; the build fails rather than silently succeeding.
- Behavior: the controlled transform fixtures retain the thrown message but render `Error: Error: <message>` without the plugin name, module ID, hook name, or worker-side stack. Controlled resolve and load failures propagate and exit without a signal, but worker stderr loses the ordinary plugin label and original handler frame; failed builds also end before drop-time hook metrics appear. The Vue compiler probe loses ordinary plugin, hook, module ID, location, parser code, and worker stack. Both Svelte probes retain a relative filename, source frame, code, and position but lose the complete module path, plugin label, ordinary compiler error shape, and worker stack; the graph probe does not expose a separate structured hook field in either form. Peer workers terminate promptly in the controlled transform fixtures. [Core evidence](../experiments/core-transform/2026-07-11-node-24.18.0-smoke.md), [hook evidence](../experiments/resolve-load/2026-07-11/README.md#d019-errors-propagate-but-worker-attribution-is-lost), [Vue evidence](../experiments/vue-transform/2026-07-11-vue-icon-results.md), [isolated Svelte evidence](../experiments/svelte-transform/2026-07-11-svelte-results.md#correctness-gates), [Svelte graph evidence](../experiments/svelte-transform/2026-07-11-svelte-registry-graph-results.md#correctness-and-diagnostic-gates)
- Impact: users can see the immediate message but cannot identify which parallel plugin instance or module produced it, and worker stacks needed to debug compiler failures are lost.
- Fix condition: synchronous and asynchronous hook failures retain the plugin name, hook, module ID, original message and stack, exit without leaked workers, and match ordinary-plugin error attribution at the strongest practical level.

## D020: a pending asynchronous hook holds an exclusive worker permit

- Status: observed for controlled asynchronous `load` on Node.js 24.18.0.
- Severity: high performance defect for already-asynchronous hooks; a compatibility risk if a plugin instance assumes either exclusive or concurrent callback execution.
- Behavior: `run_single` holds one worker permit until the JavaScript Promise settles, even while that worker's event loop is idle and capable of tracking more Promises. An ordinary plugin overlaps 512 five-millisecond timers and completes in about 22 ms. Worker-1 serializes them in about 3.0 seconds; worker-8 still takes about 440 ms because only eight Promises can be pending. Ordinary JavaScript handler activity reaches 512, while parallel activity is exactly bounded by the worker count. [Evidence](../experiments/resolve-load/2026-07-11/README.md#main-thread-responsiveness)
- Impact: moving async filesystem, network, or timer work into the current pool can reduce existing event-loop concurrency by orders of magnitude while adding startup, CPU, and memory. Releasing the permit at Promise creation would instead allow concurrent callbacks on one plugin instance and can break mutable-state assumptions, so this is an execution-contract issue rather than a local semaphore tweak.
- Fix condition: the supported contract either keeps already-asynchronous hooks on the coordinator, gives pending operations a separate capacity policy, or explicitly permits concurrent calls within one worker instance with ordering, state, reentrancy, cancellation, and shutdown tests.
