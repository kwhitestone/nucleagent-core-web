<script setup lang="ts">
/**
 * 管理区布局 —— 顶部模块 tab 导航 + <router-view>。
 *
 * 对齐 agentia AdminLayout 的职责（菜单收敛 + 布局壳），但视觉语言用 Aurora：
 * tab 样式对齐侧栏 nav-item.active（渐变底 + 左缘高亮条的轻量变体）。
 *
 * 权限收敛：每个模块按自己的读 capability 显示；写端点继续由后端
 * adminmw 强制校验，前端隐藏不是安全边界。
 */
import { computed, ref, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import {
  filterEmbeddedAuthorizedItems,
  useEmbeddedAuthorization,
} from "@/contracts/platform-runtime";
import { isInShell } from "@/contracts/platform-runtime";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const authorization = useEmbeddedAuthorization();
const embedded = isInShell();

const tabs = computed(() => filterEmbeddedAuthorizedItems([
  { to: "/admin/providers", label: t("admin.tabs.providers"), permission: "core:provider:read" },
  { to: "/admin/default-model", label: t("admin.tabs.defaultModel"), permission: "core:admin:read" },
  { to: "/admin/skills", label: t("admin.tabs.skills"), permission: "core:skill:admin-read" },
  { to: "/admin/tools", label: t("admin.tabs.tools"), permission: "core:tool:read" },
  { to: "/admin/executors", label: t("admin.tabs.executors"), permission: "core:admin:read" },
], embedded, authorization.can));

watchEffect(() => {
	if (!embedded) return;
  if (!route.path.startsWith("/admin")) return;
  if (tabs.value.some((tab) => route.path.startsWith(tab.to))) return;
  void router.replace(tabs.value[0]?.to ?? "/chat");
});

/** R-ADMIN A7: one calm, dismissible notice below 1024px, remembered per browser. */
const NOTICE_KEY = "nucleagent_admin_desktop_notice";
const noticeDismissed = ref(localStorage.getItem(NOTICE_KEY) === "1");
function dismissNotice(): void {
  localStorage.setItem(NOTICE_KEY, "1");
  noticeDismissed.value = true;
}

/** 当前激活 tab：按 path 前缀匹配（子路由不含更深嵌套，前缀即精确）。 */
function isActive(to: string): boolean {
  return route.path.startsWith(to);
}
</script>

<template>
  <div class="admin-view">
    <div class="admin-header">
      <div>
        <h1 class="page-title">{{ t("admin.title") }}</h1>
        <p class="page-subtitle">{{ t("admin.subtitle") }}</p>
      </div>
      <nav class="admin-tabs">
        <router-link
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="admin-tab"
          :class="{ active: isActive(tab.to) }"
        >
          {{ tab.label }}
        </router-link>
      </nav>
    </div>
    <p v-if="!noticeDismissed" class="admin-desktop-notice" role="status" data-testid="admin-desktop-notice">
      <span>{{ t("admin.desktopNotice") }}</span>
      <button type="button" :aria-label="t('common.close')" @click="dismissNotice">×</button>
    </p>
    <div class="admin-body">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
/* 布局对齐 Providers.vue 的 .providers-view 体量：内容区自身滚动
   （壳 iframe 高度受限，overflow-y:auto 让长列表不出壳）。 */
.admin-view {
  height: 100%;
  overflow-y: auto;
  max-width: 1080px;
  margin: 0 auto;
  width: 100%;
  padding: 32px 24px 48px;
  display: flex;
  flex-direction: column;
}

.admin-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.page-title { font-size: 22px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
.page-subtitle { font-size: 13px; color: var(--text-secondary); }

.admin-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-xs);
}

.admin-tab {
  padding: 7px 14px;
  border-radius: var(--r-md);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all 0.2s var(--ease);
  white-space: nowrap;
}

.admin-tab:hover { color: var(--text-primary); background: var(--bg-hover); }

.admin-tab.active {
  background: var(--grad-brand-soft);
  color: var(--indigo-600);
  font-weight: 600;
}

.admin-body { flex: 1; min-height: 0; }

.admin-desktop-notice { display: none; }

/* R-ADMIN (board §17) below 1024px: A2 tabs = one row of 44px chips that
   scrolls sideways; A3 title in the shell bar, description ≤ 2 lines; A4 tables
   scroll inside their box; A6 ≥ 44px targets; A7 calm desktop notice.
   A5 (dialogs as full pages) stays desktop-first — documented. */
@media (max-width: 1023.98px) {
  .admin-view { padding: 12px 16px 32px; }
  .admin-header { flex-direction: column; gap: 10px; margin-bottom: 12px; }
  .admin-header > div { width: 100%; }
  .page-title { display: none; }
  .page-subtitle { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .admin-tabs {
    flex-wrap: nowrap; overflow-x: auto; width: calc(100% + 32px); margin: 0 -16px; padding: 0 16px;
    background: transparent; border: 0; box-shadow: none; gap: 8px; scrollbar-width: none;
  }
  .admin-tab {
    flex: none; display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px;
    border: 1px solid var(--border); border-radius: var(--r-full); background: var(--bg-card); font-size: 14px;
  }
  .admin-desktop-notice {
    display: flex; align-items: center; gap: 8px; margin: 0 0 12px; padding: 4px 4px 4px 12px;
    border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-subtle);
    color: var(--text-secondary); font-size: 13px;
  }
  .admin-desktop-notice button {
    margin-left: auto; flex: none; width: 44px; height: 44px; border: 0; background: transparent;
    color: inherit; font-size: 20px; cursor: pointer;
  }
  .admin-body :deep(table) { display: block; max-width: 100%; overflow-x: auto; }
  .admin-body :deep(th:first-child), .admin-body :deep(td:first-child) { position: sticky; left: 0; background: var(--bg-card); z-index: 1; }
  .admin-body :deep(button), .admin-body :deep(a[href]), .admin-body :deep(select) { min-height: 44px; }
  .admin-body :deep(input:not([type=checkbox]):not([type=radio])), .admin-body :deep(select), .admin-body :deep(textarea) { font-size: 16px; }
}
</style>
