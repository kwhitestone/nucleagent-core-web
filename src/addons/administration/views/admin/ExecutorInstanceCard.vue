<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { ConnectedExecutor, RuntimeBackendStatus } from "../../executors/types";

defineProps<{ instance: ConnectedExecutor; canWrite: boolean; editing: boolean }>();
defineEmits<{ edit: [instanceId: string] }>();
const { t, te, locale } = useI18n();
const stateLabel = (state: string) => te(`admin.executors.states.${state}`) ? t(`admin.executors.states.${state}`) : state;
const nativePolicyPending = (backend: RuntimeBackendStatus) => backend.state === "reconciling" && backend.errorCode === "native_policy_pending";
function modeLabel(backend: RuntimeBackendStatus): string {
  if (backend.mode === "shared" && backend.maxProcesses === 1) return t("admin.executors.singleProcess");
  return te(`admin.executors.modes.${backend.mode}`) ? t(`admin.executors.modes.${backend.mode}`) : backend.mode;
}
function time(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale.value) : t("admin.executors.unreported");
}
</script>

<template>
  <article class="executor-card" :data-instance-id="instance.instanceId">
    <header class="executor-card__header">
      <div class="executor-card__identity">
        <h3>{{ instance.deviceName || instance.deviceId || instance.instanceId }} <span class="online-badge">{{ t("admin.executors.connected") }}</span></h3>
        <p class="instance-id">{{ instance.instanceId }}</p>
        <p class="muted">{{ instance.os || t("admin.executors.unreported") }} · {{ t("admin.executors.version") }} {{ instance.appVersion || t("admin.executors.unreported") }}</p>
      </div>
      <button v-if="canWrite && instance.runtime?.configurable" type="button" class="executor-button" data-testid="edit-runtime" :disabled="editing" @click="$emit('edit', instance.instanceId)">
        {{ t("admin.executors.configure") }}
      </button>
    </header>

    <dl class="executor-summary">
      <div><dt>{{ t("admin.executors.isolation") }}</dt><dd>{{ instance.runtime?.isolationMode || t("admin.executors.unreported") }}</dd></div>
      <div><dt>{{ t("admin.executors.coreExecutions") }}</dt><dd :data-active-executions="instance.activeExecutions">{{ instance.activeExecutions }} / {{ instance.maxConcurrency }}</dd></div>
      <div><dt>{{ t("admin.executors.connectedAt") }}</dt><dd>{{ time(instance.connectedAt) }}</dd></div>
      <div><dt>{{ t("admin.executors.lastSeenAt") }}</dt><dd>{{ time(instance.lastSeenAt) }}</dd></div>
    </dl>

    <template v-if="instance.runtime">
      <div class="backend-scroll">
        <table class="backend-table">
          <thead><tr>
            <th>{{ t("admin.executors.backend") }}</th><th>{{ t("admin.executors.processModel") }}</th>
            <th>{{ t("admin.executors.processes") }}</th><th>{{ t("admin.executors.sessionsPerProcess") }}</th>
            <th>{{ t("admin.executors.activeSessions") }}</th><th>{{ t("admin.executors.capacity") }}</th>
          </tr></thead>
          <tbody><tr v-for="backend in instance.runtime.backends" :key="backend.backend" :data-backend="backend.backend">
            <td><strong>{{ backend.backend }}</strong><span class="backend-state" :class="{ degraded: ['degraded', 'failed', 'unhealthy'].includes(backend.state), unavailable: backend.state === 'unavailable' }">{{ nativePolicyPending(backend) ? t('admin.executors.applyingConfiguration') : stateLabel(backend.state) }}</span><span v-if="backend.errorCode && !nativePolicyPending(backend)" class="backend-error">{{ backend.errorCode }}</span></td>
            <td>{{ modeLabel(backend) }}</td>
            <td><span>{{ backend.readyProcesses }} / {{ backend.minProcesses }}</span><small>{{ t('admin.executors.readyTarget') }}</small><small>{{ backend.mode === 'dedicated' && backend.maxProcesses === 0 ? t('admin.executors.legacyUnlimitedProcesses') : t('admin.executors.processLimit', { n: backend.maxProcesses }) }}</small><small>{{ t("admin.executors.processBreakdown", { resident: backend.residentProcesses, starting: backend.startingProcesses, draining: backend.drainingProcesses }) }}</small></td>
            <td>{{ backend.sessionsPerProcess }}<small v-if="backend.maxActiveSessions > 0">{{ t("admin.executors.activeLimit", { n: backend.maxActiveSessions }) }}</small></td>
            <td :data-active-sessions="backend.activeSessions">{{ backend.activeSessions }}</td>
            <td :data-admission-capacity="backend.admissionCapacity" :data-target-capacity="backend.targetCapacity"><span>{{ backend.admissionCapacity }} / {{ backend.targetCapacity }}</span><small>{{ t("admin.executors.admissionTarget") }}</small><small v-if="backend.state === 'unavailable'">{{ t("admin.executors.unavailableHint") }}</small></td>
          </tr></tbody>
        </table>
      </div>
      <p v-if="!instance.runtime.backends.length" class="muted empty-backends">{{ t("admin.executors.noBackends") }}</p>
      <p v-if="instance.runtime.backends.some(backend => backend.mode === 'dedicated' && backend.maxProcesses > 0)" class="runtime-hint">{{ t("admin.executors.dedicatedCacheHint") }}</p>
      <footer class="executor-card__footer">
        <span>{{ t("admin.executors.revision", { n: instance.runtime.revision }) }}</span>
        <span v-if="!instance.runtime.configurable">{{ t("admin.executors.notConfigurable") }}</span>
      </footer>
      <div v-if="instance.runtime.backends.some(backend => backend.processes?.length)" class="process-details">
        <template v-for="backend in instance.runtime.backends" :key="backend.backend">
          <details v-if="backend.processes?.length">
            <summary>{{ backend.backend }} · {{ t("admin.executors.processDetails", { n: backend.processes.length }) }}</summary>
            <ul><li v-for="process in backend.processes" :key="`${process.slot}:${process.generation}`"><code>{{ process.slot }}</code><span>{{ stateLabel(process.state) }}</span><span>{{ t("admin.executors.processSessions", { n: process.activeSessions }) }}</span><span>{{ t("admin.executors.generation", { n: process.generation }) }}</span></li></ul>
          </details>
        </template>
      </div>
    </template>
    <p v-else class="legacy-hint">{{ t("admin.executors.legacyHint") }}</p>
  </article>
</template>

<style scoped>
.executor-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-xs); overflow: hidden; }
.executor-card__header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 20px 20px 12px; }
.executor-card__identity { min-width: 0; }
h3 { margin: 0 0 6px; font-size: 15px; color: var(--text-primary); overflow-wrap: anywhere; }
.instance-id { font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); overflow-wrap: anywhere; margin: 0 0 5px; }
.muted { color: var(--text-secondary); font-size: 12px; margin: 0; }
.online-badge { display: inline-block; font-size: 11px; color: var(--teal-600); background: var(--teal-50); padding: 3px 7px; border-radius: var(--r-sm); margin-left: 7px; vertical-align: middle; font-weight: 500; }
.executor-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; padding: 12px 20px 20px; margin: 0; }
.executor-summary dt { font-size: 11px; color: var(--text-tertiary); margin-bottom: 6px; }
.executor-summary dd { margin: 0; font-size: 12px; color: var(--text-primary); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.backend-scroll { overflow-x: auto; }
.backend-table { border-collapse: collapse; width: 100%; min-width: 760px; font-size: 12px; text-align: left; font-variant-numeric: tabular-nums; }
th { font-weight: 500; color: var(--text-secondary); background: var(--bg-subtle); padding: 10px 15px; white-space: nowrap; }
td { border-top: 1px solid var(--border); padding: 13px 15px; color: var(--text-primary); vertical-align: top; }
th:first-child, td:first-child { padding-left: 20px; }
th:last-child, td:last-child { padding-right: 20px; text-align: right; }
small { display: block; font-size: 10px; color: var(--text-tertiary); margin-top: 4px; white-space: nowrap; }
.backend-state { display: block; font-size: 11px; color: var(--teal-600); margin-top: 5px; }
.backend-state.degraded, .backend-error { color: var(--rose-500); }
.backend-state.unavailable { color: var(--text-tertiary); }
.backend-error { display: block; font-size: 10px; margin-top: 4px; max-width: 180px; overflow-wrap: anywhere; }
.executor-card__footer { display: flex; justify-content: space-between; gap: 12px; padding: 10px 20px; border-top: 1px solid var(--border); color: var(--text-tertiary); font-size: 11px; }
.legacy-hint, .empty-backends { padding: 16px 20px; border-top: 1px solid var(--border); color: var(--text-secondary); font-size: 12px; margin: 0; }
.runtime-hint { margin: 0; padding: 12px 20px; border-top: 1px solid var(--border); color: var(--text-secondary); font-size: 11px; line-height: 1.7; }
.process-details { border-top: 1px solid var(--border); padding: 4px 20px; }
details { font-size: 11px; color: var(--text-secondary); padding: 9px 0; }
summary { cursor: pointer; }
ul { list-style: none; padding: 0; margin: 10px 0 0; }
li { display: flex; gap: 16px; flex-wrap: wrap; padding: 5px 0; }
li code { min-width: 100px; overflow-wrap: anywhere; }
.executor-button { padding: 7px 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-secondary); font-size: 12px; white-space: nowrap; cursor: pointer; }
.executor-button:hover:not(:disabled) { color: var(--indigo-600); border-color: var(--indigo-400); }
.executor-button:disabled { opacity: .5; cursor: not-allowed; }
@media (max-width: 680px) { .executor-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
