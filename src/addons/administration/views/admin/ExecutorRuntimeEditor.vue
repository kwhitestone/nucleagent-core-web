<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { RUNTIME_LIMITS, validateRuntimeConfig, type RuntimeEditor } from "../../executors/executorManagement";
import type { ExecutorRuntimeStatus } from "../../executors/types";

const props = defineProps<{ editor: RuntimeEditor; runtime: ExecutorRuntimeStatus | null; deviceName: string; saving: boolean; canWrite: boolean }>();
defineEmits<{ concurrency: [value: number]; backend: [index: number, field: "minProcesses" | "maxProcesses" | "sessionsPerProcess" | "maxActiveSessions", value: number]; cancel: []; save: []; reload: [] }>();
const { t } = useI18n();
const conflict = computed(() => Boolean(props.runtime && props.runtime.revision !== props.editor.expectedRevision));
const invalid = computed(() => validateRuntimeConfig(props.editor.config));
const editable = computed(() => props.canWrite && Boolean(props.runtime?.configurable) && !props.saving);
const number = (event: Event) => Number((event.target as HTMLInputElement).value);
</script>

<template>
  <form class="runtime-editor" @submit.prevent="$emit('save')">
    <header><div><h3>{{ t("admin.executors.editTitle", { name: deviceName }) }}</h3><p>{{ t("admin.executors.editHint") }}</p></div><span>{{ t("admin.executors.revision", { n: editor.expectedRevision }) }}</span></header>
    <p v-if="!runtime" class="editor-warning" role="status">{{ t("admin.executors.disconnected") }}</p>
    <p v-else-if="conflict" class="editor-warning" role="status">{{ t("admin.executors.conflict") }} <button type="button" class="reload-button" :disabled="!editable" @click="$emit('reload')">{{ t("admin.executors.reloadConfig") }}</button></p>
    <fieldset :disabled="!editable || conflict">
      <label class="concurrency-field"><span>{{ t("admin.executors.maxConcurrency") }}</span><input type="number" required min="1" :max="RUNTIME_LIMITS.maxConcurrency" step="1" :value="editor.config.maxConcurrency" @input="$emit('concurrency', number($event))" /></label>
      <div class="editor-table-scroll"><table>
        <thead><tr><th>{{ t("admin.executors.backend") }}</th><th>{{ t("admin.executors.processTarget") }}</th><th>{{ t("admin.executors.maxProcesses") }}</th><th>{{ t("admin.executors.sessionsPerProcess") }}</th><th>{{ t("admin.executors.maxActiveSessions") }}</th></tr></thead>
        <tbody><tr v-for="(backend, index) in editor.config.backends" :key="backend.backend">
          <td><strong>{{ backend.backend }}</strong><small>{{ backend.mode === 'dedicated' ? t('admin.executors.modes.dedicated') : t('admin.executors.modes.shared') }}</small></td>
          <td><label><span class="input-label">{{ t('admin.executors.warmTarget') }}</span><input type="number" required min="1" :max="RUNTIME_LIMITS.processes" step="1" :aria-label="`${backend.backend} ${t('admin.executors.processTarget')}`" :value="backend.minProcesses" @input="$emit('backend', index, 'minProcesses', number($event))" /></label></td>
          <td><input type="number" required :min="backend.minProcesses" :max="RUNTIME_LIMITS.processes" step="1" :aria-label="`${backend.backend} ${t('admin.executors.maxProcesses')}`" :value="backend.maxProcesses" @input="$emit('backend', index, 'maxProcesses', number($event))" /></td>
          <td><span v-if="backend.mode === 'dedicated'" class="fixed-value">1</span><input v-else type="number" required min="1" :max="RUNTIME_LIMITS.sessionsPerProcess" step="1" :aria-label="`${backend.backend} ${t('admin.executors.sessionsPerProcess')}`" :value="backend.sessionsPerProcess" @input="$emit('backend', index, 'sessionsPerProcess', number($event))" /></td>
          <td><input v-if="backend.mode === 'dedicated'" type="number" required min="1" :max="RUNTIME_LIMITS.maxConcurrency" step="1" :aria-label="`${backend.backend} ${t('admin.executors.maxActiveSessions')}`" :value="backend.maxActiveSessions" @input="$emit('backend', index, 'maxActiveSessions', number($event))" /><span v-else class="fixed-value">{{ backend.maxActiveSessions || t('admin.executors.automaticCapacity') }}</span></td>
        </tr></tbody>
      </table></div>
    </fieldset>
    <p v-if="invalid" class="editor-warning" role="status">{{ t(`admin.executors.${invalid}`) }}</p>
    <footer><p>{{ t("admin.executors.warmHint") }}</p><div><button type="button" class="cancel-button" :disabled="saving" @click="$emit('cancel')">{{ t("common.cancel") }}</button><button type="submit" class="save-button" data-testid="save-runtime" :disabled="!editable || conflict || Boolean(invalid)">{{ saving ? t("admin.executors.saving") : t("common.save") }}</button></div></footer>
  </form>
</template>

<style scoped>
.runtime-editor { background: var(--bg-card); border: 1px solid var(--indigo-400); border-radius: var(--r-lg); padding: 20px; box-shadow: var(--shadow-sm); }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
h3 { margin: 0 0 6px; color: var(--text-primary); font-size: 15px; }
header p, header > span, footer p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
header > span { white-space: nowrap; }
fieldset { margin: 0; padding: 0; border: none; min-width: 0; }
.concurrency-field { display: flex; align-items: center; gap: 16px; margin-bottom: 15px; font-size: 12px; color: var(--text-primary); }
input { width: 100px; max-width: 100%; border: 1px solid var(--border); border-radius: var(--r-md); padding: 7px 9px; color: var(--text-primary); background: var(--bg-card); font-size: 13px; }
input:focus { outline: 2px solid var(--teal-200); outline-offset: 1px; border-color: var(--indigo-400); }
input:disabled { background: var(--bg-subtle); color: var(--text-tertiary); }
.editor-table-scroll { overflow-x: auto; }
table { width: 100%; min-width: 580px; border-collapse: collapse; font-size: 12px; text-align: left; }
th { color: var(--text-secondary); font-weight: 500; padding: 9px 10px; border-bottom: 1px solid var(--border); }
td { padding: 12px 10px; color: var(--text-primary); border-bottom: 1px solid var(--border); }
th:first-child, td:first-child { padding-left: 0; }
small, .input-label { display: block; color: var(--text-tertiary); font-size: 10px; margin: 4px 0; }
.fixed-value { color: var(--text-secondary); font-size: 12px; }
.editor-warning { font-size: 12px; color: var(--amber-600); line-height: 1.6; margin: 12px 0; }
.reload-button { border: none; background: transparent; color: var(--indigo-600); cursor: pointer; text-decoration: underline; }
footer { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 16px; }
footer > div { display: flex; gap: 8px; }
button { white-space: nowrap; }
.save-button, .cancel-button { padding: 8px 16px; border: 1px solid var(--border); border-radius: var(--r-md); font-size: 12px; cursor: pointer; }
.save-button { border-color: transparent; background: var(--grad-teal-indigo); color: white; }
.cancel-button { background: var(--bg-card); color: var(--text-secondary); }
button:disabled { opacity: .5; cursor: not-allowed; }
@media (max-width: 680px) { header, footer { flex-direction: column; } footer > div { align-self: flex-end; } }
</style>
