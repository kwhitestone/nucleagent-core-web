<script setup lang="ts">
/** One "my agent" card: cover + avatar (uploaded image, else gradient + initial), description, meta, actions. */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { MyAgent } from "../api/agent";
import { relativeTime } from "../composables/taskDesk";
import { agentModel, agentStatus, avatarGradient } from "./agentCard";

const props = defineProps<{ agent: MyAgent; admin: boolean; hasModelField: boolean; delay: number }>();
const { t, locale } = useI18n();
const avatarOk = ref(true);
watch(() => props.agent.config?.avatar, () => { avatarOk.value = true; });
const avatar = computed(() => (avatarOk.value ? props.agent.config?.avatar || "" : ""));
const model = computed(() => agentModel(props.agent));
const status = computed(() => agentStatus(props.agent, props.hasModelField));
const used = computed(() => props.agent.sessionCount > 0
  ? t("agents.usage", { n: props.agent.sessionCount, when: props.agent.lastSessionAt ? relativeTime(props.agent.lastSessionAt, Date.now(), locale.value) : "" })
  : t("agents.neverUsed"));
const to = computed(() => `/agents/${props.agent.templateId}`);
</script>

<template>
  <article class="agent-card" :class="{ off: agent.disabled }" :style="{ animationDelay: `${Math.min(delay, 9) * 0.05}s` }"
    data-testid="agent-card" :data-template-id="agent.templateId">
    <router-link :to="to" class="agent-card-hit" :aria-label="agent.name" />
    <div class="agent-card-cover" :style="{ background: avatarGradient(agent.templateId) }" />
    <span class="agent-card-av" :style="{ background: avatarGradient(agent.templateId) }" aria-hidden="true">
      <img v-if="avatar" :src="avatar" alt="" @error="avatarOk = false">
      <template v-if="!avatar">{{ [...(agent.name.trim() || "?")][0] }}</template>
    </span>
    <div class="agent-card-body">
      <div class="agent-card-name">
        <span>{{ agent.name }}</span>
        <span v-if="status === 'unconfigured'" class="badge cfg" data-testid="agent-badge-unconfigured">{{ t("agents.unconfigured") }}</span>
        <span v-else-if="status === 'disabled'" class="badge off" data-testid="agent-badge-disabled">{{ t("agents.disabled") }}</span>
      </div>
      <p class="agent-card-desc" :class="{ fb: !agent.description }">
        {{ agent.description || (model ? t("agents.basedOn", { model }) : t("agents.noDescription")) }}
      </p>
      <div class="agent-card-meta">
        <span v-if="model" class="chip" data-testid="agent-model">{{ model }}</span>
        <span>{{ used }}</span>
      </div>
      <div class="agent-card-act">
        <router-link :to="to" class="btn-primary" data-testid="agent-card-start">{{ agent.disabled ? t("agents.history") : t("agents.start") }}</router-link>
        <router-link v-if="admin" :to="`/admin/agents?edit=${agent.templateId}`" class="btn-ghost" data-testid="agent-card-edit">
          {{ status === "unconfigured" ? t("agents.configure") : t("agents.edit") }}
        </router-link>
      </div>
    </div>
    <span class="agent-card-go" aria-hidden="true">→</span>
  </article>
</template>

<style>
/* Non-scoped like the other core views (micro-app disable-scopecss); agent-card-* is core-private. Tokens only. */
.agent-card { position: relative; display: flex; flex-direction: column; background: rgba(255, 255, 255, 0.72); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; transition: all 0.3s var(--ease); animation: fade-in-up 0.4s var(--ease-out) both; }
.agent-card:hover { border-color: var(--teal-300); box-shadow: var(--shadow-md); transform: translateY(-3px) scale(1.02); }
.agent-card:hover .agent-card-av { transform: scale(1.15) rotate(-5deg); }
.agent-card-hit { position: absolute; inset: 0; z-index: 0; }
.agent-card-hit:focus-visible { outline: 2px solid var(--teal-500); outline-offset: -2px; border-radius: inherit; }
.agent-card-cover { height: 64px; }
.agent-card-av { position: relative; z-index: 1; pointer-events: none; width: 48px; height: 48px; border-radius: var(--r-lg); margin: -24px 0 0 16px; border: 3px solid #fff; display: grid; place-items: center; overflow: hidden; color: #fff; font-size: 20px; font-weight: 600; box-shadow: var(--shadow-sm); transition: transform 0.3s var(--ease-spring); flex: none; }
.agent-card-av img { width: 100%; height: 100%; object-fit: cover; }
.agent-card-body { position: relative; z-index: 1; pointer-events: none; padding: 10px 16px 14px; display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.agent-card-name { font-size: 15px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px; min-width: 0; }
.agent-card-name > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-card-desc { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 39px; }
.agent-card-desc.fb { color: var(--text-tertiary); }
.agent-card-meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 11.5px; color: var(--text-tertiary); }
.agent-card .chip { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--slate-100); color: var(--text-secondary); font-family: var(--font-mono); }
.agent-card .badge { flex: none; font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
.agent-card .badge.off { background: var(--slate-100); color: var(--text-tertiary); }
.agent-card .badge.cfg { background: #fef3c7; color: #b45309; }
.agent-card-act { display: flex; gap: 8px; margin-top: 6px; pointer-events: auto; }
.agent-card-act a { height: 32px; font-size: 12.5px; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; padding: 0 14px; }
.agent-card-act .btn-primary { flex: 1; }
.agent-card.off { background: rgba(255, 255, 255, 0.55); }
.agent-card.off .agent-card-cover { filter: saturate(0.25); opacity: 0.6; }
.agent-card.off .agent-card-av { filter: saturate(0.3); }
.agent-card-go { display: none; margin-left: auto; width: 32px; height: 32px; border-radius: var(--r-full); background: var(--grad-brand); color: #fff; place-items: center; font-size: 14px; flex: none; box-shadow: var(--shadow-glow-teal); position: relative; z-index: 1; pointer-events: none; }
@media (max-width: 640px) {
  .agent-card { flex-direction: row; align-items: center; padding: 12px; }
  .agent-card:hover { transform: none; }
  .agent-card-cover, .agent-card-act { display: none; }
  .agent-card-av { margin: 0; border: 0; }
  .agent-card-body { padding: 0 0 0 12px; gap: 3px; }
  .agent-card-desc { -webkit-line-clamp: 1; min-height: 0; }
  .agent-card-go { display: grid; }
}
@media (prefers-reduced-motion: reduce) {
  .agent-card, .agent-card-av { animation: none; transition: none; }
  .agent-card:hover, .agent-card:hover .agent-card-av { transform: none; }
}
</style>
