<script setup lang="ts">
/** All of my agents: every enabled definition, plus disabled ones I have used. */
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "@/composables/useToast";
import { listMyAgents, type MyAgent } from "../api/agent";

const { t } = useI18n();
const agents = ref<MyAgent[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    agents.value = await listMyAgents();
  } catch {
    toast.error(t("agents.loadFailed"));
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="view active">
    <div class="agent-list" data-testid="agent-list">
      <h1>{{ t("agents.title") }}</h1>
      <p class="hint">{{ t("agents.listHint") }}</p>
      <p v-if="loading" class="hint">{{ t("common.loading") }}</p>
      <p v-else-if="!agents.length" class="hint">{{ t("agents.none") }}</p>
      <router-link v-for="a in agents" :key="a.templateId" :to="`/agents/${a.templateId}`" class="row" :class="{ off: a.disabled }" data-testid="agent-list-row">
        <span class="avatar" aria-hidden="true">{{ a.name.slice(0, 1) }}</span>
        <span class="main">
          <span class="name">{{ a.name }}<span v-if="a.disabled" class="tag">{{ t("agents.disabled") }}</span></span>
          <span class="desc">{{ a.description || t("agents.sessionsCount", { n: a.sessionCount }) }}</span>
        </span>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.agent-list { height: 100%; overflow-y: auto; max-width: 880px; margin: 0 auto; width: 100%; padding: 32px 24px 48px; display: flex; flex-direction: column; gap: 10px; }
h1 { font-size: 20px; font-weight: 700; color: var(--text-primary); }
.hint { font-size: 13px; color: var(--text-tertiary); }
.row { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 10px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); text-decoration: none; }
.row:hover { border-color: var(--border-strong); }
.row.off { opacity: 0.6; }
.avatar { width: 36px; height: 36px; border-radius: var(--r-md); background: var(--grad-brand-soft); color: var(--teal-600); display: grid; place-items: center; font-weight: 700; flex: none; }
.main { display: flex; flex-direction: column; min-width: 0; }
.name { font-size: 14px; font-weight: 600; color: var(--text-primary); display: flex; gap: 8px; align-items: center; }
.desc { font-size: 12.5px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 999px; background: var(--slate-100); color: var(--text-tertiary); }
@media (max-width: 1023.98px) { .agent-list { padding: 16px; } }
</style>
