// MUYU-410: shell sidebar 「⋯ › 置顶/取消置顶」. The shell never calls Core; it asks us over the verified
// channel, we PATCH {pinned} via the store (Core checks ownership) and answer `pin-result`.
export interface PinIntent { requestId: number; conversationId: number; pinned: boolean }

export function parsePinIntent(payload: unknown): PinIntent | null {
  if (!payload || typeof payload !== "object") return null;
  const { source, type, requestId, conversationId, pinned } = payload as Record<string, unknown>;
  if (source !== "shell" || type !== "pin" || typeof pinned !== "boolean") return null;
  if (!Number.isSafeInteger(requestId) || (requestId as number) < 0) return null;
  if (!Number.isSafeInteger(conversationId) || (conversationId as number) <= 0) return null;
  return { requestId: requestId as number, conversationId: conversationId as number, pinned };
}

export async function runSidebarPin(
  intent: PinIntent,
  setPinned: (id: number, pinned: boolean) => Promise<{ pinned?: boolean }>,
  send: (payload: Record<string, unknown>) => void,
  onError: () => void,
): Promise<void> {
  const base = { source: "sub", type: "pin-result", requestId: intent.requestId, conversationId: intent.conversationId };
  try {
    const saved = await setPinned(intent.conversationId, intent.pinned);
    send({ ...base, ok: true, pinned: typeof saved?.pinned === "boolean" ? saved.pinned : intent.pinned });
  } catch {
    onError();
    send({ ...base, ok: false });
  }
}
