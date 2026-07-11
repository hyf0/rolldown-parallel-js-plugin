# Direct-Rolldown Svelte Transform Experiment

This directory contains the [formal result](./2026-07-11-svelte-results.md) and raw data for the pinned Svelte compiler transform case. The 24-component case regresses at every worker count, while the 1,340-component confirmation reaches a 1.36x paired median wall-time speedup at four workers with higher CPU and RSS. The executable fixture, upstream corpus manifest, extraction rules, and MIT license live on Rolldown branch `research/parallel-js-plugin-svelte-case` at `20cbc043ccf1ab730ded962db1f413abde15753d`.
