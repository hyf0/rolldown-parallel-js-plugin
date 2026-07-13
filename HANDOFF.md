# Scale-Crossover Research Machine Handoff

This is the entry point for continuing the active `scale-crossover-v1-amended-8` iteration on another machine. The repository at tag `research/scale-crossover-handoff-v2` contains the Project Context Records, all durable evidence available at the checkpoint, the exact ignored Rolldown runtime distributions, the exact patched `cpulimit` binary and source Git bundle, a machine-readable manifest, restoration code, and a doctor. No vault note or old-machine temporary directory is required to understand the state.

## Current outcome and exact next state

Every non-timing prerequisite completed before this handoff: the 5,000-SFC controlled Vue admission and correctness chain, the three-project independent Vue correctness chain, the 9,157-source MDX correctness and semantic gates, the correlated attribution runtime, the generic initialization harness, the fixed-policy evaluator, and the product-capability ledger. No new formal wall-time child has run. All four formal launchers refused the old host before their first child because uptime and swap exceeded the frozen limits.

The iteration is not complete. A qualifying restarted host must still produce the controlled Vue and independent Vue wall curves, the MDX crossover and worker-four/worker-eight attribution, conditional Rust-pool and CPU-rate evidence, the ten-block initialization result, and the fixed-policy verdict. The current product ledger derives `productCrossover:false`; timing cannot override the known source-map, metadata, state, diagnostic, lifecycle, ordering, cache, or failure-semantics gaps.

The first non-timing implementation task on the new checkout is to add a durable promotion path for the formal controlled Vue attribution report. Amendment 7 requires that report, but the current content-addressed attribution store accepts the MDX report shape only. Do not run the large Vue attribution matrix until its raw/summary/pointer promotion and fresh-clone verifier are implemented. This missing importer does not invalidate the existing untimed Vue correctness evidence.

## Frozen host and path boundary

The existing formal result can be continued only on Darwin arm64 with Apple M3 Pro, 12 logical CPUs split 6 performance and 6 efficiency cores, and exactly 38,654,705,664 bytes of RAM. The fixed-policy evaluator and generic initialization admission enforce this identity. A different machine is useful for build-free work, but it cannot contribute formal timing to amended-8. Add Amendment 9, regenerate every machine-bound input, and rerun affected correctness checks before timing on a different topology.

Active MDX matrices contain canonical absolute paths. Recreate this layout rather than editing runnable matrix JSON after the protocol was frozen:

```text
/Users/yunfeihe/Documents/github-opensource/
├── rolldown
├── rolldown-parallel-js-plugin
└── .worktrees/
    ├── cloudflare-docs-rolldown-build
    ├── rolldown-parallel-js-plugin-scale-baseline
    ├── rolldown-parallel-js-plugin-init-stage-resources
    ├── rolldown-parallel-js-plugin-vue-evidence
    └── rolldown-parallel-js-plugin-scale-crossover
```

Historical absolute paths inside committed raw evidence are provenance and must not be rewritten. If `/Users/yunfeihe/Documents/github-opensource` cannot exist, change the protocol through a versioned amendment; do not perform a bulk path substitution.

## Canonical repositories and artifacts

| Role | Remote and ref | Commit |
| --- | --- | --- |
| Research, PCR, durable evidence, policy | `hyf0/rolldown-parallel-js-plugin` `main` | The handoff tag is the exact checkpoint; continue from `main` only while the tag remains an ancestor |
| Wall and correctness runtime | `rolldown/rolldown` `research/parallel-js-plugin-scale-baseline` | `b144106882fe244b19b738fc0acf3ffa07c7c9f3` |
| Attribution runtime | `rolldown/rolldown` `research/parallel-js-plugin-init-stage-resources` | `76a971de8ce66e031b7d19637d13742fe4662594` |
| Controlled and independent Vue harness | `rolldown/rolldown` `research/parallel-js-plugin-vue-evidence` | `b177e85de42f8cc325b95a30d14117ff9785526b` |
| Generic initialization harness | `rolldown/rolldown` `research/parallel-js-plugin-scale-crossover` | `299a83472369edcf482621cb8612c87fbb8b544d` |
| Production MDX source | `cloudflare/cloudflare-docs` detached | `2b08a67a41da1a521aecbcf465893abae1e9a6df` |

The generic initialization subtree is byte-identical between `299a834` and `b177e85`; use the focused `299a834` checkout so the lane's provenance is unambiguous. The Cloudflare checkout is pristine production source. The direct-Rolldown adapter is entirely in this research repository; there is no unpublished Cloudflare adaptation branch.

The two generated Rolldown distributions were the largest old-machine-only risk. They are now committed as compressed artifacts and restored only into their exact ignored destinations:

| Runtime | Dist identity | Native binding |
| --- | --- | --- |
| Lifecycle baseline | 46 files, 17,095,091 bytes, `1efffd0b63483e77cd2854fe716941000ae9548768691d7b5a64dceb011f3c45` | 16,311,136 bytes, `7b8863bb28aefd2e2eb7409f8be6dae57a252fe4a2688383007be7ea2f847bf7` |
| Attribution | 49 files, 17,240,063 bytes, `3e4b174ad36807430da1b5b7db3f294a47909962511531b370f421fe00d83fbd` | 16,360,800 bytes, `6d6fc6e94b30b7b39b4c6d116b38bbecca2907ecc183c99a25a1a67e1cce1fce` |

The exact patched `cpulimit` binary is 37,848 bytes with SHA-256 `233531824804f4be5ef3b425b0903bd36a90c069fd44598da4fad77e90eb0bd9`. Its upstream Git history at `f4d2682804931e7aea02a869137344bb5452a3cd`, GPL-2.0-or-later source, and the applied patch are retained with it. The old build used Apple clang 17.0.0 on macOS 26.5.1, but the binary bundle removes the need to reproduce unrecorded linker details.

## Bootstrap a fresh machine

Use Vite+ to install Node.js 24.18.0, then invoke the underlying managed runtime rather than the shim. The accepted Darwin arm64 binary is 120,965,360 bytes with SHA-256 `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a`. Existing evidence records `process.execPath`, but the formal contracts compare the current run consistently and pin the binary bytes; the old mise installation path is not a protocol requirement.

```sh
vp env install 24.18.0
NODE=/Users/yunfeihe/.vite-plus/js_runtime/node/24.18.0/bin/node
COREPACK=/Users/yunfeihe/.vite-plus/js_runtime/node/24.18.0/bin/corepack
"$NODE" --version
shasum -a 256 "$NODE"
mkdir -p /Users/yunfeihe/Documents/github-opensource/.worktrees
```

Clone the research repository and first prove that the checkpoint itself arrived intact:

```sh
git clone https://github.com/hyf0/rolldown-parallel-js-plugin.git /Users/yunfeihe/Documents/github-opensource/rolldown-parallel-js-plugin
git -C /Users/yunfeihe/Documents/github-opensource/rolldown-parallel-js-plugin fetch --tags origin
cd /Users/yunfeihe/Documents/github-opensource/rolldown-parallel-js-plugin
"$NODE" experiments/handoff/doctor.mjs --checkpoint-only
```

Clone Rolldown once, fetch the four public research branches, and create detached exact worktrees:

```sh
ROOT=/Users/yunfeihe/Documents/github-opensource
WT="$ROOT/.worktrees"
git clone https://github.com/rolldown/rolldown.git "$ROOT/rolldown"
git -C "$ROOT/rolldown" fetch origin \
  research/parallel-js-plugin-scale-baseline \
  research/parallel-js-plugin-init-stage-resources \
  research/parallel-js-plugin-vue-evidence \
  research/parallel-js-plugin-scale-crossover
git -C "$ROOT/rolldown" worktree add --detach "$WT/rolldown-parallel-js-plugin-scale-baseline" b144106882fe244b19b738fc0acf3ffa07c7c9f3
git -C "$ROOT/rolldown" worktree add --detach "$WT/rolldown-parallel-js-plugin-init-stage-resources" 76a971de8ce66e031b7d19637d13742fe4662594
git -C "$ROOT/rolldown" worktree add --detach "$WT/rolldown-parallel-js-plugin-vue-evidence" b177e85de42f8cc325b95a30d14117ff9785526b
git -C "$ROOT/rolldown" worktree add --detach "$WT/rolldown-parallel-js-plugin-scale-crossover" 299a83472369edcf482621cb8612c87fbb8b544d
```

Install each Rolldown worktree with the repository-pinned pnpm 11.9.0 and scripts disabled, then restore the exact ignored research artifacts. The bootstrap uses Node's installed Corepack directly so a global `vp` is not a hidden prerequisite. Do not rebuild the two formal distributions after restoration.

```sh
for worktree in \
  "$WT/rolldown-parallel-js-plugin-scale-baseline" \
  "$WT/rolldown-parallel-js-plugin-init-stage-resources" \
  "$WT/rolldown-parallel-js-plugin-vue-evidence" \
  "$WT/rolldown-parallel-js-plugin-scale-crossover"
do
  (cd "$worktree" && "$COREPACK" pnpm@11.9.0 install --frozen-lockfile --prefer-offline --ignore-scripts)
done
```

Create the pristine Cloudflare checkout and its frozen dependency layout. pnpm lifecycle scripts are required here because the checkout uses its postinstall patch workflow. Do not copy `.astro`, `.astro-cache`, `.tmp/middlecache`, `skills`, or any other old ignored cache. The fresh-clone correctness verifier is the proof that such state is not an input.

```sh
git clone --filter=blob:none --no-checkout https://github.com/cloudflare/cloudflare-docs.git "$WT/cloudflare-docs-rolldown-build"
git -C "$WT/cloudflare-docs-rolldown-build" fetch --depth=1 origin 2b08a67a41da1a521aecbcf465893abae1e9a6df
git -C "$WT/cloudflare-docs-rolldown-build" checkout --detach 2b08a67a41da1a521aecbcf465893abae1e9a6df
(cd "$WT/cloudflare-docs-rolldown-build" && "$COREPACK" pnpm@11.12.0 install --frozen-lockfile)
cd "$ROOT/rolldown-parallel-js-plugin"
"$NODE" experiments/handoff/restore-artifacts.mjs --restore-all
```

pnpm writes a current `prunedAt` timestamp into `.modules.yaml`, so a fresh install cannot naturally reproduce the historical metadata hash even when its dependency content is correct. `restore-artifacts.mjs` therefore runs after every install: it restores the five exact protocol-bound `.modules.yaml` files in addition to the two runtime distributions and CPU controller. The deep verifier then rechecks the real installed lock, package trees, dependency closure, package-manager fields, clean source, and the 9,157-source manifest; restoring metadata cannot substitute for installing the packages. The final Cloudflare metadata SHA-256 is `60f64721c5cacfa8ec58d148e21b96a57096f3051cfd2ec6675e13bd3324edcd`.

Prepare the controlled Vue corpus from five named public detached checkouts. These source repositories need no dependency install:

```sh
SOURCES="$ROOT/vue-scale-sources"
mkdir -p "$SOURCES"
git clone https://github.com/primefaces/primevue.git "$SOURCES/primevue" && git -C "$SOURCES/primevue" checkout --detach d4374cb7c1267f35eba7cee5d0a266f50ca8ec84
git clone https://github.com/element-plus/element-plus.git "$SOURCES/element-plus" && git -C "$SOURCES/element-plus" checkout --detach 85bdf740c1d550f3ca44472262e2a314039eab7d
git clone https://github.com/Tencent/tdesign-vue-next.git "$SOURCES/tdesign-vue-next" && git -C "$SOURCES/tdesign-vue-next" checkout --detach dd334e2dc06d8ab48d1b6ebc5e9d4f6de67b16a2
git clone https://github.com/epicmaxco/vuestic-ui.git "$SOURCES/vuestic-ui" && git -C "$SOURCES/vuestic-ui" checkout --detach c5337ed8e7e24ea294221326fe2ca6af8d3b8e1b
git clone https://github.com/quasarframework/quasar.git "$SOURCES/quasar" && git -C "$SOURCES/quasar" checkout --detach 2165ce9f69d84e6169e7ca8a1c51fde105042cb9
cd "$WT/rolldown-parallel-js-plugin-vue-evidence/examples/par-plugin/cases/vue-scale"
"$NODE" ./prepare-corpus.mjs --sources "$SOURCES"
```

Prepare independent Vue projects with the committed script. It creates all frozen candidate checkouts, but formal timing uses Floating Vue at four reached SFCs, cabinet-fe/icon at 166, and Directus at 546. The script uses exact Corepack pnpm versions for the Vben and Directus dependency subsets.

```sh
cd "$WT/rolldown-parallel-js-plugin-vue-evidence/examples/par-plugin/cases/vue-projects"
"$NODE" ./prepare-projects.mjs \
  --project floating-vue \
  --project cabinet-icon \
  --project directus-amendment-candidate
"$NODE" ./test-verification.mjs
"$NODE" ./test-performance-verification.mjs
```

Run the complete preflight. The doctor reports the checkpoint, setup, and timing phases independently. Before the restart, timing is expected to fail; do not weaken the gate. `--deep` runs the build-free MDX, evidence-store, product-ledger, and fixed-policy contract suites.

```sh
cd "$ROOT/rolldown-parallel-js-plugin"
"$NODE" experiments/handoff/doctor.mjs --deep
```

## Canonical current evidence

- Controlled Vue final admission raw: `403247c6b953ffd7fef71a77e4bd06ce00952014a63eff8f449b157b6c850f58`.
- Controlled Vue final correctness raw: `2aa03aab0d6247853e43e519232b21288c20d3c0a941122564600bd3110f1420`.
- Controlled Vue content address: `82ff7743fcd200d2c0df5efb8b740b6be9585b66a164a9072be483956119b8b6`.
- Independent Vue content address: `e2c0cdecdb028ffac4a5f5931797b1f33ccceac201c3a30ab3dd4c5af1bed048`.
- MDX full correctness raw: `0570935049182f87bd479c4ae20dea41d1c2deb8b288b0330dadf0c6b4e2b38d`.
- MDX semantic sentinel: `99649c9d1ee1e0371b0d97ed50f1ac5152bd828acd72392d920855d0b132d551`.
- MDX executable gate: `ddd3bc860df4f45de9ff2f91d4a2245359740076e26e5bb327ad86a141dd3f06`.

The admission and correctness hashes displayed in the bound Vue branch README are stale because later evidence commits could not edit a README included in the same source manifest without invalidating the chain. The values above and the content-addressed stores in this research repository are canonical. Older independent Vue correctness addresses are historical, not alternatives.

## Formal execution order

Run locally and sequentially after a restart, with AC power, low-power mode off, no active CI markers, inherited `NODE_OPTIONS` unset, uptime at most 24 hours, starting swap at most 512 MiB, one-minute load at most 2.0, summed process CPU at most 150%, memory-pressure free percentage at least 50%, and zero pageout or swapout delta for every child. Store staging output outside every Git worktree and promote it immediately after each completed lane.

Set these paths once:

```sh
ROOT=/Users/yunfeihe/Documents/github-opensource
WT="$ROOT/.worktrees"
NODE=/Users/yunfeihe/.vite-plus/js_runtime/node/24.18.0/bin/node
BASE="$WT/rolldown-parallel-js-plugin-scale-baseline/packages/rolldown"
ATTR="$WT/rolldown-parallel-js-plugin-init-stage-resources/packages/rolldown"
VUE="$WT/rolldown-parallel-js-plugin-vue-evidence/examples/par-plugin/cases"
INIT="$WT/rolldown-parallel-js-plugin-scale-crossover/examples/par-plugin/cases/runtime-initialization"
RESEARCH="$ROOT/rolldown-parallel-js-plugin"
OUT="$HOME/Documents/rolldown-parallel-js-plugin-formal"
mkdir -p "$OUT"
unset CI CONTINUOUS_INTEGRATION GITHUB_ACTIONS NODE_OPTIONS NODE_COMPILE_CACHE NODE_COMPILE_CACHE_PORTABLE NODE_DISABLE_COMPILE_CACHE
```

The command sequence through MDX attribution is copy-pasteable; later refinement, allocation, quota, and generic initialization must follow the numbered frozen order because their exact inputs depend on the preceding raw result:

```sh
# Controlled Vue screen, generated repeated confirmation, and first summary.
cd "$VUE/vue-scale"
"$NODE" ./run-matrix.mjs ./wall-screen-matrix.json "$OUT/vue-wall-screen.raw.json" "$BASE"
"$NODE" ./create-confirm-matrix.mjs "$OUT/vue-wall-screen.raw.json" "$OUT/vue-wall-confirm.matrix.json"
"$NODE" ./run-matrix.mjs "$OUT/vue-wall-confirm.matrix.json" "$OUT/vue-wall-confirm.raw.json" "$BASE"
"$NODE" ./summarize-matrix.mjs "$OUT/vue-wall-confirm.raw.json" "$OUT/vue-wall-confirm.summary.json"

# If and only if the summary contains additionalConfirmationMatrix, run the mechanically requested extension.
"$NODE" ./write-additional-confirm-matrix.mjs "$OUT/vue-wall-confirm.summary.json" "$OUT/vue-wall-additional.matrix.json"
"$NODE" ./run-matrix.mjs "$OUT/vue-wall-additional.matrix.json" "$OUT/vue-wall-additional.raw.json" "$BASE"
"$NODE" ./merge-confirmation-reports.mjs "$OUT/vue-wall-confirm.raw.json" "$OUT/vue-wall-additional.raw.json" "$OUT/vue-wall-confirm-merged.raw.json"
"$NODE" ./summarize-matrix.mjs "$OUT/vue-wall-confirm-merged.raw.json" "$OUT/vue-wall-confirm-merged.summary.json"

# Controlled Vue formal attribution, only after its missing promotion/verifier path is committed.
"$NODE" ./run-matrix.mjs ./instrumented-matrix.json "$OUT/vue-attribution.raw.json" "$ATTR"

# Independent Vue screen and generated confirmation.
cd "$VUE/vue-projects"
IVUE_EVIDENCE="$RESEARCH/research/artifacts/correctness/sha256/e2c0cdecdb028ffac4a5f5931797b1f33ccceac201c3a30ab3dd4c5af1bed048/manifest.json"
"$NODE" ./run-performance.mjs ./performance-wall-screen-matrix.json "$OUT/independent-vue-screen.raw.json" "$BASE" --correctness-evidence "$IVUE_EVIDENCE"
"$NODE" ./create-performance-confirm-matrix.mjs "$OUT/independent-vue-screen.raw.json" "$OUT/independent-vue-confirm.matrix.json"
"$NODE" ./run-performance.mjs "$OUT/independent-vue-confirm.matrix.json" "$OUT/independent-vue-confirm.raw.json" "$BASE" --correctness-evidence "$IVUE_EVIDENCE" --screen-evidence "$OUT/independent-vue-screen.raw.json" "$OUT/independent-vue-screen.raw.summary.json"

# MDX base screen and first mechanically generated follow-up.
cd "$RESEARCH"
"$NODE" experiments/cloudflare-mdx/run-matrix.mjs experiments/cloudflare-mdx/scale-base-screen-matrix.json "$OUT/mdx-base-screen.raw.json"
"$NODE" experiments/cloudflare-mdx/generate-scale-followup.mjs confirmation "$OUT/mdx-base-screen.raw.json" --output "$OUT/mdx-confirm.matrix.json"
"$NODE" experiments/cloudflare-mdx/run-matrix.mjs "$OUT/mdx-confirm.matrix.json" "$OUT/mdx-confirm.raw.json"
"$NODE" experiments/cloudflare-mdx/generate-scale-followup.mjs refine "$OUT/mdx-base-screen.raw.json" "$OUT/mdx-confirm.raw.json" --output "$OUT/mdx-next.matrix-or-decision.json"

# Required full MDX attribution and content-addressed promotion.
"$NODE" experiments/cloudflare-mdx/run-attribution-matrix.mjs experiments/cloudflare-mdx/scale-attribution-matrix.json "$OUT/mdx-attribution.raw.json"
"$NODE" experiments/evidence-store/create-attribution-summary.mjs "$OUT/mdx-attribution.raw.json" "$OUT/mdx-attribution.summary.json"
"$NODE" experiments/evidence-store/promote-evidence.mjs --kind attribution --raw "$OUT/mdx-attribution.raw.json" --summary "$OUT/mdx-attribution.summary.json"
```

`run-performance.mjs` writes the screen summary beside the raw file using the `.summary.json` suffix shown above. After every `promote-evidence.mjs`, commit the one new bundle before running `verify-evidence.mjs` on its pointer. If the controlled Vue summary requests more than one additional confirmation, repeat the write/run/merge/summarize cycle using the most recently merged raw and summary; do not stop at the first extension.

1. Controlled Vue wall: from `$VUE/vue-scale`, run `run-matrix.mjs wall-screen-matrix.json`, generate the confirmation with `create-confirm-matrix.mjs`, run and summarize it, then use `write-additional-confirm-matrix.mjs` and `merge-confirmation-reports.mjs` until the mechanically generated terminal status is reached. Use `$BASE`; never choose the next scale or count by hand.
2. Implement and verify the missing controlled Vue attribution promotion path, then run `$VUE/vue-scale/run-matrix.mjs instrumented-matrix.json` with `$ATTR`. This required 8-scale ordinary plus worker-one-through-eight matrix is attribution-only and must enter a content-addressed raw/summary/pointer store before later policy work.
3. Independent Vue wall: run `$VUE/vue-projects/run-performance.mjs performance-wall-screen-matrix.json` with `$BASE` and `--correctness-evidence "$RESEARCH/research/artifacts/correctness/sha256/e2c0cdecdb028ffac4a5f5931797b1f33ccceac201c3a30ab3dd4c5af1bed048/manifest.json"`; generate the confirmation with `create-performance-confirm-matrix.mjs`; run it with the same manifest plus `--screen-evidence SCREEN_RAW SCREEN_SUMMARY`.
4. MDX crossover: from `$RESEARCH`, run `experiments/cloudflare-mdx/run-matrix.mjs experiments/cloudflare-mdx/scale-base-screen-matrix.json BASE_RAW`; call `generate-scale-followup.mjs confirmation`; run its matrix; repeatedly call `generate-scale-followup.mjs refine` with every prior raw artifact in execution order until it emits an exact, censored, no-crossover, or non-monotonic terminal decision.
5. MDX attribution: run `run-attribution-matrix.mjs scale-attribution-matrix.json ATTR_RAW`, then create and promote its summary with `experiments/evidence-store`. This exact matrix is ordinary, worker four, and worker eight on all 9,157 sources using `$ATTR`.
6. MDX allocation: call `generate-mdx-policy.mjs allocation` with the base screen and every crossover raw in order. Run and summarize each generated policy matrix and pass every prior policy raw back with `--policy`. If the resource crossover is not exact, retain the generated `unavailable` terminal and do not launch an allocation child.
7. CPU rate and quota, exact resource crossover only: verify the restored controller, run `experiments/cpu-rate-control/run-calibration.mjs --output "$OUT/cpu-rate-calibration.json"`, then drive `generate-mdx-policy.mjs quota` with the passed calibration and the same ordered raw chain. A non-exact resource crossover produces `unavailable` and forbids quota children.
8. Generic initialization: from `$INIT`, run `ROLLDOWN_RESEARCH_PACKAGE_ROOT="$ATTR" "$NODE" ./run-matrix.mjs ./formal-matrix.json "$INIT/.results/formal.raw.json"`, summarize it to `$INIT/.results/formal.summary.json`, promote raw and summary with `experiments/evidence-store`, commit, and verify the pointer from a clean checkout. The runner deliberately requires formal raw output under its ignored `.results` directory.
9. Fixed policy: capture the machine topology; import only the source types accepted by `experiments/worker-policy`: controlled Vue wall plus its admission/correctness and harness snapshot, independent Vue screen/confirmation plus correctness, MDX crossover plus conditional allocation/quota/calibration, and the machine record. Those timing reports carry their own required host/runtime/harness lineage. Attribution and initialization remain separately verified content-addressed evidence for the final explanation and verdict; they are not fixed-policy build-plan source types. Commit reports and the build plan, build and commit fixed-policy evidence, evaluate it, then update the product ledger and verdict. A local pass can validate only fixed four or fixed eight on this M3 Pro. It cannot establish a shippable hardware heuristic.

The exact iterative MDX generator syntax and source-chain requirements are in [`experiments/cloudflare-mdx/README.md`](./experiments/cloudflare-mdx/README.md); the formal evidence builder order is in [`experiments/worker-policy/README.md`](./experiments/worker-policy/README.md). These are committed protocol instructions, not external context.

After every promoted lane, verify the new pointer from a clean clone, commit to `main`, and push before starting the next expensive lane. Never leave the only copy of formal raw data in `$OUT`.

## Resume goal prompt

Use this as the new session's `/goal` prompt:

```text
Continue the rolldown-parallel-js-plugin scale-crossover research from HANDOFF.md and the scale-crossover-v1-amended-8 PCR until this iteration is genuinely complete. Start by running the handoff doctor and resolving only factual setup failures; do not relax the frozen host, correctness, resource, statistics, or provenance gates. If the machine is not the exact frozen M3 Pro/12-CPU/6P+6E/38,654,705,664-byte host, add a versioned protocol amendment before any timing rather than mixing results. First close the missing controlled Vue attribution content-addressed promotion/verifier path. Then, after a qualifying restart, run the unchanged local-only sequence: controlled Vue wall and attribution, independent Vue wall, MDX crossover, MDX worker-4/worker-8 attribution, conditional Tokio/Rayon and CPU-rate/quota stages, generic initialization, complete evidence promotion, fixed-policy evaluation, product ledger, verdict, PCR, and TODO closure. Use direct Rolldown and Node.js 24.18.0 only; do not use CI timing, Vite, watch, rebuild, dev-server, HMR, artificial delay, duplicated modules, or ad hoc matrix/path edits. Treat negative, censored, unavailable, and non-monotonic outcomes as valid when mechanically produced. Commit and push each durable evidence checkpoint so another clean machine can continue without old local state. Continue without asking me unless an action crosses an explicit safety or authority boundary.
```
