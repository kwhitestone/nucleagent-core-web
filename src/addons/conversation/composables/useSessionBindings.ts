import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isBusinessBoundaryChange, SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { syncSessionBindings, updateSessionBindings, type SessionBindings } from "../api/sessionBindings";
import { bindingSnapshotConfirmed, bindingSnapshotCurrent, bindingWriteStarted } from "./bindingWriteCoordinator";
import { useBindingSelection } from "./useBindingSelection";
import { createLatestRequestGate } from "./latestRequestGate";

export function useSessionBindings(id: () => string, disabled: () => boolean) {
  const { t } = useI18n();
  const selection = useBindingSelection();
  const { skillIds, toolIds, pickedTools } = selection;
  const saved = ref<SessionBindings | null>(null);
  const loading = ref(true);
  const saving = ref(false);
  const error = ref("");
  const gate = createLatestRequestGate();
  let request: AbortController | undefined;
  let authenticated = true;
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((value) => b.includes(value));
  const dirty = computed(() => !!saved.value && (!same(skillIds.value, saved.value.skillIds) || !same(toolIds.value, saved.value.toolIds)));
  const uncertain = computed(() => !!saved.value && !bindingSnapshotCurrent(id(), saved.value));
  const pending = computed(() => loading.value || saving.value || dirty.value || uncertain.value || !saved.value);
  function restore(data: SessionBindings): void {
    if (!bindingSnapshotConfirmed(id(), data)) throw new Error("Stale bindings snapshot");
    saved.value = data;
    skillIds.value = [...data.skillIds];
    toolIds.value = [...data.toolIds];
  }
  function discard(): void {
    if (uncertain.value) return;
    if (saved.value && !saving.value && !loading.value) restore(saved.value);
    error.value = "";
  }
  async function load(): Promise<void> {
    const ticket = gate.begin();
    request?.abort();
    request = new AbortController();
    const scope = id();
    saved.value = null;
    skillIds.value = [];
    toolIds.value = [];
    loading.value = true;
    saving.value = false;
    error.value = "";
    if (!authenticated) return;
    try {
      const data = await syncSessionBindings(scope, request.signal);
      if (ticket.isCurrent()) restore(data);
    } catch {
      if (ticket.isCurrent()) error.value = t("common.bindingsLoadFailed");
    } finally {
      if (ticket.isCurrent()) loading.value = false;
    }
  }
  async function save(): Promise<void> {
    if (!saved.value?.editable || !dirty.value || uncertain.value || disabled() || saving.value || loading.value) return;
    if (selection.toolsLoading.value || selection.toolsFailed.value) { error.value = t("common.bindingsLoadFailed"); return; }
    const ticket = gate.begin();
    const scope = id();
    request?.abort();
    request = new AbortController();
    saving.value = true;
    error.value = "";
    bindingWriteStarted(scope, saved.value);
    try {
      const data = await updateSessionBindings(scope, { skillIds: [...skillIds.value], toolIds: [...pickedTools.value],
        revision: saved.value.revision }, request.signal);
      if (ticket.isCurrent()) restore(data);
    } catch (e) {
      if (ticket.isCurrent()) {
        const failure = e as { status?: number; code?: string };
        error.value = t(failure?.code === "bindings_revision_conflict" ? "common.bindingsRevisionConflict" :
          failure?.status === 409 ? "common.bindingsBusy" : "common.bindingsOutcomeUnknown");
      }
    } finally {
      if (ticket.isCurrent()) saving.value = false;
    }
  }
  function onSessionChange(event: Event): void {
    authenticated = (event as CustomEvent<{ authenticated?: boolean }>).detail?.authenticated === true;
    if (authenticated && !isBusinessBoundaryChange(event)) return;
    void load();
  }
  watch(id, load, { immediate: true, flush: "sync" });
  onMounted(() => window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange));
  onBeforeUnmount(() => {
    gate.invalidate();
    request?.abort();
    saved.value = null;
    skillIds.value = [];
    toolIds.value = [];
    window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
  });
  return { ...selection, saved, loading, saving, error, dirty, uncertain, pending, load, save, discard };
}
