<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { listExecutionBackends } from "../api/conversation";
import type { ExecutionBackendOption, ModelChoice } from "../api/types";
import { listProviders, type Provider } from "@/contracts/model-catalog";
import { getPlatformRuntime, SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { createLatestRequestGate } from "../composables/latestRequestGate";
import { broadcastBackendSelection } from "../composables/broadcastViewPolicy";

const props = defineProps<{ modelChoice: ModelChoice | null }>();
const emit = defineEmits<{ "eligible-change": [count: number] }>();
const { t } = useI18n();
const options = ref<ExecutionBackendOption[]>([]);
const providers = ref<Provider[]>([]);
const loading = ref(true);
const failed = ref(false);
const gate = createLatestRequestGate();
const selection = computed(() => broadcastBackendSelection(options.value, props.modelChoice, providers.value));
const eligibleCount = computed(() => loading.value || failed.value ? 0 : selection.value.eligible.length);
watch(eligibleCount, value => emit("eligible-change", value), { immediate: true });

async function load(): Promise<void> {
  const request = gate.begin();
  loading.value = true;
  failed.value = false;
  try {
    const [backends, catalog] = await Promise.all([listExecutionBackends(), listProviders()]);
    if (!request.isCurrent()) return;
    options.value = backends;
    providers.value = catalog;
  } catch {
    if (request.isCurrent()) failed.value = true;
  } finally {
    if (request.isCurrent()) loading.value = false;
  }
}

function sessionChanged(): void {
  gate.invalidate();
  options.value = [];
  providers.value = [];
  loading.value = true;
  if (getPlatformRuntime().getAccessToken()) void load();
}
onMounted(() => {
  window.addEventListener(SESSION_CHANGE_EVENT, sessionChanged);
  void load();
});
onBeforeUnmount(() => {
  gate.invalidate();
  window.removeEventListener(SESSION_CHANGE_EVENT, sessionChanged);
});
</script>

<template>
  <div class="broadcast-options" aria-live="polite">
    <span v-if="loading">{{ t('common.loading') }}</span>
    <template v-else-if="failed">
      <span>{{ t('common.executionBackendLoadFailed') }}</span>
      <button type="button" @click="load">{{ t('common.retry') }}</button>
    </template>
    <template v-else>
      <span>{{ t('broadcast.eligibleCount', { count: eligibleCount }) }}</span>
      <p v-if="!eligibleCount">{{ t('broadcast.noCompatible') }}</p>
      <ul v-if="selection.skipped.length">
        <li v-for="item in selection.skipped" :key="item.backend">
          {{ options.find(option => option.id === item.backend)?.displayName ?? item.backend }}:
          {{ t(`broadcast.reasons.${item.reason}`) }}
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.broadcast-options { padding: 4px 14px 10px; color: var(--text-secondary); text-align: left; font-size: 12px; }
.broadcast-options p { margin: 6px 0 0; }
.broadcast-options ul { margin: 6px 0 0; padding-left: 18px; }
.broadcast-options button { margin-left: 8px; color: var(--indigo-600); background: transparent; border: 0; cursor: pointer; }
</style>
