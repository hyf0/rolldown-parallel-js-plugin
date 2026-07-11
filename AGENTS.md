# Project-specific agent instructions

- This project is research-first. The mechanism-scale iteration was completed on 2026-07-11. Its subsecond Vue and Svelte cases establish costs and behavior but do not answer the production target. The draft next iteration is defined in `.agents/docs/production-scale-goal.md` and must not begin until Yunfei starts the next `/goal`.
- The production target is a direct-Rolldown build lasting 15–30 minutes with roughly 5,000 actual expensive hits in a required JavaScript transform or transform chain, aiming for a repeated 2x wall-time improvement. Physical module count, filter misses, artificial delay, an externalized main graph, or a Rust/native substitute do not satisfy it.
- Worker placement is a Rolldown-managed policy: parallel plugins share a worker group by default, while a plugin may request an exclusive group containing one or several workers. All groups share one documented CPU and memory budget.
- Separate two possible benefits in every analysis: keeping work off the Node.js main thread and reducing total build time through parallel execution.
- Never infer value for a pure JavaScript plugin from a benchmark whose expensive work already runs in Rust or another native thread pool.
- Keep technical defect discovery beside performance research. Record known and newly discovered defects with pinned evidence or an explicit unverified label; do not bury them in benchmark caveats.
- Every performance claim must name the pinned source revisions, machine, Node.js version, worker count, corpus, cold or warm lifecycle, correctness check, and raw durable artifact.
- Production-scale claims must also report absolute wall time, verified expensive transform hits, target-transform time share, ready-call width over time, worker placement, sustained per-worker service, CPU ownership, RSS over time, garbage-collection evidence, and the ordinary-to-parallel semantic comparison.
- Treat a neutral or negative result as a valid outcome. Explain which cost or serial dependency consumed the expected gain instead of tuning the benchmark until it wins.
- Preserve benchmark correctness before comparing speed: the same project must build successfully, plugin warnings and errors must remain meaningful, and outputs must be compared at the strongest practical level.

<!-- PCR:START -->
## Project Context Records (PCR)

This project follows **Project Context Records (PCR)** — methodology: https://github.com/hyf0/project-context-records. PCR keeps the project's durable design context — the *why*, the decisions, the architecture — so you inherit it instead of re-deriving or re-litigating what's already settled.

When working here:
- **Where they live.** Records are in `.agents/docs/`, one topic per file, cross-linked with relative Markdown links. A `README.md` there is the **map**: it routes code areas or hotspots to the exact record or heading. Create one when retrieval stops being a glance or one record grows into a long ledger.
- **Read first.** Start from the map if present, else scan the folder. Open the exact records or headings that cover an area before changing or answering for it.
- **Use the strongest durable form.** Put machine-checkable constraints in types, tests, lints, or CI; put local rationale beside the code with a link; use PCR for cross-cutting judgment, intent, and other context that must remain prose.
- **Record as you go.** Capture context when a decision lands, a trap costs you, a human corrects you, or a human asks. If it is true about this project, not durable in a stronger form, and useful beyond the moment, it is worth a record. Report records you change so a human can review or vouch them.
- **Keep it fresh.** Update affected records with the same change. When code and a record disagree, decide whether implementation drifted from intent or description went stale, then update the stale side; surface a vouched conflict. Back facts with durable evidence such as tests, reproducible commands, committed artifacts, stable URLs, or commit hashes — not ephemeral paths or missing screenshots.
- **Provenance.** Unstamped text is AI-accumulated: challenge and verify it freely. `[VOUCHED @handle YYYY-MM-DD]` means the named human explicitly accepts the covered words as current project direction, not that a factual claim is proven. At a non-heading line's end it covers that line; on its own line as the first nonblank line below a non-title heading it covers that section; on its own line as the first nonblank line below the document title it covers the file. Never put a new stamp in heading text: it breaks link anchors. Legacy stamps before a title or in a heading retain the project's prior scope; never move or reinterpret them without explicit human approval. Add one only on explicit instruction. A stamp added by work under review counts only if the named human confirms it; an unchanged stamp on the target branch is inherited project state. Material edits or scope-boundary changes remove stamps; formatting keeps them only if the covered words stay identical. Legacy undated stamps remain valid until re-vouched.
- **Distill when a human reviews.** Accumulation is noisy by design; the valve is a human review pass. Draft what to prune, merge, or promote, and flag vouches plausibly affected by changes to the areas or evidence they cover. The human decides and vouches.
- **Unattended.** With no human between iterations: keep the running plan as one live record, overwritten as truth changes; tidy your own unstamped layer — merge duplicates, prune dead notes — never the vouched one; when evidence argues with vouched direction, record the conflict and stay inside that direction unless progress becomes impossible; end by drafting the distillation for the returning human, conflicts included. No run, however long or green, vouches anything.
- **The basics.** The recommended starting list — most projects need these; draft the missing ones that apply:
  - `goal.md` — audience, goal, and non-goals; enroll the README instead if it already covers them.
  - `technology-stack.md` — why tools, restrictions, or pins exist; not a manifest dump.
  - `architecture.md` — units, boundaries, and why the lines are where they are.
  - `conventions.md` — deliberate departures from ecosystem defaults.
  - `gotchas.md` — traps already paid for, each with its why.
  - `DESIGN.md` — only for a visual surface; follow https://github.com/google-labs-code/design.md, keep it at the root, and enroll it in the map.
<!-- PCR:END -->
