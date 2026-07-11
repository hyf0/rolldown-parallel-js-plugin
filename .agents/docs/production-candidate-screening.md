# Production Candidate Screening

Status: complete. The search universe and three-candidate order were frozen in commit `dc89184` before any research clone, installation, local build, adaptation, or timing run. All three selected candidates failed their first admission rule on pinned source evidence. This is an inconclusive corpus result, not a ParallelPlugin value verdict. [Terminal synthesis](../../research/production-scale-verdict.md)

## Screening protocol

- Screen only Cloudflare Docs, WordPress Gutenberg, and Elastic Kibana, in that order, from the frozen [candidate-search manifest](./production-candidate-search.md).
- Stop each candidate at its first decisive failed [workload admission rule](./production-scale-goal.md#workload-admission-gate). Mark every later rule `not evaluated`; do not replace a failed candidate.
- Source inspection may establish or reject a rule. Installation, ordinary timing, instrumentation, adaptation, and parallel implementation occur only when every earlier rule remains viable.
- The goal environment remains Node.js `v24.18.0`. Candidate CI evidence may use that same exact patch, but a Vite, Rollup, webpack, or other production build is not relabeled as direct Rolldown.

## Candidate 1: Cloudflare Docs

Disposition: rejected on 2026-07-12 at admission rule 1. No dependency installation, local build, adaptation, or local timing was performed.

### Pin and public evidence

- Project: [`cloudflare/cloudflare-docs@2b08a67a41da1a521aecbcf465893abae1e9a6df`](https://github.com/cloudflare/cloudflare-docs/tree/2b08a67a41da1a521aecbcf465893abae1e9a6df), license CC-BY-4.0.
- Production run: [GitHub Actions run 29160281389](https://github.com/cloudflare/cloudflare-docs/actions/runs/29160281389), job `86564079661`, same head SHA, Node.js `v24.18.0`, successful Build step from `2026-07-11T16:43:46Z` to `17:01:45Z`, exactly 17 minutes 59 seconds. The pinned [workflow invokes `pnpm run build`](https://github.com/cloudflare/cloudflare-docs/blob/2b08a67a41da1a521aecbcf465893abae1e9a6df/.github/workflows/publish-production.yml#L23-L52).
- Candidate source has 6,719 distinct `.mdx` paths under `src/content/docs` and 9,159 repository-wide. These are physical source counts only; exact expensive-handler hits are deliberately not claimed after the earlier rule fails.
- Exact framework sources: [`astro@6.4.7` tag commit `910e121ad33c481dcfb4b313abd7d8ff370ee347`](https://github.com/withastro/astro/tree/910e121ad33c481dcfb4b313abd7d8ff370ee347) and [`@astrojs/mdx@6.0.3` tag commit `0b879fbbaa0c8494835dab6f5c781b1c0cb36eac`](https://github.com/withastro/astro/tree/0b879fbbaa0c8494835dab6f5c781b1c0cb36eac/packages/integrations/mdx).

### First failed rule

Rule 1 requires an unmodified ordinary production build that uses Rolldown directly on the pinned Node.js release and lasts 15–30 minutes. The duration half passes, but the direct-Rolldown half fails:

- The project's production script is [`astro build`](https://github.com/cloudflare/cloudflare-docs/blob/2b08a67a41da1a521aecbcf465893abae1e9a6df/package.json#L5-L10), with Astro `6.4.7` and `@astrojs/mdx` `6.0.3` pinned in the same file. The lockfile resolves Astro through Vite `7.3.5`, which resolves Rollup `4.62.2`; it contains no Rolldown package or production configuration. [Exact lock entries](https://github.com/cloudflare/cloudflare-docs/blob/2b08a67a41da1a521aecbcf465893abae1e9a6df/pnpm-lock.yaml#L9486-L9539), [Vite-to-Rollup entry](https://github.com/cloudflare/cloudflare-docs/blob/2b08a67a41da1a521aecbcf465893abae1e9a6df/pnpm-lock.yaml#L14042-L14049).
- Exact Astro `6.4.7` constructs a Vite configuration during setup, then its production path calls [`vite.createBuilder(...)` and `builder.buildApp()`](https://github.com/withastro/astro/blob/910e121ad33c481dcfb4b313abd7d8ff370ee347/packages/astro/src/core/build/static-build.ts#L241-L322). The build owns sequential prerender, SSR, and client environments, route generation, asset movement, content injection, and post-build hooks; these are part of the production graph rather than a replaceable command-line wrapper.
- Exact `@astrojs/mdx` `6.0.3` registers its compiler through [`vite.plugins`](https://github.com/withastro/astro/blob/0b879fbbaa0c8494835dab6f5c781b1c0cb36eac/packages/integrations/mdx/src/index.ts#L82-L124). Its expensive `.mdx` handler is a [Vite transform that calls `mdxRenderer.process(...)`](https://github.com/withastro/astro/blob/0b879fbbaa0c8494835dab6f5c781b1c0cb36eac/packages/integrations/mdx/src/vite-plugin-mdx.ts#L15-L81).

A new direct-Rolldown fixture around the MDX compiler could measure a useful kernel, but it would replace Astro's Vite/Rollup orchestration and omit or reconstruct content loading, virtual modules, multiple build environments, route generation, prerendering, and asset behavior. That would be an adapted workload rather than the required unmodified production graph. It is therefore not an admissible substitute.

### Admission ledger

| Admission rule | Result | Evidence or reason |
| --- | --- | --- |
| 1. Direct Rolldown on pinned Node.js and stable 15–30 minute ordinary baseline | **Fail** | The same-SHA Node.js 24.18.0 production step is 17m59s, but it is `astro build` using Vite 7.3.5 and Rollup 4.62.2, not direct Rolldown. |
| 2. One real project with original relationships and production plugin configuration | Not evaluated | Screening stopped at rule 1. |
| 3. Required expensive JavaScript plugin or transform chain | Not evaluated | The MDX handler is plausible, but formal ownership and retained-JavaScript justification were not admitted. |
| 4. Roughly 5,000 distinct project module IDs at the expensive handler boundary | Not evaluated | 6,719 source files are only a preliminary physical count; no handler-boundary instrumentation was run. |
| 5. Critical-path share can mathematically reach a 2x complete-build result | Not evaluated | No ordinary blocking timeline or replay bound was run. |
| 6. Sustained ready transform width | Not evaluated | No timeline was run. |
| 7. Relevant time is synchronous JavaScript rather than asynchronous I/O or native work | Not evaluated | No stage attribution was run. |
| 8. Source, behavior, diagnostics, maps, and environment are reviewable | Not evaluated | Later rule after the decisive failure. |

## Candidate 2: WordPress Gutenberg

Disposition: rejected on 2026-07-12 at admission rule 1. No dependency installation, local build, adaptation, or local timing was performed.

### Pin and source correction

- Project: [`WordPress/gutenberg@eb24e81eb05de53abb7238a9e6b0b7882b4bd490`](https://github.com/WordPress/gutenberg/tree/eb24e81eb05de53abb7238a9e6b0b7882b4bd490), license GPL-2.0-or-later.
- The complete pinned tree has 6,611 non-declaration JavaScript and TypeScript files. This remains a physical source count only; exact handler hits were not evaluated after rule 1 failed.
- The preliminary manifest found a real [`@wordpress/scripts` webpack configuration](https://github.com/WordPress/gutenberg/blob/eb24e81eb05de53abb7238a9e6b0b7882b4bd490/packages/scripts/config/webpack.config.js#L1-L26) whose JavaScript rule invokes [`babel-loader`](https://github.com/WordPress/gutenberg/blob/eb24e81eb05de53abb7238a9e6b0b7882b4bd490/packages/scripts/config/webpack.config.js#L164-L199). Deep screening corrected the important inference: that reusable package configuration is not the pinned repository's root production build path.

### First failed rule

Rule 1 requires an unmodified ordinary production build that uses Rolldown directly on the pinned Node.js release and lasts 15–30 minutes. Direct Rolldown fails before duration needs evaluation:

- The root [`build` script](https://github.com/WordPress/gutenberg/blob/eb24e81eb05de53abb7238a9e6b0b7882b4bd490/package.json#L92-L97) invokes the private `@wordpress/build-scripts` workspace. Its orchestrator cleans outputs, runs every workspace's build script, builds TypeScript declarations and vendors, invokes `wp-build` in production mode, generates three block manifests, then runs every workspace's `build:wp` script. [Pinned orchestration](https://github.com/WordPress/gutenberg/blob/eb24e81eb05de53abb7238a9e6b0b7882b4bd490/tools/build-scripts/build.mjs#L94-L208).
- The production `wp-build` tool is [`@wordpress/build`](https://github.com/WordPress/gutenberg/blob/eb24e81eb05de53abb7238a9e6b0b7882b4bd490/packages/wp-build/package.json#L1-L53), which declares and imports esbuild plus `esbuild-plugin-babel`, not Rolldown. Its implementation directly calls `esbuild.build(...)` for package, browser, route, widget, worker, CommonJS, and ESM outputs. [Pinned imports](https://github.com/WordPress/gutenberg/blob/eb24e81eb05de53abb7238a9e6b0b7882b4bd490/packages/wp-build/lib/build.mjs#L1-L23), [representative build calls](https://github.com/WordPress/gutenberg/blob/eb24e81eb05de53abb7238a9e6b0b7882b4bd490/packages/wp-build/lib/build.mjs#L1445-L1512).
- The lockfile contains a transitive `@rolldown/pluginutils` utility, but no Rolldown bundler or production Rolldown configuration participates in this command. A direct-Rolldown benchmark would require replacing the production build system and re-expressing multiple independent workspace and output steps; it would not be the unmodified ordinary build required by the gate.

### Admission ledger

| Admission rule | Result | Evidence or reason |
| --- | --- | --- |
| 1. Direct Rolldown on pinned Node.js and stable 15–30 minute ordinary baseline | **Fail** | The root production command is a multi-stage workspace orchestrator whose bundle work uses esbuild; it does not use Rolldown directly. Duration was not evaluated after this decisive failure. |
| 2. One real project with original relationships and production plugin configuration | Not evaluated | Screening stopped at rule 1. |
| 3. Required expensive JavaScript plugin or transform chain | Not evaluated | The Babel path exists, but its production reach and ownership were not evaluated. |
| 4. Roughly 5,000 distinct project module IDs at the expensive handler boundary | Not evaluated | 6,611 source files are only a physical count; no handler-boundary instrumentation was run. |
| 5. Critical-path share can mathematically reach a 2x complete-build result | Not evaluated | No ordinary wall baseline, blocking timeline, or replay bound was run. |
| 6. Sustained ready transform width | Not evaluated | No timeline was run. |
| 7. Relevant time is synchronous JavaScript rather than asynchronous I/O or native work | Not evaluated | No stage attribution was run; the active bundler is native esbuild. |
| 8. Source, behavior, diagnostics, maps, and environment are reviewable | Not evaluated | Later rule after the decisive failure. |

## Candidate 3: Elastic Kibana

Disposition: rejected on 2026-07-12 at admission rule 1. No dependency installation, local build, adaptation, or local timing was performed.

### Pin and public evidence

- Project: [`elastic/kibana@60605e8006b0ffe337f5e5673ccdea4a28eafc5a`](https://github.com/elastic/kibana/tree/60605e8006b0ffe337f5e5673ccdea4a28eafc5a), tri-licensed by file headers under Elastic License 2.0, GNU AGPLv3, or Server Side Public License v1 where applicable.
- The truncated discovery tree already contained 32,416 non-declaration JavaScript and TypeScript paths. This remains a physical lower bound only; exact target-handler hits were not evaluated after rule 1 failed.
- The root [`build` script and engines](https://github.com/elastic/kibana/blob/60605e8006b0ffe337f5e5673ccdea4a28eafc5a/package.json#L40-L77) pin Node.js `24.18.0` and invoke `node scripts/build --all-platforms`. Thus the Node patch matches this goal, but the production bundler does not.

### First failed rule

Rule 1 requires an unmodified ordinary production build that uses Rolldown directly on the pinned Node.js release and lasts 15–30 minutes. Direct Rolldown fails before duration needs evaluation:

- The distributable builder chooses between a legacy optimizer and an opt-in Rspack transition. Without `KBN_USE_RSPACK`, it runs [`BuildKibanaPlatformPlugins`](https://github.com/elastic/kibana/blob/60605e8006b0ffe337f5e5673ccdea4a28eafc5a/src/dev/build/build_distributables.ts#L80-L100); with that environment variable, it runs `BuildRspackBundles`. The pinned Buildkite production step sets the Rspack variable only for a specifically labeled transition build and otherwise records the build type as legacy. [Pinned CI selection](https://github.com/elastic/kibana/blob/60605e8006b0ffe337f5e5673ccdea4a28eafc5a/.buildkite/scripts/steps/build_kibana.sh#L11-L40).
- The default task imports and calls [`runOptimizer` from `@kbn/optimizer`](https://github.com/elastic/kibana/blob/60605e8006b0ffe337f5e5673ccdea4a28eafc5a/src/dev/build/tasks/build_kibana_platform_plugins.ts#L10-L43). That optimizer's production config imports webpack, constructs a webpack configuration per bundle, and applies [`babel-loader` to JavaScript and TypeScript](https://github.com/elastic/kibana/blob/60605e8006b0ffe337f5e5673ccdea4a28eafc5a/packages/kbn-optimizer/src/worker/webpack.config.ts#L10-L45) with the [Babel rule](https://github.com/elastic/kibana/blob/60605e8006b0ffe337f5e5673ccdea4a28eafc5a/packages/kbn-optimizer/src/worker/webpack.config.ts#L245-L256).
- The optional transition path invokes Rspack, not Rolldown. The separately discovered [`kbn-babel-transform` synchronous Babel helper](https://github.com/elastic/kibana/blob/60605e8006b0ffe337f5e5673ccdea4a28eafc5a/src/platform/packages/private/kbn-babel-transform/sync_transform.js#L10-L37) is real, but the optimizer does not import that helper; its production transform path calls `babel-loader` directly. Neither path makes the webpack/Rspack production unit a direct-Rolldown build.

Porting the optimizer and its bundle orchestration to Rolldown could be a future migration project, but it would replace the production build system before measuring ParallelPlugin. That is outside this admission gate and cannot be used as the unmodified ordinary baseline.

### Admission ledger

| Admission rule | Result | Evidence or reason |
| --- | --- | --- |
| 1. Direct Rolldown on pinned Node.js and stable 15–30 minute ordinary baseline | **Fail** | Node.js is exactly 24.18.0, but the default production optimizer is webpack and the opt-in transition is Rspack; neither uses Rolldown directly. Duration was not evaluated after this decisive failure. |
| 2. One real project with original relationships and production plugin configuration | Not evaluated | Screening stopped at rule 1. |
| 3. Required expensive JavaScript plugin or transform chain | Not evaluated | Babel is present in the optimizer, but retained-JavaScript ownership was not admitted. |
| 4. Roughly 5,000 distinct project module IDs at the expensive handler boundary | Not evaluated | The 32,416-path discovery count is a truncated-tree physical lower bound; no handler-boundary instrumentation was run. |
| 5. Critical-path share can mathematically reach a 2x complete-build result | Not evaluated | No ordinary wall baseline, blocking timeline, or replay bound was run. |
| 6. Sustained ready transform width | Not evaluated | No timeline was run. |
| 7. Relevant time is synchronous JavaScript rather than asynchronous I/O or native work | Not evaluated | No stage attribution was run. |
| 8. Source, behavior, diagnostics, maps, and environment are reviewable | Not evaluated | Later rule after the decisive failure. |

## Bounded screening result

No selected candidate uses Rolldown directly in its unmodified production build. Cloudflare Docs uses Astro/Vite/Rollup, Gutenberg uses a multi-stage esbuild workflow, and Kibana uses webpack by default with an opt-in Rspack transition. All later rules are not evaluated for all candidates, no candidate is admitted, and no research timing, instrumentation, implementation, adaptation, or parallel matrix follows from this corpus.

The terminal result is `inconclusive corpus`: the predeclared public search universe did not supply the workload required to answer the production-scale ParallelPlugin value question. It does not show that ParallelPlugin lacks value, and the mechanism-scale evidence remains unchanged.

## Source-screen reproduction

These commands reproduce the local source pins and decisive rule-1 evidence without installing or building a candidate. Use separate empty directories for each clone.

```bash
git clone --filter=blob:none --no-checkout https://github.com/cloudflare/cloudflare-docs.git cloudflare-docs
git -C cloudflare-docs fetch --depth=1 origin 2b08a67a41da1a521aecbcf465893abae1e9a6df
git -C cloudflare-docs checkout --detach FETCH_HEAD
git -C cloudflare-docs rev-parse HEAD
find cloudflare-docs/src/content/docs -type f -name '*.mdx' | LC_ALL=C sort -u | wc -l
git -C cloudflare-docs grep -nE 'astro build|"astro": "6\.4\.7"|"@astrojs/mdx": "6\.0\.3"' 2b08a67a41da1a521aecbcf465893abae1e9a6df -- package.json
gh api repos/cloudflare/cloudflare-docs/actions/runs/29160281389 --jq '{head_sha,status,conclusion,html_url}'
gh api repos/cloudflare/cloudflare-docs/actions/runs/29160281389/jobs --jq '.jobs[] | {id,name,steps:[.steps[] | select(.name=="Build") | {started_at,completed_at,conclusion}]}'

git clone --filter=blob:none --no-checkout https://github.com/WordPress/gutenberg.git gutenberg
git -C gutenberg fetch --depth=1 origin eb24e81eb05de53abb7238a9e6b0b7882b4bd490
git -C gutenberg checkout --detach FETCH_HEAD
git -C gutenberg rev-parse HEAD
git -C gutenberg ls-tree -r --name-only HEAD | awk '/\.(js|jsx|ts|tsx)$/ && !/\.d\.ts$/' | wc -l
git -C gutenberg grep -nE '@wordpress/build-scripts|wp-build|esbuild' eb24e81eb05de53abb7238a9e6b0b7882b4bd490 -- package.json tools/build-scripts/build.mjs packages/wp-build/package.json packages/wp-build/lib/build.mjs

git clone --filter=blob:none --no-checkout https://github.com/elastic/kibana.git kibana
git -C kibana fetch --depth=1 origin 60605e8006b0ffe337f5e5673ccdea4a28eafc5a
git -C kibana checkout --detach FETCH_HEAD
git -C kibana rev-parse HEAD
git -C kibana grep -nE '24\.18\.0|KBN_USE_RSPACK|BuildKibanaPlatformPlugins|babel-loader|from .webpack.' 60605e8006b0ffe337f5e5673ccdea4a28eafc5a -- package.json .buildkite/scripts/steps/build_kibana.sh src/dev/build/build_distributables.ts src/dev/build/tasks/build_kibana_platform_plugins.ts packages/kbn-optimizer/src/worker/webpack.config.ts
```

The exact Astro and MDX implementation pins can be inspected without package installation:

```bash
git clone --filter=blob:none --no-checkout https://github.com/withastro/astro.git astro-source
git -C astro-source fetch --depth=1 origin 910e121ad33c481dcfb4b313abd7d8ff370ee347 0b879fbbaa0c8494835dab6f5c781b1c0cb36eac
git -C astro-source show 910e121ad33c481dcfb4b313abd7d8ff370ee347:packages/astro/src/core/build/static-build.ts
git -C astro-source show 0b879fbbaa0c8494835dab6f5c781b1c0cb36eac:packages/integrations/mdx/src/vite-plugin-mdx.ts
```
