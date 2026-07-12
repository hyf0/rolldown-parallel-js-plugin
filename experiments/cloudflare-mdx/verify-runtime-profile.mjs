import {
  HISTORICAL_RUNTIME_PROFILE,
  LIFECYCLE_FIXED_RUNTIME_PROFILE,
  normalizeRuntimeProfile,
  validateRuntimeLane,
} from './runtime-profile.mjs';

const historical = normalizeRuntimeProfile(HISTORICAL_RUNTIME_PROFILE);
assertRejected(
  () =>
    validateRuntimeLane({
      runtimeProfile: historical,
      instrumentation: false,
      rustInstrumentation: false,
      evidenceKind: 'performance-screen',
    }),
  'historical artifact as a wall baseline',
);
validateRuntimeLane({
  runtimeProfile: historical,
  instrumentation: true,
  rustInstrumentation: false,
  evidenceKind: 'historical-replay',
  lifecycleClaim: false,
});
assertRejected(
  () =>
    validateRuntimeLane({
      runtimeProfile: historical,
      instrumentation: true,
      rustInstrumentation: false,
      evidenceKind: 'correctness-only',
      lifecycleClaim: false,
    }),
  'historical artifact without explicit replay classification',
);
assertRejected(
  () =>
    validateRuntimeLane({
      runtimeProfile: historical,
      instrumentation: false,
      rustInstrumentation: false,
      evidenceKind: 'historical-replay',
      lifecycleClaim: true,
    }),
  'historical success as lifecycle counterevidence',
);
assertRejected(
  () =>
    validateRuntimeLane({
      runtimeProfile: historical,
      instrumentation: true,
      rustInstrumentation: true,
      evidenceKind: 'attribution',
    }),
  'baseline Rust attribution',
);

const lifecycleFixed = LIFECYCLE_FIXED_RUNTIME_PROFILE;
validateRuntimeLane({
  runtimeProfile: lifecycleFixed,
  instrumentation: false,
  rustInstrumentation: false,
  evidenceKind: 'performance-screen',
});

const attribution = {
  kind: 'instrumented-attribution',
  rolldownCommit: '1'.repeat(40),
  bindingSha256: '2'.repeat(64),
  distSha256: '3'.repeat(64),
};
validateRuntimeLane({
  runtimeProfile: attribution,
  instrumentation: true,
  rustInstrumentation: true,
  evidenceKind: 'attribution',
});
assertRejected(
  () =>
    validateRuntimeLane({
      runtimeProfile: attribution,
      instrumentation: false,
      rustInstrumentation: false,
      evidenceKind: 'performance-screen',
    }),
  'instrumented binary as a metrics-off baseline',
);
assertRejected(
  () =>
    normalizeRuntimeProfile({
      ...attribution,
      bindingSha256: HISTORICAL_RUNTIME_PROFILE.bindingSha256,
    }),
  'instrumented profile reusing the unchanged binding',
);

console.log(
  JSON.stringify({
    valid: true,
    historicalSourcePin: historical,
    requiredRunnableBaselineShape: lifecycleFixed,
    enforced: [
      'historical artifact cannot provide wall or lifecycle evidence',
      'historical execution requires explicit replay classification',
      'sole parent Worker.unref lifecycle fix for the next runnable baseline',
      'distinct instrumented attribution artifacts',
      'no metrics-off instrumented baseline substitution',
    ],
  }),
);

function assertRejected(callback, label) {
  let rejected = false;
  try {
    callback();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Runtime-profile gate accepted ${label}`);
}
