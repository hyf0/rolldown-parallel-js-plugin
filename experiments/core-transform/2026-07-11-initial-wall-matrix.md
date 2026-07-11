# Initial Core Transform Wall-Time Matrix

This is an exploratory repeated wall-time and worker-count result after the runtime repairs. It used Rolldown's debug native binding because the setup command was `just build-rolldown`, so none of its speed ratios are final production-build claims. The release-binding controlled matrix and baseline rerun supersede it for final performance conclusions. Hook call count, ready concurrency, queue wait, service time, task-size crossover, and independently sampled multi-worker RSS are also still missing here. One-worker event-loop availability and RSS are covered separately in the [main-thread isolation measurement](./2026-07-11-main-thread-isolation.md).

## Method

- Environment and code pins match the [smoke evidence](./2026-07-11-node-24.18.0-smoke.md), with Rolldown research head `30d992c39` adding the non-public `ROLLDOWN_PARALLEL_PLUGIN_WORKERS` control.
- Native binding profile was debug. The exact setup command was `mise exec node@24.18.0 -- just build-rolldown`; this was discovered after the first matrix and is why the data are retained as exploratory evidence rather than silently replaced.
- Hyperfine 1.20.0 invoked the Node.js 24.18.0 binary and Rolldown CLI directly, avoiding pnpm startup in measured commands.
- Every sample used a fresh Node.js process and newly created plugin workers.
- The five-variant matrices used one warmup and five measured runs per variant. The Babel confirmation used two warmups and ten measured runs per variant.
- Raw per-run wall and hyperfine memory values are in [`data/2026-07-11-wall-time-runs.json`](./data/2026-07-11-wall-time-runs.json).
- The no-op plugin busy-waits for approximately 1 ms in every reached transform. The Babel plugin synchronously parses and transforms reached Rome TypeScript modules with source-map generation enabled in Babel, although it returns only code.
- All no-op variants produced 10,167,549 bytes with SHA-256 `8227952f5da912ca7d095a0b08d03ac3f08a5e6a1b969f53b6c49de72bf68385`.
- All Babel variants produced 2,682,699 bytes with SHA-256 `cafb11e5747e1d190041cfb385cfd881d1c598cc54dcecb2bf3b903cf21ba888`.

Rolldown research commit `29492bda6` adds `examples/par-plugin/run-wall-time-matrix.mjs`, which encodes every config path, worker-count environment value, warmup count, run count, and direct CLI command. From the `examples/par-plugin` working directory, the exact rerun interface is:

```sh
NODE=/Users/yunfeihe/.local/share/mise/installs/node/24.18.0/bin/node
$NODE ./run-wall-time-matrix.mjs noop-five /tmp/noop-five.json
$NODE ./run-wall-time-matrix.mjs babel-five /tmp/babel-five.json
$NODE ./run-wall-time-matrix.mjs babel-confirm-control /tmp/babel-confirm-control.json
$NODE ./run-wall-time-matrix.mjs babel-confirm-workers /tmp/babel-confirm-workers.json
```

The runner derives its measured Node binary from `process.execPath`, invokes `node_modules/rolldown/bin/cli.mjs` directly, and uses `/usr/bin/env ROLLDOWN_PARALLEL_PLUGIN_WORKERS=<count>` only for parallel variants. The normalized research JSON combines the corresponding Hyperfine result fields under stable suite and batch names.

## Five-run matrices

| Workload | Variant | Mean ± standard deviation | Relative to ordinary | Mean user CPU | Hyperfine maximum memory |
| --- | --- | ---: | ---: | ---: | ---: |
| No-op Three10x | ordinary | 6.355 ± 0.093 s | 1.00x | 11.634 s | 1,162,166,272 B |
| No-op Three10x | 1 worker | 10.707 ± 0.209 s | 0.59x | 11.910 s | 1,169,686,528 B |
| No-op Three10x | 2 workers | 5.393 ± 0.028 s | 1.18x | 11.684 s | 1,210,744,832 B |
| No-op Three10x | 4 workers | 3.950 ± 0.023 s | 1.61x | 12.594 s | 1,265,287,168 B |
| No-op Three10x | 8 workers | 3.518 ± 0.032 s | 1.81x | 12.830 s | 1,333,395,456 B |
| Babel Rome | ordinary | 3.343 ± 0.027 s | 1.00x | 6.348 s | 970,752,000 B |
| Babel Rome | 1 worker | 4.970 ± 0.157 s | 0.67x | 6.849 s | 970,752,000 B |
| Babel Rome | 2 workers | 3.220 ± 0.359 s | 1.04x | 8.174 s | 1,224,638,464 B |
| Babel Rome | 4 workers | 2.663 ± 0.029 s | 1.26x | 11.668 s | 1,656,553,472 B |
| Babel Rome | 8 workers | 2.851 ± 0.148 s | 1.17x | 15.655 s | 2,341,371,904 B |

The Babel two-worker cell contained one 3.858-second outlier among four 3.016–3.108-second runs, so the worker cells were repeated in a longer confirmation batch.

## Ten-run Babel confirmation

The ordinary and one-worker variants ran in one batch; the two-, four-, and eight-worker variants ran in a second adjacent batch. Use the five-run matrix for the strict same-batch comparison and this table to judge stability.

| Variant | Mean ± standard deviation | Relative to confirmation ordinary | Mean user CPU | Hyperfine maximum memory |
| --- | ---: | ---: | ---: | ---: |
| ordinary | 3.427 ± 0.110 s | 1.00x | 6.496 s | 1,177,042,944 B |
| 1 worker | 4.955 ± 0.111 s | 0.69x | 6.843 s | 1,177,042,944 B |
| 2 workers | 3.129 ± 0.119 s | 1.10x | 8.016 s | 1,240,842,240 B |
| 4 workers | 2.496 ± 0.110 s | 1.37x | 10.838 s | 1,659,207,680 B |
| 8 workers | 2.524 ± 0.036 s | 1.36x | 15.066 s | 2,387,935,232 B |

Four and eight workers are effectively tied on confirmed Babel wall time, while eight workers use about 39% more user CPU than four. Hyperfine also reports about 728 MB more maximum memory for eight workers than four, but the macOS memory series shows stepwise values and needs an independent process-tree sampler before it is treated as authoritative RSS.

## What this establishes for the debug binding

- One worker has a large observed wall-time penalty in both workloads: approximately 69% slower than ordinary for no-op and 45% slower in the ten-run Babel confirmation. The [separate main-thread measurement](./2026-07-11-main-thread-isolation.md) shows what isolation buys without treating this combined penalty as one fixed cost.
- Multiple workers can reduce complete direct-Rolldown build time. The no-op workload continues improving through eight workers; Babel reaches its useful plateau around four workers on this 12-logical-CPU machine.
- The current default of eight workers is not wall-time or user-CPU-optimal for this Babel corpus: four workers are slightly faster, while eight use about 39% more user CPU. Hyperfine also indicates substantially higher memory at eight workers, but that memory comparison remains provisional until it is confirmed with the independent sampler. A general worker-count policy requires the controlled task-size and graph-shape matrix.
- In the Three10x corpus, multiple workers can beat ordinary execution even when each reached transform busy-waits for only approximately 1 ms. This does not yet establish a general task-cost crossover because the exact call count and ready-task concurrency are not recorded.
- These examples do not yet locate the general crossover because the exact transform count, task-size distribution, ready concurrency, and queue time are not recorded.

## Required next evidence

1. Count reached transforms and record source and result bytes.
2. Measure ready-call concurrency, worker queue wait, and plugin service time.
3. Extend independent peak-RSS sampling from the completed ordinary/one-worker isolation run to the multi-worker matrix.
4. Vary graph width, module count, payload, and per-module work in a controlled direct-Rolldown fixture before generalizing from Three10x or Rome.
