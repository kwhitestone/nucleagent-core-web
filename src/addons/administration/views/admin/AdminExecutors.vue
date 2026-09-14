<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { isInShell, useEmbeddedAuthorization } from "@/contracts/platform-runtime";
import { listConnectedExecutors, updateExecutorRuntime } from "../../api/executor";
import { createExecutorManagement, type ExecutorManagementState } from "../../executors/executorManagement";
import ExecutorInstanceCard from "./ExecutorInstanceCard.vue";
import ExecutorRuntimeEditor from "./ExecutorRuntimeEditor.vue";

const { t, locale } = useI18n();
const authorization = useEmbeddedAuthorization();
const canWrite = computed(() => !isInShell() || authorization.can("core:admin:write"));
const state = shallowRef<ExecutorManagementState>();
const controller = createExecutorManagement({ list: listConnectedExecutors, update: updateExecutorRuntime }, next => { state.value = next; });
state.value = controller.state;
const editingInstance = computed(() => state.value?.instances?.find(instance => instance.instanceId === state.value?.editor?.instanceId));
const updatedAt = computed(() => state.value?.updatedAt ? new Date(state.value.updatedAt).toLocaleString(locale.value) : "");
let poll: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void controller.refresh();
  poll = setInterval(() => { if (document.visibilityState !== "hidden") void controller.refresh(); }, 5000);
});
onBeforeUnmount(() => { if (poll) clearInterval(poll); controller.dispose(); });
function save(): void { if (canWrite.value) void controller.save(); }
function edit(id: string): void { if (canWrite.value) controller.edit(id); }
</script>

<template>
  <section v-if="state" class="executor-admin" :aria-busy="state.loading || state.saving">
    <header class="executor-admin__toolbar"><div><h2>{{ t("admin.executors.title") }}</h2><p>{{ t("admin.executors.subtitle") }}</p></div><button type="button" :disabled="state.loading || state.saving" @click="controller.refresh()">{{ state.loading ? t("common.loading") : t("admin.executors.refresh") }}</button></header>
    <div v-if="state.error" class="executor-notice error" role="alert"><strong>{{ t(`admin.executors.${state.error.kind}`) }}</strong><span v-if="state.error.message">{{ state.error.message }}</span></div>
    <p v-if="state.notice === 'saved'" class="executor-notice success" role="status">{{ t("admin.executors.saved") }}</p>
    <ExecutorRuntimeEditor v-if="state.editor" :editor="state.editor" :runtime="editingInstance?.runtime ?? null" :device-name="editingInstance?.deviceName || state.editor.instanceId" :saving="state.saving" :can-write="canWrite"
      @concurrency="controller.setConcurrency" @backend="controller.setBackend" @cancel="controller.cancelEdit" @save="save" @reload="edit(state.editor.instanceId)" />
    <p v-if="state.instances === null && state.loading" class="executor-empty" role="status">{{ t("common.loading") }}</p>
    <p v-else-if="state.instances?.length === 0" class="executor-empty">{{ t("admin.executors.empty") }}</p>
    <ExecutorInstanceCard v-for="instance in state.instances ?? []" :key="instance.instanceId" :instance="instance" :can-write="canWrite" :editing="Boolean(state.editor) || state.saving" @edit="edit" />
    <footer v-if="state.instances !== null" class="executor-admin__footer"><p>{{ t("admin.executors.capacityHint") }}</p><span>{{ t("admin.executors.updatedAt", { time: updatedAt }) }}</span></footer>
  </section>
</template>

<style scoped>
.executor-admin { display: flex; flex-direction: column; gap: 16px; padding-top: 4px; }
.executor-admin__toolbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
h2 { margin: 0 0 6px; font-size: 16px; color: var(--text-primary); }
.executor-admin__toolbar p, .executor-admin__footer { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.executor-admin__toolbar button { padding: 7px 13px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-secondary); font-size: 12px; cursor: pointer; white-space: nowrap; }
.executor-admin__toolbar button:disabled { opacity: .5; cursor: not-allowed; }
.executor-empty { padding: 40px 20px; text-align: center; color: var(--text-tertiary); font-size: 13px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); }
.executor-notice { display: flex; flex-direction: column; gap: 4px; padding: 12px 15px; margin: 0; border: 1px solid var(--border); border-radius: var(--r-md); font-size: 12px; overflow-wrap: anywhere; }
.executor-notice.error { color: var(--rose-500); background: var(--bg-card); border-color: var(--rose-400); }
.executor-notice.success { color: var(--teal-700); background: var(--teal-50); }
.executor-admin__footer { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--text-tertiary); }
.executor-admin__footer p { margin: 0; }
</style>
