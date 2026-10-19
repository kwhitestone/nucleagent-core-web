import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { resourcePage } from "@/api/resourcePage";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { useRemotePage } from "./useRemotePage";

export function useResourceOptions<T extends { id: number }>(endpoint: string, selected: () => number[], pageSelected = false) {
  const group = ref("");
  const hydrated = shallowRef<T[]>([]);
  const hydratedLoaded = ref(false);
  const hydrationFailed = ref(false);
  let generation = 0;
  let controller: AbortController | undefined;
  const collection = useRemotePage<T>((params, signal) => resourcePage<T>(endpoint, {
    ...params,
    ...(group.value === "__selected" ? { ids: selected().length ? selected() : [0] } : { group: group.value || "all" }),
  }, signal));
  const selectedPage = useRemotePage<T>((params, signal) => resourcePage<T>(endpoint, {
    ...params, ids: selected().length ? selected() : [0],
  }, signal));
  const known = computed(() => [...hydrated.value, ...collection.rows.value.filter(row => !hydrated.value.some(item => item.id === row.id))]);
  async function hydrate() {
    const ticket = ++generation;
    controller?.abort();
    controller = new AbortController();
    hydratedLoaded.value = false;
    hydrationFailed.value = false;
    hydrated.value = [];
    if (!selected().length) { hydratedLoaded.value = true; return; }
    try {
      const result = await resourcePage<T>(endpoint, { ids: selected(), page: 1, pageSize: 50 }, controller.signal);
      if (ticket !== generation) return;
      hydrated.value = result.data;
      hydratedLoaded.value = true;
    } catch {
      if (ticket === generation) hydrationFailed.value = true;
    }
  }
  function filter(value: { search: string; group: string }) {
    const changedQuery = collection.query.value !== value.search;
    const changedGroup = group.value !== value.group;
    group.value = value.group;
    if (changedQuery) collection.query.value = value.search;
    else if (changedGroup) { collection.reset(); void collection.load(); }
  }
  function reset() {
    generation++;
    controller?.abort();
    hydrated.value = [];
    hydratedLoaded.value = false;
    hydrationFailed.value = false;
    collection.reset();
    selectedPage.reset();
  }
  function session(event: Event) {
    reset();
    if ((event as CustomEvent).detail?.authenticated === true) {
      void collection.load();
      void hydrate();
      if (pageSelected) void selectedPage.load();
    }
  }
  watch(selected, () => {
    void hydrate();
    if (pageSelected) void selectedPage.load();
    if (group.value === "__selected") { collection.reset(); void collection.load(); }
  }, { deep: true });
  onMounted(() => {
    void collection.load();
    void hydrate();
    if (pageSelected) void selectedPage.load();
    window.addEventListener(SESSION_CHANGE_EVENT, session);
  });
  onBeforeUnmount(() => { reset(); window.removeEventListener(SESSION_CHANGE_EVENT, session); });
  async function retry() { await Promise.all([collection.load(), hydrate()]); }
  return { ...collection, known, hydratedLoaded, selectedPage, filter, hydrate, load: retry,
    failed: computed(() => collection.failed.value || hydrationFailed.value) };
}
