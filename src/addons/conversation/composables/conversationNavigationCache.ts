import type { Conversation } from "../api/types";
import type { ConversationSnapshot } from "../task-conversation/core/types";
import { MAX_SNAPSHOT_ITEMS } from "../task-conversation/core/types.ts";

interface SessionScope {
  token: string | null;
  version: number;
}

interface CacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  ttlMs?: number;
  now?: () => number;
}

/** Memory-only display snapshots. Every restoration is reconciled by REST
 * before SSE starts; settings/status requests share only in-flight work. */
export function createConversationNavigationCache(
  getSession: () => SessionScope,
  options: CacheOptions = {},
) {
  const maxEntries = options.maxEntries ?? 8;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const now = options.now ?? Date.now;
  const snapshots = new Map<string, { json: string; bytes: number; expires: number }>();
  const requests = new Map<string, Promise<Conversation>>();
  let session: SessionScope | undefined;
  let generation = 0;
  let bytes = 0;

  function clear(): void {
    generation += 1;
    snapshots.clear();
    requests.clear();
    bytes = 0;
  }

  function scope(): number {
    const current = getSession();
    if (session?.token !== current.token || session?.version !== current.version) {
      clear();
      session = { ...current };
    }
    return generation;
  }

  function remove(id: string): void {
    bytes -= snapshots.get(id)?.bytes ?? 0;
    snapshots.delete(id);
  }

  function forConversation(id: string) {
    const owner = scope();
    const isCurrent = () => owner === scope();
    return {
      isCurrent,
      forget(): void {
        if (isCurrent()) remove(id);
      },
      read(): ConversationSnapshot | undefined {
        if (!isCurrent() || !session?.token) return;
        const entry = snapshots.get(id);
        if (!entry) return;
        if (entry.expires <= now()) { remove(id); return; }
        snapshots.delete(id);
        snapshots.set(id, entry);
        return JSON.parse(entry.json) as ConversationSnapshot;
      },
      write(snapshot: ConversationSnapshot): void {
        if (!isCurrent() || !session?.token) return;
        remove(id);
        // Live streams/pagination can outgrow a single protocol snapshot.
        // Skip the preview rather than truncating history or storing an
        // invalid snapshot that would prevent authoritative restoration.
        if (snapshot.items.length > MAX_SNAPSHOT_ITEMS) return;
        const json = JSON.stringify(snapshot);
        const size = new TextEncoder().encode(json).byteLength;
        if (size > maxBytes || maxEntries < 1) return;
        snapshots.set(id, { json, bytes: size, expires: now() + ttlMs });
        bytes += size;
        while (snapshots.size > maxEntries || bytes > maxBytes) {
          remove(snapshots.keys().next().value!);
        }
      },
    };
  }

  function loadConversation(id: string, load: () => Promise<Conversation>): Promise<Conversation> {
    const owner = scope();
    const pending = requests.get(id);
    if (pending) return pending;
    const assertCurrent = () => {
      if (owner !== scope()) throw new DOMException("Conversation session changed", "AbortError");
    };
    const request = load().then(
      (conversation) => { assertCurrent(); return conversation; },
      (error: unknown) => { assertCurrent(); throw error; },
    ).finally(() => {
      if (requests.get(id) === request) requests.delete(id);
    });
    requests.set(id, request);
    return request;
  }

  return { forConversation, loadConversation, clear };
}
