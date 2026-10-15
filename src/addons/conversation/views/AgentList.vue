<script setup lang="ts">
/** All of my agents: every enabled definition (chat-ready), plus disabled ones I have used (collapsed). */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isInShell, useEmbeddedAuthorization } from "@/contracts/platform-runtime";
import { toast } from "@/composables/useToast";
import { listMyAgents, type MyAgent } from "../api/agent";
import {
  USER_AGENT_LIMIT, createUserAgent, deleteUserAgent, draftPatch, entryState, listMyDefinitions, listUserAgentModels, mergeOwned,
  setUserAgentActive, singleFlight, updateUserAgent, userAgentError, type Draft, type UserDefinition,
} from "../api/userAgent";
import AgentCard from "../components/AgentCard.vue";
import UserAgentWizard from "../components/UserAgentWizard.vue";
import { agentModel, groupAgents } from "../components/agentCard";

const { t } = useI18n();
const authorization = useEmbeddedAuthorization();
// Same capability that gates the admin console; regular users never see manage/import/edit.
const admin = computed(() => isInShell() && authorization.can("core:admin:read"));

const agents = ref<MyAgent[]>([]);
const loading = ref(true);
const failed = ref(false);
const query = ref("");
const applied = ref("");
const showInactive = ref(false);
const showHelp = ref(false);

let timer: ReturnType<typeof setTimeout> | undefined;
watch(query, (q) => { clearTimeout(timer); timer = setTimeout(() => { applied.value = q; }, 150); });

const groups = computed(() => groupAgents(agents.value, applied.value));
// Older Core omits config.model entirely; then "needs config" can't be told apart from "disabled".
const hasModelField = computed(() => agents.value.some((a) => a.config && "model" in a.config));
const searchable = computed(() => agents.value.length >= 6);
const searching = computed(() => !!applied.value.trim());
const noMatch = computed(() => searching.value && !groups.value.active.length && !groups.value.inactive.length);

// My own definitions: null = this core has no list route → create/manage hidden (fail closed).
const defs = ref<UserDefinition[] | null>(null);
const models = ref<string[]>([]);
const ownedIds = computed(() => new Set((defs.value ?? []).map((d) => d.id)));
const entry = computed(() => entryState(defs.value, models.value));
const wizard = ref<{ initial?: Draft & { id: number } } | null>(null);
const busy = ref(false);
const errors = ref<Record<string, string>>({});

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;
  try {
    const [mine, own, open] = await Promise.all([listMyAgents(), listMyDefinitions().catch(() => null), listUserAgentModels().catch(() => [])]);
    defs.value = own;
    models.value = open;
    agents.value = mergeOwned(mine, own);
  } catch {
    failed.value = true;
    toast.error(t("agents.loadFailed"));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

/** Mapped error as text (toast and template both render text, never HTML). */
function errorText(e: unknown): { field?: string; text: string } {
  const m = userAgentError(e);
  return "text" in m ? { text: m.text } : { field: m.field, text: t(m.key) };
}

function openCreate(): void {
  if (entry.value === "noModels") { toast.info(t("agents.mine.noModels")); return; }
  if (entry.value !== "ok") return;
  errors.value = {};
  wizard.value = {};
}
function openEdit(a: MyAgent): void {
  errors.value = {};
  wizard.value = { initial: { id: a.templateId, name: a.name, description: a.description ?? "", model: agentModel(a), prompt: "" } };
}

async function reveal(id: number): Promise<void> {
  if (agents.value.find((a) => a.templateId === id)?.disabled) showInactive.value = true;
  await nextTick();
  const card = document.querySelector<HTMLElement>(`[data-template-id="${id}"]`);
  card?.scrollIntoView({ block: "center" });
  card?.querySelector<HTMLElement>("a")?.focus();
}

const submit = singleFlight(async (draft: Draft) => {
  busy.value = true;
  errors.value = {};
  const initial = wizard.value?.initial;
  let id = initial?.id ?? 0;
  try {
    if (initial) {
      const patch = draftPatch(initial, draft);
      if (Object.keys(patch).length) await updateUserAgent(id, patch);
      toast.success(t("agents.mine.saved"));
    } else {
      id = (await createUserAgent(draft)).id;
      // The create route refuses isActive; "create and enable" is create + PATCH.
      try { await setUserAgentActive(id, true); toast.success(t("agents.mine.created")); }
      catch (e) { toast.error(errorText(e).text); }
    }
    wizard.value = null;
    await load();
    await reveal(id);
  } catch (e) {
    const m = errorText(e);
    errors.value = { [m.field ?? "form"]: m.text };
  } finally {
    busy.value = false;
  }
});

const act = singleFlight(async (run: () => Promise<void>, done: string) => {
  try { await run(); toast.success(t(done)); } catch (e) { toast.error(errorText(e).text); }
  await load();
});
const toggle = (a: MyAgent) => act(() => setUserAgentActive(a.templateId, a.disabled), a.disabled ? "agents.mine.enabledDone" : "agents.mine.disabledDone");
function remove(a: MyAgent): void {
  // Same native confirm as clearing memory (AgentInstance.vue).
  if (!window.confirm(t("agents.mine.confirmDelete", { name: a.name }))) return;
  void act(() => deleteUserAgent(a.templateId), "agents.mine.deleted");
}
</script>

<template>
  <div class="view active">
    <div class="agent-list" data-testid="agent-list">
      <header class="agent-list-head">
        <div>
          <p class="agent-list-eyebrow">{{ t("agents.eyebrow") }}</p>
          <h1>
            {{ t("agents.title") }}
            <span class="agent-list-help-wrap">
              <button type="button" class="agent-list-q" :aria-expanded="showHelp" :aria-label="t('agents.helpLabel')"
                data-testid="agent-list-help" @click="showHelp = !showHelp" @blur="showHelp = false">?</button>
              <span v-if="showHelp" class="agent-list-pop" role="tooltip">{{ t("agents.help") }}</span>
            </span>
          </h1>
          <p class="agent-list-hint">{{ t("agents.listHint") }}</p>
        </div>
        <div class="agent-list-tools">
          <input v-if="searchable" v-model="query" type="search" :placeholder="t('agents.searchPlaceholder')"
            :aria-label="t('agents.searchPlaceholder')" data-testid="agent-list-search">
          <router-link v-if="admin" to="/admin/agents" class="btn-ghost" data-testid="agent-list-admin">{{ t("agents.manage") }}</router-link>
          <template v-if="entry !== 'hidden'">
            <span class="agent-list-quota" data-testid="agent-quota">{{ t("agents.mine.used", { n: defs?.length ?? 0, max: USER_AGENT_LIMIT }) }}</span>
            <button type="button" class="btn-primary" data-testid="agent-create" :disabled="entry === 'full'"
              :title="entry === 'full' ? t('agents.mine.fullHint') : undefined" @click="openCreate">+ {{ t("agents.mine.create") }}</button>
          </template>
        </div>
      </header>

      <div v-if="loading" class="agent-grid" data-testid="agent-list-skeleton" aria-busy="true">
        <div v-for="i in 6" :key="i" class="agent-skel"><i /><b /><b /><b class="short" /></div>
      </div>

      <div v-else-if="failed" class="agent-list-error" role="alert" data-testid="agent-list-error">
        <span>{{ t("agents.loadError") }}</span>
        <button type="button" class="btn-ghost" data-testid="agent-list-retry" @click="load">{{ t("agents.retry") }}</button>
      </div>

      <template v-else>
        <div v-if="!groups.active.length && !searching" class="agent-list-empty" data-testid="agent-list-empty">
          <span class="agent-list-badge" aria-hidden="true">✦</span>
          <h2>{{ t("agents.emptyTitle") }}</h2>
          <template v-if="admin">
            <p>{{ t("agents.emptyAdmin") }}</p>
            <router-link to="/admin/agents" class="btn-primary">{{ t("agents.importRecommended") }}</router-link>
          </template>
          <p v-else>{{ t("agents.emptyUser") }}</p>
        </div>

        <p v-if="noMatch" class="agent-list-nomatch">
          {{ t("agents.noMatch", { q: applied.trim() }) }}
          <button type="button" class="btn-ghost" @click="query = ''">{{ t("agents.clearSearch") }}</button>
        </p>

        <section v-if="groups.active.length" data-testid="agent-list-active">
          <h2 class="agent-list-group">{{ t("agents.groupActive") }} <span>{{ groups.active.length }}</span></h2>
          <div class="agent-grid">
            <AgentCard v-for="(a, i) in groups.active" :key="a.templateId" :agent="a" :admin="admin" :has-model-field="hasModelField" :delay="i"
              :owned="ownedIds.has(a.templateId)" @edit="openEdit(a)" @toggle="toggle(a)" @remove="remove(a)" />
          </div>
          <div v-if="groups.active.length === 1 && !searching" class="agent-list-more">
            <span>{{ admin ? t("agents.emptyAdmin") : t("agents.moreUser") }}</span>
            <router-link v-if="admin" to="/admin/agents" class="btn-ghost">{{ t("agents.importRecommended") }}</router-link>
          </div>
        </section>

        <section v-if="groups.inactive.length" data-testid="agent-list-inactive">
          <h2 class="agent-list-group">
            {{ t("agents.groupInactive") }} <span>{{ groups.inactive.length }}</span>
            <button type="button" class="agent-list-toggle" :aria-expanded="showInactive" data-testid="agent-list-inactive-toggle"
              @click="showInactive = !showInactive">{{ showInactive ? t("agents.collapse") : t("agents.expand") }}</button>
          </h2>
          <div v-if="showInactive" class="agent-grid agent-grid-in">
            <AgentCard v-for="(a, i) in groups.inactive" :key="a.templateId" :agent="a" :admin="admin" :has-model-field="hasModelField" :delay="i"
              :owned="ownedIds.has(a.templateId)" @edit="openEdit(a)" @toggle="toggle(a)" @remove="remove(a)" />
          </div>
          <p v-else class="agent-list-names">{{ groups.inactive.map((a) => a.name).join(t("agents.nameSep")) }} — {{ t("agents.inactiveHint") }}</p>
        </section>
      </template>
    </div>
    <UserAgentWizard v-if="wizard" :models="models" :busy="busy" :errors="errors" :initial="wizard.initial"
      @submit="submit" @cancel="busy || (wizard = null)" />
  </div>
</template>

<style>
/* Non-scoped like AgentCard; agent-list-* / agent-grid / agent-skel are core-private. Tokens only. */
.agent-list { height: 100%; overflow-y: auto; max-width: 1200px; margin: 0 auto; width: 100%; padding: 32px 32px 48px; display: flex; flex-direction: column; gap: 20px; }
.agent-list-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
.agent-list-eyebrow { margin: 0 0 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--teal-600); }
.agent-list h1 { margin: 0; font-size: 26px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
.agent-list-hint { margin: 6px 0 0; font-size: 13px; color: var(--text-tertiary); }
.agent-list-help-wrap { position: relative; display: inline-flex; }
.agent-list-q { width: 22px; height: 22px; border-radius: var(--r-full); border: 1px solid var(--border); background: var(--bg-card); color: var(--text-tertiary); font-size: 12px; cursor: pointer; }
.agent-list-pop { position: absolute; top: 30px; left: -8px; z-index: 5; width: 280px; padding: 10px 12px; border-radius: var(--r-md); background: var(--bg-card); border: 1px solid var(--border); box-shadow: var(--shadow-md); font-size: 12.5px; font-weight: 400; line-height: 1.6; color: var(--text-secondary); animation: fade-in 0.2s var(--ease) both; }
.agent-list-tools { display: flex; gap: 8px; align-items: center; }
.agent-list-tools input { height: 36px; width: 240px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-primary); font-size: 13px; }
.agent-list-tools > button { height: 36px; padding: 0 14px; font-size: 13px; cursor: pointer; }
.agent-list-tools > button:disabled { opacity: 0.55; cursor: not-allowed; }
.agent-list-quota { font-size: 12.5px; color: var(--text-tertiary); }
.agent-list-tools input:focus { outline: none; border-color: var(--teal-500); }
.agent-list-tools a, .agent-list-more a, .agent-list-empty a { height: 36px; display: inline-flex; align-items: center; padding: 0 14px; font-size: 13px; text-decoration: none; }
.agent-list-group { margin: 0 0 12px; font-size: 13px; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 8px; }
.agent-list-group > span { color: var(--text-tertiary); font-weight: 500; }
.agent-list-toggle { margin-left: auto; border: 0; background: none; color: var(--teal-600); font-size: 12.5px; cursor: pointer; }
.agent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 16px; }
.agent-grid-in { animation: fade-in-up 0.4s var(--ease-out) both; }
.agent-list-names { margin: 0; padding: 10px 14px; border: 1px dashed var(--border); border-radius: var(--r-lg); font-size: 12.5px; color: var(--text-tertiary); }
.agent-list-more { margin-top: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-radius: var(--r-lg); background: var(--grad-brand-soft); font-size: 13px; color: var(--text-secondary); }
.agent-list-empty { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 64px 16px; text-align: center; color: var(--text-tertiary); font-size: 13px; }
.agent-list-empty h2 { margin: 0; font-size: 20px; font-weight: 700; color: var(--text-primary); }
.agent-list-empty p { margin: 0; }
.agent-list-badge { width: 64px; height: 64px; border-radius: var(--r-lg); display: grid; place-items: center; background: var(--grad-brand); color: #fff; font-size: 26px; box-shadow: var(--shadow-glow-teal); animation: float 3s ease-in-out infinite; }
.agent-list-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: var(--r-lg); background: #fff1f2; border: 1px solid #fecdd3; color: #be123c; font-size: 13px; }
.agent-list-nomatch { margin: 0; display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-tertiary); }
.agent-skel { height: 196px; border-radius: var(--r-lg); border: 1px solid var(--border); background: var(--bg-card); overflow: hidden; display: flex; flex-direction: column; gap: 10px; }
.agent-skel i, .agent-skel b { display: block; background: linear-gradient(90deg, var(--slate-100) 25%, #f8fafc 50%, var(--slate-100) 75%); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
.agent-skel i { height: 64px; }
.agent-skel b { height: 12px; margin: 0 16px; border-radius: 6px; }
.agent-skel b.short { width: 40%; }
@media (max-width: 1023.98px) { .agent-list { padding: 16px 16px 88px; } }
@media (max-width: 640px) {
  .agent-list h1 { font-size: 22px; }
  .agent-list-tools { width: 100%; }
  .agent-list-tools input { flex: 1; width: auto; font-size: 16px; }
  .agent-grid { grid-template-columns: 1fr; gap: 10px; }
  .agent-skel { height: 72px; }
}
@media (prefers-reduced-motion: reduce) {
  .agent-skel i, .agent-skel b, .agent-list-badge, .agent-grid-in, .agent-list-pop { animation: none; }
}
</style>
