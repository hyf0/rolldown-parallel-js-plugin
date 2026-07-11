# Svelte registry graph raw data

These JSON files are copied byte-for-byte from the committed graph-preserving fixture's ignored `.results` directory after execution at clean Rolldown commit `1074399c2e3b0858388e5a7dee586388c76c82f6`. Performance claims use the instrumentation-off 15-round wall confirmation. Instrumented data explains startup, imports, concurrency, handler cost, scheduling, and payload; isolation data measures event-loop responsiveness; semantics and ordinary-proof files preserve graph and diagnostic gates.

- `2026-07-11-ordinary-proof-final.json`: independent ordinary graph discovery and expected-graph comparison.
- `2026-07-11-semantics-final.json`: ordinary/worker graph log comparison and invalid-component error comparison.
- `2026-07-11-smoke-final.json` and summary: one uninstrumented and one instrumented exact-output process for ordinary and worker-4.
- `2026-07-11-wall-confirm-final.json` and summary: one warmup and 15 measured fresh processes per variant, instrumentation disabled.
- `2026-07-11-instrumented-final.json` and summary: one warmup and three measured fresh processes per ordinary, worker-1, worker-4, and worker-8 variant.
- `2026-07-11-isolation-final.json` and summary: one warmup and five measured fresh processes per ordinary, worker-1, worker-4, and worker-8 variant with event-loop monitoring.

The executable fixture and exact reproduction commands are in the [formal graph report](../2026-07-11-svelte-registry-graph-results.md#reproduction).
