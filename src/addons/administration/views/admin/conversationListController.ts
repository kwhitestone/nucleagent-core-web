/**
 * List state of the all-users conversation viewer (AdminConversations.vue).
 * Only the latest query may commit: switching type, searching or paging while
 * an older request is in flight makes that request's answer (or failure)
 * irrelevant, so a slow response can never put chat rows under the IM tab or
 * hand the next page a cursor minted for other filters.
 */
import { reactive } from "vue";
import { createLatestRequestGate } from "../../../conversation/composables/latestRequestGate.ts";
import type { ConversationFilters, ConversationRow, ConversationType, CursorPage } from "../../api/conversations";

export type FetchConversationPage = (filters: ConversationFilters, cursor: string, limit: number) => Promise<CursorPage<ConversationRow>>;

export function createConversationListController(fetchPage: FetchConversationPage, pageSize = 20, onError: (error: unknown) => void = () => {}) {
  const state = reactive({
    filters: { type: "chat", userId: "", from: "", to: "", includeDeleted: false } as ConversationFilters,
    rows: [] as ConversationRow[],
    cursors: [""] as string[],
    pageIndex: 0,
    nextCursor: "",
    loading: false,
  });

  const gate = createLatestRequestGate();

  async function load(index: number): Promise<void> {
    const ticket = gate.begin();
    state.loading = true;
    try {
      // Snapshot the filters this request is for; later edits start a new request.
      const page = await fetchPage({ ...state.filters }, state.cursors[index] ?? "", pageSize);
      if (!ticket.isCurrent()) return;
      state.rows = page.items;
      state.pageIndex = index;
      state.nextCursor = page.nextCursor;
      if (page.hasMore) state.cursors[index + 1] = page.nextCursor;
    } catch (error) {
      if (ticket.isCurrent()) onError(error);
    } finally {
      if (ticket.isCurrent()) state.loading = false;
    }
  }

  function search(): Promise<void> {
    state.cursors = [""];
    return load(0);
  }

  function switchType(type: ConversationType): Promise<void> {
    if (state.filters.type === type) return Promise.resolve();
    state.filters.type = type;
    return search();
  }

  /** Drops whatever is in flight (unmount). */
  function dispose(): void {
    gate.invalidate();
  }

  return { state, load, search, switchType, dispose };
}
