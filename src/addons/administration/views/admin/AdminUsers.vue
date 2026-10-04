<script setup lang="ts">
/**
 * Accounts: search, then disable or enable. A disabled account cannot sign in,
 * its open sessions end on their next request, and nobody can message it or
 * add it to a group. Enabling restores all of it.
 */
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/contracts/platform-runtime";
import { toast } from "@/composables/useToast";
import { listUsers, setUserActive, type AdminUser } from "../../api/user";

const PAGE = 20;
const { t } = useI18n();
const query = ref("");
const users = ref<AdminUser[]>([]);
const total = ref(0);
const offset = ref(0);
const loading = ref(false);
const busy = ref<number | null>(null);

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : t("common.operationFailed");
}

async function load(at = 0): Promise<void> {
  loading.value = true;
  try {
    const page = await listUsers(query.value.trim(), at, PAGE);
    users.value = page.items;
    total.value = page.total;
    offset.value = at;
  } catch (error) {
    toast.error(errorText(error));
  } finally {
    loading.value = false;
  }
}
onMounted(() => load());

async function toggle(user: AdminUser): Promise<void> {
  if (busy.value !== null) return;
  if (user.isActive && !window.confirm(t("users.admin.confirmDisable", { name: user.nickName || user.username }))) return;
  busy.value = user.id;
  try {
    const saved = await setUserActive(user.id, !user.isActive);
    user.isActive = saved.isActive;
  } catch (error) {
    toast.error(errorText(error));
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="users-view">
    <form class="search-row" role="search" @submit.prevent="load(0)">
      <input v-model="query" type="search" maxlength="100" :placeholder="t('users.admin.searchPlaceholder')"
        :aria-label="t('common.search')" data-testid="user-search" />
      <button class="btn-primary" type="submit">{{ t("common.search") }}</button>
    </form>
    <p class="section-hint">{{ t("users.admin.hint") }}</p>

    <p v-if="loading" class="empty-hint">{{ t("common.loading") }}</p>
    <p v-else-if="!users.length" class="empty-hint">{{ t("users.admin.empty") }}</p>

    <div v-else class="user-list">
      <div v-for="user in users" :key="user.id" class="user-card" :class="{ inactive: !user.isActive }" data-testid="user-row">
        <div class="user-main">
          <span class="user-name">{{ user.nickName || user.username }}</span>
          <span class="user-meta">UID {{ user.id }} · {{ user.username }}</span>
          <span v-if="user.accountType === 'agent'" class="type-chip">{{ t("users.admin.agent") }}</span>
          <span class="badge" :class="user.isActive ? 'on' : 'off'">
            {{ user.isActive ? t("common.enabled") : t("common.disabled") }}
          </span>
        </div>
        <button class="btn-ghost" :class="{ danger: user.isActive }" type="button" :disabled="busy === user.id"
          data-testid="user-toggle" @click="toggle(user)">
          {{ user.isActive ? t("common.disable") : t("common.enable") }}
        </button>
      </div>
    </div>

    <div v-if="total > PAGE" class="pager">
      <button class="btn-ghost" type="button" :disabled="offset === 0" @click="load(Math.max(0, offset - PAGE))">‹</button>
      <span class="count-hint">{{ offset + 1 }}–{{ offset + users.length }} / {{ total }}</span>
      <button class="btn-ghost" type="button" :disabled="offset + PAGE >= total" @click="load(offset + PAGE)">›</button>
    </div>
  </div>
</template>

<style scoped>
.users-view { display: flex; flex-direction: column; gap: 14px; }
.search-row { display: flex; gap: 8px; }
.search-row input {
  flex: 1; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--bg-card); color: var(--text-primary); font-size: 13px;
}
.search-row input:focus { outline: none; border-color: var(--teal-500); }
.section-hint { font-size: 12px; color: var(--text-tertiary); }
.empty-hint { color: var(--text-tertiary); text-align: center; padding: 32px 0; font-size: 13px; }
.count-hint { font-size: 12.5px; color: var(--text-tertiary); }
.user-list { display: flex; flex-direction: column; gap: 8px; }
.user-card {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 16px;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-xs);
}
.user-card.inactive { opacity: 0.6; }
.user-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.user-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.user-meta { font-size: 11.5px; color: var(--text-tertiary); font-family: var(--font-mono); }
.type-chip { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; background: var(--bg-hover); color: var(--text-secondary); }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
.badge.on { background: #d1fae5; color: #047857; }
.badge.off { background: var(--slate-100); color: var(--text-tertiary); }
.pager { display: flex; align-items: center; justify-content: center; gap: 10px; }
.btn-primary {
  padding: 8px 16px; border: none; border-radius: var(--r-md); background: var(--grad-teal-indigo);
  color: white; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.btn-ghost {
  padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card);
  color: var(--text-secondary); font-size: 12.5px; cursor: pointer; white-space: nowrap; flex-shrink: 0;
}
.btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-primary); }
.btn-ghost.danger:hover:not(:disabled) { border-color: var(--rose-400); color: var(--rose-500); }
</style>
