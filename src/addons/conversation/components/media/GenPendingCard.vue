<script setup lang="ts">
/**
 * Placeholder card shown inside the assistant message while an image job runs.
 * Design: UI-DESIGN-3 §3.1② / §3.2 (shimmer skeleton, indeterminate bar, elapsed clock).
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

type PendingState = "queued" | "submitting" | "running" | "ingesting";
type Aspect = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";

const props = withDefaults(defineProps<{
  state: PendingState;
  count?: number;
  aspect?: Aspect;
  startedAt: number;
  expectedSec?: number;
  cancelable?: boolean;
}>(), { count: 1, aspect: "1:1", expectedSec: 20, cancelable: true });

const emit = defineEmits<{ cancel: [] }>();

// Chinese originals (UI-DESIGN-3 §3.1②); used only when the host i18n lacks the key.
const FALLBACK: Record<string, string> = {
  "gen.generating": "正在生成 {n} 张图片",
  "gen.stage.queued": "排队中",
  "gen.stage.submitting": "正在提交给模型…",
  "gen.stage.running": "生成中",
  "gen.stage.ingesting": "马上就好，正在取回结果…",
  "gen.elapsed": "已用 {t}",
  "gen.expectedSec": "预计约 {n} 秒",
  "gen.slow": "比平时慢一些，仍在生成…",
  "gen.cancel": "取消",
  "gen.cancelConfirm": "取消后不会出结果。尚未提交给模型的不扣费；已提交的按实际扣费。",
  "gen.cancelYes": "取消生成",
  "gen.cancelNo": "继续等",
};
const { t, te } = useI18n();
function tr(key: string, params: Record<string, unknown> = {}): string {
  if (te(key)) return t(key, params);
  return (FALLBACK[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}

const cells = computed(() => Math.min(4, Math.max(1, Math.round(props.count) || 1)));
const ratio = computed(() => props.aspect.replace(":", " / "));
const portrait = computed(() => {
  const [w, h] = props.aspect.split(":").map(Number);
  return h > w;
});

// Elapsed clock: ticks every second, paused while the page is hidden.
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
function tick() { now.value = Date.now(); }
function syncTimer() {
  clearInterval(timer);
  timer = undefined;
  if (document.hidden) return;
  tick();
  timer = setInterval(tick, 1000);
}
onMounted(() => {
  document.addEventListener("visibilitychange", syncTimer);
  syncTimer();
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", syncTimer);
  clearInterval(timer);
});

const elapsedSec = computed(() => Math.max(0, Math.floor((now.value - props.startedAt) / 1000)));
const elapsedText = computed(() => {
  const s = elapsedSec.value;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
});
const slow = computed(() => elapsedSec.value > props.expectedSec * 2);
const showCancel = computed(() => props.cancelable && props.state !== "ingesting");

const confirming = ref(false);
function askCancel() { confirming.value = true; }
function keepWaiting() { confirming.value = false; }
function confirmCancel() {
  confirming.value = false;
  emit("cancel");
}
</script>

<template>
  <div class="gen-pending" :class="`is-${state}`" role="status" aria-live="polite">
    <div class="gen-pending__head">
      <span>{{ tr("gen.generating", { n: cells }) }}</span>
      <i class="gen-pending__dot" aria-hidden="true" />
    </div>
    <div
      class="gen-pending__grid"
      :class="[`n-${cells}`, { 'is-portrait': cells === 1 && portrait }]"
      aria-hidden="true"
    >
      <div v-for="i in cells" :key="i" class="gen-pending__cell" :style="{ aspectRatio: ratio }" />
    </div>
    <div class="gen-pending__bar" aria-hidden="true" />
    <div class="gen-pending__meta">
      <span class="gen-pending__text">
        {{ tr(`gen.stage.${state}`) }} · {{ tr("gen.elapsed", { t: elapsedText }) }} ·
        {{ slow ? tr("gen.slow") : tr("gen.expectedSec", { n: expectedSec }) }}
      </span>
      <button v-if="showCancel && !confirming" type="button" class="gen-pending__cancel gen-btn" @click="askCancel">
        {{ tr("gen.cancel") }}
      </button>
    </div>
    <div v-if="showCancel && confirming" class="gen-pending__confirm" role="alertdialog" :aria-label="tr('gen.cancelConfirm')">
      <p>{{ tr("gen.cancelConfirm") }}</p>
      <div class="gen-pending__confirm-actions">
        <button type="button" class="gen-btn is-danger" @click="confirmCancel">{{ tr("gen.cancelYes") }}</button>
        <button type="button" class="gen-btn" @click="keepWaiting">{{ tr("gen.cancelNo") }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gen-pending {
  max-width: 560px;
  padding: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  animation: fade-in-up 0.5s var(--ease-out) both;
}
.gen-pending__head { display: flex; align-items: center; gap: 8px; margin: 0 2px 10px; color: var(--text-primary); }
.gen-pending__dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--atc-accent, #6366f1);
  animation: atc-pulse 1.2s ease-in-out infinite;
}
.gen-pending__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; border-radius: var(--r-md); overflow: hidden; }
.gen-pending__grid.n-1 { grid-template-columns: 1fr; max-width: 480px; }
.gen-pending__grid.n-1.is-portrait { max-width: 360px; }
.gen-pending__grid.n-1.is-portrait .gen-pending__cell { max-height: 520px; }
.gen-pending__grid.n-3 .gen-pending__cell:first-child { grid-row: span 2; aspect-ratio: auto !important; }
.gen-pending__cell,
.gen-pending__bar {
  background-size: 200% 100%;
  animation: shimmer 3s linear infinite;
}
.gen-pending__cell { background-image: linear-gradient(90deg, #eef2f7 25%, #f8fafc 50%, #eef2f7 75%); }
.gen-pending__bar {
  height: 3px;
  margin: 10px 0 6px;
  border-radius: 3px;
  background-image: linear-gradient(90deg, #c7d2fe 25%, #8b5cf6 50%, #c7d2fe 75%);
}
.is-queued .gen-pending__bar { animation: none; background: linear-gradient(90deg, #8b5cf6 10%, #e0e7ff 10%); }
.gen-pending__meta {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums;
}
.gen-pending__confirm {
  margin-top: 8px; padding: 10px 12px;
  font-size: 13px; color: var(--text-primary);
  background: var(--bg-subtle); border-radius: var(--r-md);
  animation: fade-in 0.4s var(--ease-out) both;
}
.gen-pending__confirm p { margin: 0 0 8px; }
.gen-pending__confirm-actions { display: flex; gap: 6px; }
.gen-btn {
  font: inherit; font-size: 13px; padding: 5px 12px; cursor: pointer;
  color: var(--text-primary); background: var(--bg-card);
  border: 1px solid var(--border); border-radius: var(--r-md);
  transition: all 0.3s var(--ease);
}
.gen-btn:hover { border-color: color-mix(in srgb, var(--atc-accent, #6366f1) 55%, var(--border)); }
.gen-btn.is-danger { color: #dc2626; }
@media (prefers-reduced-motion: reduce) {
  .gen-pending, .gen-pending__dot, .gen-pending__cell, .gen-pending__bar, .gen-pending__confirm { animation: none; }
}
</style>
