<script setup lang="ts">
/** UI-IMPL-6: image results grid + lightbox (moved out of GenResultCard; §3.4). */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Download, PenLine, X } from "@lucide/vue";
import type { GenResultItem } from "./GenResultCard.vue";

const props = defineProps<{ items: GenResultItem[]; aspect: string }>();
const emit = defineEmits<{ download: [item: GenResultItem]; refine: [item: GenResultItem] }>();

const FALLBACK: Record<string, string> = {
  "chatGen.download": "下载",
  "chatGen.continueEdit": "继续修改",
  "chatGen.loadFailed": "图片加载失败",
  "chatGen.reload": "重新加载",
  "chatGen.close": "关闭",
};
const { t, te } = useI18n();
const tr = (key: string): string => (te(key) ? t(key) : FALLBACK[key] ?? key);

const shown = computed(() => props.items.slice(0, 4));
const single = computed(() => shown.value.length === 1);

// Ratio of an image: real pixels when known, otherwise the requested aspect.
function ratioOf(item: GenResultItem): [number, number] {
  if (item.width && item.height) return [item.width, item.height];
  const [w, h] = props.aspect.split(":").map(Number);
  return w && h ? [w, h] : [1, 1];
}
const singleRatio = computed(() => ratioOf(shown.value[0] ?? { url: "", name: "" }));
const singleShape = computed(() => {
  const [w, h] = singleRatio.value;
  return w > h ? "is-landscape" : h > w ? "is-portrait" : "is-square";
});
// Multi-image cells all follow the first image's ratio (§3.4).
const cellRatio = computed(() => {
  if (single.value) return singleRatio.value.join(" / ");
  return shown.value.length === 4 ? "1 / 1" : ratioOf(shown.value[0]).join(" / ");
});

const failed = ref(new Set<number>());
const reloadKey = ref(0);
function onImgError(i: number) { failed.value = new Set(failed.value).add(i); }
function reload(i: number) {
  const next = new Set(failed.value);
  next.delete(i);
  failed.value = next;
  reloadKey.value++;
}

// Lightbox: Esc closes, ←/→ switch.
const active = ref<number | null>(null);
const current = computed(() => (active.value === null ? null : shown.value[active.value]));
function open(i: number) { active.value = i; }
function close() { active.value = null; }
function onKey(e: { key: string }) {
  if (active.value === null) return;
  const n = shown.value.length;
  if (e.key === "Escape") close();
  else if (e.key === "ArrowRight") active.value = (active.value + 1) % n;
  else if (e.key === "ArrowLeft") active.value = (active.value + n - 1) % n;
}
watch(active, (v, old) => {
  if (typeof window === "undefined") return;
  if (v !== null && old === null) window.addEventListener("keydown", onKey);
  if (v === null) window.removeEventListener("keydown", onKey);
});
onBeforeUnmount(() => { if (typeof window !== "undefined") window.removeEventListener("keydown", onKey); });
</script>

<template>
  <div :class="['gen-result__grid', `n-${shown.length}`, single ? singleShape : '']">
    <div
      v-for="(item, i) in shown"
      :key="`${i}-${reloadKey}`"
      :class="['gen-result__cell', `delay-${i + 1}`]"
      :style="{ aspectRatio: cellRatio }"
    >
      <div v-if="failed.has(i)" class="gen-result__failed">
        <span>{{ tr("chatGen.loadFailed") }}</span>
        <button type="button" class="gen-btn" @click="reload(i)">{{ tr("chatGen.reload") }}</button>
      </div>
      <template v-else>
        <button type="button" class="gen-result__open" :aria-label="item.name" @click="open(i)">
          <img :src="item.thumbUrl || item.url" :alt="item.name" loading="lazy" @error="onImgError(i)" />
        </button>
        <div class="gen-result__corner">
          <button type="button" :title="tr('chatGen.download')" :aria-label="tr('chatGen.download')" @click="emit('download', item)">
            <Download :size="14" />
          </button>
          <button type="button" :title="tr('chatGen.continueEdit')" :aria-label="tr('chatGen.continueEdit')" @click="emit('refine', item)">
            <PenLine :size="14" />
          </button>
        </div>
      </template>
    </div>
  </div>
  <Teleport to="body">
    <div v-if="current" class="gen-lightbox" role="dialog" aria-modal="true" :aria-label="current.name" @click.self="close">
      <img :src="current.url" :alt="current.name" />
      <div class="gen-lightbox__bar">
        <button type="button" class="gen-btn" @click="emit('download', current)"><Download :size="14" />{{ tr("chatGen.download") }}</button>
        <button type="button" class="gen-btn" :aria-label="tr('chatGen.close')" @click="close"><X :size="14" /></button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.gen-result__grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
  max-width: 560px; border-radius: var(--r-lg); overflow: hidden;
}
.gen-result__grid.n-1 { grid-template-columns: 1fr; }
.gen-result__grid.n-1.is-landscape { max-width: min(780px, 100%); }
.gen-result__grid.n-1.is-square { max-width: 480px; }
.gen-result__grid.n-1.is-portrait { max-width: 360px; }
.gen-result__grid.n-1 .gen-result__cell { max-height: 520px; }
.gen-result__grid.n-3 .gen-result__cell:first-child { grid-row: span 2; aspect-ratio: auto !important; }
.gen-result__cell {
  position: relative; overflow: hidden; background: var(--bg-subtle);
  animation: scale-in 0.4s var(--ease-spring) both;
  transition: transform 0.3s var(--ease), box-shadow 0.3s var(--ease);
}
.gen-result__cell.delay-2 { animation-delay: 50ms; }
.gen-result__cell.delay-3 { animation-delay: 100ms; }
.gen-result__cell.delay-4 { animation-delay: 150ms; }
.gen-result__grid:not(.n-1) .gen-result__cell:hover { transform: scale(1.02); box-shadow: var(--shadow-md); z-index: 1; }
.gen-result__open { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }
.gen-result__open img { display: block; width: 100%; height: 100%; object-fit: cover; }
.gen-result__grid.n-1 .gen-result__open img { object-fit: contain; }
.gen-result__corner {
  position: absolute; top: 6px; right: 6px; display: flex; gap: 4px;
  opacity: 0; transition: opacity 0.3s var(--ease);
}
.gen-result__cell:hover .gen-result__corner, .gen-result__corner:focus-within { opacity: 1; }
.gen-result__corner button {
  display: grid; place-items: center; width: 26px; height: 26px; cursor: pointer;
  color: var(--text-primary); background: rgb(255 255 255 / 90%);
  border: 0; border-radius: var(--r-full); box-shadow: var(--shadow-md);
}
.gen-result__failed {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  height: 100%; font-size: 12px; color: var(--text-secondary);
}
.gen-lightbox {
  position: fixed; inset: 0; z-index: 3000;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: rgb(15 23 42 / 82%);
  animation: fade-in 0.4s var(--ease-out) both;
}
.gen-lightbox img { max-width: 92vw; max-height: 82vh; object-fit: contain; border-radius: var(--r-md); animation: scale-in 0.4s var(--ease-spring) both; }
.gen-lightbox__bar { display: flex; gap: 8px; }
@media (max-width: 600px) {
  .gen-result, .gen-result__grid, .gen-result__grid.n-1.is-square, .gen-result__grid.n-1.is-portrait { max-width: 100%;}
  .gen-result__grid.n-1 .gen-result__cell { max-height: 70vh;}
}
@media (prefers-reduced-motion: reduce) {
  .gen-result, .gen-result__cell, .gen-lightbox, .gen-lightbox img { animation: none;}
  .gen-result__cell, .gen-result__corner { transition: none;}
}
.gen-btn {
  display: inline-flex; align-items: center; gap: 4px;
  font: inherit; font-size: 13px; padding: 5px 12px; cursor: pointer; text-decoration: none;
  color: var(--text-primary); background: var(--bg-card);
  border: 1px solid var(--border); border-radius: var(--r-md);
  transition: all 0.3s var(--ease);
}
.gen-btn:hover { border-color: color-mix(in srgb, var(--atc-accent, #6366f1) 55%, var(--border)); }
</style>
