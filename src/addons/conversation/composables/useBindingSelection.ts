import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { effectiveToolIds, listToolCatalog, type ToolCatalogItem } from "../api/toolCatalog";
import { createLatestRequestGate } from "./latestRequestGate";

export function useBindingSelection() {
  const skillIds = ref<number[]>([]);
  const toolIds = ref<number[]>([]);
  const tools = ref<ToolCatalogItem[]>([]);
  const toolsLoading = ref(false);
  const toolsFailed = ref(false);
  const gate = createLatestRequestGate();
  const pickedTools = computed(() => effectiveToolIds(toolIds.value, tools.value, skillIds.value));
  const createBindings = computed(() => ({
    skillIds: skillIds.value.length ? [...skillIds.value] : undefined,
    toolIds: pickedTools.value.length ? [...pickedTools.value] : undefined,
  }));

  async function loadTools(): Promise<void> {
    const request = gate.begin();
    toolsLoading.value = true;
    toolsFailed.value = false;
    try {
      const rows = await listToolCatalog();
      if (request.isCurrent()) tools.value = rows;
    } catch {
      if (request.isCurrent()) toolsFailed.value = true;
    } finally {
      if (request.isCurrent()) toolsLoading.value = false;
    }
  }
  function onSessionChange(event: Event): void {
    gate.invalidate();
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
  onBeforeUnmount(() => {
    gate.invalidate();
    window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
  });
  return { skillIds, toolIds, tools, toolsLoading, toolsFailed, loadTools, pickedTools, createBindings };
}
