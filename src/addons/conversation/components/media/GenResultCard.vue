<script setup lang="ts">
/**
 * Result card for in-chat image generation.
 * Design: UI-DESIGN-3 §3.1③ / §3.4 (single image keeps ratio, max height 520; multi = grid; lightbox).
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Check, Copy, Download, PenLine, RefreshCw, Star, X } from "@lucide/vue";

export interface GenResultItem { url: string; thumbUrl?: string; width?: number; height?: number; name: string }

const props = defineProps<{
  items: GenResultItem[];
  prompt: string;
  params: { aspect: string; count: number; model: string; size: string };
  saved?: boolean;
  libraryUrl?: string;
}>();

const emit = defineEmits<{
  download: [item: GenResultItem];
  regenerate: [];
  refine: [item: GenResultItem];
  save: [];
}>();

// Chinese originals; used only when the host i18n lacks the key.
const FALLBACK: Record<string, string> = {
  "gen.countN": "{n} 张",
  "gen.copyPrompt": "复制提示词",
  "gen.copied": "已复制",
  "gen.download": "下载",
  "gen.regenerate": "重新生成",
  "gen.continueEdit": "继续修改",
  "gen.saveToLibrary": "保存到成果库",
  "gen.saved": "已存 ✓",
  "gen.openLibrary": "在成果库查看",
  "gen.loadFailed": "图片加载失败",
  "gen.reload": "重新加载",
  "gen.close": "关闭",
};
const { t, te } = useI18n();
function tr(key: string, params: Record<string, unknown> = {}): string {
  if (te(key)) return t(key, params);
  return (FALLBACK[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}

const shown = computed(() => props.items.slice(0, 4));
const single = computed(() => shown.value.length === 1);

// Ratio of an image: real pixels when known, otherwise the requested aspect.
function ratioOf(item: GenResultItem): [number, number] {
  if (item.width && item.height) return [item.width, item.height];
  const [w, h] = props.params.aspect.split(":").map(Number);
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

const badges = computed(() => [
  props.params.aspect,
  tr("gen.countN", { n: props.params.count }),
  props.params.model,
  props.params.size,
].filter(Boolean));

const failed = ref(new Set<number>());
const reloadKey = ref(0);
function onImgError(i: number) { failed.value = new Set(failed.value).add(i); }
function reload(i: number) {
  const next = new Set(failed.value);
  next.delete(i);
  failed.value = next;
  reloadKey.value++;
}

const copied = ref(false);
async function copyPrompt() {
  await navigator.clipboard.writeText(props.prompt);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 1500);
}

function downloadAll() { shown.value.forEach((item) => emit("download", item)); }

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
  <div class="gen-result">
    <div :class="['gen-result__grid', `n-${shown.length}`, single ? singleShape : '']">
      <div
        v-for="(item, i) in shown"
        :key="`${i}-${reloadKey}`"
        :class="['gen-result__cell', `delay-${i + 1}`]"
        :style="{ aspectRatio: cellRatio }"
      >
        <div v-if="failed.has(i)" class="gen-result__failed">
          <span>{{ tr("gen.loadFailed") }}</span>
          <button type="button" class="gen-btn" @click="reload(i)">{{ tr("gen.reload") }}</button>
        </div>
        <template v-else>
          <button type="button" class="gen-result__open" :aria-label="item.name" @click="open(i)">
            <img :src="item.thumbUrl || item.url" :alt="item.name" loading="lazy" @error="onImgError(i)" />
          </button>
          <div class="gen-result__corner">
            <button type="button" :title="tr('gen.download')" :aria-label="tr('gen.download')" @click="emit('download', item)">
              <Download :size="14" />
            </button>
            <button type="button" :title="tr('gen.continueEdit')" :aria-label="tr('gen.continueEdit')" @click="emit('refine', item)">
              <PenLine :size="14" />
            </button>
          </div>
        </template>
      </div>
    </div>

    <div class="gen-result__prompt">
      <span class="gen-result__prompt-text">「{{ prompt }}」</span>
      <button type="button" class="gen-result__copy" :title="tr('gen.copyPrompt')" :aria-label="tr('gen.copyPrompt')" @click="copyPrompt">
        <Check v-if="copied" :size="13" /><Copy v-else :size="13" />
        <span v-if="copied">{{ tr("gen.copied") }}</span>
      </button>
    </div>
    <div class="gen-result__badges">
      <span v-for="b in badges" :key="b" class="gen-result__badge">{{ b }}</span>
    </div>

    <div class="gen-result__actions">
      <button type="button" class="gen-btn" @click="single ? emit('download', shown[0]) : downloadAll()">
        <Download :size="14" />{{ tr("gen.download") }}
      </button>
      <template v-if="saved">
        <span class="gen-btn is-opt is-done"><Check :size="14" />{{ tr("gen.saved") }}</span>
        <a v-if="libraryUrl" class="gen-btn is-opt" :href="libraryUrl">{{ tr("gen.openLibrary") }}</a>
      </template>
      <button v-else type="button" class="gen-btn is-opt" @click="emit('save')">
        <Star :size="14" />{{ tr("gen.saveToLibrary") }}
      </button>
      <button type="button" class="gen-btn is-opt" @click="emit('regenerate')">
        <RefreshCw :size="14" />{{ tr("gen.regenerate") }}
      </button>
      <button type="button" class="gen-btn" @click="emit('refine', shown[0])">
        <PenLine :size="14" />{{ tr("gen.continueEdit") }}
      </button>
    </div>

    <Teleport to="body">
      <div v-if="current" class="gen-lightbox" role="dialog" aria-modal="true" :aria-label="current.name" @click.self="close">
        <img :src="current.url" :alt="current.name" />
        <div class="gen-lightbox__bar">
          <button type="button" class="gen-btn" @click="emit('download', current)"><Download :size="14" />{{ tr("gen.download") }}</button>
          <button type="button" class="gen-btn" :aria-label="tr('gen.close')" @click="close"><X :size="14" /></button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.gen-result { max-width: 780px; animation: fade-in-up 0.5s var(--ease-out) both; }
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
.gen-result__prompt { display: flex; align-items: flex-start; gap: 6px; margin: 10px 2px 4px; color: var(--text-secondary); }
.gen-result__prompt-text { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.gen-result__copy {
  display: inline-flex; align-items: center; gap: 3px; flex: none; padding: 2px 4px; cursor: pointer;
  font: inherit; font-size: 12px; color: var(--text-tertiary); background: none; border: 0; border-radius: var(--r-sm);
}
.gen-result__copy:hover { color: var(--atc-accent, #6366f1); }
.gen-result__badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.gen-result__badge {
  font-size: 12px; padding: 1px 9px; color: var(--text-secondary);
  background: var(--bg-subtle); border-radius: var(--r-full);
}
.gen-result__actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.gen-btn {
  display: inline-flex; align-items: center; gap: 4px;
  font: inherit; font-size: 13px; padding: 5px 12px; cursor: pointer; text-decoration: none;
  color: var(--text-primary); background: var(--bg-card);
  border: 1px solid var(--border); border-radius: var(--r-md);
  transition: all 0.3s var(--ease);
}
.gen-btn:hover { border-color: color-mix(in srgb, var(--atc-accent, #6366f1) 55%, var(--border)); }
.gen-btn.is-done { cursor: default; color: var(--accent, #0d9488); }
.gen-lightbox {
  position: fixed; inset: 0; z-index: 3000;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: rgb(15 23 42 / 82%);
  animation: fade-in 0.4s var(--ease-out) both;
}
.gen-lightbox img { max-width: 92vw; max-height: 82vh; object-fit: contain; border-radius: var(--r-md); animation: scale-in 0.4s var(--ease-spring) both; }
.gen-lightbox__bar { display: flex; gap: 8px; }
@media (max-width: 600px) {
  .gen-result, .gen-result__grid, .gen-result__grid.n-1.is-square, .gen-result__grid.n-1.is-portrait { max-width: 100%; }
  .gen-result__grid.n-1 .gen-result__cell { max-height: 70vh; }
  .gen-result__actions .is-opt { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .gen-result, .gen-result__cell, .gen-lightbox, .gen-lightbox img { animation: none; }
  .gen-result__cell, .gen-result__corner { transition: none; }
}
</style>
