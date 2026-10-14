<script setup lang="ts">
/**
 * Result card for in-chat generation; the product area is picked by kind
 * (registry `card`: image-grid → ImageGrid, video-player → VideoPlayer).
 * Design: UI-DESIGN-3 §3.1③ / §3.4 (single image keeps ratio, max height 520; multi = grid; lightbox).
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Check, Copy, Download, PenLine, RefreshCw, Star } from "@lucide/vue";
import ImageGrid from "./ImageGrid.vue";
import VideoPlayer from "./VideoPlayer.vue";

export interface GenResultItem { url: string; thumbUrl?: string; width?: number; height?: number; name: string }

const props = defineProps<{
  items: GenResultItem[];
  prompt: string;
  params: { aspect: string; count: number; model: string; size: string; duration?: number; resolution?: string };
  kind?: "image" | "video";
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
  "chatGen.countN": "{n} 张",
  "chatGen.durationN": "{n} 秒",
  "chatGen.copyPrompt": "复制提示词",
  "chatGen.copied": "已复制",
  "chatGen.download": "下载",
  "chatGen.regenerate": "重新生成",
  "chatGen.continueEdit": "继续修改",
  "chatGen.saveToLibrary": "保存到成果库",
  "chatGen.saved": "已存 ✓",
  "chatGen.openLibrary": "在成果库查看",
  "chatGen.loadFailed": "图片加载失败",
  "chatGen.reload": "重新加载",
  "chatGen.close": "关闭",
};
const { t, te } = useI18n();
function tr(key: string, params: Record<string, unknown> = {}): string {
  if (te(key)) return t(key, params);
  return (FALLBACK[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}

const shown = computed(() => props.items.slice(0, 4));
const single = computed(() => shown.value.length === 1);
const badges = computed(() => [
  props.params.aspect,
  props.kind === "video" ? (props.params.duration ? tr("chatGen.durationN", { n: props.params.duration }) : "") : tr("chatGen.countN", { n: props.params.count }),
  props.params.resolution,
  props.params.model,
  props.params.size,
].filter(Boolean));

const copied = ref(false);
async function copyPrompt() {
  await navigator.clipboard.writeText(props.prompt);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 1500);
}

function downloadAll() { shown.value.forEach((item) => emit("download", item)); }
</script>

<template>
  <div class="gen-result">
    <VideoPlayer
      v-if="kind === 'video'"
      :item="shown[0]"
      :aspect="params.aspect"
    />
    <ImageGrid v-else :items="shown" :aspect="params.aspect" @download="(it) => emit('download', it)" @refine="(it) => emit('refine', it)" />

    <div class="gen-result__prompt">
      <span class="gen-result__prompt-text">「{{ prompt }}」</span>
      <button type="button" class="gen-result__copy" :title="tr('chatGen.copyPrompt')" :aria-label="tr('chatGen.copyPrompt')" @click="copyPrompt">
        <Check v-if="copied" :size="13" /><Copy v-else :size="13" />
        <span v-if="copied">{{ tr("chatGen.copied") }}</span>
      </button>
    </div>
    <div class="gen-result__badges">
      <span v-for="b in badges" :key="b" class="gen-result__badge">{{ b }}</span>
    </div>

    <div class="gen-result__actions">
      <button type="button" class="gen-btn" @click="single ? emit('download', shown[0]) : downloadAll()">
        <Download :size="14" />{{ tr("chatGen.download") }}
      </button>
      <template v-if="saved">
        <span class="gen-btn is-opt is-done">{{ tr("chatGen.saved") }}</span>
        <a v-if="libraryUrl" class="gen-btn is-opt" :href="libraryUrl">{{ tr("chatGen.openLibrary") }}</a>
      </template>
      <button v-else type="button" class="gen-btn is-opt" @click="emit('save')">
        <Star :size="14" />{{ tr("chatGen.saveToLibrary") }}
      </button>
      <button type="button" class="gen-btn is-opt" @click="emit('regenerate')">
        <RefreshCw :size="14" />{{ tr("chatGen.regenerate") }}
      </button>
      <button type="button" class="gen-btn" @click="emit('refine', shown[0])">
        <PenLine :size="14" />{{ tr("chatGen.continueEdit") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.gen-result { max-width: 780px; animation: fade-in-up 0.5s var(--ease-out) both; }
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
@media (max-width: 600px) {
  .gen-result { max-width: 100%; }
  .gen-result__actions .is-opt { display: none;}
}
@media (prefers-reduced-motion: reduce) {
  .gen-result { animation: none; }
}
</style>
