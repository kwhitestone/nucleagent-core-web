import type { Provider } from "@/contracts/model-catalog";
import type { ExecutionBackendOption, ModelChoice } from "../api/types";
import { executionBackendCompatibility } from "./executionBackendCompatibility.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function broadcastGroupId(conversation: { state?: unknown }): string | undefined {
  const state = conversation.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
  const id = (state as Record<string, unknown>).broadcastGroupId;
  return typeof id === "string" && UUID.test(id) ? id : undefined;
}

export function broadcastRoute(conversation: { id: number; state?: unknown }) {
  const groupId = broadcastGroupId(conversation);
  return groupId ? { path: `/b/${groupId}`, query: { conversationId: String(conversation.id) } } : undefined;
}

export function activeBroadcastMember(members: readonly { id: number }[], query: unknown): number | null {
  const id = typeof query === "string" && /^\d+$/.test(query) ? Number(query) : null;
  return members.find(member => member.id === id)?.id ?? members[0]?.id ?? null;
}

export function broadcastBackendSelection(
  options: ExecutionBackendOption[],
  modelChoice: ModelChoice | null,
  providers: Provider[],
) {
  const unique = options.filter((option, index) => options.findIndex(item => item.id === option.id) === index);
  const candidates = unique.map(option => ({
    backend: option.id, ...executionBackendCompatibility(option, modelChoice, providers),
  }));
  return {
    eligible: candidates.filter(item => item.allowed).map(item => item.backend),
    skipped: candidates.filter(item => !item.allowed).map(({ backend, reason }) => ({ backend, reason })),
  };
}

export function activeSidebarConversation(
  path: string,
  query: unknown,
  conversations: readonly { id: number; state?: unknown }[],
): number | null {
  const single = path.match(/^\/c\/(\d+)$/);
  if (single) return Number(single[1]);
  const group = path.match(/^\/b\/([^/]+)$/)?.[1];
  return group ? activeBroadcastMember(
    conversations.filter(conversation => broadcastGroupId(conversation) === group), query,
  ) : null;
}
