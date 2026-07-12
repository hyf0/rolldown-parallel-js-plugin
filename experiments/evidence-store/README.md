# Content-Addressed Research Evidence Store

This directory promotes formal initialization and attribution reports into deterministic, Git-tracked evidence bundles. It does not decide whether a benchmark or attribution result is favorable, and it does not turn instrumented elapsed fields into wall-performance evidence.

Each bundle lives at `research/artifacts/evidence/<kind>/sha256/<contentSha256>`. The content address is derived from the exact raw and summary byte lengths and SHA-256 hashes. A bundle contains the unchanged raw bytes, unchanged summary bytes, and a deterministic `pointer.json`; directory rename makes the three-file publication atomic.

The pointer records canonical repository-relative paths, content hashes and byte lengths, the summary-to-raw binding, and the runtime, harness, Node, matrix, and classification identities derived from the reports. It contains no timestamp or checkout path, so a clean clone can recompute it byte-for-byte.

## Initialization integration

First use the initialization harness summarizer. Keep the raw and summary in the same staging directory so `summary.source.rawArtifact.path` is a non-escaping relative path.

```sh
/Users/yunfeihe/.local/share/mise/installs/node/24.18.0/bin/node \
  /path/to/rolldown/examples/par-plugin/cases/runtime-initialization/summarize-matrix.mjs \
  /path/to/rolldown/examples/par-plugin/cases/runtime-initialization/.results/formal.raw.json \
  /path/to/rolldown/examples/par-plugin/cases/runtime-initialization/.results/formal.summary.json

/Users/yunfeihe/.local/share/mise/installs/node/24.18.0/bin/node \
  ./experiments/evidence-store/promote-evidence.mjs \
  --kind initialization \
  --raw /path/to/rolldown/examples/par-plugin/cases/runtime-initialization/.results/formal.raw.json \
  --summary /path/to/rolldown/examples/par-plugin/cases/runtime-initialization/.results/formal.summary.json
```

Initialization promotion requires the formal raw classification, clean harness/runtime provenance, a harness manifest rederived from its entries, exact binding/distribution/package-entry identities, the complete package-environment identity, and the Node executable identity already recorded by the harness summary.

## Attribution integration

The MDX attribution report already embeds the derived per-variant attribution summaries but has no standalone summary artifact. Create the deterministic evidence-store summary, then promote both exact files:

```sh
/Users/yunfeihe/.local/share/mise/installs/node/24.18.0/bin/node \
  ./experiments/evidence-store/create-attribution-summary.mjs \
  /path/to/mdx-attribution.raw.json \
  /path/to/mdx-attribution.summary.json

/Users/yunfeihe/.local/share/mise/installs/node/24.18.0/bin/node \
  ./experiments/evidence-store/promote-evidence.mjs \
  --kind attribution \
  --raw /path/to/mdx-attribution.raw.json \
  --summary /path/to/mdx-attribution.summary.json
```

Write the attribution runner's raw output and this staging summary outside the research worktree. Promotion deliberately refuses a dirty or untracked research repository, including a report staged under `experiments/cloudflare-mdx/data`.

The generated summary retains each variant's already validated `attributionSummary`, the cross-variant ordinary-factory versus worker-pool initialization comparison, and the raw report's harness manifest, runtime triple, correctness gate, matrix, runner, case runner, and current Node executable bytes. Promotion rederives that summary instead of accepting an independently authored compact result.

## Commit and fresh-clone verification

Promotion requires a clean research worktree. It intentionally leaves one new untracked bundle, which must be reviewed and committed before verification. Promote and commit one bundle at a time.

```sh
git add research/artifacts/evidence
git commit -m "research: record initialization evidence"

/Users/yunfeihe/.local/share/mise/installs/node/24.18.0/bin/node \
  ./experiments/evidence-store/verify-evidence.mjs \
  research/artifacts/evidence/initialization/sha256/<contentSha256>/pointer.json
```

The verifier requires the entire research worktree to be clean, requires the pointer, raw, and summary to be tracked, compares every working-tree byte with `HEAD`, rejects symlinks and path escape, rechecks the summary's raw binding and provenance, and rebuilds the complete pointer. The same command works from a fresh clone; no staging file or original absolute source path is needed.

Run the build-free positive and adversarial contract tests with:

```sh
/Users/yunfeihe/.local/share/mise/installs/node/24.18.0/bin/node \
  ./experiments/evidence-store/verify-evidence-store.mjs
```
