<script setup lang="ts">
// UI-IMPL-5: 「最近删除」 — my conversations deleted in the last 30 days (Core filters the window).
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { listDeletedConversations, restoreConversation } from "../api/conversation";
import type { Conversation } from "../api/types";
import { daysLeft } from "../composables/conversationDelete";
import { useConversationStore } from "../store/conversation";
import { toast } from "@/composables/useToast";

const { t } = useI18n();
const rows = ref<Conversation[]>([]);
const state = ref<"loading" | "ready" | "error">("loading");
const busy = ref<number | null>(null);

async function load(): Promise<void> {
  state.value = "loading";
  try {
    rows.value = await listDeletedConversations();
    state.value = "ready";
  } catch {
    state.value = "error";
  }
}

async function restore(row: Conversation): Promise<void> {
  busy.value = row.id;
  try {
    await restoreConversation(row.id);
    toast.success(t("conversation.delete.restored"));
    void useConversationStore().load(true);
    await load();
  } catch {
    toast.error(t("conversation.delete.restoreFailed"));
    await load();
  } finally {
    busy.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div class="view active">
    <section class="rdel" data-testid="recently-deleted">
      <header class="rdel-head">
        <router-link to="/chat" class="rdel-back">{{ t("conversation.delete.back") }}</router-link>
        <h1>{{ t("conversation.delete.recentlyDeleted") }}</h1>
      </header>
      <p v-if="state === 'loading'" class="rdel-status">…</p>
      <p v-else-if="state === 'error'" class="rdel-status" role="alert">
        {{ t("conversation.delete.loadFailed") }}
        <button type="button" @click="load">{{ t("common.retry") }}</button>
      </p>
      <p v-else-if="!rows.length" class="rdel-status" data-testid="recently-deleted-empty">{{ t("conversation.delete.recentlyDeletedEmpty") }}</p>
      <ul v-else class="rdel-list">
        <li v-for="row in rows" :key="row.id" class="rdel-row">
          <div class="rdel-text">
            <strong>{{ row.title || t("common.untitled") }}</strong>
            <span v-if="row.deletedAt">{{ t("conversation.delete.daysLeft", { n: daysLeft(row.deletedAt) }) }}</span>
          </div>
          <button type="button" :disabled="busy === row.id" @click="restore(row)">{{ t("conversation.delete.restore") }}</button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.rdel { max-width: 720px; margin: 0 auto; padding: 24px 20px; }
.rdel-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.rdel-head h1 { margin: 0; font-size: 18px; }
.rdel-back { color: var(--text-secondary); font-size: 13px; }
.rdel-status { color: var(--text-secondary); font-size: 13.5px; padding: 32px 0; text-align: center; }
.rdel-status button { margin-left: 8px; }
.rdel-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.rdel-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px;
  border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card);
}
.rdel-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rdel-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rdel-text span { font-size: 12px; color: var(--text-secondary); }
.rdel-row button { flex-shrink: 0; padding: 6px 14px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--bg-card); cursor: pointer; }
@media (max-width: 640px) {
  .rdel { padding: 16px 12px; }
  .rdel-row button { padding: 8px 14px; }
}
</style>
