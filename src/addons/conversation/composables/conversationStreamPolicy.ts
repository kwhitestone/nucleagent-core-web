import type { ConversationItem } from "@/addons/conversation/task-conversation/core";
import type { Message } from "@/addons/conversation/api/types";

interface StreamVersion {
  revision: number;
  seq: number;
}

export interface ConversationStreamVersionTracker {
  seed(items: readonly ConversationItem[]): void;
  next(itemId: string): StreamVersion;
  current(itemId: string): StreamVersion | undefined;
}

/**
 * Adapter-local per-stream version state. Snapshot items seed their actual
 * version; the first SSE replay of the same message therefore advances 1→2.
 */
export function createConversationStreamVersionTracker(): ConversationStreamVersionTracker {
  let versions: ReadonlyMap<string, StreamVersion> = new Map();
  return {
    seed(items) {
      versions = new Map(
        items.map((item) => [
          item.id,
          { revision: item.revision, seq: item.seq },
        ]),
      );
    },
    next(itemId) {
      const previous = versions.get(itemId);
      const next = {
        revision: (previous?.revision ?? 0) + 1,
        seq: (previous?.seq ?? 0) + 1,
      };
      versions = new Map(versions).set(itemId, next);
      return next;
    },
    current(itemId) {
      return versions.get(itemId);
    },
  };
}

export function snapshotMessageCursor(messages: readonly Message[]): string | undefined {
  const maximum = messages.reduce(
    (current, message) => Math.max(current, Number(message.id) || 0),
    0,
  );
  return maximum > 0 ? String(maximum) : undefined;
}

export function normalizeSSECursor(cursor?: string): string | undefined {
  if (!cursor || !/^\d{1,20}$/.test(cursor) || cursor === "0") return undefined;
  return cursor;
}

/** Message updates may replay an older row; never let that move the cursor back. */
export function advanceMessageCursor(current: string | undefined, messageId: number): string {
  const previous = Number(normalizeSSECursor(current) ?? 0);
  return String(Math.max(previous, messageId));
}
