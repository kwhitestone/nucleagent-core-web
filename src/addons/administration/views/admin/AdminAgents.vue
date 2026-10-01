<script setup lang="ts">
/**
 * Agent definitions. Every user owns every enabled definition; their personal
 * instance appears on first use. Disable is one row and takes effect for all
 * instances: the running turn finishes, later turns are refused. The usage view
 * is metadata only — who, first use, how many sessions — never content.
 */
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/contracts/platform-runtime";
import { toast } from "@/composables/useToast";
import {
  createAgentDefinition,
  listAgentDefinitions,
  listAgentInstances,
  updateAgentDefinition,
  type AgentDefinition,
  type AgentDefinitionInput,
  type AgentInstanceMeta,
} from "../../api/agent";

const { t } = useI18n();
const loading = ref(false);
const saving = ref(false);
const agents = ref<AgentDefinition[]>([]);

const editingId = ref<number | null | undefined>(undefined); // null = create, undefined = closed
const formOpen = computed(() => editingId.value !== undefined);
const isCreate = computed(() => editingId.value === null);
const form = reactive({
  name: "", slug: "", description: "", prompt: "", memory: true,
  executionBackend: "", providerId: "", model: "", authAgentUserId: "",
});

const usageOf = ref<AgentDefinition | null>(null);
const usage = ref<AgentInstanceMeta[]>([]);
const usageTotal = ref(0);

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : t("common.operationFailed");
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    agents.value = await listAgentDefinitions();
  } catch (error) {
    toast.error(errorText(error));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function openCreate(): void {
  Object.assign(form, { name: "", slug: "", description: "", prompt: "", memory: true,
    executionBackend: "", providerId: "", model: "", authAgentUserId: "" });
  editingId.value = null;
}

function openEdit(agent: AgentDefinition): void {
  const cfg = agent.config ?? {};
  Object.assign(form, {
    name: agent.name, slug: agent.slug, description: cfg.description ?? "", prompt: cfg.prompt ?? "",
    memory: cfg.memory !== false, executionBackend: cfg.defaults?.executionBackend ?? "",
    providerId: cfg.defaults?.providerId ? String(cfg.defaults.providerId) : "", model: cfg.defaults?.model ?? "",
    authAgentUserId: agent.authAgentUserId ? String(agent.authAgentUserId) : "",
  });
  editingId.value = agent.id;
}

function body(): AgentDefinitionInput {
  const providerId = Number(form.providerId) || undefined;
  return {
    name: form.name.trim(), slug: form.slug.trim(), description: form.description.trim(),
    prompt: form.prompt, memory: form.memory,
    defaults: { executionBackend: form.executionBackend.trim(), providerId, model: form.model.trim() },
    authAgentUserId: Number(form.authAgentUserId) || 0,
  };
}

async function submit(): Promise<void> {
  if (saving.value) return;
  if (!form.name.trim() || !form.slug.trim()) {
    toast.error(t("agents.admin.errNameSlug"));
    return;
  }
  saving.value = true;
  try {
    if (isCreate.value) await createAgentDefinition(body());
    else await updateAgentDefinition(editingId.value as number, body());
    toast.success(t("agents.admin.saved"));
    editingId.value = undefined;
    await load();
  } catch (error) {
    toast.error(errorText(error));
  } finally {
    saving.value = false;
  }
}

async function toggleActive(agent: AgentDefinition): Promise<void> {
  if (agent.isActive && !window.confirm(t("agents.admin.confirmDisable", { name: agent.name }))) return;
  try {
    await updateAgentDefinition(agent.id, { isActive: !agent.isActive });
    await load();
  } catch (error) {
    toast.error(errorText(error));
  }
}

async function openUsage(agent: AgentDefinition, offset = 0): Promise<void> {
  try {
    const page = await listAgentInstances(agent.id, offset);
    usageOf.value = agent;
    usage.value = page.items;
    usageTotal.value = page.total;
  } catch (error) {
    toast.error(errorText(error));
  }
}

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}
</script>

<template>
  <div class="agents-view">
    <div class="list-header">
      <span class="count-hint">{{ t("agents.admin.count", { n: agents.length }) }}</span>
      <button class="btn-primary" type="button" data-testid="agent-create" @click="openCreate">{{ t("agents.admin.create") }}</button>
    </div>
    <p class="section-hint">{{ t("agents.admin.hint") }}</p>

    <p v-if="loading" class="empty-hint">{{ t("common.loading") }}</p>
    <p v-else-if="!agents.length" class="empty-hint">{{ t("agents.admin.empty") }}</p>

    <div v-else class="tool-list">
      <div v-for="agent in agents" :key="agent.id" class="tool-card" :class="{ inactive: !agent.isActive }" data-testid="agent-row">
        <div class="tool-main">
          <div class="tool-title-row">
            <span class="tool-name">{{ agent.name }}</span>
            <span class="tool-slug">{{ agent.slug }}</span>
            <span class="badge" :class="agent.isActive ? 'on' : 'off'">
              {{ agent.isActive ? t("common.enabled") : t("common.disabled") }}
            </span>
            <span v-if="agent.authAgentUserId" class="type-chip">IM UID {{ agent.authAgentUserId }}</span>
          </div>
          <div v-if="agent.config?.description" class="tool-desc">{{ agent.config.description }}</div>
          <div class="tool-url">{{ t("agents.admin.stats", { instances: agent.instanceCount, sessions: agent.sessions7d }) }}</div>
        </div>
        <div class="tool-actions">
          <button class="btn-ghost" type="button" @click="openUsage(agent)">{{ t("agents.admin.viewInstances") }}</button>
          <button class="btn-ghost" type="button" @click="openEdit(agent)">{{ t("common.edit") }}</button>
          <button class="btn-ghost" :class="{ danger: agent.isActive }" type="button" data-testid="agent-toggle" @click="toggleActive(agent)">
            {{ agent.isActive ? t("common.disable") : t("common.enable") }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="formOpen" class="modal-mask" @click.self="editingId = undefined">
      <div class="modal-card" role="dialog" :aria-label="isCreate ? t('agents.admin.createTitle') : t('agents.admin.editTitle')">
        <div class="modal-header">
          <h2>{{ isCreate ? t("agents.admin.createTitle") : t("agents.admin.editTitle") }}</h2>
          <button class="modal-close" type="button" :aria-label="t('common.close')" @click="editingId = undefined">×</button>
        </div>
        <div class="modal-body">
          <label class="field"><span class="field-label">{{ t("agents.admin.fieldName") }} *</span>
            <input v-model="form.name" type="text" maxlength="128" data-testid="agent-name" /></label>
          <label class="field"><span class="field-label">Slug *</span>
            <input v-model="form.slug" type="text" maxlength="64" :disabled="!isCreate" placeholder="hr-assistant" data-testid="agent-slug" /></label>
          <label class="field"><span class="field-label">{{ t("agents.admin.fieldDescription") }}</span>
            <input v-model="form.description" type="text" maxlength="200" /></label>
          <label class="field"><span class="field-label">{{ t("agents.admin.fieldPrompt") }}</span>
            <textarea v-model="form.prompt" rows="8" maxlength="4000" data-testid="agent-prompt" />
            <span class="section-hint">{{ t("agents.personaNewSessions") }}</span></label>
          <div class="field-row">
            <label class="field"><span class="field-label">{{ t("agents.admin.fieldBackend") }}</span>
              <input v-model="form.executionBackend" type="text" placeholder="hermes" /></label>
            <label class="field"><span class="field-label">{{ t("agents.admin.fieldProvider") }}</span>
              <input v-model="form.providerId" type="text" inputmode="numeric" /></label>
            <label class="field"><span class="field-label">{{ t("agents.admin.fieldModel") }}</span>
              <input v-model="form.model" type="text" /></label>
          </div>
          <label class="field"><span class="field-label">{{ t("agents.admin.fieldIM") }}</span>
            <input v-model="form.authAgentUserId" type="text" inputmode="numeric" :placeholder="t('agents.admin.phIM')" /></label>
          <label class="switch-row"><input v-model="form.memory" type="checkbox" class="switch" />{{ t("agents.admin.fieldMemory") }}</label>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" type="button" @click="editingId = undefined">{{ t("common.cancel") }}</button>
          <button class="btn-primary" type="button" :disabled="saving" data-testid="agent-save" @click="submit">{{ t("common.save") }}</button>
        </div>
      </div>
    </div>

    <div v-if="usageOf" class="modal-mask" @click.self="usageOf = null">
      <div class="modal-card" role="dialog" :aria-label="t('agents.admin.instancesTitle', { name: usageOf.name })">
        <div class="modal-header">
          <h2>{{ t("agents.admin.instancesTitle", { name: usageOf.name }) }}</h2>
          <button class="modal-close" type="button" :aria-label="t('common.close')" @click="usageOf = null">×</button>
        </div>
        <div class="modal-body">
          <p class="section-hint">{{ t("agents.admin.metadataOnly") }}</p>
          <p v-if="!usage.length" class="empty-hint">{{ t("agents.admin.noInstances") }}</p>
          <table v-else class="usage-table" data-testid="agent-usage">
            <thead><tr><th>{{ t("agents.admin.colUser") }}</th><th>{{ t("agents.admin.colFirst") }}</th><th>{{ t("agents.admin.colSessions") }}</th><th>{{ t("agents.admin.colLast") }}</th></tr></thead>
            <tbody>
              <tr v-for="row in usage" :key="row.instanceId">
                <td>{{ row.nickName || "—" }} <span class="tool-slug">UID {{ row.userId }}</span></td>
                <td>{{ when(row.firstUsedAt) }}</td>
                <td>{{ row.sessionCount }}</td>
                <td>{{ when(row.lastSessionAt) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="usageTotal > usage.length" class="count-hint">{{ t("agents.admin.total", { n: usageTotal }) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agents-view { display: flex; flex-direction: column; gap: 14px; }
.list-header { display: flex; align-items: center; justify-content: space-between; }
.count-hint { font-size: 12.5px; color: var(--text-tertiary); }
.section-hint { font-size: 12px; color: var(--text-tertiary); }
.empty-hint { color: var(--text-tertiary); text-align: center; padding: 32px 0; font-size: 13px; }
.tool-list { display: flex; flex-direction: column; gap: 10px; }
.tool-card {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 16px;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-xs);
}
.tool-card.inactive { opacity: 0.6; }
.tool-main { min-width: 0; flex: 1; }
.tool-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tool-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.tool-slug { font-size: 11.5px; color: var(--text-tertiary); font-family: var(--font-mono); }
.tool-desc { font-size: 12.5px; color: var(--text-secondary); margin-top: 3px; }
.tool-url { font-size: 12px; color: var(--text-tertiary); margin-top: 3px; }
.tool-actions { display: flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; }
.type-chip { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; background: var(--bg-hover); color: var(--text-secondary); font-family: var(--font-mono); }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
.badge.on { background: #d1fae5; color: #047857; }
.badge.off { background: var(--slate-100); color: var(--text-tertiary); }
.modal-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(3px); z-index: 50;
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.modal-card {
  width: min(680px, 94vw); max-height: 86vh; overflow-y: auto; background: var(--bg-card);
  border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-lg);
}
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.modal-header h2 { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.modal-close { width: 30px; height: 30px; border: none; border-radius: var(--r-md); background: transparent; font-size: 18px; color: var(--text-tertiary); cursor: pointer; }
.modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); }
.field-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.field-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 5px; }
.field input, .field textarea {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--bg-card); color: var(--text-primary); font-size: 13px;
}
.field input:focus, .field textarea:focus { outline: none; border-color: var(--teal-500); }
.field input:disabled { background: var(--bg-subtle); color: var(--text-tertiary); }
.switch-row { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
.switch { accent-color: var(--teal-500); }
.usage-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.usage-table th, .usage-table td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); }
.usage-table th { color: var(--text-tertiary); font-weight: 600; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: none; border-radius: var(--r-md);
  background: var(--grad-teal-indigo); color: white; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--bg-card); color: var(--text-secondary); font-size: 12.5px; cursor: pointer; white-space: nowrap;
}
.btn-ghost:hover { border-color: var(--border-strong); color: var(--text-primary); }
.btn-ghost.danger:hover { border-color: var(--rose-400); color: var(--rose-500); }
@media (max-width: 759.98px) { .field-row { grid-template-columns: 1fr; } }
</style>
