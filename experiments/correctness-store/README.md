# Correctness Artifact Promotion

`promote-independent-vue.mjs` imports durable independent Vue raw/summary pairs into the existing schema-2 content-addressed correctness store. It requires Node.js 24.18.0, a clean `github.com/hyf0/rolldown-parallel-js-plugin` checkout, summaries that bind their raw SHA-256, and the lifecycle-fixed baseline. The generated bundle must be committed before the Rolldown-side verifier accepts it.

```sh
/Users/yunfeihe/.local/share/mise/installs/node/24.18.0/bin/node experiments/correctness-store/promote-independent-vue.mjs RAW SUMMARY [RAW SUMMARY ...]
```
