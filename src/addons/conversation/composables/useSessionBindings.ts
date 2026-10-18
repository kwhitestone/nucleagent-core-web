import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { getSessionBindings, updateSessionBindings, type SessionBindings } from "../api/sessionBindings";
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
  // Retiring a response cannot cancel a PUT. Returning to its scope must wait.
  const writes = new Map<string, Promise<unknown>>();
  let authenticated = true;
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((value) => b.includes(value));
  const dirty = computed(() => !!saved.value && (!same(skillIds.value, saved.value.skillIds) || !same(toolIds.value, saved.value.toolIds)));
  const pending = computed(() => loading.value || saving.value || dirty.value || !saved.value);
  function restore(data: SessionBindings): void {
    saved.value = data;
    skillIds.value = [...data.skillIds];
    toolIds.value = [...data.toolIds];
  }
  function discard(): void {
    if (saved.value && !saving.value && !loading.value) restore(saved.value);
    error.value = "";
  }
  async function load(): Promise<void> {
    const ticket = gate.begin();
    const scope = id();
    saved.value = null;
    skillIds.value = [];
    toolIds.value = [];
    loading.value = true;
    saving.value = false;
    error.value = "";
    if (!authenticated) return;
    try {
      await writes.get(scope)?.catch(() => {});
      if (!ticket.isCurrent()) return;
      const data = await getSessionBindings(scope);
      if (ticket.isCurrent()) restore(data);
    } catch {
      if (ticket.isCurrent()) error.value = t("common.bindingsLoadFailed");
    } finally {
      if (ticket.isCurrent()) loading.value = false;
    }
  }
  async function save(): Promise<void> {
    if (!saved.value?.editable || !dirty.value || disabled() || saving.value || loading.value) return;
    const ticket = gate.begin();
    const scope = id();
    saving.value = true;
    error.value = "";
    const write = updateSessionBindings(scope, { skillIds: [...skillIds.value], toolIds: [...pickedTools.value] });
    writes.set(scope, write);
    try {
      const data = await write;
      if (ticket.isCurrent()) restore(data);
    } catch (e) {
      if (ticket.isCurrent()) error.value = t((e as { status?: number })?.status === 409 ? "common.bindingsBusy" : "common.bindingsSaveFailed");
    } finally {
      if (writes.get(scope) === write) writes.delete(scope);
      if (ticket.isCurrent()) saving.value = false;
    }
  }
  function onSessionChange(event: Event): void {
    authenticated = (event as CustomEvent<{ authenticated?: boolean }>).detail?.authenticated === true;
    void load();
  }
  watch(id, load, { immediate: true, flush: "sync" });
  onMounted(() => window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange));
  onBeforeUnmount(() => {
    gate.invalidate();
    window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
  });
  return { ...selection, saved, loading, saving, error, dirty, pending, load, save, discard };
}
