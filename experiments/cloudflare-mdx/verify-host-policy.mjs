import {
  evaluateChildHostPolicy,
  evaluateStartAdmission,
  FROZEN_PERFORMANCE_HOST_POLICY,
  validateFrozenPerformanceHostPolicy,
} from './local-host-policy.mjs';

validateFrozenPerformanceHostPolicy(FROZEN_PERFORMANCE_HOST_POLICY);

const admitted = {
  loadAverage: [1, 1, 1],
  uptimeSeconds: 60,
  totalProcessCpuPercent: 100,
  competingStudyProcesses: [],
  power: { available: true, source: 'AC Power', raw: '' },
  lowPowerMode: { available: true, enabled: false, raw: '' },
  thermal: {
    available: true,
    noThermalWarning: true,
    noPerformanceWarning: true,
    raw: '',
  },
  memoryPressure: { available: true, freePercentage: 75, raw: '' },
  swapUsage: { available: true, usedBytes: 0, raw: '' },
  virtualMemoryCounters: { pageouts: 100, swapouts: 200 },
};

const clean = evaluateStartAdmission(FROZEN_PERFORMANCE_HOST_POLICY, admitted);
if (clean.immediate.length !== 0 || clean.transient.length !== 0) {
  throw new Error(`Synthetic admitted host failed: ${JSON.stringify(clean)}`);
}

const immediate = evaluateStartAdmission(FROZEN_PERFORMANCE_HOST_POLICY, {
  ...admitted,
  uptimeSeconds: 86_401,
  swapUsage: { available: true, usedBytes: 512 * 1024 * 1024 + 1, raw: '' },
  competingStudyProcesses: [
    { pid: 42, ppid: 1, cpuPercent: 10, kind: 'javascript-tool' },
  ],
});
if (
  !immediate.immediate.some((message) => message.startsWith('host uptime')) ||
  !immediate.immediate.some((message) => message.startsWith('starting swap')) ||
  !immediate.immediate.some((message) => message.startsWith('competing study'))
) {
  throw new Error(`Immediate host gates were not enforced: ${JSON.stringify(immediate)}`);
}

const transient = evaluateStartAdmission(FROZEN_PERFORMANCE_HOST_POLICY, {
  ...admitted,
  loadAverage: [2.01, 1, 1],
  totalProcessCpuPercent: 151,
  memoryPressure: { available: true, freePercentage: 49, raw: '' },
});
if (transient.transient.length !== 3 || transient.immediate.length !== 0) {
  throw new Error(`Transient host gates were not enforced: ${JSON.stringify(transient)}`);
}

const cleanChild = evaluateChildHostPolicy(
  FROZEN_PERFORMANCE_HOST_POLICY,
  admitted,
  {
    ...admitted,
    virtualMemoryCounters: { pageouts: 100, swapouts: 200 },
  },
);
if (cleanChild.length !== 0) {
  throw new Error(`Zero-delta child failed: ${JSON.stringify(cleanChild)}`);
}
const pagingChild = evaluateChildHostPolicy(
  FROZEN_PERFORMANCE_HOST_POLICY,
  admitted,
  {
    ...admitted,
    virtualMemoryCounters: { pageouts: 101, swapouts: 201 },
  },
);
if (pagingChild.length !== 2) {
  throw new Error(`Pageout/swapout deltas were not rejected: ${JSON.stringify(pagingChild)}`);
}

let changedPolicyAccepted = false;
try {
  validateFrozenPerformanceHostPolicy({
    ...FROZEN_PERFORMANCE_HOST_POLICY,
    maxStartOneMinuteLoad: 3,
  });
  changedPolicyAccepted = true;
} catch {}
if (changedPolicyAccepted) {
  throw new Error('A changed frozen host policy was accepted');
}

console.log(
  JSON.stringify({
    valid: true,
    tested: [
      'clean-start-admission',
      'immediate-uptime-swap-and-competing-process-rejection',
      'transient-load-cpu-memory-rejection',
      'zero-pageout-and-swapout-child-gate',
      'frozen-policy-mutation-rejection',
    ],
  }),
);
