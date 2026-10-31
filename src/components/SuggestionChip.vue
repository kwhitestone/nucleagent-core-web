<script setup lang="ts">
/** One home suggestion card; the home page and the admin preview render the same markup. Text is plain text, never HTML. */
import { computed } from "vue";
import { iconFor, type HomeCard } from "@/composables/homeSuggestions";

const props = defineProps<{ card: HomeCard; delay?: number }>();
const icon = computed(() => iconFor(props.card.icon));
</script>

<template>
  <button type="button" class="suggestion-chip" :class="delay ? `delay-${delay}` : ''" data-testid="suggestion-chip" :data-card-id="card.id">
    <span class="chip-icon" :style="{ background: icon.bg, color: icon.color }" :data-icon="icon.id">
      <component :is="icon.component" aria-hidden="true" />
    </span>
    <span class="chip-title">{{ card.title }}</span>
    <span class="chip-desc">{{ card.desc }}</span>
  </button>
</template>

<style>
/* 设计稿第 618–833 行，自 Home.vue 移来（首页与管理端预览共用）。非 scoped：core
   子应用以 micro-app disable-scopecss 加载，scoped 样式不生效。 */
.suggestion-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  width: 100%; max-width: 640px;
}

.suggestion-chip {
  text-align: left; padding: 14px 16px;
  font: inherit; color: inherit;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: none; -webkit-backdrop-filter: none;
  border: 1px solid var(--border); border-radius: var(--r-lg);
  cursor: pointer; transition: color var(--mo-t-state), background-color var(--mo-t-state), border-color var(--mo-t-state), box-shadow var(--mo-t-state), opacity var(--mo-t-state), transform var(--mo-t-state);
  display: flex; flex-direction: column; gap: 4px;
  position: relative; overflow: hidden;
  animation: fade-in-up 0.4s var(--ease-out) both;
}

.suggestion-chip::before {
  content: ''; position: absolute; inset: 0;
  background: var(--grad-brand-soft);
  opacity: 0; transition: opacity var(--mo-dur-base) var(--ease); border-radius: inherit;
}

.suggestion-chip:hover { border-color: var(--teal-300); box-shadow: var(--shadow-md); transform: none; }
.suggestion-chip:hover::before { opacity: 0.5; }
.suggestion-chip:focus-visible { outline: 2px solid var(--teal-500); outline-offset: 2px; }
.suggestion-chip > * { position: relative; z-index: 1; }

.suggestion-chip .chip-icon {
  width: 30px; height: 30px; border-radius: var(--r-sm);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 4px; transition: transform var(--mo-dur-base) var(--ease-spring);
}

.suggestion-chip:hover .chip-icon { transform: none; }
.suggestion-chip .chip-icon svg { width: 16px; height: 16px; }
.suggestion-chip .chip-title { font-size: 12px; font-weight: 500; color: var(--text-primary); }
.suggestion-chip .chip-desc { font-size: 12px; color: var(--text-tertiary); }
</style>
