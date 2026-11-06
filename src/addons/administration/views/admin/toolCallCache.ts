/**
 * Short-lived, in-memory cache for the tool-call log pages (MUYU-181).
 * Key = owner (access token identity, never persisted) + session version + task/cursor/limit,
 * so nothing is shared across accounts or permission versions. Failed loads and pages that
 * still show running calls are never cached; identical in-flight loads share one request.
 */
export const TOOL_CALL_CACHE_TTL_MS = 15_000;

interface Entry<T> { at: number; value: Promise<T>; done: boolean }

export interface ToolCallCacheDeps {
  owner: () => string | null;
  version: () => number;
  now?: () => number;
}

export function createToolCallCache<T>(deps: ToolCallCacheDeps, keep: (value: T) => boolean) {
  const now = deps.now ?? Date.now;
  let owner: string | null = null;
  let entries = new Map<string, Entry<T>>();

  const clear = (): void => { entries = new Map(); };

  /** fresh=true (manual refresh, running-call polling) bypasses the cache and replaces the entry. */
  function get(parts: readonly unknown[], load: () => Promise<T>, fresh = false): Promise<T> {
    const current = deps.owner();
    if (!current) { clear(); owner = null; return load(); } // signed out: never cache
    if (current !== owner) { clear(); owner = current; }
    const key = JSON.stringify([deps.version(), ...parts]);
    const hit = entries.get(key);
    if (!fresh && hit && (!hit.done || now() - hit.at < TOOL_CALL_CACHE_TTL_MS)) return hit.value;
    const map = entries;
    const entry: Entry<T> = { at: now(), done: false, value: load() };
    map.set(key, entry);
    entry.value.then(
      (value) => { entry.done = true; entry.at = now(); if (!keep(value) && map.get(key) === entry) map.delete(key); },
      () => { if (map.get(key) === entry) map.delete(key); },
    );
    return entry.value;
  }

  return { get, clear, size: () => entries.size };
}
