# Scale-Crossover Protocol Amendment 4: Directus Independent Large Vue Project

Status: frozen on 2026-07-12 before any independent-project wall timing. This amendment changes only the large band of the independent Vue project comparison in the [frozen execution protocol](./scale-crossover-frozen-protocol.md). The controlled Vue curve, MDX curve, runtime profiles, host gate, worker and Rust-pool settings, statistical and resource thresholds, and product-crossover requirements remain unchanged.

## Trigger: the frozen large candidates cannot supply a valid high-frequency Vue transform graph

The pinned GitLab source contains 2,620 physical SFCs and its production entry generator yields 374 entries, but the selected graph requires Vue 2.7.16 and Vue 3 compat/compiler-sfc 3.5.34, two loader versions, `?vue3` routing, custom-element configuration, and infection propagation. The current transform-only Vue 3 adapter cannot preserve that contract, so GitLab is rejected before transform with `GITLAB_DUAL_COMPILER_CONTRACT_UNAVAILABLE`; it is not silently compiled under different semantics.

The frozen Vben fallback has 680 repository-wide physical SFCs, but the selected app plus every reachable workspace package contains only 375 and the real `apps/web-antd/src/main.ts` graph transforms 366. Even the conservative union of all five official app entry closures contains only 469 SFCs, below the frozen 512 threshold. Vben therefore cannot fill the large band. PrimeVue remains a workspace-resolution bridge and cannot be relabelled large.

TDesign Vue Next was evaluated as the first amendment candidate and rejected. Its `packages/components` subtree contains 744 physical SFCs, but the real `packages/components/index.ts` library entry and official production TS/TSX build transform zero SFCs; 685 physical files are examples, demos, or tests and the remaining 59 are usage files outside the production graph. This is direct evidence that repository file count cannot substitute for actual transform hits.

## Promoted large project

The large comparison is [Directus](https://github.com/directus/directus/tree/9f2f73aee7d8647d3f187dac43f724fe617763f5) at commit `9f2f73aee7d8647d3f187dac43f724fe617763f5`, using its real `app/src/main.ts` production application entry. The pinned `app/license` is Business Source License 1.1 with SHA-256 `f209dfa60e56b29f6e8e5cefde91dec4ce86f12289209ede63520556385d555d`.

The prepared checkout scope contains 561 SFCs and 2,675,339 bytes with physical manifest SHA-256 `9c790f915893da23aa1406a6e8744a74a71cea4841a377ac20c5d803947d12a7`. The real graph transforms 546 SFCs and 2,667,307 source bytes, including `packages/themes/src/components/theme-provider.vue` reached through the checked-out `@directus/themes` workspace package. Exactly 15 prepared SFCs are outside the graph. The reached-source manifest is `2fc2f91479509f3ec7e45fcfce527f07e87d840ddaaf1fb20e2fd2e5744176cf`; the transform source/result manifest is `f99fd2cfd58ed134612d295f9176a903cc2a861ba05e2b3ef7843ef945a013ef`.

The completed direct-Rolldown graph contains 1,966 modules with manifest SHA-256 `5a189112149b735fa33cc97b900303a873f3e908e87541f90d55aad87eafbabc`. Its normalized code and generated-map hashes are `7d39e88ca1f0a8a31cafe898e0a0e7fb7c6a92815aedca4460943618a343dc26` and `007636cd19156e4de84f5f1579559b97501d97e9c6467757f583d810f940882b`. These hashes are correctness goldens for the frozen harness; they do not establish transform-level source-map-chain correctness.

## Project support and compiler provenance

The harness expands only the six literal `import.meta.glob` calls used by the pinned application and records every importer, pattern, option, and matched file. The frozen expansion covers 126 files with manifest SHA-256 `c0e6bf016a14745680bdc1ac4dcc71ff73a11c0c0248f559752a6bbd73086dcf`. Checked-out workspace package declarations form a 33-package manifest `62b3fe65a546773989df2e8fef0b0a3ac360e88af4ed921c66299009de73b168`; the 480 source-to-workspace resolutions form manifest `5ece9537182b9d3ecb6813c0c3780b732e38cee0942406e5645ee0f2db424612`. Missing repository-local edges fail. Catalog dependencies `@directus/license` and `@directus/vue-split-panel` remain external.

Preparation uses Node 24.18.0 Corepack to invoke exactly `pnpm@10.27.0`, disables lifecycle scripts, pins root lock SHA-256 `aeafd45f0650bd6265ada31e7a530f3a83ae62b7cce1c36eb60f45de9b2b42c1`, and validates the installed lock, `.modules.yaml`, and critical package manifests. The project installs Vue/compiler 3.5.24, while the research transform adapter deliberately and visibly uses `unplugin-vue` 7.2.0 and `@vue/compiler-sfc` 3.5.39. Every run pins their package manifests and the adapter implementation source manifest instead of claiming that the project compiler performed the transform.

The narrow support layer replaces raw, YAML, asset URL, Sass/CSS, and Vue style-child requests deterministically so that local graph edges remain closed. It does not construct or execute Vite. These replacements, the transform-only adapter, transform source maps disabled inside the Vue kernel, and the absence of warning/error sentinels mean this lane is independent graph and mechanical transform evidence rather than product crossover evidence.

## Hard admission before timing

Directus enters the frozen large band only after a clean committed harness produces a durable correctness artifact and compact summary with:

1. Two fresh ordinary processes and worker-one and worker-four processes, all exiting normally with `executionStatus=completed` and `admissionStatus=accepted`.
2. Exact parity for all 546 transform IDs, source and result bytes, transform and graph manifests, glob and workspace manifests, warnings, chunks, exports, normalized code, and generated maps.
3. Exact runtime, pool, Node, package-manager, installed-dependency, actual adapter/compiler, matrix, golden, and harness provenance.
4. A raw artifact SHA-256 and checkout-path-independent canonical evidence hash generated from a clean worktree. A dirty or pre-amendment run is provisional and cannot open the wall gate.

The corrected ordinary golden was established during admission diagnosis, but the pre-correction worker runs audited only 545 application-local SFCs. They are not promoted. Worker parity must be rerun after the harness is committed and the complete reached-source audit is active.

## Independent wall comparison

After hard admission, the independent comparison consists of Floating Vue as the four-SFC small project, cabinet-fe/icon as the 166-SFC medium project, and Directus as the 546-SFC large project. PrimeVue may remain a workspace bridge but does not define a scale band. GitLab, Vben, and TDesign remain retained rejection evidence and are not timed as substitutes.

Each accepted project first receives one fresh-process uninstrumented local screen of ordinary plus worker counts one through eight under the lifecycle-corrected baseline and frozen host gate. The screened best resource-eligible count and adjacent lower and higher counts are then repeated in rotated blocks, using fifteen blocks below two seconds and ten otherwise. These are different real project families, so their results validate small-project regression and workload portability; they must not be joined into a synthetic nested crossover curve. The controlled schema-2 Vue corpus remains the source of the nested Vue crossover.
