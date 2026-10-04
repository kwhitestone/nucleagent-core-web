<script setup lang="ts">
/**
 * 模型提供商 —— 只读的「目鱼网关」条目（UNI-UI-GAP，GWLINK 设计 §2.1(6)）。
 *
 * 模型由目鱼网关统一提供：页面只显示一个条目，旧的提供商行（已停用/已收拢）
 * 不再列出，也不再提供新增、编辑、启停或删除。网关目录同步与刷新由
 * GWLINK-R3 的 core-web 波次在此基础上补充。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/contracts/platform-runtime";
import { listProviders, type Provider } from "@/contracts/model-catalog";
import { toast } from "@/composables/useToast";
import { gatewayModels } from "../provider/gatewayEntry";

const { t } = useI18n();

const providers = ref<Provider[]>([]);
const loading = ref(true);
const models = computed(() => gatewayModels(providers.value));

onMounted(async () => {
  try {
    providers.value = await listProviders();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("provider.loadFailed"));
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="view active">
    <div class="providers-view">
      <div class="providers-header">
        <div>
          <h1 class="page-title">{{ t('provider.title') }}</h1>
        </div>
      </div>

      <p v-if="loading" class="providers-empty">{{ t('common.loading') }}</p>

      <div v-else class="provider-list">
        <div class="provider-card" data-testid="provider-gateway">
          <div class="provider-main">
            <div class="provider-title-row">
              <span class="provider-name">{{ t('provider.gatewayName') }}</span>
              <span class="provider-badge on">{{ t('provider.gatewayManaged') }}</span>
            </div>
            <p class="provider-note">{{ t('provider.gatewayNote') }}</p>
            <div class="provider-models-title">{{ t('provider.gatewayModels', { count: models.length }) }}</div>
            <div v-if="models.length" class="provider-models">
              <span v-for="m in models" :key="m" class="model-chip">{{ m }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.providers-view {
  max-width: 880px; margin: 0 auto; width: 100%;
  padding: 32px 24px 48px;
}

.providers-header { margin-bottom: 16px; }

.page-title { font-size: 22px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }

.providers-empty { color: var(--text-tertiary); text-align: center; padding: 40px 0; font-size: 14px; }

.provider-list { display: flex; flex-direction: column; gap: 12px; }

.provider-card {
  padding: 16px 18px;
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--r-lg); box-shadow: var(--shadow-xs);
}

.provider-main { min-width: 0; }
.provider-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
.provider-name { font-size: 15px; font-weight: 600; color: var(--text-primary); }

.provider-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
.provider-badge.on { background: #d1fae5; color: #047857; }

.provider-note { font-size: 12.5px; color: var(--text-secondary); margin: 6px 0 10px; }
.provider-models-title { font-size: 12px; color: var(--text-tertiary); }

.provider-models { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.model-chip {
  font-size: 11px; padding: 2px 7px; border-radius: var(--r-sm);
  background: var(--bg-hover); color: var(--text-secondary); font-family: var(--font-mono);
}
</style>
