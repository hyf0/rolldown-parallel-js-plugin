# Scale-Crossover Protocol Amendment 3: Controlled Vue 5,000-Source Curve

Status: frozen on 2026-07-12 before any lifecycle-fixed Vue scale timing. This amendment supersedes only the controlled Vue corpus, preparation contract, scale points, and admission artifacts in the [frozen execution protocol](./scale-crossover-frozen-protocol.md). Independent Vue projects, MDX, runtime profiles, host admission, worker and Rust-pool grids, CPU-rate controls, statistical thresholds, resource gates, and product semantics remain unchanged.

## Trigger: the four-repository pool cannot reach 5,000 and tracked files alone do not compile

The original schema-1 corpus contained 4,540 content-unique SFCs. Its first tracked-only ordinary admission exposed 717 deterministic compiler failures rather than a transform-performance result: 601 PrimeVue Volt sources extended a missing generated Nuxt TypeScript configuration, 103 Vuestic sources depended on generated or package TypeScript configurations, and 13 Element Plus sources required checked-out workspace package resolution. TDesign contributed no failures. These failures were caused by absent static support material used by the pinned compiler, not by Rolldown, worker execution, or a requirement to execute Nuxt or Vite during a measured build.

The controlled maximum also remained below the requested 5,000 mandatory Vue transforms. Quasar at commit `2165ce9f69d84e6169e7ca8a1c51fde105042cb9` supplies enough additional real SFCs without source replication or synthetic delay. Its MIT license file has SHA-256 `830424149e83c3b9caa4243c36e73ac1b024b501fea99f8a22138b86eedc8d47`.

## Schema-2 corpus

Schema 2 retains the exact PrimeVue, Element Plus, TDesign Vue Next, and Vuestic UI pins from schema 1 and adds Quasar. Eligibility still uses `@vue/compiler-sfc` 3.5.39, requires a successful parse, excludes style and custom blocks, excludes every block with `src`, excludes optional non-HTML template preprocessors, and removes exact content duplicates by retaining the first UTF-8-sorted `repository/path`. Quasar additionally excludes three pinned playground SFC paths whose tracked TypeScript configuration extends a missing generated `.quasar/tsconfig.json`; an untimed pre-exclusion audit must prove that these are the complete compile-failure set before the exclusion is accepted.

| Source | Commit | Retained SFCs | Bytes |
| --- | --- | ---: | ---: |
| PrimeVue | `d4374cb7c1267f35eba7cee5d0a266f50ca8ec84` | 2,495 | 8,511,875 |
| Element Plus | `85bdf740c1d550f3ca44472262e2a314039eab7d` | 725 | 1,942,309 |
| TDesign Vue Next | `dd334e2dc06d8ab48d1b6ebc5e9d4f6de67b16a2` | 644 | 897,120 |
| Vuestic UI | `c5337ed8e7e24ea294221326fe2ca6af8d3b8e1b` | 676 | 882,094 |
| Quasar | `2165ce9f69d84e6169e7ca8a1c51fde105042cb9` | 1,110 | 2,244,448 |

The admitted pool contains 5,650 distinct contents and 14,477,846 bytes: 2,505 script-setup, 2,247 ordinary-script, and 898 template-only SFCs. Its canonical aggregate SHA-256 is `114f8b7b7e3fa7d13d5f14946acd7a4a42d88957f7ca57da041381cd6eada99c`, computed with the schema-1 path, byte-length, and content-hash record format. The curve deliberately ends at a nested 5,000-source prefix rather than changing the maximum to every available source.

Nested order remains `SHA-256(aggregateSha256 + NUL + sourceKey)` with UTF-8 source key as tie-breaker. The superseding scales and selection SHA-256 values are:

| Scale | Selection SHA-256 |
| ---: | --- |
| 32 | `542c27dc121c69009a27ebb77a75e2a5b8660b4e2c85ad3949c766af8ca59998` |
| 128 | `1a1833a66bd645d2f63886493dc0749ad05de6728549b6bb8af62a1fc7ff3591` |
| 256 | `0609df9cb9e6153bbd5a19325a7c82d17b4ec52f35c509f99bff94e67411100a` |
| 512 | `6770cadb2c52ae19ad3776e969d204b9f458be1e26f8e6d28d4a463001274d93` |
| 1,024 | `5d01c401de0e559934961478783dcb36ca9ddaa98fc6bc987a62e81726fe7b34` |
| 2,048 | `2483b221836c7f86610095ddab18f9f7ca42e22d857558347f8f8f3cffbcfed9` |
| 4,096 | `ffdfac9f785e570f8db341ce2afc1e66c40db8008e19c953e9bfc41e5829645f` |
| 5,000 | `27add878d7150bf40b5efc3540f0e78e029a6d4b076aae8914ba2b2ca7d6e474` |

## Frozen support boundary

Preparation copies every tracked file from the five exact clean checkouts and adds 15 pinned support entries totalling 28,403 bytes, including two relative workspace symlinks. Their aggregate SHA-256 is `64370492a4d453788b0b6ef0134218814e192fcefe6d1dd4bc3f7264f3457c48`. The overlay contains the exact PrimeVue Volt generated TypeScript configuration, two Element Plus workspace links, two Vuestic generated TypeScript configurations, and the exact standalone TypeScript configuration packages required by the Vuestic compiler playground. The committed support record pins source lockfiles, tool versions and capture commands, registry integrity where applicable, byte hashes, symlink targets, and licenses.

Support capture is preparation provenance, not measured execution. A benchmark run copies the committed overlay only: it performs no dependency installation, registry access, Nuxt preparation, Vite execution, or support generation. Matrix startup rehashes every tracked and generated support entry and rejects missing, changed, or unexpected files.

## Hard admission before timing

No schema-2 Vue wall or attribution matrix may run until a clean committed harness records and pins all of the following untimed evidence:

1. A pre-exclusion Quasar audit that enumerates the parse-eligible, content-deduplicated candidates and proves that the only ordinary compiler failures are the three frozen `.quasar/tsconfig.json` paths with the expected diagnostic classification.
2. A full-pool ordinary admission over all 5,650 retained SFCs with zero compile or generate failures, not only the 5,000 performance prefix.
3. A 5,000-prefix correctness artifact covering ordinary, worker one, worker four, and worker eight with exact selected IDs, one transform per source, exact input bytes, every requested worker used, clean Rust queue and lifecycle state, and identical normalized code and generated-map hashes. Incidental instrumentation is correctness-only and cannot provide wall, CPU, RSS, service-time, or optimum evidence.
4. A compact committed admission record that pins the raw artifact hashes, harness source manifest or clean commit, runtime triple, compiler and adapter provenance, support manifest, corpus aggregate, selection hash, and all golden output hashes.

Any failure changes admission status; it may not be converted into timing by removing a source or support entry without another versioned amendment.

## Statistical consequence

Schema 1 timing, if any is replayed later, remains historical and cannot be merged with schema 2. The fixed-count optimum must be selected from the resource-eligible repeated results before applying the smaller-worker tie rule. An exact crossover may be reported only when the candidate and its immediate next larger frozen scale are repeatedly positive and every smaller boundary needed to exclude an earlier crossover has repeated evidence. A left-censored, right-censored, non-monotonic, or screen-versus-confirmation reversal remains an interval or requests additional confirmation; it must not be relabelled as an exact scale.
