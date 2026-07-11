# Controlled `resolveId` and `load` Experiment

The [formal release result](./2026-07-11/README.md) and its raw reports cover cheap, synchronous CPU, cached synchronous filesystem, dependency-chain, already-asynchronous, and returned-payload cases for `resolveId` and `load`. They also retain main-thread isolation, filter-miss, mutable-state, reentrancy, and error-attribution probes.

The executable fixture lives on Rolldown branch `research/parallel-js-plugin-resolve-load` at `937864d40`. The measured native binding was built from `c9a41b1b93bdceab0572edb91c8d68bf630f3c4b`; fixture-only commits after that source revision do not change the native implementation, and every raw report pins the binding hash.
