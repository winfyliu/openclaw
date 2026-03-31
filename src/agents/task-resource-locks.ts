import { resolveGlobalSingleton } from "../shared/global-singleton.js";

export type TaskResourceLockDomain = "task_resume_forward" | "task_registry_write" | "background_task_submit";

type LockWaiter = {
  resolve: (release: () => void) => void;
  timeout?: NodeJS.Timeout;
};

type ResourceLockState = {
  locked: boolean;
  waiters: LockWaiter[];
};

type TaskResourceLockState = {
  domains: Map<TaskResourceLockDomain, Map<string, ResourceLockState>>;
};

const TASK_RESOURCE_LOCKS_KEY = Symbol.for("openclaw.taskResourceLocks");
const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 15_000;

const state = resolveGlobalSingleton<TaskResourceLockState>(TASK_RESOURCE_LOCKS_KEY, () => ({
  domains: new Map(),
}));

function resolveDomainMap(domain: TaskResourceLockDomain): Map<string, ResourceLockState> {
  const existing = state.domains.get(domain);
  if (existing) {
    return existing;
  }
  const created = new Map<string, ResourceLockState>();
  state.domains.set(domain, created);
  return created;
}

function resolveResourceLock(
  domain: TaskResourceLockDomain,
  resourceKey: string,
): ResourceLockState {
  const domainMap = resolveDomainMap(domain);
  const existing = domainMap.get(resourceKey);
  if (existing) {
    return existing;
  }
  const created: ResourceLockState = {
    locked: false,
    waiters: [],
  };
  domainMap.set(resourceKey, created);
  return created;
}

function cleanupResourceLock(domain: TaskResourceLockDomain, resourceKey: string): void {
  const domainMap = state.domains.get(domain);
  const lock = domainMap?.get(resourceKey);
  if (!domainMap || !lock || lock.locked || lock.waiters.length > 0) {
    return;
  }
  domainMap.delete(resourceKey);
  if (domainMap.size === 0) {
    state.domains.delete(domain);
  }
}

function createReleaseFn(params: {
  domain: TaskResourceLockDomain;
  resourceKey: string;
}): () => void {
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const lock = resolveResourceLock(params.domain, params.resourceKey);
    const next = lock.waiters.shift();
    if (next) {
      if (next.timeout) {
        clearTimeout(next.timeout);
      }
      next.resolve(createReleaseFn(params));
      return;
    }
    lock.locked = false;
    cleanupResourceLock(params.domain, params.resourceKey);
  };
}

export async function acquireTaskResourceLock(params: {
  domain: TaskResourceLockDomain;
  resourceKey: string;
  timeoutMs?: number;
}): Promise<() => void> {
  const resourceKey = params.resourceKey.trim();
  if (!resourceKey) {
    throw new Error("task resource lock requires non-empty resourceKey");
  }
  const lock = resolveResourceLock(params.domain, resourceKey);
  if (!lock.locked) {
    lock.locked = true;
    return createReleaseFn({ domain: params.domain, resourceKey });
  }

  const timeoutMs =
    typeof params.timeoutMs === "number" &&
    Number.isFinite(params.timeoutMs) &&
    params.timeoutMs > 0
      ? Math.floor(params.timeoutMs)
      : DEFAULT_LOCK_WAIT_TIMEOUT_MS;

  return await new Promise<() => void>((resolve, reject) => {
    const waiter: LockWaiter = { resolve };
    waiter.timeout = setTimeout(() => {
      const index = lock.waiters.indexOf(waiter);
      if (index >= 0) {
        lock.waiters.splice(index, 1);
      }
      cleanupResourceLock(params.domain, resourceKey);
      reject(
        new Error(
          `task resource lock wait timed out: domain=${params.domain} key=${resourceKey} timeoutMs=${timeoutMs}`,
        ),
      );
    }, timeoutMs);
    lock.waiters.push(waiter);
  });
}

export async function withTaskResourceLock<T>(
  params: {
    domain: TaskResourceLockDomain;
    resourceKey: string;
    timeoutMs?: number;
  },
  run: () => Promise<T>,
): Promise<T> {
  const release = await acquireTaskResourceLock(params);
  try {
    return await run();
  } finally {
    release();
  }
}

export const __testing = {
  resetTaskResourceLocks(): void {
    state.domains.clear();
  },
};
