# Machine Portability and Formal-Run Handoff

Status: frozen handoff decision for `scale-crossover-v1-amended-8` on 2026-07-13. The operational commands and current resume prompt live in [HANDOFF.md](../../HANDOFF.md); the machine-readable source is [`experiments/handoff/manifest.json`](../../experiments/handoff/manifest.json).

## What must travel in Git

The source branches alone cannot reconstruct the exact formal runtimes because the two required `packages/rolldown/dist` trees and native bindings are ignored, and the old build did not retain enough Xcode and linker provenance to guarantee a byte-identical rebuild. The handoff therefore commits content-addressed compressed copies of the lifecycle-fixed `b144106` distribution and the attribution `76a971d` distribution, plus a restore-and-verify script. It also commits the exact patched Darwin arm64 `cpulimit` binary, the upstream Git bundle, and the applied GPL-2.0-or-later source patch. Node.js 24.18.0 remains publicly reconstructible and is accepted only when its exact executable bytes match the frozen hash.

Durable raw evidence, compact pointers, PCR, policy code, and product classifications remain ordinary tracked files. Historical absolute paths in those artifacts are hash-bound provenance and are not migration targets.

## What must be regenerated

The controlled Vue corpus, independent Vue project checkouts and installed subsets, Cloudflare dependencies, Rolldown workspace dependencies, build caches, and staging results are generated state. The public repositories, commits, locks, package-manager versions, corpus manifests, support overlays, and verification code needed to recreate them are committed. pnpm's protocol-bound `.modules.yaml` files are the narrow exception: they contain a `prunedAt` timestamp, so the five exact metadata files are committed and restored only after a real frozen-lock install. Deep package-tree and dependency-closure verification proves the installed content. Old Vue `.results`, Astro caches, middlecache, generated `skills`, and other Cloudflare ignored state must not be copied. Fresh-clone correctness and provenance checks decide whether regeneration is valid; a difference is a hidden-input defect, not permission to restore an unrecorded cache.

## Formal machine and path identity

The amended-8 formal policy remains bound to Darwin arm64, Apple M3 Pro, 12 logical CPUs, six performance and six efficiency cores, and 38,654,705,664 bytes of RAM. Generic initialization and the fixed-policy evidence enforce these values. A different topology requires a versioned Amendment 9 and regeneration of every machine-bound input before timing.

Active MDX matrices contain `/Users/yunfeihe/Documents/github-opensource` worktree paths. Recreating those paths preserves the frozen executable bytes. Editing them after the protocol was frozen requires an amendment and affected correctness refresh; bulk rewriting historical artifacts is forbidden.

## Known closure gap

Controlled Vue formal attribution remains required by Amendment 7, but the current content-addressed attribution store accepts only the MDX report shape. Before the large controlled Vue attribution matrix runs, add a raw/summary/pointer promotion path and fresh-clone verifier for its report without editing the bound `b177e85` harness. This is the only known non-timing implementation gap in the handoff sequence.

The bound Vue branch README contains stale displayed admission and correctness hashes because editing that README would change the source manifest and force another 5,000-SFC correctness refresh. Canonical current hashes live in the research repository and HANDOFF; the stale status paragraph must not be used as an execution input.
