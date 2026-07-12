export const POOL_ENVIRONMENT_KEYS = Object.freeze([
  'ROLLDOWN_WORKER_THREADS',
  'RAYON_NUM_THREADS',
  'ROLLDOWN_MAX_BLOCKING_THREADS',
]);

export const BASELINE_POOL_ENVIRONMENT = Object.freeze({
  ROLLDOWN_WORKER_THREADS: '18',
  RAYON_NUM_THREADS: '12',
  ROLLDOWN_MAX_BLOCKING_THREADS: '4',
});

export function normalizePoolEnvironment(value = BASELINE_POOL_ENVIRONMENT) {
  const normalized = {};
  for (const key of POOL_ENVIRONMENT_KEYS) {
    const raw = value?.[key];
    if (!/^\d+$/.test(String(raw ?? '')) || Number(raw) < 1) {
      throw new Error(`${key} must be an explicit positive integer string`);
    }
    normalized[key] = String(raw);
  }
  const unknown = Object.keys(value ?? {}).filter(
    (key) => !POOL_ENVIRONMENT_KEYS.includes(key),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown pool environment keys: ${unknown.join(', ')}`);
  }
  return normalized;
}

export function applyPoolEnvironment(environment, value) {
  const normalized = normalizePoolEnvironment(value);
  for (const [key, setting] of Object.entries(normalized)) {
    environment[key] = setting;
  }
  return normalized;
}

export function readPoolEnvironment(environment = process.env) {
  return Object.fromEntries(
    POOL_ENVIRONMENT_KEYS.map((key) => [key, environment[key] ?? null]),
  );
}

export function assertPoolEnvironment(expected, environment = process.env) {
  const normalized = normalizePoolEnvironment(expected);
  const actual = readPoolEnvironment(environment);
  if (JSON.stringify(actual) !== JSON.stringify(normalized)) {
    throw new Error(
      `Pool environment mismatch: expected ${JSON.stringify(normalized)}, got ${JSON.stringify(actual)}`,
    );
  }
  return actual;
}
