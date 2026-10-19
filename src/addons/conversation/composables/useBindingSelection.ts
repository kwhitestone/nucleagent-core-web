import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { isBusinessBoundaryChange, SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { effectiveToolIds, TOOL_CATALOG_PATH, type ToolCatalogItem } from "../api/toolCatalog";
import { resourcePage } from "@/api/resourcePage";
import { createLatestRequestGate } from "./latestRequestGate";

export function useBindingSelection() {
  const skillIds = ref<number[]>([]);
  const toolIds = ref<number[]>([]);
  const tools = ref<ToolCatalogItem[]>([]);
  const toolsLoading = ref(false);
  const toolsFailed = ref(false);
  const gate = createLatestRequestGate();
  let controller: AbortController | undefined;
  const pickedTools = computed(() => effectiveToolIds(toolIds.value, tools.value, skillIds.value));
  const createBindings = computed(() => ({
    skillIds: skillIds.value.length ? [...skillIds.value] : undefined,
    toolIds: pickedTools.value.length ? [...pickedTools.value] : undefined,
  }));

  async function loadTools(): Promise<void> {
    const request = gate.begin();
    controller?.abort();
    controller = new AbortController();
    tools.value = [];
    if (!toolIds.value.length) { toolsLoading.value = false; toolsFailed.value = false; return; }
    toolsLoading.value = true;
    toolsFailed.value = false;
    try {
      const result = await resourcePage<ToolCatalogItem>(TOOL_CATALOG_PATH, { ids: [...toolIds.value], pageSize: 50 }, controller.signal);
      if (request.isCurrent()) tools.value = result.data;
    } catch {
      if (request.isCurrent()) toolsFailed.value = true;
    } finally {
      if (request.isCurrent()) toolsLoading.value = false;
    }
  }
  function onSessionChange(event: Event): void {
    if ((event as CustomEvent).detail?.authenticated === true && !isBusinessBoundaryChange(event)) {
      void loadTools();
      return;
    }
    gate.invalidate();
    controller?.abort();
    skillIds.value = [];
    toolIds.value = [];
    tools.value = [];
    toolsLoading.value = false;
    toolsFailed.value = false;
    if ((event as CustomEvent<{ authenticated?: boolean }>).detail?.authenticated === true) void loadTools();
  }
  onMounted(() => {
    window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange);
    void loadTools();
  });
  watch(toolIds, loadTools, { deep: true, flush: "sync" });
  onBeforeUnmount(() => {
    gate.invalidate();
    controller?.abort();
    skillIds.value = [];
    toolIds.value = [];
    tools.value = [];
    window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
  });
  return { skillIds, toolIds, tools, toolsLoading, toolsFailed, loadTools, pickedTools, createBindings };
}
