<script setup lang="ts">
/**
 * 会话查看（只读）：按类型（AI 对话 / IM）、用户 UID、时间检索全体用户会话。
 * 每次查询后端都会鉴权并写审计；本页没有任何写操作入口。
 */
import { onBeforeUnmount, onMounted, toRefs } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/contracts/platform-runtime";
import { toast } from "@/composables/useToast";
import { listConversations, userLabel, type ConversationRow } from "../../api/conversations";
import { createConversationListController } from "./conversationListController";

const PAGE = 20;
const { t } = useI18n();

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : t("common.operationFailed");
}

// Only the latest query commits rows/cursors (see conversationListController).
const list = createConversationListController(listConversations, PAGE, (error) => toast.error(errorText(error)));
const { filters, rows, pageIndex, nextCursor, loading } = toRefs(list.state);
const { load, search, switchType } = list;

function formatTime(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function rowTitle(row: ConversationRow): string {
  if (row.type === "chat") return row.title || t("conversationsAdmin.untitled");
  if (row.channelType === 2) return `${t("conversationsAdmin.group")} · ${row.groupTitle || row.channelKey}`;
  return `${t("conversationsAdmin.dm")} · ${userLabel(row.peer, row.peerUserId)}`;
}

onMounted(() => void search());
onBeforeUnmount(list.dispose);
</script>

<template>
  <div class="conv-view" data-testid="admin-conversations">
    <p class="section-hint">{{ t("conversationsAdmin.hint") }}</p>
    <div class="type-switch" role="tablist">
      <button v-for="type in (['chat', 'im'] as const)" :key="type" type="button" role="tab"
        :aria-selected="filters.type === type" :class="{ active: filters.type === type }"
        :data-testid="`conv-type-${type}`" @click="void switchType(type)">
        {{ t(`conversationsAdmin.type.${type}`) }}
      </button>
    </div>
    <form class="filter-row" role="search" @submit.prevent="search()">
      <label>{{ t("conversationsAdmin.userId") }}
        <input v-model="filters.userId" inputmode="numeric" maxlength="12" data-testid="conv-user" />
      </label>
      <label>{{ t("conversationsAdmin.from") }}
        <input v-model="filters.from" type="datetime-local" data-testid="conv-from" />
      </label>
      <label>{{ t("conversationsAdmin.to") }}
        <input v-model="filters.to" type="datetime-local" data-testid="conv-to" />
      </label>
      <label v-if="filters.type === 'chat'" class="check">
        <input v-model="filters.includeDeleted" type="checkbox" /> {{ t("conversationsAdmin.includeDeleted") }}
      </label>
      <button class="btn-primary" type="submit" data-testid="conv-search">{{ t("common.search") }}</button>
    </form>

    <p v-if="loading" class="empty-hint">{{ t("common.loading") }}</p>
    <p v-else-if="!rows.length" class="empty-hint">{{ t("conversationsAdmin.empty") }}</p>
    <div v-else class="conv-list">
      <router-link v-for="row in rows" :key="`${row.type}-${row.id}`" class="conv-card"
        :to="`/admin/conversations/${row.type}/${row.id}`" data-testid="conv-row">
        <div class="conv-main">
          <span class="conv-title">{{ rowTitle(row) }}</span>
          <span class="conv-meta">#{{ row.id }} · {{ userLabel(row.user, row.userId) }} · UID {{ row.userId }}</span>
        </div>
        <div class="conv-side">
          <span v-if="row.processing" class="badge busy">{{ t("conversationsAdmin.processing") }}</span>
          <span v-if="row.status" class="badge">{{ row.status }}</span>
          <span v-if="row.deletedAt" class="badge off">{{ t("conversationsAdmin.deleted") }}</span>
          <span v-if="row.imLinked" class="badge">IM</span>
          <span v-if="row.hidden" class="badge off">{{ t("conversationsAdmin.hiddenByUser") }}</span>
          <span class="conv-time">{{ formatTime(row.type === 'chat' ? row.createdAt : row.lastMessageAt) }}</span>
        </div>
      </router-link>
    </div>

    <div v-if="pageIndex > 0 || nextCursor" class="pager">
      <button class="btn-ghost" type="button" :disabled="pageIndex === 0 || loading" @click="void load(pageIndex - 1)">‹</button>
      <span class="count-hint">{{ t("conversationsAdmin.page", { n: pageIndex + 1 }) }}</span>
      <button class="btn-ghost" type="button" :disabled="!nextCursor || loading" data-testid="conv-next" @click="void load(pageIndex + 1)">›</button>
    </div>
  </div>
</template>

<style scoped>
.conv-view { display: flex; flex-direction: column; gap: 14px; }
.section-hint { font-size: 12px; color: var(--text-tertiary); }
.type-switch { display: inline-flex; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); align-self: flex-start; }
.type-switch button { padding: 6px 14px; border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 13px; }
.type-switch button.active { background: var(--grad-brand-soft); color: var(--indigo-600); font-weight: 600; }
.filter-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.filter-row label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
.filter-row label.check { flex-direction: row; align-items: center; }
.filter-row input:not([type=checkbox]) { padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-primary); font-size: 13px; }
.empty-hint { color: var(--text-tertiary); text-align: center; padding: 32px 0; font-size: 13px; }
.conv-list { display: flex; flex-direction: column; gap: 8px; }
.conv-card { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 16px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-xs); text-decoration: none; color: inherit; }
.conv-card:hover { border-color: var(--border-strong); }
.conv-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.conv-title { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv-meta, .conv-time { font-size: 11.5px; color: var(--text-tertiary); font-family: var(--font-mono); }
.conv-side { display: flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--bg-hover); color: var(--text-secondary); }
.badge.busy { background: #fef3c7; color: #b45309; }
.badge.off { background: var(--slate-100); color: var(--text-tertiary); }
.pager { display: flex; align-items: center; justify-content: center; gap: 10px; }
.count-hint { font-size: 12.5px; color: var(--text-tertiary); }
.btn-primary { padding: 8px 16px; border: none; border-radius: var(--r-md); background: var(--grad-teal-indigo); color: white; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-ghost { padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-secondary); cursor: pointer; }
.btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
