export const HISTORICAL_RUNTIME_PROFILE = Object.freeze({
  kind: 'historical-0aa-artifact',
  rolldownCommit: '0aa600b5721b852cdc4095c7122a929a8cb4a798',
  bindingSha256: 'deec0b2cb7a12e507ff223e12535c3280ab5fe8371f2fcc92f9db206163f1c5d',
  distSha256: 'e30311e764bae7fba9afe27665db741d556a7c3728eb67cfbe7ce0fed3135ebc',
});

export const LIFECYCLE_FIXED_RUNTIME_PROFILE = Object.freeze({
  kind: 'lifecycle-fixed-baseline',
  rolldownCommit: 'b144106882fe244b19b738fc0acf3ffa07c7c9f3',
  bindingSha256: '7b8863bb28aefd2e2eb7409f8be6dae57a252fe4a2688383007be7ea2f847bf7',
  distSha256: '1efffd0b63483e77cd2854fe716941000ae9548768691d7b5a64dceb011f3c45',
  baseCommit: HISTORICAL_RUNTIME_PROFILE.rolldownCommit,
  changeScope: 'remove-early-parent-worker-unref-only',
});

export const ATTRIBUTION_RUNTIME_PROFILE = Object.freeze({
  kind: 'instrumented-attribution',
  rolldownCommit: '41833e1294e5f80efdf90067fe3766b31b58435d',
  bindingSha256: '2db2fd322eb0e0e57f5ff0a618e52ddac7acf64754cfcd90aa36345917cea711',
  distSha256: '7931dffb49a5e7e0fb7470a7850242d8f50726ced7f4e56792f68012405083c6',
});

export function normalizeRuntimeProfile(value) {
  if (
    value?.kind !== 'historical-0aa-artifact' &&
    value?.kind !== 'lifecycle-fixed-baseline' &&
    value?.kind !== 'instrumented-attribution'
  ) {
    throw new Error(`Unknown runtime profile: ${value?.kind}`);
  }
  for (const [field, pattern] of [
    ['rolldownCommit', /^[a-f0-9]{40}$/],
    ['bindingSha256', /^[a-f0-9]{64}$/],
    ['distSha256', /^[a-f0-9]{64}$/],
  ]) {
    if (!pattern.test(value[field] ?? '')) {
      throw new Error(`runtimeProfile.${field} is not pinned`);
    }
  }
  const normalized = {
    kind: value.kind,
    rolldownCommit: value.rolldownCommit,
    bindingSha256: value.bindingSha256,
    distSha256: value.distSha256,
  };
  if (
    value.kind === 'historical-0aa-artifact' &&
    JSON.stringify(normalized) !== JSON.stringify(HISTORICAL_RUNTIME_PROFILE)
  ) {
    throw new Error('historical-0aa-artifact must use the frozen deec/e303 artifact');
  }
  if (value.kind === 'lifecycle-fixed-baseline') {
    if (
      value.baseCommit !== HISTORICAL_RUNTIME_PROFILE.rolldownCommit ||
      value.changeScope !== 'remove-early-parent-worker-unref-only'
    ) {
      throw new Error(
        'lifecycle-fixed-baseline must declare the 0aa base and sole parent Worker.unref lifecycle fix',
      );
    }
    if (
      value.rolldownCommit === HISTORICAL_RUNTIME_PROFILE.rolldownCommit ||
      value.bindingSha256 === HISTORICAL_RUNTIME_PROFILE.bindingSha256 ||
      value.distSha256 === HISTORICAL_RUNTIME_PROFILE.distSha256
    ) {
      throw new Error(
        'lifecycle-fixed-baseline must pin its amended commit, binding, and dist artifacts',
      );
    }
    normalized.baseCommit = value.baseCommit;
    normalized.changeScope = value.changeScope;
    if (JSON.stringify(normalized) !== JSON.stringify(LIFECYCLE_FIXED_RUNTIME_PROFILE)) {
      throw new Error(
        'lifecycle-fixed-baseline must use the frozen b144106/7b8863/1efffd artifact',
      );
    }
  }
  if (
    value.kind === 'instrumented-attribution' &&
    (value.rolldownCommit === HISTORICAL_RUNTIME_PROFILE.rolldownCommit ||
      value.bindingSha256 === HISTORICAL_RUNTIME_PROFILE.bindingSha256 ||
      value.distSha256 === HISTORICAL_RUNTIME_PROFILE.distSha256)
  ) {
    throw new Error(
      'instrumented-attribution must pin its distinct commit, rebuilt binding, and dist artifacts',
    );
  }
  if (
    value.kind === 'instrumented-attribution' &&
    JSON.stringify(normalized) !== JSON.stringify(ATTRIBUTION_RUNTIME_PROFILE)
  ) {
    throw new Error(
      'instrumented-attribution must use the frozen 41833e1/2db2fd/7931df artifact',
    );
  }
  const allowedFields = [
    'kind',
    'rolldownCommit',
    'bindingSha256',
    'distSha256',
    ...(value.kind === 'lifecycle-fixed-baseline' ? ['baseCommit', 'changeScope'] : []),
  ];
  const unknown = Object.keys(value).filter((key) => !allowedFields.includes(key));
  if (unknown.length > 0) {
    throw new Error(`Unknown runtime-profile fields: ${unknown.join(', ')}`);
  }
  return normalized;
}

export function validateRuntimeLane({
  runtimeProfile,
  instrumentation,
  rustInstrumentation,
  evidenceKind,
  lifecycleClaim = false,
}) {
  const profile = normalizeRuntimeProfile(runtimeProfile);
  if (profile.kind === 'historical-0aa-artifact') {
    if (evidenceKind !== 'historical-replay') {
      throw new Error('historical 0aa/deec/e303 execution requires evidenceKind=historical-replay');
    }
    if (lifecycleClaim) {
      throw new Error(
        'historical 0aa/deec/e303 success cannot be used as lifecycle evidence because external activity may keep the parent alive',
      );
    }
  }
  if (profile.kind !== 'instrumented-attribution' && rustInstrumentation) {
    throw new Error(`${profile.kind} cannot be used for the new Rust attribution lane`);
  }
  if (profile.kind === 'instrumented-attribution') {
    if (!instrumentation || !rustInstrumentation) {
      throw new Error(
        'instrumented-attribution requires JavaScript and Rust instrumentation to be enabled',
      );
    }
    if (evidenceKind !== 'attribution') {
      throw new Error(
        `instrumented-attribution requires evidenceKind=attribution, got ${evidenceKind}`,
      );
    }
  }
  return profile;
}
