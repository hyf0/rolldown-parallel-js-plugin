import { Worker } from 'node:worker_threads';

const MAX_WORKERS = 12;

export async function createManagedWorkerCloudflareMdxPlugin(options) {
  const { managedWorkerCount = 1, ...kernelOptions } = options;
  if (
    !Number.isSafeInteger(managedWorkerCount) ||
    managedWorkerCount < 1 ||
    managedWorkerCount > MAX_WORKERS
  ) {
    throw new Error('managedWorkerCount must be an integer from 1 to ' + MAX_WORKERS);
  }

  const pool = await ManagedWorkerPool.create(managedWorkerCount, kernelOptions);
  let finalization;
  const finalize = () => {
    finalization ??= (async () => {
      try {
        await pool.buildEnd();
      } finally {
        await pool.close();
      }
    })();
    return finalization;
  };

  return {
    name: 'cloudflare-mdx',
    transform: {
      filter: { id: { include: [/\.mdx$/] } },
      handler(code, id) {
        return pool.transform(code, id);
      },
    },
    buildEnd() {
      return finalize();
    },
    closeBundle() {
      return pool.close();
    },
  };
}

class ManagedWorkerPool {
  static async create(workerCount, kernelOptions) {
    const pool = new ManagedWorkerPool();
    try {
      pool.records = Array.from({ length: workerCount }, (_, threadNumber) =>
        pool.createWorker(threadNumber, kernelOptions),
      );
      await Promise.all(pool.records.map((record) => record.ready));
      pool.idle.push(...pool.records);
      return pool;
    } catch (error) {
      await pool.close();
      throw error;
    }
  }

  records = [];
  idle = [];
  queue = [];
  drainWaiters = [];
  nextRequestId = 1;
  closed = false;
  failure;
  closePromise;

  createWorker(threadNumber, kernelOptions) {
    const worker = new Worker(new URL('./managed-worker-thread.mjs', import.meta.url), {
      workerData: { ...kernelOptions, threadNumber },
    });
    const record = {
      worker,
      threadNumber,
      pending: new Map(),
      busy: false,
      closing: false,
      readyResolve: undefined,
      readyReject: undefined,
      ready: undefined,
    };
    record.ready = new Promise((resolve, reject) => {
      record.readyResolve = resolve;
      record.readyReject = reject;
    });
    worker.on('message', (message) => this.onMessage(record, message));
    worker.on('error', (error) => this.fail(error));
    worker.on('exit', (code) => {
      if (!record.closing && !this.closed) {
        this.fail(new Error('Managed Cloudflare MDX worker ' + threadNumber + ' exited ' + code));
      }
    });
    return record;
  }

  onMessage(record, message) {
    if (message.type === 'ready') {
      record.readyResolve();
      return;
    }
    if (message.type === 'initializationError') {
      record.readyReject(deserializeError(message.error));
      return;
    }

    const pending = record.pending.get(message.requestId);
    if (!pending) {
      this.fail(
        new Error(
          'Managed Cloudflare MDX worker returned unknown request ' + message.requestId,
        ),
      );
      return;
    }
    record.pending.delete(message.requestId);
    if (pending.transform) {
      record.busy = false;
      if (!this.closed && !this.failure) this.idle.push(record);
    }
    if (message.type === 'result') pending.resolve(message.result);
    else if (message.type === 'error') pending.reject(deserializeError(message.error));
    else pending.reject(new Error('Unknown managed worker response: ' + message.type));
    this.dispatch();
    this.resolveDrainWaiters();
  }

  transform(code, id) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error('Managed Cloudflare MDX pool is closed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ code, id, resolve, reject });
      this.dispatch();
    });
  }

  dispatch() {
    while (!this.closed && !this.failure && this.idle.length > 0 && this.queue.length > 0) {
      const record = this.idle.shift();
      const job = this.queue.shift();
      const requestId = this.nextRequestId++;
      record.busy = true;
      record.pending.set(requestId, {
        transform: true,
        resolve: job.resolve,
        reject: job.reject,
      });
      record.worker.postMessage({
        type: 'transform',
        requestId,
        code: job.code,
        id: job.id,
      });
    }
  }

  async buildEnd() {
    if (this.failure) throw this.failure;
    if (this.closed) return;
    await this.drain();
    const results = await Promise.allSettled(
      this.records.map((record) => this.call(record, 'buildEnd')),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  call(record, type) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error('Managed Cloudflare MDX pool is closed'));
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      record.pending.set(requestId, { transform: false, resolve, reject });
      record.worker.postMessage({ type, requestId });
    });
  }

  drain() {
    if (this.queue.length === 0 && this.records.every((record) => !record.busy)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => this.drainWaiters.push({ resolve, reject }));
  }

  resolveDrainWaiters() {
    if (this.queue.length !== 0 || this.records.some((record) => record.busy)) return;
    const waiters = this.drainWaiters.splice(0);
    for (const waiter of waiters) waiter.resolve();
  }

  fail(error) {
    if (this.failure || this.closed) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    for (const job of this.queue.splice(0)) job.reject(this.failure);
    for (const waiter of this.drainWaiters.splice(0)) waiter.reject(this.failure);
    for (const record of this.records) {
      record.readyReject?.(this.failure);
      for (const pending of record.pending.values()) pending.reject(this.failure);
      record.pending.clear();
    }
    void this.close();
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const closedError = this.failure ?? new Error('Managed Cloudflare MDX pool closed');
    for (const job of this.queue.splice(0)) job.reject(closedError);
    for (const waiter of this.drainWaiters.splice(0)) waiter.reject(closedError);
    for (const record of this.records) {
      record.closing = true;
      for (const pending of record.pending.values()) pending.reject(closedError);
      record.pending.clear();
    }
    this.idle.length = 0;
    this.closePromise = Promise.allSettled(
      this.records.map((record) => record.worker.terminate()),
    ).then(() => undefined);
    return this.closePromise;
  }
}

function deserializeError(serialized) {
  const error = new Error(serialized?.message ?? 'Managed Cloudflare MDX worker failed');
  error.name = serialized?.name ?? 'Error';
  if (serialized?.stack) error.stack = serialized.stack;
  for (const key of [
    'code',
    'id',
    'plugin',
    'hook',
    'pluginCode',
    'loc',
    'frame',
    'line',
    'column',
  ]) {
    if (serialized?.[key] !== undefined) error[key] = serialized[key];
  }
  return error;
}
