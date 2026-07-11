# Production-Scale Candidate Verdict

Status: terminal `inconclusive corpus` outcome on 2026-07-12. No production-scale candidate was admitted, so this iteration makes no new ParallelPlugin performance, resource, correctness, or investment claim.

## Decision

The bounded public search did not find an unmodified direct-Rolldown production build that could reach the remaining admission rules. The frozen candidates were Cloudflare Docs, WordPress Gutenberg, and Elastic Kibana. Each failed rule 1 because its production build uses a different build system. Screening stopped there, as predeclared, and every later rule remains `not evaluated`.

This is an evidence-gap result. It does not mean that JavaScript worker execution has no value, that a 2x result is impossible, or that the existing ParallelPlugin architecture is production-ready. It means the predeclared public corpus could not answer those questions without first changing a project's production build system.

## Provenance and boundary

- Research repository base: `b22e602ce938ee8563a38ddc59584b274e99e7e6`; branch `research/production-scale`.
- Candidate-search manifest: commit `dc89184`, committed and pushed before any candidate clone or deep screen.
- Cloudflare Docs screen: commit `2c2d79d`; Gutenberg screen: commit `23a19c8`; completed three-candidate screen: commit `e03182c`.
- Goal environment: Node.js `v24.18.0`, arm64 Darwin executable SHA-256 `c372d2c2da14b1e2086a4965ced59359616d885501426669c07c244c7d854273` on an Apple M3 Pro with 12 logical CPUs and 36 GiB RAM.
- No candidate dependency installation, local build, research timing run, instrumentation, adaptation, Rolldown change, worker implementation, or parallel matrix was performed. Cloudflare's existing same-SHA CI duration remains preliminary public evidence. The absence of a research measurement phase is the intended result of the admission gate, not missing execution work.

## Candidate outcomes

| Candidate | Pinned revision | Useful preliminary fact | First failed admission rule | Later rules |
| --- | --- | --- | --- | --- |
| Cloudflare Docs | `2b08a67a41da1a521aecbcf465893abae1e9a6df` | Same-SHA Node.js 24.18.0 production Build step lasted 17m59s; 6,719 `.mdx` files exist under the docs content root | Production command is Astro 6.4.7 using Vite 7.3.5 and Rollup 4.62.2, not direct Rolldown | Not evaluated |
| WordPress Gutenberg | `eb24e81eb05de53abb7238a9e6b0b7882b4bd490` | Complete tree has 6,611 non-declaration JS/TS files; a reusable webpack/Babel configuration exists | Root production command is a multi-stage workspace build whose active package bundler is esbuild, not direct Rolldown | Not evaluated |
| Elastic Kibana | `60605e8006b0ffe337f5e5673ccdea4a28eafc5a` | Node.js is exactly 24.18.0; default optimizer really runs `babel-loader` over project JS/TS; discovery tree has at least 32,416 non-declaration JS/TS paths | Default production optimizer is webpack and its opt-in transition is Rspack, not direct Rolldown | Not evaluated |

The detailed pinned source links and per-rule ledgers are in [production candidate screening](../.agents/docs/production-candidate-screening.md). The original universe, queries, preliminary evidence, exclusions, and immutable order are in the [candidate-search manifest](../.agents/docs/production-candidate-search.md).

## Why adapting these projects would answer a different question

Wrapping Cloudflare's MDX compiler in a new Rolldown fixture would remove Astro's content loading, virtual modules, multiple Vite environments, route generation, static rendering, and asset work. Porting Gutenberg's workspace build or Kibana's multi-bundle optimizer would first replace esbuild, webpack, or Rspack plus their production orchestration. Either route may be worthwhile migration research, but neither supplies the unmodified ordinary direct-Rolldown baseline required by this iteration.

Allowing that migration inside this goal would also make the baseline ambiguous: a speedup could come from changing bundlers, graph topology, plugin behavior, outputs, caching, or top-level orchestration rather than from moving the same JavaScript transform into workers. The strict stop preserves the attribution the goal was designed to obtain.

## What remains established

The mechanism-scale verdict is unchanged. Current-main worker lifetime is broken on Node.js 24.18.0 without the research keepalive; one worker can move synchronous JavaScript work off the main loop while losing wall time; wide heavy controlled transforms can scale; the 166-SFC Vue case loses at every tested worker count; the graph-preserving Svelte subgraph reaches only 1.117x with large CPU and RSS costs; and state, diagnostics, ordering, reentrancy, and failure semantics prevent treating the whole-plugin marker as transparent. [Mechanism-scale verdict](./verdict.md)

Worker startup also remains the wrong primary lever for the intended minute-scale build. Even eliminating the previously measured 100–400 ms fresh initialization would save less than 0.05% of 15 minutes. The unanswered production question is sustained transform share, ready width, per-worker service degradation, CPU competition with Rust and native work, memory/JIT/cache/GC pressure, placement across several plugins, deterministic cache ownership, and ordinary-equivalent failure semantics.

## What remains unanswered

- Whether roughly 5,000 distinct project module IDs actually reaching a required JavaScript transform can sustain enough ready work for a 2x complete-build result in a 15–30 minute direct-Rolldown build.
- Whether plugin-owned `worker_threads` already capture most of the available value, or Rolldown-managed shared and exclusive groups materially improve scheduling, CPU allocation, memory duplication, fairness, and failure isolation.
- Whether adjacent high-frequency transforms can run in order inside one worker without changing source-map chains, hook order, diagnostics, metadata, side effects, or error attribution.
- Which worker-local caches are performance-only and deterministic across worker counts, assignment order, and cache warmth.
- How worker service rate, RSS, garbage collection, memory bandwidth, Rust-thread competition, ready width, and load balance evolve over a minute-scale build.

## Reopening condition

A future production-performance goal should start only when one of these inputs exists:

1. An already-direct-Rolldown public or reviewable private build that passes the scale and duration source screen before adaptation.
2. A separately scoped migration study that explicitly treats bundler migration as an independent axis, preserves the original project as a non-Rolldown reference, defines graph/output parity, and does not attribute migration gains to ParallelPlugin.

The frozen candidate universe must not be silently broadened or the three rejected projects relabeled as direct Rolldown. A new search date, universe, rules, and goal are required if ecosystem evidence changes.
