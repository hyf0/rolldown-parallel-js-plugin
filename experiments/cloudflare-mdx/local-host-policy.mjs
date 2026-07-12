import { spawnSync } from 'node:child_process';
import { freemem, loadavg, platform, uptime } from 'node:os';

export const FROZEN_PERFORMANCE_HOST_POLICY = Object.freeze({
  requiredPowerSource: 'AC Power',
  requireLowPowerModeOff: true,
  requireNoThermalOrPerformanceWarning: true,
  requireNoCompetingStudyProcesses: true,
  maxUptimeSeconds: 86_400,
  maxStartOneMinuteLoad: 2,
  maxStartTotalProcessCpuPercent: 150,
  maxStartSwapUsedBytes: 512 * 1024 * 1024,
  minStartMemoryFreePercent: 50,
  waitIntervalMs: 10_000,
  maxWaitMs: 300_000,
  maxSwapoutDeltaPages: 0,
  maxPageoutDeltaPages: 0,
});

export function captureHostSnapshot() {
  return {
    at: new Date().toISOString(),
    loadAverage: loadavg(),
    freeMemoryBytes: freemem(),
    uptimeSeconds: uptime(),
    power: powerStatus(),
    lowPowerMode: lowPowerModeStatus(),
    thermal: thermalStatus(),
    memoryPressure: memoryPressureStatus(),
    swapUsage: swapUsage(),
    virtualMemoryCounters: virtualMemoryCounters(),
    totalProcessCpuPercent: totalProcessCpuPercent(),
    competingStudyProcesses: competingStudyProcesses(),
  };
}

export function validateFrozenPerformanceHostPolicy(policy) {
  for (const [key, expected] of Object.entries(FROZEN_PERFORMANCE_HOST_POLICY)) {
    if (policy?.[key] !== expected) {
      throw new Error(`hostPolicy.${key} must be ${expected}, got ${policy?.[key]}`);
    }
  }
  const unknown = Object.keys(policy ?? {}).filter(
    (key) => !Object.hasOwn(FROZEN_PERFORMANCE_HOST_POLICY, key) && key !== 'cooldownMs',
  );
  if (unknown.length > 0) throw new Error(`Unknown host-policy fields: ${unknown.join(', ')}`);
}

export function evaluateStartAdmission(policy, snapshot) {
  const immediate = [];
  const transient = [];
  if (platform() !== 'darwin') {
    immediate.push('formal local host admission currently requires macOS');
    return { immediate, transient };
  }
  if (!snapshot.power.available) {
    immediate.push(`power status unavailable: ${snapshot.power.error}`);
  } else if (snapshot.power.source !== policy.requiredPowerSource) {
    immediate.push(
      `power source ${snapshot.power.source} did not equal ${policy.requiredPowerSource}`,
    );
  }
  if (!snapshot.lowPowerMode.available) {
    immediate.push(`low-power status unavailable: ${snapshot.lowPowerMode.error}`);
  } else if (policy.requireLowPowerModeOff && snapshot.lowPowerMode.enabled) {
    immediate.push('low-power mode is enabled');
  }
  if (!snapshot.thermal.available) {
    immediate.push(`thermal status unavailable: ${snapshot.thermal.error}`);
  } else if (
    policy.requireNoThermalOrPerformanceWarning &&
    (!snapshot.thermal.noThermalWarning || !snapshot.thermal.noPerformanceWarning)
  ) {
    immediate.push(`thermal/performance warning recorded: ${snapshot.thermal.raw}`);
  }
  if (!Number.isFinite(snapshot.uptimeSeconds)) {
    immediate.push('host uptime is unavailable');
  } else if (snapshot.uptimeSeconds > policy.maxUptimeSeconds) {
    immediate.push(
      `host uptime ${snapshot.uptimeSeconds}s exceeded ${policy.maxUptimeSeconds}s`,
    );
  }
  if (
    policy.requireNoCompetingStudyProcesses &&
    snapshot.competingStudyProcesses.length > 0
  ) {
    immediate.push(
      `competing study processes are active: ${JSON.stringify(snapshot.competingStudyProcesses)}`,
    );
  }
  if (!snapshot.swapUsage.available || !Number.isFinite(snapshot.swapUsage.usedBytes)) {
    immediate.push(`swap usage unavailable: ${snapshot.swapUsage.error}`);
  } else if (snapshot.swapUsage.usedBytes > policy.maxStartSwapUsedBytes) {
    immediate.push(
      `starting swap ${snapshot.swapUsage.usedBytes} bytes exceeded ${policy.maxStartSwapUsedBytes}`,
    );
  }

  if (!Number.isFinite(snapshot.loadAverage?.[0])) {
    transient.push('one-minute load average is unavailable');
  } else if (snapshot.loadAverage[0] > policy.maxStartOneMinuteLoad) {
    transient.push(
      `one-minute load ${snapshot.loadAverage[0]} exceeded ${policy.maxStartOneMinuteLoad}`,
    );
  }
  if (!Number.isFinite(snapshot.totalProcessCpuPercent)) {
    transient.push('summed process CPU is unavailable');
  } else if (
    snapshot.totalProcessCpuPercent > policy.maxStartTotalProcessCpuPercent
  ) {
    transient.push(
      `summed process CPU ${snapshot.totalProcessCpuPercent}% exceeded ${policy.maxStartTotalProcessCpuPercent}%`,
    );
  }
  if (
    !snapshot.memoryPressure.available ||
    !Number.isFinite(snapshot.memoryPressure.freePercentage)
  ) {
    transient.push(`memory pressure is unavailable: ${snapshot.memoryPressure.error}`);
  } else if (
    snapshot.memoryPressure.freePercentage < policy.minStartMemoryFreePercent
  ) {
    transient.push(
      `memory free percentage ${snapshot.memoryPressure.freePercentage}% was below ${policy.minStartMemoryFreePercent}%`,
    );
  }
  return { immediate, transient };
}

export function waitForHostAdmission(policy) {
  validateFrozenPerformanceHostPolicy(policy);
  const attempts = [];
  const startedAt = Date.now();
  while (true) {
    const snapshot = captureHostSnapshot();
    const violations = evaluateStartAdmission(policy, snapshot);
    attempts.push({ snapshot, ...violations });
    if (violations.immediate.length > 0) {
      throw admissionError('immediate host-admission failure', attempts);
    }
    if (violations.transient.length === 0) return { snapshot, attempts };
    if (Date.now() - startedAt >= policy.maxWaitMs) {
      throw admissionError('host-admission wait expired', attempts);
    }
    Atomics.wait(
      new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
      0,
      0,
      policy.waitIntervalMs,
    );
  }
}

export function hostDelta(before, after) {
  const counters = {};
  for (const field of [
    'pageins',
    'pageouts',
    'swapins',
    'swapouts',
    'compressions',
    'decompressions',
  ]) {
    const start = before.virtualMemoryCounters?.[field];
    const finish = after.virtualMemoryCounters?.[field];
    counters[field] =
      Number.isFinite(start) && Number.isFinite(finish)
        ? finish - start
        : undefined;
  }
  return {
    virtualMemoryCounters: counters,
    swapUsedBytes:
      Number.isFinite(before.swapUsage?.usedBytes) &&
      Number.isFinite(after.swapUsage?.usedBytes)
        ? after.swapUsage.usedBytes - before.swapUsage.usedBytes
        : undefined,
  };
}

export function evaluateChildHostPolicy(policy, before, after) {
  const violations = [];
  const delta = hostDelta(before, after);
  for (const [field, maximum] of [
    ['swapouts', policy.maxSwapoutDeltaPages],
    ['pageouts', policy.maxPageoutDeltaPages],
  ]) {
    const actual = delta.virtualMemoryCounters[field];
    if (!Number.isFinite(actual)) {
      violations.push(`${field} delta is unavailable`);
    } else if (actual > maximum) {
      violations.push(`${field} increased by ${actual} pages`);
    }
  }
  return violations;
}

function powerStatus() {
  if (platform() !== 'darwin') return unavailable('not macOS');
  const result = command('pmset', ['-g', 'batt']);
  if (!result.available) return result;
  const source = result.raw.match(/Now drawing from '([^']+)'/)?.[1];
  return source
    ? { available: true, source, raw: result.raw }
    : unavailable(`could not parse: ${result.raw}`);
}

function lowPowerModeStatus() {
  if (platform() !== 'darwin') return unavailable('not macOS');
  const result = command('pmset', ['-g']);
  if (!result.available) return result;
  const setting = result.raw.match(/^\s*lowpowermode\s+(\d+)\s*$/m)?.[1];
  return setting === undefined
    ? unavailable(`could not parse: ${result.raw}`)
    : { available: true, enabled: setting !== '0', value: Number(setting), raw: result.raw };
}

function thermalStatus() {
  if (platform() !== 'darwin') return unavailable('not macOS');
  const result = command('pmset', ['-g', 'therm']);
  if (!result.available) return result;
  return {
    available: true,
    noThermalWarning: result.raw.includes('No thermal warning level has been recorded'),
    noPerformanceWarning: result.raw.includes('No performance warning level has been recorded'),
    raw: result.raw,
  };
}

function memoryPressureStatus() {
  if (platform() !== 'darwin') return unavailable('not macOS');
  const result = command('memory_pressure', ['-Q']);
  if (!result.available) return result;
  const freePercentage = Number(
    result.raw.match(/System-wide memory free percentage:\s*(\d+)%/)?.[1],
  );
  return Number.isFinite(freePercentage)
    ? { available: true, freePercentage, raw: result.raw }
    : unavailable(`could not parse: ${result.raw}`);
}

function swapUsage() {
  if (platform() !== 'darwin') return unavailable('not macOS');
  const result = command('sysctl', ['-n', 'vm.swapusage']);
  if (!result.available) return result;
  const fields = Object.fromEntries(
    [...result.raw.matchAll(/(total|used|free) = ([0-9.]+)([KMGTP])/g)].map(
      ([, name, amount, unit]) => [name, toBytes(Number(amount), unit)],
    ),
  );
  return Number.isFinite(fields.used)
    ? {
        available: true,
        raw: result.raw,
        totalBytes: fields.total,
        usedBytes: fields.used,
        freeBytes: fields.free,
      }
    : unavailable(`could not parse: ${result.raw}`);
}

function virtualMemoryCounters() {
  if (platform() !== 'darwin') return undefined;
  const result = command('vm_stat', []);
  if (!result.available) return undefined;
  const counters = {};
  for (const line of result.raw.split('\n')) {
    const match = line.match(/^"?([^":]+)"?:\s+(\d+)\.$/);
    if (match) counters[match[1]] = Number(match[2]);
  }
  return {
    pageins: counters.Pageins,
    pageouts: counters.Pageouts,
    swapins: counters.Swapins,
    swapouts: counters.Swapouts,
    compressions: counters.Compressions,
    decompressions: counters.Decompressions,
  };
}

function totalProcessCpuPercent() {
  const result = command('/bin/ps', ['-A', '-o', '%cpu=']);
  if (!result.available) return undefined;
  return result.raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reduce((sum, value) => sum + Number(value), 0);
}

function competingStudyProcesses() {
  const result = command('/bin/ps', ['-A', '-o', 'pid=,ppid=,%cpu=,command=']);
  if (!result.available) return [{ kind: 'process-list-unavailable' }];
  const processes = result.raw
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+([0-9.]+)\s+(.*)$/);
      return match
        ? {
            pid: Number(match[1]),
            ppid: Number(match[2]),
            cpuPercent: Number(match[3]),
            command: match[4],
          }
        : undefined;
    })
    .filter(Boolean);
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const excluded = new Set([process.pid]);
  let ancestor = byPid.get(process.pid)?.ppid ?? process.ppid;
  while (ancestor && !excluded.has(ancestor)) {
    excluded.add(ancestor);
    ancestor = byPid.get(ancestor)?.ppid;
  }
  return processes.flatMap((entry) => {
    if (excluded.has(entry.pid)) return [];
    const kind = classifyStudyProcess(entry.command);
    return kind
      ? [{ pid: entry.pid, ppid: entry.ppid, cpuPercent: entry.cpuPercent, kind }]
      : [];
  });
}

function classifyStudyProcess(commandLine) {
  if (
    !commandLine.includes('rolldown-parallel-js-plugin') &&
    !commandLine.includes('cloudflare-docs-rolldown-build') &&
    !commandLine.includes('rolldown-parallel-js-plugin-core-transform')
  ) {
    return undefined;
  }
  if (/rust-analyzer|typescript-language-server/.test(commandLine)) return 'indexer';
  if (/\bcargo\b/.test(commandLine)) return 'cargo';
  if (/\b(?:node|pnpm|npm|yarn|vp)\b/.test(commandLine)) return 'javascript-tool';
  if (/\b(?:rolldown|astro|vite|vitest|jest)\b/.test(commandLine)) return 'build-or-test';
  return undefined;
}

function command(commandName, args) {
  const result = spawnSync(commandName, args, { encoding: 'utf8' });
  return result.status === 0
    ? { available: true, raw: result.stdout.trim() }
    : unavailable(result.stderr.trim() || `${commandName} exited ${result.status}`);
}

function unavailable(error) {
  return { available: false, error };
}

function toBytes(amount, unit) {
  const power = ['K', 'M', 'G', 'T', 'P'].indexOf(unit) + 1;
  return amount * 1024 ** power;
}

function admissionError(message, attempts) {
  const last = attempts.at(-1);
  const error = new Error(
    `${message}: ${[...last.immediate, ...last.transient].join('; ')}`,
  );
  error.hostAdmissionAttempts = attempts;
  return error;
}
