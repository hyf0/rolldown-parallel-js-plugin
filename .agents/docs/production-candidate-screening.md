# Production Candidate Screening

Status: active. The search universe and three-candidate order were frozen in commit `dc89184` before any candidate clone, installation, build, adaptation, or timing. Candidate 1 failed its first admission rule on pinned source evidence; candidate 2 is next. This is a bounded corpus screen, not a ParallelPlugin value verdict.

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

## Remaining order

1. WordPress Gutenberg at `eb24e81eb05de53abb7238a9e6b0b7882b4bd490`.
2. Elastic Kibana at `60605e8006b0ffe337f5e5673ccdea4a28eafc5a`.

No candidate is admitted, and no implementation work is authorized by the evidence so far.
