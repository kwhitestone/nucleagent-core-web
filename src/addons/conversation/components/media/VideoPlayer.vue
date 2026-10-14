<script setup lang="ts">
/**
 * UI-IMPL-6: video result (registry card "video-player", design §3.4).
 * Native player, never autoplays; the first frame is the cover (poster when
 * the server has one, else `#t=0.1` so Safari paints a frame from metadata).
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { GenResultItem } from "./GenResultCard.vue";

const props = defineProps<{ item?: GenResultItem; aspect: string }>();
const emit = defineEmits<{ download: [] }>();

const FALLBACK: Record<string, string> = { "chatGen.videoLoadFailed": "视频加载失败", "chatGen.reload": "重新加载" };
const { t, te } = useI18n();
const tr = (key: string): string => (te(key) ? t(key) : FALLBACK[key] ?? key);

const src = computed(() => (props.item ? (props.item.url.includes("#") ? props.item.url : `${props.item.url}#t=0.1`) : ""));
const ratio = computed(() => {
  const [w, h] = props.aspect.split(":").map(Number);
  return w && h ? `${w} / ${h}` : "16 / 9";
});
const portrait = computed(() => {
  const [w, h] = props.aspect.split(":").map(Number);
  return h > w;
});
const failed = ref(false);
const reloadKey = ref(0);
function reload() { failed.value = false; reloadKey.value++; }
</script>

<template>
  <div class="gen-video" :class="{ 'is-portrait': portrait }" :style="{ aspectRatio: ratio }" data-testid="gen-video">
    <div v-if="failed || !item" class="gen-video__failed">
      <span>{{ tr("chatGen.videoLoadFailed") }}</span>
      <button v-if="item" type="button" class="gen-btn" @click="reload">{{ tr("chatGen.reload") }}</button>
    </div>
    <video
      v-else
      :key="reloadKey"
      :src="src"
      :poster="item.thumbUrl"
      :aria-label="item.name"
      controls preload="metadata" playsinline
      @error="failed = true"
    />
  </div>
</template>

<style scoped>
.gen-video { max-width: min(780px, 100%); max-height: 520px; border-radius: var(--r-lg); overflow: hidden; background: #000; }
.gen-video.is-portrait { max-width: 300px; }
.gen-video video { display: block; width: 100%; height: 100%; object-fit: contain; }
.gen-video__failed {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  height: 100%; font-size: 12px; color: var(--text-secondary); background: var(--bg-subtle);
}
.gen-btn {
  display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 13px; padding: 5px 12px; cursor: pointer;
  color: var(--text-primary); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md);
}
@media (max-width: 600px) { .gen-video { max-width: 100%; max-height: 70vh; } }
</style>
