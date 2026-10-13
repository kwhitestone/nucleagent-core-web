<script setup lang="ts">
// UI-IMPL-5: delete confirm dialog + 5s undo bar (UI-DESIGN-7 §5). Mounted once in App.vue.
import { onBeforeUnmount, watch } from "vue";
import { useI18n } from "vue-i18n";
import { UNDO_WINDOW_MS, deleteConfirmKeys } from "../composables/conversationDelete";
import { confirmDelete, pendingDelete, undoDelete, undoTarget } from "../composables/useConversationDelete";

const { t } = useI18n();
let timer: ReturnType<typeof setTimeout> | undefined;

watch(undoTarget, (id) => {
  clearTimeout(timer);
  if (id != null) timer = setTimeout(() => (undoTarget.value = null), UNDO_WINDOW_MS);
});
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div v-if="pendingDelete" class="cdel-scrim" @click.self="pendingDelete = null" @keydown.esc="pendingDelete = null">
    <div class="cdel-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cdel-title" data-testid="conv-delete-dialog">
      <h2 id="cdel-title">{{ t("conversation.delete.title") }}</h2>
      <p v-if="pendingDelete.title" class="cdel-name">{{ pendingDelete.title }}</p>
      <p v-for="key in deleteConfirmKeys(pendingDelete.status, pendingDelete.members)" :key="key">{{ t(key) }}</p>
      <div class="cdel-actions">
        <button type="button" class="cdel-cancel" @click="pendingDelete = null">{{ t("conversation.delete.cancel") }}</button>
        <button type="button" class="cdel-confirm" data-testid="conv-delete-confirm" @click="confirmDelete">{{ t("conversation.delete.confirm") }}</button>
      </div>
    </div>
  </div>
  <div v-if="undoTarget != null" class="cdel-undo" role="status" data-testid="conv-undo">
    <span>{{ t("conversation.delete.done") }}</span>
    <button type="button" @click="undoDelete">{{ t("conversation.delete.undo") }}</button>
  </div>
</template>

<style scoped>
.cdel-scrim { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center; background: rgba(15, 23, 42, 0.36); }
.cdel-dialog {
  width: min(420px, calc(100vw - 32px)); padding: 20px 22px; border-radius: var(--r-md);
  background: var(--bg-card); color: var(--text-primary); box-shadow: var(--shadow-lg);
  animation: fade-in-up 0.15s var(--ease-out) both;
}
.cdel-dialog h2 { margin: 0 0 8px; font-size: 16px; }
.cdel-dialog p { margin: 6px 0; font-size: 13.5px; line-height: 1.6; color: var(--text-secondary); }
.cdel-name { font-weight: 600; color: var(--text-primary) !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cdel-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.cdel-actions button { padding: 7px 16px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--bg-card); cursor: pointer; }
.cdel-confirm { background: var(--rose-500) !important; border-color: var(--rose-500) !important; color: #fff; }
.cdel-undo {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 9000;
  display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-radius: var(--r-md);
  background: var(--text-primary); color: var(--bg-card); box-shadow: var(--shadow-lg); font-size: 13.5px;
  animation: fade-in-up 0.2s var(--ease-out) both;
}
.cdel-undo button { border: 0; background: none; color: var(--indigo-300, #a5b4fc); font-weight: 600; cursor: pointer; }
@media (max-width: 640px) {
  .cdel-scrim { place-items: end center; }
  .cdel-dialog { width: 100vw; border-radius: var(--r-md) var(--r-md) 0 0; padding-bottom: calc(20px + env(safe-area-inset-bottom)); }
  .cdel-actions button { flex: 1; padding: 10px; }
  .cdel-undo { bottom: calc(16px + env(safe-area-inset-bottom)); width: calc(100vw - 32px); justify-content: space-between; }
}
</style>
