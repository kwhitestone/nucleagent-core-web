<script setup lang="ts">
import { onMounted, ref } from "vue";
import { openToolLink } from "@/addons/conversation/api/conversation";
import { toast } from "@/composables/useToast";
import { assertToolImageUrl, toolImageFilename } from "./toolImages";

const props = defineProps<{ src: string; alt: string }>();

const root = ref<HTMLElement | null>(null);
const url = ref("");
const state = ref<"loading" | "ready" | "error">("loading");

// MUYU-342: the sealed ticket is unsealed by Core for the conversation owner only; the
// real URL is only bound as an attribute by Vue and sent without a referrer.
onMounted(async () => {
  const conversationId = root.value?.closest("[data-conversation-key]")?.getAttribute("data-conversation-key") ?? "";
  if (!/^\d+$/.test(conversationId)) {
    state.value = "error";
    return;
  }
  try {
    url.value = assertToolImageUrl(await openToolLink(conversationId, props.src));
    state.value = "ready";
  } catch {
    state.value = "error";
  }
});

async function download(): Promise<void> {
  if (!url.value) return;
  const name = toolImageFilename(url.value);
  try {
    const response = await fetch(url.value, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    const blob = await response.blob();
    if (!response.ok || !/^image\//.test(blob.type)) throw new Error("bad image");
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 0);
  } catch {
    // The storage host may not allow CORS; let the browser fetch it in a separate, unlinked tab.
    if (!window.open(url.value, "_blank", "noopener,noreferrer")) toast.error("图片下载失败");
  }
}
</script>

<template>
  <figure ref="root" class="atc-tool-image">
    <img
      v-if="state === 'ready'"
      :src="url"
      :alt="alt"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="state = 'error'"
    />
    <span v-else-if="state === 'loading'" class="atc-tool-image-status">图片加载中…</span>
    <span v-else class="atc-tool-image-status">图片无法显示</span>
    <figcaption>
      <span>{{ alt }}</span>
      <button type="button" class="atc-tool-image-download" :disabled="state !== 'ready'" @click="download">下载图片</button>
    </figcaption>
  </figure>
</template>

<style scoped>
.atc-tool-image { margin: 8px 0; max-width: min(480px, 100%); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.atc-tool-image img { display: block; width: 100%; height: auto; }
.atc-tool-image-status { display: block; padding: 24px; text-align: center; color: var(--text-tertiary); font-size: 12px; }
.atc-tool-image figcaption { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; font-size: 12px; color: var(--text-secondary); }
.atc-tool-image-download { border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; background: var(--bg-card); color: var(--text-primary); cursor: pointer; font: inherit; }
.atc-tool-image-download:disabled { opacity: 0.5; cursor: default; }
</style>
