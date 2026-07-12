# Fixed Worker-Count Policy Evaluation

This directory evaluates the two fixed startup policies frozen before scale timing: four JavaScript workers and `min(availableParallelism, 8)`, which selects eight on the local 12-CPU M3 Pro. The evaluator does not fit either count from benchmark results. Every case is therefore held out from candidate fitting, although crossover locations and confirmation cases are still selected mechanically by the frozen experiment protocol rather than by an independent test corpus.

The current protocol identity is `scale-crossover-v1-amended-7`. A formal evidence file records the committed bytes and SHA-256 of the frozen protocol plus Amendments 1 through 7, the committed build plan, every source report, and the source commit. The evaluator rejects Amendment 4 evidence, dirty or untracked source reports, a source commit that is not an ancestor of the evidence commit, or a report whose current bytes differ from its recorded commit.

## Evidence construction

`import-policy-report.mjs` copies a JSON artifact byte-for-byte into `data/reports/sha256/<sha256>.json`. Import both compact policy-evidence outputs and every raw or intermediate artifact required by its formal source type. The builder derives mandatory admission, raw, screen, confirmation, calibration, and completion contracts from `sourceType`; plan-supplied assertions cannot substitute for those contracts. Every required `links` entry must resolve the source document's exact SHA-256 field to an imported report of the expected type, and undeclared extra links are rejected. This makes the complete evidence chain available in a fresh clone instead of leaving absolute paths into another worktree.

The committed build plan contains JSON Pointers and workload labels, but no copied wall, CPU, RSS, eligibility, bootstrap, oracle, crossover-role, finalist, or pool values. `build-fixed-policy-evidence.mjs` reads every metric from the imported report, retains all repeated variants, and emits the exact pointer used for every normalized value. Crossover roles are derived from the completed controlled Vue or MDX decision: previous repeated point, exact crossover, confirming adjacent point, and frozen full endpoint. Independent Vue roles are derived from the frozen project ID, band, and SFC count. Every formal case also names a `poolEnvironmentSourceId` and `poolEnvironmentPointer`; the builder normalizes numeric Vue pool records and string MDX pool records to the exact `18/12/4` environment.

Formal source types and mandatory chains are:

| Result used by the evaluator | Required source and intermediate chain                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controlled Vue baseline      | completed `wall-confirm` summary → admitted `wall-confirm` raw → passed admission and correctness pointers → their untimed raw reports               |
| Independent Vue baseline     | durable `independent-vue-wall-confirm` summary → admitted confirmation raw → admitted screen raw and summary plus the committed correctness manifest |
| MDX baseline                 | exact `crossover-complete` decision → every consumed repeated confirmation raw → base screen and ordered follow-up raw chain                         |
| MDX allocation               | `allocation-complete` result → Tokio screen/confirmation and Rayon screen/confirmation raw reports → exact completed crossover chain                 |
| MDX quota                    | `quota-complete` result → quota screen/confirmation raw reports → passed schema-2 CPU-rate calibration and exact completed crossover chain           |

Controlled Vue raw evidence must bind the exact lifecycle runtime pin and a clean harness manifest containing both `run-matrix.mjs` and `summarize-matrix.mjs`. Formal coverage additionally requires one content-addressed, Git-committed source snapshot for the declared Rolldown fixture commit; the builder rehashes every embedded source blob, its Git blob identity, and the sorted manifest entry count, byte count, and aggregate before matching admission, correctness, confirmation, and pointer records to it. Independent Vue raw and summary evidence must bind the same exact runtime, clean harness commit and source-manifest hash, frozen three-project grid, and recomputed content-addressed correctness manifest. MDX reports must bind the committed hashes of their exact matrix runner, case runner, policy launcher, crossover generator, policy generator, and summarizer sources. Formal raw timing reports must be local-only, admitted by the frozen host and correctness gates, carry the expected timing classification, and retain wall, total-process CPU, peak RSS, and zero paging deltas.

The formal builder does not trust compact metrics merely because their hashes and keys line up. It validates every raw matrix against its complete rotated run order, contiguous sequence numbers, and unique repeat indices, then deterministically rebuilds controlled and independent Vue policy metrics and selected oracle counts from paired raw blocks. The independent Vue confirmation must be generated from the resource-eligible screen winner plus its frozen adjacent workers. It replays the production MDX follow-up planner from the complete base screen through every generated confirmation and refinement before accepting the completed crossover, validates the complete Tokio, Rayon, and quota screen grids and their generated confirmations, and rebuilds allocation and quota summaries before checking their selected pool winners. Both policy completions must embed the same uniquely rederived MDX crossover, while a passed CPU-rate calibration must retain the frozen local profile and controller provenance and be rederived from its ordered samples, saturation ceiling, controller records, and equivalence pairs. A truncated or duplicated raw grid, or a compact summary, oracle, decision, selection, or winner changed without the linked raw runs, therefore fails even when every copied field was edited consistently.

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

- Unthrottled controlled Vue at the repeated lower, exact crossover, confirming next point, and full 5,000-SFC scale.
- Independent Vue at the frozen 4-SFC small, 166-SFC medium, and 546-SFC large projects.
- Unthrottled MDX at the repeated lower, exact crossover, confirming next point, and full 9,157-source scale.
- Both repeated Tokio finalist pool settings at every one of those four MDX roles.
- Both repeated Rayon finalist pool settings at every one of those four MDX roles.
- MDX crossover and full scale at validated aggregate CPU rates of 400%, 800%, and 1,200%.
- At least one source-bound ordinary-best small case. Svelte remains optional.

Allocation and quota scale values must exactly equal the source-computed baseline MDX role values. Each Tokio confirmation pair must be the screen-selected pool and its generated different-pool runner-up while retaining Rayon 12 and blocking 4. The evaluator recomputes the repeated Tokio winner from both confirmation cases. Each Rayon screen and confirmation must retain that Tokio winner; its confirmation pair must again be the selected pool and generated runner-up. The evaluator then recomputes the repeated Rayon winner. Quota evidence must retain the baseline 18/12/4 pool settings. These checks prevent a plan from relabelling another scale, changing more than one allocation variable, or retaining only the favorable finalist.

When the confirming adjacent point is also the frozen full endpoint, one case declares `"scaleRoles": ["crossover-confirm", "full"]`. It satisfies both coverage roles but appears only once in candidate evaluation. Duplicating the same policy-evidence pointer under two cases or omitting either semantic role is rejected.

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
