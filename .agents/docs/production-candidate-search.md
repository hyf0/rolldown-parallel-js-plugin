# Production Candidate Search Manifest

Status: committed before deep screening on 2026-07-12. This manifest freezes the discovery universe, selection rules, longlist, and three-candidate screening order for the active [production-scale goal](./production-scale-goal.md). Later evidence may reject a selected candidate but must not replace it merely because it fails.

## Environment pin at goal start

- Official Node.js distribution index inspected on 2026-07-12: `v24.18.0`, released 2026-06-23, LTS codename `Krypton`, npm `11.16.0`, V8 `13.6.233.17`, modules ABI `137`. Source: [Node.js distribution index](https://nodejs.org/dist/index.json), [release record](https://nodejs.org/en/blog/release/v24.18.0/).
- Installed executable: `/Users/yunfeihe/.vite-plus/bin/node`, `v24.18.0`, arm64 Darwin, SHA-256 `c372d2c2da14b1e2086a4965ced59359616d885501426669c07c244c7d854273`.
- Discovery host: Apple M3 Pro, 12 logical CPUs, 36 GiB RAM, macOS 26.5.1 build 25F80. This is a discovery pin, not yet the formal no-swap resource envelope.

## Declared public discovery universe

Discovery ran on 2026-07-12 and stopped before cloning, installing, building, or adapting a candidate. The finite universe is the initial longlist below, derived from these public indexes and source-backed queries:

- GitHub Code Search, first 100 results for each query: `"rolldown" filename:package.json`, `from "rolldown" language:TypeScript`, `rolldown.config.ts`, `"babel-plugin-react-compiler" filename:package.json`, `"@rolldown/plugin-babel"`, `babel-loader repo:elastic/kibana`, `@babel/core repo:elastic/kibana`, and `babel-loader repo:WordPress/gutenberg`.
- Sourcegraph discovery index, first 1,000 results: `context:global "babel-plugin-react-compiler" file:(babel|vite|next).*config\.(js|cjs|mjs|ts|mts)$ count:1000`.
- Web search queries: `site:github.com "reactCompiler: true" "next.config.ts"`, `site:github.com "reactCompiler: true" "next.config.js"`, `site:github.com "babel-plugin-react-compiler" "turbo.json"`, `site:github.com "babel-plugin-react-compiler" "pnpm-workspace.yaml"`, `site:github.com rolldown "babel-plugin-react-compiler"`, `site:github.com rolldown "@mdx-js/rollup"`, `site:github.com rolldown "svelte/compiler"`, `site:github.com rolldown "unplugin-vue"`, and `site:github.com rolldown "@sveltejs/package"`.
- GitHub repository and recursive-tree APIs for candidate revision, license metadata, source counts, and truncation status.
- GitHub workflow and Actions-run evidence for public production duration.
- The existing Rolldown React Compiler and Vue/Svelte research sources already pinned by [current-state evidence](../../research/current-state.md).

GitHub Code Search reached its authenticated 10-query-per-minute limit after the declared queries. That did not broaden the universe: the initial longlist below is the frozen result of discovery, and all later checks operate only on it.

## Inclusion and exclusion rules

A longlist entry needed public pinned source plus at least one plausible route to both real scale and a required synchronous JavaScript transform. Direct Rolldown use, a public production duration, and an exact matching-file count increased priority but were not assumed when missing.

Deep-screen priority is determined in this order:

1. Public evidence of roughly 5,000 distinct project modules selected by one expensive transform or transform chain.
2. Public evidence of a representative 15–30 minute production build.
3. A synchronous JavaScript compiler or transform chain that is required by the project rather than an optional benchmark.
4. A credible path to one direct-Rolldown invocation that preserves the original production graph and plugin behavior without Vite runtime.
5. Public source, lockfile, configuration, inputs, outputs, and redistribution or reviewability.

Preliminary exclusion applies when public source already proves fewer than roughly 5,000 possible matching modules, native or Rust ownership of the expensive work, many independent package builds rather than one graph, generated physical files that do not enter a transform hook, a private corpus, or no credible path outside Vite. Missing evidence is not converted into a positive fact.

## Frozen initial longlist

| Candidate | Pinned revision | Discovery evidence | Preliminary disposition |
| --- | --- | --- | --- |
| Cloudflare Docs | [`2b08a67a41da1a521aecbcf465893abae1e9a6df`](https://github.com/cloudflare/cloudflare-docs/tree/2b08a67a41da1a521aecbcf465893abae1e9a6df) | 6,719 `.mdx` files under `src/content/docs`; production Actions build step 17m59s; `@astrojs/mdx` plus project remark/rehype plugins | Selected first; direct-Rolldown and graph-preservation are unresolved and may reject it immediately |
| WordPress Gutenberg | [`eb24e81eb05de53abb7238a9e6b0b7882b4bd490`](https://github.com/WordPress/gutenberg/tree/eb24e81eb05de53abb7238a9e6b0b7882b4bd490) | Complete recursive tree has 6,611 non-declaration JS/TS files; production webpack configuration uses `babel-loader` | Selected second; reachable filter count, duration, direct-Rolldown compatibility, and Babel share are unresolved |
| Elastic Kibana | [`60605e8006b0ffe337f5e5673ccdea4a28eafc5a`](https://github.com/elastic/kibana/tree/60605e8006b0ffe337f5e5673ccdea4a28eafc5a) | Truncated recursive tree already contains 32,416 non-declaration JS/TS paths; repository contains synchronous `kbn-babel-transform` and optimizer Babel-loader configuration | Selected third; one-graph topology, duration, direct-Rolldown compatibility, licensing, and Babel share are unresolved |
| Actual Budget | [`b37bfe2cb726f1ef43d6270266a85042c0abf7d2`](https://github.com/actualbudget/actual/tree/b37bfe2cb726f1ef43d6270266a85042c0abf7d2) | Direct Rolldown-compatible `@rolldown/plugin-babel` React Compiler config, but only 520 `.jsx`/`.tsx` files under its transform root and 506 after obvious tests | Preliminary reject: decisive scale miss |
| Infisical frontend | [`b70eb24fc49d9cdda9e29501eec72613ad0a54e0`](https://github.com/Infisical/infisical/tree/b70eb24fc49d9cdda9e29501eec72613ad0a54e0) | Current frontend has 3,917 JS/TS files; prior Rolldown fan-out transformed 3,176 files in seconds | Preliminary reject: below scale, synthetic fan-out, swallowed warnings, and native Oxc React Compiler work |
| Home Assistant Frontend | [`42e0a1e4b53531b313c060768008817618aa0f64`](https://github.com/home-assistant/frontend/tree/42e0a1e4b53531b313c060768008817618aa0f64) | Real Babel toolchain, but only 2,865 non-declaration JS/TS files repository-wide | Preliminary reject: decisive scale miss before reachability |
| Marimo | [`1f1bb633df7e635899ffb88479576944dd15b543`](https://github.com/marimo-team/marimo/tree/1f1bb633df7e635899ffb88479576944dd15b543) | Product frontend Vite configs use `babel-plugin-react-compiler` | Not selected: scale, duration, and no-Vite direct graph are unproven and weaker than the selected entries |
| Arize Phoenix | [`6938695f77fed40b390e3d6b79d483c3d071b72e`](https://github.com/Arize-ai/phoenix/tree/6938695f77fed40b390e3d6b79d483c3d071b72e) | One app-level Vite config uses `babel-plugin-react-compiler` with `panicThreshold: "none"` | Not selected: scale, duration, and direct-Rolldown parity are unproven |
| Filen Web | [`2c2bf21123331f81ace6f4914063bf91c7ec11b9`](https://github.com/FilenCloudDienste/filen-web/tree/2c2bf21123331f81ace6f4914063bf91c7ec11b9) | Single app config contains `babel-plugin-react-compiler`; AGPL-3.0 | Not selected: scale, duration, compiler share, and direct-Rolldown parity are unproven |
| FireCMS | [`cb002b4df1d5b84dcd4bd6de3ac6db6fd56b65e9`](https://github.com/firecmsco/firecms/tree/cb002b4df1d5b84dcd4bd6de3ac6db6fd56b65e9) | At least 14 package-level Vite configs contain `babel-plugin-react-compiler` | Preliminary reject: fragmented package builds cannot be summed into one primary invocation |
| Nexus Mods Vortex | [`5eb7e97359953a9d5d27ad2ebfa163db6803171b`](https://github.com/Nexus-Mods/Vortex/tree/5eb7e97359953a9d5d27ad2ebfa163db6803171b) | Real direct-Rolldown production configs across the app and extensions | Not selected: inspected base config exposes no required expensive JavaScript transform, and many extension builds are independent invocations |
| DataDog Browser SDK | [`2bacdcf830a7ac32ff782153b92ed48f0c998c4b`](https://github.com/DataDog/browser-sdk/tree/2bacdcf830a7ac32ff782153b92ed48f0c998c4b) | Production package build now calls tsdown/Rolldown | Preliminary reject: the source transform is native Oxc, while declarations use a separate TypeScript program; no required module-local JS transform was found |
| FormatJS | [`afe004c6e7797d3e05ae58be3658c4d2521ca07c`](https://github.com/formatjs/formatjs/tree/afe004c6e7797d3e05ae58be3658c4d2521ca07c) | Bazel tool invokes direct Rolldown and optionally `rolldown-plugin-dts` | Preliminary reject: package-level invocations and no qualifying high-frequency synchronous JS transform in the inspected bundle path |
| Fumadocs | [`3958960afebb03a560880a0b89be931ddba25125`](https://github.com/fuma-nama/fumadocs/tree/3958960afebb03a560880a0b89be931ddba25125) | Provides a direct Rolldown MDX integration | Not selected: its own production corpus and 15–30 minute single graph are not established |
| Tabler Icons | [`6d128ed935d4546607b1e4d5d08c8b27bdbe7758`](https://github.com/tabler/tabler-icons/tree/6d128ed935d4546607b1e4d5d08c8b27bdbe7758) | Generates thousands of real Svelte and Vue icon modules | Preliminary reject: production package paths generate or package files rather than compile every component through the required bundler transform |
| Reported private Svelte application | [public discussion](https://github.com/sveltejs/kit/discussions/13455) | Report says 3,768 Svelte components, 15,328 TS files, and a 10-minute production build | Preliminary reject: private unreviewable corpus, fewer than 5,000 Svelte transforms, below duration, and Vite runtime |
| GitLab Community Edition mirror | [`e8bc1d46aca1a28cb7f7e14a42bc5d9b84609cd2`](https://github.com/gitlabhq/gitlabhq/tree/e8bc1d46aca1a28cb7f7e14a42bc5d9b84609cd2) | Truncated tree lower bounds include 2,620 `.vue`, 1,154 `.graphql`, and 4,064 `.js` files | Not selected: separate handler populations cannot be combined, duration is unpinned, and obvious paths use Vite/Babel rather than direct Rolldown |

## Selected deep-screen order

### 1. Cloudflare Docs

This is the only public discovery entry that already proves both requested order-of-magnitude facts: more than 5,000 plausible expensive content transforms and a production step inside 15–30 minutes. The first screen is deliberately narrow and decisive: inspect the pinned Astro content pipeline, prove whether approximately 5,000 MDX files actually enter one transform boundary, and determine whether one no-Vite direct-Rolldown invocation can preserve the original production graph and configuration. Reject before installation or timing when the direct graph cannot exist without changing the workload.

### 2. WordPress Gutenberg

This is the smallest selected repository with a complete tree already above the distinct-module target and a production Babel loader. Screen the pinned webpack multi-entry topology, exact Babel include/exclude rules, reachable distinct matching modules, and whether an equivalent direct-Rolldown graph can preserve loader behavior. Only then install or time it.

### 3. Elastic Kibana

This is the largest selected codebase and has explicit synchronous Babel transform code, but its optimizer may consist of many separately scheduled bundles. Screen the pinned optimizer topology, Babel filter, module counts per compilation, and whether a single direct-Rolldown graph can represent the production unit. Reject if only the aggregate of independent compilations reaches the scale or duration gate.

## Evidence links for selected candidates

- Cloudflare Docs count: [recursive tree](https://api.github.com/repos/cloudflare/cloudflare-docs/git/trees/2b08a67a41da1a521aecbcf465893abae1e9a6df?recursive=1); duration: [Actions run 29160281389](https://github.com/cloudflare/cloudflare-docs/actions/runs/29160281389); workflow: [publish-production.yml](https://github.com/cloudflare/cloudflare-docs/blob/2b08a67a41da1a521aecbcf465893abae1e9a6df/.github/workflows/publish-production.yml); configuration: [astro.config.ts](https://github.com/cloudflare/cloudflare-docs/blob/2b08a67a41da1a521aecbcf465893abae1e9a6df/astro.config.ts), [package.json](https://github.com/cloudflare/cloudflare-docs/blob/2b08a67a41da1a521aecbcf465893abae1e9a6df/package.json).
- Gutenberg count: [recursive tree](https://api.github.com/repos/WordPress/gutenberg/git/trees/eb24e81eb05de53abb7238a9e6b0b7882b4bd490?recursive=1); Babel path: [webpack.config.js](https://github.com/WordPress/gutenberg/blob/eb24e81eb05de53abb7238a9e6b0b7882b4bd490/packages/scripts/config/webpack.config.js), [package.json](https://github.com/WordPress/gutenberg/blob/eb24e81eb05de53abb7238a9e6b0b7882b4bd490/packages/scripts/package.json).
- Kibana count lower bound: [truncated recursive tree](https://api.github.com/repos/elastic/kibana/git/trees/60605e8006b0ffe337f5e5673ccdea4a28eafc5a?recursive=1); Babel paths: [sync_transform.js](https://github.com/elastic/kibana/blob/60605e8006b0ffe337f5e5673ccdea4a28eafc5a/src/platform/packages/private/kbn-babel-transform/sync_transform.js), [webpack optimizer config](https://github.com/elastic/kibana/blob/60605e8006b0ffe337f5e5673ccdea4a28eafc5a/packages/kbn-optimizer/src/worker/webpack.config.ts), [Babel preset](https://github.com/elastic/kibana/blob/60605e8006b0ffe337f5e5673ccdea4a28eafc5a/packages/kbn-babel-preset/webpack_preset.js).

## Commitment boundary

No candidate repository was cloned, installed, built, adapted, or timed before this manifest commit. Deep screening is limited to the three selected entries in the frozen order. A selected candidate stops at its first decisive failed admission rule; later rules are marked `not evaluated`. No replacement candidate is promoted from the longlist after a failure.
