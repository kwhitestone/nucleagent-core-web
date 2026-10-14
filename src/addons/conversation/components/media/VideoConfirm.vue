<script setup lang="ts">
/**
 * UI-IMPL-6 §3.5: asked before a video generation. No price is shown (the
 * ledger is the source of truth); "don't remind me" is browser-local per
 * conversation (registry.skipConfirm), never stored server-side.
 */
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

const emit = defineEmits<{ answer: [ok: boolean, skip: boolean] }>();
const { t } = useI18n();
const skip = ref(false);
const dialog = ref<HTMLDialogElement | null>(null);
onMounted(() => dialog.value?.showModal?.());
</script>

<template>
  <dialog ref="dialog" class="vc" aria-labelledby="vc-title" data-testid="video-confirm" @cancel.prevent="emit('answer', false, false)">
    <h3 id="vc-title">{{ t("chatGen.confirmVideo.title") }}</h3>
    <p>{{ t("chatGen.confirmVideo.body") }}</p>
    <label class="vc-skip"><input v-model="skip" type="checkbox" data-testid="video-confirm-skip" /> {{ t("chatGen.confirmVideo.skip") }}</label>
    <div class="vc-actions">
      <button type="button" class="vc-btn" @click="emit('answer', false, false)">{{ t("chatGen.confirmVideo.cancel") }}</button>
      <button type="button" class="vc-btn is-primary" data-testid="video-confirm-ok" @click="emit('answer', true, skip)">{{ t("chatGen.confirmVideo.ok") }}</button>
    </div>
  </dialog>
</template>

<style scoped>
.vc { max-width: min(420px, 92vw); padding: 18px 20px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--bg-card); color: var(--text-primary); }
.vc::backdrop { background: rgb(15 23 42 / 45%); }
.vc h3 { margin: 0 0 8px; font-size: 15px; }
.vc p { margin: 0 0 12px; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.vc-skip { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.vc-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.vc-btn { font: inherit; font-size: 13px; padding: 5px 14px; cursor: pointer; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-primary); }
.vc-btn.is-primary { border-color: var(--atc-accent, #6366f1); background: var(--atc-accent, #6366f1); color: #fff; }
</style>
