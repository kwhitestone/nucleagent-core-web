<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { getSessionBindings, updateSessionBindings, type SessionBindings } from "../api/sessionBindings";
import { useBindingSelection } from "../composables/useBindingSelection";
import { createLatestRequestGate } from "../composables/latestRequestGate";
import BindingPickers from "./BindingPickers.vue";

const props = defineProps<{ id: string; disabled?: boolean; row?: boolean }>();
const emit = defineEmits<{ pending: [pending: boolean] }>();
const { t } = useI18n();
const { skillIds, toolIds, tools, toolsLoading, toolsFailed, loadTools, pickedTools } = useBindingSelection();
const saved = ref<SessionBindings | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const gate = createLatestRequestGate();
const same = (a: number[], b: number[]) => a.length === b.length && a.every((id) => b.includes(id));
const dirty = computed(() => !!saved.value && (!same(skillIds.value, saved.value.skillIds) || !same(toolIds.value, saved.value.toolIds)));
watch(() => loading.value || saving.value || dirty.value, (value) => emit("pending", value), { immediate: true });
function restore(data: SessionBindings): void {
  saved.value = data;
  skillIds.value = [...data.skillIds];
  toolIds.value = [...data.toolIds];
}
function discard(): void {
  if (saved.value && !saving.value) restore(saved.value);
  error.value = "";
}
async function load(): Promise<void> {
  const ticket = gate.begin();
  saved.value = null;
  skillIds.value = [];
  toolIds.value = [];
  loading.value = true;
  saving.value = false;
  error.value = "";
  try {
    const data = await getSessionBindings(props.id);
    if (ticket.isCurrent()) restore(data);
  } catch {
    if (ticket.isCurrent()) error.value = t("common.bindingsLoadFailed");
  } finally {
    if (ticket.isCurrent()) loading.value = false;
  }
}
async function save(): Promise<void> {
  if (!saved.value?.editable || !dirty.value || props.disabled || saving.value) return;
  const ticket = gate.begin();
  saving.value = true;
  error.value = "";
  try {
    const data = await updateSessionBindings(props.id, { skillIds: [...skillIds.value], toolIds: [...pickedTools.value] });
    if (ticket.isCurrent()) restore(data);
  } catch (e) {
    if (ticket.isCurrent()) error.value = t((e as { status?: number })?.status === 409 ? "common.bindingsBusy" : "common.bindingsSaveFailed");
  } finally {
    if (ticket.isCurrent()) saving.value = false;
  }
}
function onSessionChange(event: Event): void {
  gate.invalidate();
  saved.value = null;
  skillIds.value = [];
  toolIds.value = [];
  saving.value = false;
  loading.value = false;
  error.value = "";
  if ((event as CustomEvent<{ authenticated?: boolean }>).detail?.authenticated === true) void load();
}
watch(() => props.id, load, { immediate: true });
onMounted(() => window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange));
onBeforeUnmount(() => {
  gate.invalidate();
  window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
});
</script>

<template>
  <section v-if="loading || error || saved?.editable" class="session-bindings" data-testid="session-bindings" :aria-busy="loading || saving">
    <span v-if="loading">{{ t('common.loading') }}</span>
    <BindingPickers v-if="saved?.editable" v-model:skill-ids="skillIds" v-model:tool-ids="toolIds" :tools="tools"
      :loading="toolsLoading" :failed="toolsFailed" :disabled="disabled || saving" :row="row" @retry="loadTools" />
    <p v-if="error" role="alert" class="session-bindings-error">{{ error }}</p>
    <div class="conversation-settings-actions">
      <button v-if="!saved && error" type="button" @click="load">{{ t('common.retry') }}</button>
      <template v-if="dirty">
        <button type="button" :disabled="disabled || saving" data-testid="bindings-save" @click="save">{{ t(saving ? 'common.applying' : 'common.applySettings') }}</button>
        <button type="button" :disabled="saving" data-testid="bindings-discard" @click="discard">{{ t('common.discardSettings') }}</button>
      </template>
    </div>
  </section>
</template>

<style>
.session-bindings { flex: none; min-width: 0; padding: 4px 12px; border-top: 1px solid var(--border); font-size: 13px; }
.session-bindings-error { color: var(--rose-500); margin: 4px 0; }
.session-bindings .conversation-settings-actions { flex-wrap: wrap; }
</style>
