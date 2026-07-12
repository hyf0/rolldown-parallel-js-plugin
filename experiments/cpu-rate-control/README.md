# Local Aggregate CPU-Rate Controller

This directory pins the optional macOS aggregate CPU-rate axis required by the [frozen scale-crossover protocol](../../.agents/docs/scale-crossover-frozen-protocol.md). It is not a core-affinity tool and does not select Performance or Efficiency cores.

The source is `opsengine/cpulimit` at `f4d2682804931e7aea02a869137344bb5452a3cd`. The retained patch repairs its Apple process-list byte/count handling, Mach CPU-time conversion, structure-size check, initial limit-above-100% timespec, missing declarations, and old C prototype. It adds one machine-readable report with control cycles, stop cycles, and measured stopped time. The prepared binary remains GPL-2.0-or-later under the upstream project; it is built into ignored `tmp/bench`, not committed.

Run `node experiments/cpu-rate-control/prepare-cpulimit.mjs` to clone, patch, build, test, and print source/patch/compiler/binary provenance. The upstream process-iterator test measures a busy child over several seconds and can fail on a host that is already heavily CPU-starved; a failure aborts preparation and cannot be ignored for project runs.

`cpu-load.mjs` is the pinned calibration target. After preparation, `node experiments/cpu-rate-control/run-calibration.mjs --output tmp/bench/cpu-rate-calibration.json` runs the formal validation. It uses three rotated samples at 200%, 400%, 600%, and 800% with eight busy worker threads, followed by five rotated direct-versus-1,200% pairs. The target's own `process.cpuUsage()` supplies CPU time. Project runs are forbidden until every active-target sample is within five percent, the paired median 1,200% wrapper stays within two percent of direct wall and CPU, and the controller reports zero stops at 1,200%.

A 400% result means the complete Node process averaged no more than roughly four CPU-seconds per wall-second. During its active 100-millisecond slices it may execute on all twelve cores. Global stop intervals intentionally make quota wall behavior different from unthrottled scheduling and make quota traces invalid for service-latency or initialization attribution.
