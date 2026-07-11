# Main-Thread Isolation Measurement

This exploratory experiment separates one-worker main-thread isolation from complete-build speed. The one-worker variant makes this workload slower, while keeping the Node.js main event loop available during the synchronous transform work. It used a debug native binding; the event-loop mechanism is observed, but final speed ratios require the release-binding rerun.

## Method

- Environment and dependency pins match the [core transform smoke evidence](./2026-07-11-node-24.18.0-smoke.md).
- Native binding profile was debug, produced by `just build-rolldown`. Release-binding samples are required before using the wall-time ratio as a production result.
- Rolldown research commit `2a032a612` contains the committed measurement programs at `examples/par-plugin/measure-main-thread.mjs` and `examples/par-plugin/run-main-thread-matrix.mjs`.
- The working directory was `examples/par-plugin` in the isolated Rolldown worktree.
- The exact top-level invocation was:

```sh
/Users/yunfeihe/.local/share/mise/installs/node/24.18.0/bin/node ./run-main-thread-matrix.mjs
```

- The runner starts five fresh child processes for the ordinary plugin and five for the parallel plugin with `ROLLDOWN_PARALLEL_PLUGIN_WORKERS=1`. Each child is wrapped in `/usr/bin/time -l` for process peak RSS.
- Each child uses direct programmatic Rolldown, generates output, closes the build, and records elapsed wall time, process CPU, final RSS, and `monitorEventLoopDelay({ resolution: 1 })` statistics.
- The histogram is enabled and settled for 25 ms before it is reset. It remains enabled for 25 ms after the timed build so a delay spanning build completion is observed. The two settling intervals are excluded from `elapsedMs`.
- Raw data, invocation metadata, and every sample are retained in [`data/2026-07-11-main-thread-runs.json`](./data/2026-07-11-main-thread-runs.json).

## Results

| Metric | Ordinary main-thread transform | One worker | One-worker change |
| --- | ---: | ---: | ---: |
| Mean build wall time | 6,062.7 ms | 9,812.0 ms | 61.8% slower |
| Median build wall time | 6,067.0 ms | 9,690.4 ms | 59.7% slower |
| Mean user CPU | 11,019.7 ms | 11,100.4 ms | 0.7% higher |
| Mean peak RSS | 1,168,801,792 B | 1,161,065,267 B | 0.7% lower |
| Mean event-loop maximum delay | 1,029.60 ms | 6.37 ms | 161.7x lower |
| Median event-loop maximum delay | 1,029.70 ms | 6.69 ms | 153.8x lower |
| Mean event-loop p99 delay | 2.394 ms | 1.449 ms | 39.5% lower |

Every sample produced 10,167,549 output-code bytes and the same filename-aware SHA-256, `cf6dfe8b08d3c3f31a2d6e6308d7604b5d5db5d32d7aac9ebff130c2b53fe49f`.

All five ordinary samples recorded a maximum event-loop delay between 1,027.08 and 1,031.80 ms. All five one-worker samples recorded a maximum between 4.92 and 8.34 ms. The ranges do not overlap.

## Interpretation

- Main-thread isolation is a real, independently measurable value even when complete build time regresses. For this workload, moving the synchronous hook to one worker removes the approximately one-second longest main-loop stall while increasing wall time by about 62%.
- The ordinary maximum is much larger than one individual approximately 1 ms transform. This shows that many callbacks can keep the main event loop from returning for about one second; the current evidence does not yet attribute that interval to one specific Rust, Node-API, or JavaScript scheduling step.
- One worker has similar total user CPU and peak RSS to ordinary execution here. The large wall-time difference is therefore not evidence of additional CPU work or memory pressure by itself. Queueing, cross-thread dispatch, conversion, and incomplete overlap with Rust work remain candidates to measure separately.
- The one-worker result does not predict multi-worker whole-build speed. The separate wall matrix already shows that two or more workers can recover the transfer cost and reduce wall time when enough calls are ready concurrently.

## Limits

- This is a synthetic approximately 1 ms transform over the Three10x graph, not a user-facing responsiveness test and not a Vue or Svelte result.
- `monitorEventLoopDelay` reports the Node.js main event loop only. It does not report worker-loop delay, Rust executor availability, or queue wait.
- `/usr/bin/time -l` samples the process that contains the main isolate and worker threads. It does not break RSS down by isolate or distinguish shared from private pages.
- Initialization, per-call transport, JavaScript service, and result conversion are still combined in wall time. The controlled fixture and Rust-side timing are required before explaining the one-worker penalty.
