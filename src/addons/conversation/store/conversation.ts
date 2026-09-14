import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getPlatformRuntime } from "@/contracts/platform-runtime";
import {
  listConversations,
  createConversation as createConversationApi,
} from "@/addons/conversation/api/conversation";
import type { Conversation, CreateConversationRequest } from "@/addons/conversation/api/types";
import { createBroadcast as createBroadcastApi } from "../api/broadcast";
import type { BroadcastRequest, BroadcastSkipped } from "../api/types";
import { conversationNavigation, seedCreatedConversation } from "../composables/conversationNavigation";

/**
 * Conversation list store.
 *
 * Owns the sidebar history shared between Workbench and Conversation views.
 * State is mutated only via reassignment (immutable-style); actions wrap the
 * API layer so views stay thin.
 *
 * 游标分页：conversations 累积全部已加载页，hasMore 标记是否还能向下翻。
 * load() 拉首页，loadMore() 用上一列表页的最小 id 作 beforeId 追加下一页。
 * 推给壳时（useShellBridge）把累积列表 + hasMore 一起推，壳据此控制加载态。
 */
export const useConversationStore = defineStore("conversation", () => {
  const conversations = ref<Conversation[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const broadcastNotices = ref<Record<string, BroadcastSkipped[]>>({});
  let generation = 0;
  let pageCursor: number | undefined;
  let pageGeneration = 0;
  const sessionToken = () => getPlatformRuntime().getAccessToken();

  /** 还有更早的对话可加载（后端 hasMore）。首屏前默认 true，避免侧栏提前显示「没有更多」。 */
  const hasMore = ref(true);
  /** loadMore 进行中，防止重复触发。 */
  const loadingMore = ref(false);
  /** 每页大小，与后端默认一致。 */
  const PAGE_SIZE = 20;

  const sorted = computed(() =>
    // Newest first by createdAt，then id 兜底。
    // 后端返回 camelCase（createdAt），类型定义已对齐。
    [...conversations.value].sort((a, b) => {
      const ta = a.createdAt ?? "";
      const tb = b.createdAt ?? "";
      const byTime = tb.localeCompare(ta);
      return byTime !== 0 ? byTime : (b.id ?? 0) - (a.id ?? 0);
    }),
  );

  async function load(force = false): Promise<void> {
    const token = sessionToken();
    if (!token) return;
    if (loaded.value && !force) return;
    if (loading.value) return;
    const requestGeneration = generation;
    const requestPageGeneration = ++pageGeneration;
    loading.value = true;
    try {
      const res = await listConversations({ limit: PAGE_SIZE });
      if (generation !== requestGeneration || pageGeneration !== requestPageGeneration || sessionToken() !== token) return;
      conversations.value = res.data;
      pageCursor = res.data.length ? Math.min(...res.data.map(row => row.id)) : undefined;
      hasMore.value = res.hasMore;
      loaded.value = true;
    } catch (error) {
      // A retired account/request cannot surface an error in the new session.
      if (generation !== requestGeneration || sessionToken() !== token) return;
      throw error;
    } finally {
      if (generation === requestGeneration && sessionToken() === token) loading.value = false;
    }
  }

  /**
   * 仅列表响应推进游标；详情补载、广播成员补载或删除不能改变分页边界。
   */
  async function loadMore(): Promise<void> {
    const token = sessionToken();
    if (!token) return;
    const requestGeneration = generation;
    const requestPageGeneration = pageGeneration;
    if (!hasMore.value || loadingMore.value) return;
    if (!loaded.value) return load();
    if (loading.value || pageCursor === undefined) return;
    const beforeId = pageCursor;
    loadingMore.value = true;
    try {
      const res = await listConversations({ beforeId, limit: PAGE_SIZE });
      if (generation !== requestGeneration || pageGeneration !== requestPageGeneration || sessionToken() !== token) return;
      // 去重追加：翻页间隙可能有新数据写入，按 id 去重避免重复。
      const seen = new Set(conversations.value.map((c) => c.id));
      const fresh = res.data.filter((c) => !seen.has(c.id));
      conversations.value = [...conversations.value, ...fresh];
      if (res.data.length) pageCursor = Math.min(...res.data.map(row => row.id));
      hasMore.value = res.hasMore;
    } catch (error) {
      if (generation !== requestGeneration || sessionToken() !== token) return;
      throw error;
    } finally {
      if (generation === requestGeneration && sessionToken() === token) loadingMore.value = false;
    }
  }

  async function create(payload: CreateConversationRequest): Promise<Conversation> {
    const requestGeneration = generation;
    const token = sessionToken();
    const created = await createConversationApi(payload);
    // Immutable prepend so the sidebar updates immediately.
    if (generation === requestGeneration && sessionToken() === token) {
      seedCreatedConversation(created, payload);
      conversations.value = [created, ...conversations.value];
    } else {
      throw new DOMException("Conversation session changed", "AbortError");
    }
    return created;
  }

  async function createBroadcast(payload: BroadcastRequest) {
    const requestGeneration = generation;
    const token = sessionToken();
    const created = await createBroadcastApi(payload);
    if (generation !== requestGeneration || sessionToken() !== token) {
      throw new DOMException("Conversation session changed", "AbortError");
    }
    for (const conversation of created.conversations) seedCreatedConversation(conversation, payload);
    const ids = new Set(created.conversations.map(conversation => conversation.id));
    conversations.value = [...created.conversations, ...conversations.value.filter(item => !ids.has(item.id))];
    setBroadcastNotices(created.groupId, created.skipped ?? []);
    return created;
  }

  function setBroadcastNotices(groupId: string, skipped: BroadcastSkipped[]): void {
    broadcastNotices.value = { ...broadcastNotices.value, [groupId]: [...skipped] };
  }

  function upsert(conversation: Conversation): void {
    const existing = conversations.value.findIndex((c) => c.id === conversation.id);
    if (existing >= 0) {
      const next = conversations.value.slice();
      next[existing] = conversation;
      conversations.value = next;
    } else {
      conversations.value = [conversation, ...conversations.value];
    }
  }

  function reconcileBroadcastMembers(groupId: string, memberIds: readonly number[]): void {
    const members = new Set(memberIds);
    const removed = conversations.value.filter(row =>
      row.state?.broadcastGroupId === groupId && !members.has(row.id));
    if (!removed.length) return;
    const removedIds = new Set(removed.map(row => row.id));
    conversations.value = conversations.value.filter(row => !removedIds.has(row.id));
    removed.forEach(row => conversationNavigation.forConversation(String(row.id)).forget());
  }

  function reset(): void {
    conversationNavigation.clear();
    generation += 1;
    pageGeneration += 1;
    pageCursor = undefined;
    conversations.value = [];
    loading.value = false;
    loaded.value = false;
    broadcastNotices.value = {};
    hasMore.value = true;
    loadingMore.value = false;
  }

  return {
    // state
    conversations,
    loading,
    loaded,
    hasMore,
    loadingMore,
    broadcastNotices,
    // getters
    sorted,
    // actions
    load,
    loadMore,
    create,
    createBroadcast,
    setBroadcastNotices,
    upsert,
    reconcileBroadcastMembers,
    reset,
  };
});
