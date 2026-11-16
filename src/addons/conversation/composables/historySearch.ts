import { computed, ref, watch } from "vue";
import type { Conversation } from "../api/types";

type Page = { data: Conversation[]; hasMore: boolean };

/**
 * History title search against Core (GET /conversation?q=), mirroring OWUI
 * SearchModal schedule/fetchResults: debounce, latest-request-wins, dedupe on
 * paging, blank query clears. Results are a separate view; the task desk list
 * and its order are untouched.
 */
export function createTitleSearch(fetchPage: (q: string, beforeId?: number) => Promise<Page>, debounceMs = 180) {
  const query = ref("");
  const results = ref<Conversation[]>([]);
  const loading = ref(false);
  const failed = ref(false);
  const hasMore = ref(false);
  const active = computed(() => query.value.trim() !== "");
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load(beforeId?: number): Promise<void> {
    const mine = ++generation;
    loading.value = true;
    failed.value = false;
    try {
      const page = await fetchPage(query.value.trim(), beforeId);
      if (mine !== generation) return;
      const seen = new Set(results.value.map(c => c.id));
      results.value = beforeId === undefined ? page.data : [...results.value, ...page.data.filter(c => !seen.has(c.id))];
      hasMore.value = page.hasMore;
    } catch {
      if (mine === generation) failed.value = true;
    } finally {
      if (mine === generation) loading.value = false;
    }
  }

  // sync: every keystroke invalidates the in-flight request before the next one is scheduled.
  watch(query, () => {
    clearTimeout(timer);
    generation += 1;
    results.value = [];
    hasMore.value = false;
    failed.value = false;
    loading.value = active.value;
    if (active.value) timer = setTimeout(() => void load(), debounceMs);
  }, { flush: "sync" });

  const lastId = () => results.value.at(-1)?.id;
  return {
    query, results, loading, failed, hasMore, active,
    more: () => (loading.value || !hasMore.value ? Promise.resolve() : load(lastId())),
    retry: () => load(lastId()),
  };
}
