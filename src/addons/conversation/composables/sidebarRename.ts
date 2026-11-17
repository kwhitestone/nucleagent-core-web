// MUYU-410: shell sidebar 「⋯ › 重命名」/double-click. The shell never calls Core; it asks us over the verified
// channel, we PATCH {title} via the store (Core trims, checks 1-80 runes and ownership) and answer `rename-result`.
export interface RenameIntent { requestId: number; conversationId: number; title: string }

export function parseRenameIntent(payload: unknown): RenameIntent | null {
  if (!payload || typeof payload !== "object") return null;
  const { source, type, requestId, conversationId, title } = payload as Record<string, unknown>;
  if (source !== "shell" || type !== "rename" || typeof title !== "string") return null;
  if (!Number.isSafeInteger(requestId) || (requestId as number) < 0) return null;
  if (!Number.isSafeInteger(conversationId) || (conversationId as number) <= 0) return null;
  const trimmed = title.trim();
  const runes = [...trimmed].length;
  if (runes < 1 || runes > 80) return null;
  return { requestId: requestId as number, conversationId: conversationId as number, title: trimmed };
}

export async function runSidebarRename(
  intent: RenameIntent,
  rename: (id: number, title: string) => Promise<{ title?: string }>,
  send: (payload: Record<string, unknown>) => void,
  onError: () => void,
): Promise<void> {
  const base = { source: "sub", type: "rename-result", requestId: intent.requestId, conversationId: intent.conversationId };
  try {
    const saved = await rename(intent.conversationId, intent.title);
    send({ ...base, ok: true, title: saved?.title || intent.title });
  } catch {
    onError();
    send({ ...base, ok: false });
  }
}
