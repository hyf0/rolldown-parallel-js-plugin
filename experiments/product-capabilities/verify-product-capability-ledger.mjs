import { readFile, rm, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProductCapabilityLedger } from './product-capability-ledger.mjs';

const repoRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../..');
const ledger = JSON.parse(
  await readFile(nodePath.join(import.meta.dirname, 'product-capability-ledger.json'), 'utf8'),
);
await validateProductCapabilityLedger(ledger, { repoRoot });

const rejected = [];
await expectRejected('missing-capability', (value) => {
  delete value.families[0].capabilities.shutdown;
});
await expectRejected('unknown-status', (value) => {
  value.families[0].capabilities.state.status = 'unknown';
});
await expectRejected('not-tested-with-evidence', (value) => {
  value.families[0].capabilities.state.evidence = ['mdxFullCorrectness'];
});
await expectRejected('missing-performance-crossover', (value) => {
  delete value.families[0].performanceCrossovers.resourceAcceptable;
});
await expectRejected('performance-pass-without-evidence', (value) => {
  value.families[0].performanceCrossovers.mechanical.status = 'pass';
});
await expectRejected('forged-semantic-capabilities-pass', (value) => {
  value.families[0].semanticCapabilitiesPass = true;
});
await expectRejected('forged-family-product-crossover', (value) => {
  value.families[0].productCrossover = true;
});
await expectRejected('forged-global-product-crossover', (value) => {
  value.productCrossover = true;
});
await expectRejected('forged-source-map-pass', (value) => {
  value.families[0].capabilities.sourceMaps.status = 'pass';
});
await expectRejected('capability-evidence-substitution', (value) => {
  value.families[0].capabilities.code.evidence = ['mdxSemanticSentinel'];
});
await expectRejected('missing-cache-determinism', (value) => {
  delete value.families[1].capabilities.cacheDeterminism;
});
await expectRejected('evidence-path-escape', (value) => {
  value.evidence.mdxCorrectnessGate.path = '../outside.json';
});
await expectRejected('evidence-hash-drift', (value) => {
  value.evidence.mdxCorrectnessGate.sha256 = '0'.repeat(64);
});
await expectRejected('controlled-bundle-address-drift', (value) => {
  value.evidence.controlledVueBundleManifest.path =
    value.evidence.controlledVueCorrectnessPointer.path;
  value.evidence.controlledVueBundleManifest.bytes =
    value.evidence.controlledVueCorrectnessPointer.bytes;
  value.evidence.controlledVueBundleManifest.sha256 =
    value.evidence.controlledVueCorrectnessPointer.sha256;
});
await expectRejected('controlled-raw-substitution', (value) => {
  value.evidence.controlledVueCorrectnessRaw = structuredClone(
    value.evidence.controlledVueAdmissionRaw,
  );
});
await expectRejected('controlled-source-kind-drift', (value) => {
  value.evidence.controlledVuePluginImplementation.kind = 'local-json';
});
await expectRejected('forged-controlled-source-map-pass', (value) => {
  value.families[1].capabilities.sourceMaps.status = 'pass';
});
await expectRejected('invented-family-product-crossover', (value) => {
  const invented = structuredClone(value.families[0]);
  invented.id = 'invented-family';
  for (const record of Object.values(invented.capabilities)) {
    record.status = 'pass';
    record.evidence = ['mdxFullCorrectness'];
  }
  for (const record of Object.values(invented.performanceCrossovers)) {
    record.status = 'pass';
    record.evidence = ['mdxFullCorrectness'];
  }
  invented.semanticCapabilitiesPass = true;
  invented.productCrossover = true;
  value.families.push(invented);
  value.productCrossoverFamilies = ['invented-family'];
  value.productCrossover = true;
});
await expectUnlistedBundleFileRejected();

console.log(
  JSON.stringify({
    valid: {
      families: ledger.families.length,
      capabilitiesPerFamily: ledger.capabilitySet.length,
      productCrossover: ledger.productCrossover,
    },
    rejected,
  }),
);

async function expectRejected(name, mutate) {
  const value = structuredClone(ledger);
  mutate(value);
  try {
    await validateProductCapabilityLedger(value, { repoRoot });
  } catch {
    rejected.push(name);
    return;
  }
  throw new Error(`Invalid product capability ledger was accepted: ${name}`);
}

async function expectUnlistedBundleFileRejected() {
  const path = nodePath.join(
    repoRoot,
    nodePath.dirname(ledger.evidence.controlledVueBundleManifest.path),
    'unlisted-negative-control.json',
  );
  await writeFile(path, '{}\n', { flag: 'wx' });
  try {
    await validateProductCapabilityLedger(ledger, { repoRoot });
  } catch {
    rejected.push('unlisted-bundle-file');
    return;
  } finally {
    await rm(path, { force: true });
  }
  throw new Error('Controlled Vue evidence bundle accepted an unlisted file');
}
