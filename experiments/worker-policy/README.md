# Fixed Worker-Count Policy Evaluation

This directory evaluates the two fixed startup policies frozen before scale timing: four JavaScript workers and `min(availableParallelism, 8)`, which selects eight on the local 12-CPU M3 Pro. The evaluator does not fit either count from benchmark results. Every case is therefore held out from candidate fitting, although crossover locations and confirmation cases are still selected mechanically by the frozen experiment protocol rather than by an independent test corpus.

The current protocol identity is `scale-crossover-v1-amended-7`. A formal evidence file records the committed bytes and SHA-256 of the frozen protocol plus Amendments 1 through 7, the committed build plan, every source report, and the source commit. The evaluator rejects Amendment 4 evidence, dirty or untracked source reports, a source commit that is not an ancestor of the evidence commit, or a report whose current bytes differ from its recorded commit.

## Evidence construction

`import-policy-report.mjs` copies a JSON artifact byte-for-byte into `data/reports/sha256/<sha256>.json`. Import both compact policy-evidence outputs and every raw or intermediate artifact required by its formal source type. The builder derives mandatory admission, raw, screen, confirmation, calibration, and completion contracts from `sourceType`; plan-supplied assertions cannot substitute for those contracts. Every required `links` entry must resolve the source document's exact SHA-256 field to an imported report of the expected type, and undeclared extra links are rejected. This makes the complete evidence chain available in a fresh clone instead of leaving absolute paths into another worktree.

Create the controlled Vue harness snapshot from the exact wall-confirm fixture commit rather than from the current worktree:

```sh
node ./create-controlled-vue-harness-snapshot.mjs /path/to/rolldown <wall-confirm-commit> /tmp/vue-controlled-harness-snapshot.json
```

The generator reads Git objects, not checkout files. It embeds the commit object and the minimal recursive tree-object proof needed to reach the harness scope, then applies the harness's exact two recursive roots, two explicit files, ignored evidence/result directories, UTF-8 byte ordering, content SHA-256, Git blob OID, and aggregate-manifest rules. The verifier rehashes the commit, every tree, and every blob, walks from the commit's root tree, rejects missing or unused tree proof, and reconstructs the complete in-scope path set before accepting the manifest. The repository's normalized `origin` must be `github.com/rolldown/rolldown` and the object format must be SHA-1.

The committed build plan contains JSON Pointers and workload labels, but no copied wall, CPU, RSS, eligibility, bootstrap, oracle, crossover-role, finalist, or pool values. `build-fixed-policy-evidence.mjs` reads every metric from the imported report, retains all repeated variants, and emits the exact pointer used for every normalized value. Crossover roles are derived from the completed controlled Vue or MDX decision: previous repeated point, exact crossover, confirming adjacent point, and frozen full endpoint. Independent Vue roles are derived from the frozen project ID, band, and SFC count. Every formal case also names a `poolEnvironmentSourceId` and `poolEnvironmentPointer`; the builder normalizes numeric Vue pool records and string MDX pool records to the exact `18/12/4` environment.

Formal source types and mandatory chains are:

| Result used by the evaluator | Required source and intermediate chain                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controlled Vue baseline      | completed `wall-confirm` summary → admitted `wall-confirm` raw → passed admission and correctness pointers → their untimed raw reports               |
| Independent Vue baseline     | durable `independent-vue-wall-confirm` summary → admitted confirmation raw → admitted screen raw and summary plus the committed correctness manifest |
| MDX baseline                 | terminal `crossover-complete` decision → every consumed repeated confirmation raw → base screen and ordered follow-up raw chain                      |
| MDX allocation               | exact crossover: `allocation-complete` plus four policy raws; non-exact crossover: frozen `allocation-unavailable` record                            |
| MDX quota                    | exact crossover: `quota-complete`, two policy raws, and calibration; non-exact crossover: frozen `quota-unavailable` record                          |

Controlled Vue raw evidence must bind the exact lifecycle runtime pin and a clean harness manifest containing both `run-matrix.mjs` and `summarize-matrix.mjs`. Admission, correctness, and wall timing may come from different phase commits because committing ignored evidence advances `HEAD`; each pointer must bind its own raw report's SHA-256, byte count, commit, and manifest, all three raw reports must bind the same harness manifest, and the source snapshot must bind the wall raw report's exact commit and complete manifest. The wall summary must bind the exact wall raw artifact, full runtime record, and full fixture record. The builder rehashes every embedded source blob, its Git blob identity, and the sorted manifest entry count, byte count, and aggregate. Independent Vue raw and summary evidence must bind the same exact runtime, clean harness commit and source-manifest hash, frozen three-project grid, and recomputed content-addressed correctness manifest. MDX reports must bind the committed hashes of their exact matrix runner, case runner, policy launcher, crossover generator, policy generator, and summarizer sources. Formal raw timing reports must be local-only, admitted by the frozen host and correctness gates, carry the expected timing classification, and retain wall, total-process CPU, peak RSS, and zero paging deltas.

The formal builder does not trust compact metrics merely because their hashes and keys line up. It validates every raw matrix against its complete rotated run order, contiguous sequence numbers, and unique repeat indices, then deterministically rebuilds controlled and independent Vue policy metrics and selected oracle counts from paired raw blocks. An independent Vue screen normally selects the fastest resource-envelope-eligible worker. If none exists, the confirmation definition records `screenSelectionStatus: "no-resource-envelope-worker"` and deterministically selects the fastest worker from the complete worker-1 through worker-8 screen. Both states confirm ordinary, the selected count, its valid adjacent counts, fixed four, and fixed eight, with duplicates removed. It replays the production MDX follow-up planner from the complete base screen through every generated confirmation and refinement before accepting any terminal exact, censored, no-crossover, or non-monotonic outcome. Exact MDX crossover evidence continues through allocation and quota validation. A non-exact resource outcome instead requires allocation and quota records with `status: "unavailable"`, `applicability: "not-applicable"`, the correct stage, reason `resource-crossover-not-exact`, the exact crossover artifact SHA-256, and that artifact's resource status; policy timing and calibration artifacts are rejected as inapplicable. A truncated or duplicated raw grid, or a compact summary, oracle, decision, selection, or winner changed without the linked raw runs, therefore fails even when every copied field was edited consistently.

Use these actual output locations when authoring the build plan:

| Evidence source                      | Scale pointer                               | Policy-evidence pointer                           | Schema pointer                                           | Oracle pointer                                                              |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Controlled Vue confirmation summary  | `/scaleSummaries/<index>/componentCount`    | `/policyEvidence/byScale/<scale>`                 | `/policyEvidence/schema`                                 | `/policyEvidence/byScale/<scale>/variants/ordinary/selectedOracleCount`     |
| Independent Vue confirmation summary | `/projectSummaries/<index>/reachedSfcCount` | `/projectSummaries/<index>/policyEvidence`        | `/projectSummaries/<index>/policyEvidence/schema`        | `/projectSummaries/<index>/policyEvidence/selectedOracleWorkerCount`        |
| Completed MDX crossover decision     | `/decision/points/<index>/scale`            | `/decision/policyEvidenceByScale/<scale>`         | `/decision/policyEvidenceByScale/<scale>/schema`         | `/decision/policyEvidenceByScale/<scale>/selectedOracleWorkerCount`         |
| Completed MDX Tokio allocation case  | `/tokioConfirmation/cases/<index>/scale`    | `/tokioConfirmation/cases/<index>/policyEvidence` | `/tokioConfirmation/cases/<index>/policyEvidence/schema` | `/tokioConfirmation/cases/<index>/policyEvidence/selectedOracleWorkerCount` |
| Completed MDX Rayon allocation case  | `/rayonConfirmation/cases/<index>/scale`    | `/rayonConfirmation/cases/<index>/policyEvidence` | `/rayonConfirmation/cases/<index>/policyEvidence/schema` | `/rayonConfirmation/cases/<index>/policyEvidence/selectedOracleWorkerCount` |
| Completed MDX quota case             | `/confirmation/cases/<index>/scale`         | `/confirmation/cases/<index>/policyEvidence`      | `/confirmation/cases/<index>/policyEvidence/schema`      | `/confirmation/cases/<index>/policyEvidence/selectedOracleWorkerCount`      |

Allocation and quota cases additionally bind their completion object's case-local `poolEnvironment`, `quotaPercent`, and confirmation `sourcePolicy.stage`. The exact expected stages are `allocation-tokio-confirmation`, `allocation-rayon-confirmation`, and `quota-confirmation`. A one-shot screen has a null paired-bootstrap upper bound and is rejected; fixed-policy evidence must come from repeated confirmation.

A source entry has this generic shape:

```json
{
  "id": "independent-vue-confirmation",
  "sourceType": "vue-independent-confirmation-summary",
  "path": "reports/sha256/<sha256>.json",
  "assertions": [],
  "links": [
    {
      "sourceId": "independent-vue-raw",
      "sha256Pointer": "/rawArtifactSha256"
    }
  ]
}
```

A case binding has this shape; allocation and quota cases add the three pointers described above:

```json
{
  "id": "vue-project-small",
  "family": "vue-project",
  "study": "baseline",
  "scaleRole": "independent-small",
  "sourceId": "independent-vue-confirmation",
  "scaleValuePointer": "/projectSummaries/0/reachedSfcCount",
  "policyEvidencePointer": "/projectSummaries/0/policyEvidence",
  "policyEvidenceSchemaPointer": "/projectSummaries/0/policyEvidence/schema",
  "oracleWorkerCountPointer": "/projectSummaries/0/policyEvidence/selectedOracleWorkerCount",
  "poolEnvironmentSourceId": "independent-vue-confirmation-raw",
  "poolEnvironmentPointer": "/configuredPools"
}
```

The machine record uses pointers for available parallelism, CPU model, Node version, performance-core count, and efficiency-core count. `capture-machine-topology.mjs` reads the two Apple performance levels through `sysctl`, cross-checks them against Node's CPU view, and emits a timestamp-free importable record. Only the policy safety cap of eight is a constant. Formal evidence requires Node.js 24.18.0, Apple M3 Pro, 12 available CPUs, six performance cores, and six efficiency cores.

## Required formal coverage

A formal manifest is rejected unless it contains all of the following repeated evidence:

- Unthrottled controlled Vue at the repeated lower, exact crossover, confirming next point, and full 5,000-SFC scale when the result is exact; otherwise every repeated curve point, including 5,000.
- Independent Vue at the frozen 4-SFC small, 166-SFC medium, and 546-SFC large projects.
- Unthrottled MDX at the repeated lower, exact crossover, confirming next point, and full 9,157-source scale when the resource result is exact; otherwise every repeated curve point, including 9,157.
- For an exact MDX resource crossover only, both repeated Tokio finalist pool settings and both repeated Rayon finalist pool settings at every one of the four MDX roles.
- For an exact MDX resource crossover only, MDX crossover and full scale at validated aggregate CPU rates of 400%, 800%, and 1,200%.
- For a non-exact MDX resource outcome, no allocation or quota case and one explicit unavailable result for each stage.
- At least one source-bound ordinary-best small case. Svelte remains optional.

Allocation and quota scale values must exactly equal the source-computed baseline MDX role values. Each Tokio confirmation pair must be the screen-selected pool and its generated different-pool runner-up while retaining Rayon 12 and blocking 4. The evaluator recomputes the repeated Tokio winner from both confirmation cases. Each Rayon screen and confirmation must retain that Tokio winner; its confirmation pair must again be the selected pool and generated runner-up. The evaluator then recomputes the repeated Rayon winner. Quota evidence must retain the baseline 18/12/4 pool settings. These checks prevent a plan from relabelling another scale, changing more than one allocation variable, or retaining only the favorable finalist.

When the confirming adjacent point is also the frozen full endpoint, one case declares `"scaleRoles": ["crossover-confirm", "full"]`. It satisfies both coverage roles but appears only once in candidate evaluation. Duplicating the same policy-evidence pointer under two cases or omitting either semantic role is rejected.

Controlled Vue terminal statuses are `confirmed`, `left-censored`, `not-observed-through-maximum`, `right-boundary-unconfirmed`, and `inconsistent-repeated-direction`. MDX terminal statuses are `exact`, `left-censored`, `interval-censored-before-screen-interval`, `right-censored`, `interval-censored-after-screen-interval`, `non-monotonic-or-unbounded`, `non-monotonic-repeated-evidence`, and `right-edge-censored`. A status that still requests refinement or confirmation is not terminal and cannot enter formal fixed-policy evidence. Non-exact baseline cases use the source-derived `curve-point` role; the full endpoint uses both `curve-point` and `full`.

Every case must contain ordinary, worker four, worker eight, and the repeated source-selected oracle. The normalizer retains every other repeated adjacent candidate present in the source. If any worker is resource eligible, ordinary cannot be named as oracle; if no worker is eligible, ordinary is mandatory. A worker oracle outside the frozen below-two-percent wall tie window is rejected. The source's exact tie decision remains pointer-bound because the compact block does not contain the candidate wall-median bootstrap intervals needed to recompute interval overlap.

## Gates and interpretation

Each fixed candidate must be within 5% of the repeated oracle's wall median and within 10% of its total-process CPU and peak RSS on every case. When no worker passes the resource envelope, ordinary remains the oracle; a fixed worker may still pass the fixed-policy regret gate without being relabelled as a resource oracle. On every ordinary-best small case, the stricter frozen limits additionally require at most 3% median wall regression and at most a 5% paired worker-to-ordinary bootstrap upper bound. One failing case falsifies the policy; averages cannot hide it.

Passing these gates produces only a local M3 Pro fixed-policy result. `shippableAutomaticFixedPolicy` remains false because one machine cannot establish a user-wide hardware heuristic. Cross-machine topology and quota portability are a later study. The unchanged runtime also chooses and initializes its complete pool before ready-queue history exists, cannot resize or park it, and cannot return safely to ordinary execution; this evidence cannot validate a progressive queue-driven policy.

## Ordered local workflow

Use the exact Node.js 24.18.0 binary and local benchmark artifacts only:

```sh
node ./capture-machine-topology.mjs /tmp/fixed-policy-machine.json
node ./import-policy-report.mjs /tmp/fixed-policy-machine.json
node ./import-policy-report.mjs /path/to/source-report.json
git add ./data/reports ./data/fixed-policy-build-plan.json
git commit -m "research: record fixed-policy source evidence"
node ./build-fixed-policy-evidence.mjs ./data/fixed-policy-build-plan.json ./data/fixed-policy-evidence.json
git add ./data/fixed-policy-evidence.json
git commit -m "research: normalize fixed-policy evidence"
node ./evaluate-fixed-policy.mjs ./data/fixed-policy-evidence.json ./data/fixed-policy-evaluation.json
```

The two commits are intentional. The builder requires the plan, protocol documents, and source reports to match one source commit; the evaluator then requires the generated evidence itself to match HEAD while preserving that source commit as an ancestor.

Run the cheap contract tests without any benchmark timing:

```sh
node ./verify-evaluator.mjs
node ./verify-evidence-artifacts.mjs
```

Until the quiet-host formal confirmations exist, the remaining inputs are data only: the controlled Vue wall-confirm raw and summary plus its admission/correctness pointer chains; the independent Vue screen and confirmation raw/summary plus its correctness manifest; the completed MDX crossover decision plus the base screen and all ordered confirmation/refinement raws; the completed four-stage allocation result plus all four policy raws; the completed two-stage quota result plus both policy raws; the passed CPU-rate calibration; and the local machine-topology record. The builder rejects a partial compact-only substitution for any of these chains.
