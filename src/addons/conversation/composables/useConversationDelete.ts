/**
 * UI-IMPL-5: one delete flow for the header 「⋯」 and the shell sidebar intent.
 * ConversationDeleteHost (mounted once in App.vue) renders the confirm dialog and
 * the 5s undo bar from this state; Core does the soft delete / restore.
 */
import { ref } from "vue";
import type { Router } from "vue-router";
import { deleteConversation, restoreConversation } from "@/addons/conversation/api/conversation";
import { useConversationStore } from "@/addons/conversation/store/conversation";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";
import { deleteErrorKey, groupSize } from "./conversationDelete";

export const pendingDelete = ref<{ id: number; title: string; status?: string; members: number } | null>(null);
export const undoTarget = ref<number | null>(null);
let routerRef: Router | null = null;

export function bindDeleteRouter(router: Router): void {
  routerRef = router;
}

/** Open the confirm dialog; status/title fall back to the loaded list row. */
export function requestDelete(id: number, info: { title?: string; status?: string } = {}): void {
  const store = useConversationStore();
  const row = store.conversations.find((c) => c.id === id);
  pendingDelete.value = {
    id,
    title: info.title || row?.title || "",
    status: info.status || row?.status,
    members: groupSize(store.conversations, id),
  };
}

function isOpen(id: number, group: unknown): boolean {
  const route = routerRef?.currentRoute.value;
  if (!route) return false;
  if (route.name === "conversation") return Number(route.params.id) === id;
  return route.name === "broadcast-conversation" && !!group && route.params.groupId === group;
}

export async function confirmDelete(): Promise<void> {
  const target = pendingDelete.value;
  if (!target) return;
  pendingDelete.value = null;
  const store = useConversationStore();
  const group = store.conversations.find((c) => c.id === target.id)?.state?.broadcastGroupId;
  try {
    await deleteConversation(target.id);
  } catch (error) {
    const key = deleteErrorKey(error);
    toast.error(i18n.global.t(key));
    // 404: not mine / already gone — drop the stale row, nothing to undo.
    if (key === "conversation.delete.notFound") store.remove(target.id);
    return;
  }
  store.remove(target.id);
  undoTarget.value = target.id;
  // Deleting the open conversation lands on a fresh chat (§5).
  if (isOpen(target.id, group)) void routerRef?.push("/chat");
}

export async function undoDelete(): Promise<void> {
  const id = undoTarget.value;
  if (id == null) return;
  undoTarget.value = null;
  try {
    await restoreConversation(id);
    toast.success(i18n.global.t("conversation.delete.restored"));
    await useConversationStore().load(true);
  } catch {
    toast.error(i18n.global.t("conversation.delete.restoreFailed"));
  }
}
