const FEISHU_REGISTER_LOG_ONCE = Symbol.for("openclaw.feishu.registerLogOnce");

function getSeenSet(): Set<string> {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  const existing = globalStore[FEISHU_REGISTER_LOG_ONCE];
  if (existing instanceof Set) {
    return existing as Set<string>;
  }
  const created = new Set<string>();
  globalStore[FEISHU_REGISTER_LOG_ONCE] = created;
  return created;
}

export function logRegisterOnce(log: ((message: string) => void) | undefined, key: string, message: string): void {
  if (!log) {
    return;
  }
  const seen = getSeenSet();
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  log(message);
}

export function __resetRegisterLogOnceForTests(): void {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  globalStore[FEISHU_REGISTER_LOG_ONCE] = new Set<string>();
}
