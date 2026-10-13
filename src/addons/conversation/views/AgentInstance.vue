<script setup lang="ts">
/**
 * My agent: one definition seen through my personal instance. Effective sources, memory
 * (view / edit / clear), my sessions with it (each opens the normal /c/:id
 * replay), and a box that starts a new session in this instance.
 */
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, isInShell, useEmbeddedAuthorization } from "@/contracts/platform-runtime";
import { toast } from "@/composables/useToast";
import { getMyAgent, updateAgentMemory, type MyAgent } from "../api/agent";
import { listConversations } from "../api/conversation";
import type { Conversation } from "../api/types";
import { useConversationStore } from "../store/conversation";
import AgentEffective from "../../administration/agents/definition/AgentEffective.vue";
import { createEffectiveApi } from "../../administration/agents/definition/effective";
import { definitionTransport } from "../../administration/api/agent";

const props = defineProps<{ templateId: string }>();
const { t, locale } = useI18n();
const router = useRouter();
const store = useConversationStore();
const authorization = useEmbeddedAuthorization();
// Admins jump to the definition editor (/admin/agents?edit=id); others never see the link.
const canEditDefinition = computed(() => isInShell() && authorization.can("core:admin:write"));

const agent = ref<MyAgent | null>(null);
const sessions = ref<Conversation[]>([]);
const loading = ref(true);
const missing = ref(false);
const input = ref("");
const inputEl = ref<HTMLTextAreaElement | null>(null);
const submitting = ref(false);
const editingMemory = ref(false);
const memoryDraft = ref("");
const savingMemory = ref(false);

const effective = createEffectiveApi(definitionTransport);
const selectedSession = ref<number | null>(null);
const memory = computed(() => (agent.value?.memory ?? "").trim());

async function load(): Promise<void> {
  loading.value = true;
  missing.value = false;
  selectedSession.value = null;
  try {
    agent.value = await getMyAgent(Number(props.templateId));
    missing.value = !agent.value;
    sessions.value = agent.value?.instanceId
      ? (await listConversations({ agentId: agent.value.instanceId, limit: 50 })).data
      : [];
  } catch (error) {
    missing.value = true;
    if (!(error instanceof ApiError && error.status === 404)) toast.error(t("agents.loadFailed"));
  } finally {
    loading.value = false;
  }
  // Card "start chat" lands here: put the cursor in the new-session box (absent when disabled/deleted).
  await nextTick();
  inputEl.value?.focus({ preventScroll: true });
}
watch(() => props.templateId, load, { immediate: true });

async function startSession(): Promise<void> {
  const text = input.value.trim();
  if (!text || submitting.value || !agent.value || agent.value.disabled) return;
  submitting.value = true;
  try {
    const created = await store.create({ mode: "a2a_agent", input: text, agentTemplateId: agent.value.templateId });
    input.value = "";
    await router.push(`/c/${created.id}`);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("home.createFailed"));
  } finally {
    submitting.value = false;
  }
}

function editMemory(): void {
  memoryDraft.value = memory.value;
  editingMemory.value = true;
}

async function saveMemory(value: string): Promise<void> {
  const instanceId = agent.value?.instanceId;
  if (!instanceId || savingMemory.value) return;
  if ([...value].length > 2000) {
    toast.error(t("agents.memoryTooLong"));
    return;
  }
  savingMemory.value = true;
  try {
    await updateAgentMemory(instanceId, value);
    if (agent.value) agent.value.memory = value.trim() || null;
    editingMemory.value = false;
    toast.success(value.trim() ? t("agents.memorySaved") : t("agents.memoryCleared"));
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  } finally {
    savingMemory.value = false;
  }
}

function clearMemory(): void {
  if (window.confirm(t("agents.confirmClear"))) void saveMemory("");
}

function source(c: Conversation): string {
  const type = (c.state as { imChannelType?: number } | undefined)?.imChannelType;
  return type === 2 ? t("agents.sourceGroup") : type === 1 ? t("agents.sourceDM") : t("agents.sourceWeb");
}
</script>

<template>
  <div class="view active">
    <div class="agent-view" data-testid="agent-instance">
      <p v-if="loading" class="empty-hint">{{ t("common.loading") }}</p>
      <p v-else-if="missing || !agent" class="empty-hint">{{ t("agents.notFound") }}</p>
      <template v-else>
        <header class="agent-head">
          <div class="agent-avatar" aria-hidden="true">{{ agent.name.slice(0, 1) }}</div>
          <div class="agent-title">
            <h1>{{ agent.name }}
              <span v-if="agent.deleted" class="tag off" data-testid="agent-deleted-tag">{{ t("agents.deleted") }}</span>
              <span v-else-if="agent.disabled" class="tag off">{{ t("agents.disabled") }}</span></h1>
            <p v-if="agent.description">{{ agent.description }}</p>
          </div>
          <router-link v-if="canEditDefinition && !agent.deleted" class="btn-ghost" :to="`/admin/agents?edit=${agent.templateId}`"
            data-testid="agent-admin-edit">{{ t("agents.editAsAdmin") }}</router-link>
        </header>

        <p v-if="agent.deleted" class="notice" role="status" data-testid="agent-deleted-banner">{{ t("agents.deletedHint") }}</p>
        <p v-else-if="agent.disabled" class="notice" role="status">{{ t("agents.disabledHint") }}</p>
        <form v-else class="agent-compose" @submit.prevent="startSession">
          <textarea ref="inputEl" v-model="input" rows="3" :placeholder="t('agents.newSessionPlaceholder', { name: agent.name })"
            data-testid="agent-new-input" @keydown.enter.exact.prevent="startSession" />
          <button class="btn-primary" type="submit" :disabled="!input.trim() || submitting" data-testid="agent-new-session">
            {{ t("agents.newSession") }}
          </button>
        </form>

        <template v-if="agent.instanceId">
          <label class="effective-target">{{ locale.startsWith('zh') ? '版本范围' : 'Version scope' }}
            <select v-model="selectedSession">
              <option :value="null">{{ locale.startsWith('zh') ? '个人实例' : 'My instance' }}</option>
              <option v-for="c in sessions" :key="c.id" :value="c.id">{{ c.title || `#${c.id}` }}</option>
            </select>
          </label>
          <AgentEffective :api="effective" :kind="selectedSession ? 'conversation' : 'instance'" :id="selectedSession || agent.instanceId" />
        </template>

        <section class="card" data-testid="agent-memory">
          <div class="card-head">
            <h2>{{ t("agents.memory") }}</h2>
            <div v-if="agent.instanceId && !editingMemory" class="actions">
              <button class="btn-ghost" type="button" data-testid="memory-edit" @click="editMemory">{{ t("common.edit") }}</button>
              <button v-if="memory" class="btn-ghost danger" type="button" data-testid="memory-clear" @click="clearMemory">{{ t("agents.clear") }}</button>
            </div>
          </div>
          <template v-if="editingMemory">
            <textarea v-model="memoryDraft" rows="8" maxlength="2000" data-testid="memory-input" />
            <div class="actions end">
              <span class="hint">{{ [...memoryDraft].length }}/2000</span>
              <button class="btn-ghost" type="button" @click="editingMemory = false">{{ t("common.cancel") }}</button>
              <button class="btn-primary" type="button" :disabled="savingMemory" data-testid="memory-save" @click="saveMemory(memoryDraft)">{{ t("common.save") }}</button>
            </div>
          </template>
          <p v-else-if="memory" class="pre" data-testid="memory-text">{{ memory }}</p>
          <p v-else class="muted">{{ t("agents.noMemory") }}</p>
          <p class="hint">{{ t("agents.memoryHint") }}</p>
        </section>

        <section class="card">
          <h2>{{ t("agents.sessions", { n: sessions.length }) }}</h2>
          <p v-if="!sessions.length" class="muted">{{ t("agents.noSessions") }}</p>
          <ul v-else class="sessions">
            <li v-for="c in sessions" :key="c.id">
              <router-link :to="`/c/${c.id}`" class="session" data-testid="agent-session">
                <span class="session-title">{{ c.title || `#${c.id}` }}</span>
                <span class="session-meta">{{ source(c) }} · {{ t(`broadcast.status.${c.status}`) }} · {{ new Date(c.createdAt).toLocaleString() }}</span>
              </router-link>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.agent-view { height: 100%; overflow-y: auto; max-width: 880px; margin: 0 auto; width: 100%; padding: 32px 24px 48px; display: flex; flex-direction: column; gap: 16px; }
.effective-target { display: grid; gap: 8px; font-size: 13px; }
.effective-target select { width: 100%; min-height: 44px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border); border-radius: 4px; padding: 8px; }
.agent-head { display: flex; align-items: center; gap: 14px; }
.agent-avatar { width: 48px; height: 48px; border-radius: var(--r-lg); background: var(--grad-brand-soft); color: var(--teal-600); display: grid; place-items: center; font-weight: 700; font-size: 20px; flex: none; }
.agent-title h1 { font-size: 20px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
.agent-title p { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
.tag.off { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: var(--slate-100); color: var(--text-tertiary); }
.notice { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-subtle); color: var(--text-secondary); font-size: 13px; }
.agent-compose { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.agent-compose textarea, .card textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-primary); font-size: 14px; resize: vertical; }
.agent-compose textarea:focus, .card textarea:focus { outline: none; border-color: var(--teal-500); }
.card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 16px 18px; box-shadow: var(--shadow-xs); display: flex; flex-direction: column; gap: 8px; }
.card h2 { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.actions { display: flex; gap: 6px; align-items: center; }
.actions.end { justify-content: flex-end; }
.pre { white-space: pre-wrap; font-size: 13px; color: var(--text-primary); line-height: 1.6; }
.muted { font-size: 13px; color: var(--text-tertiary); }
.hint { font-size: 12px; color: var(--text-tertiary); }
.empty-hint { color: var(--text-tertiary); text-align: center; padding: 48px 0; font-size: 13px; }
.sessions { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
.session { display: flex; flex-direction: column; gap: 2px; padding: 9px 4px; border-bottom: 1px solid var(--border); text-decoration: none; }
.session:hover .session-title { color: var(--teal-600); }
.session-title { font-size: 13.5px; color: var(--text-primary); font-weight: 500; }
.session-meta { font-size: 12px; color: var(--text-tertiary); }
.btn-primary { padding: 8px 16px; border: none; border-radius: var(--r-md); background: var(--grad-teal-indigo); color: white; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost { padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-secondary); font-size: 12.5px; cursor: pointer; }
.btn-ghost.danger:hover { border-color: var(--rose-400); color: var(--rose-500); }
@media (max-width: 1023.98px) {
  .agent-view { padding: 16px 16px 32px; }
  .btn-primary, .btn-ghost { min-height: 44px; }
  .agent-compose textarea, .card textarea { font-size: 16px; }
}
</style>
