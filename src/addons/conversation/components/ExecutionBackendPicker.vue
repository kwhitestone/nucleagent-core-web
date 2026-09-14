<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { listExecutionBackends } from "@/addons/conversation/api/conversation";
import { listProviders, type Provider } from "@/contracts/model-catalog";
import type { ExecutionBackendOption, ModelChoice } from "@/addons/conversation/api/types";
import {
  executionBackendCompatibility,
  type ExecutionBackendCompatibility,
  type ExecutionBackendCompatibilityReason,
} from "@/addons/conversation/composables/executionBackendCompatibility";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { createLatestRequestGate } from "@/addons/conversation/composables/latestRequestGate";
import { toast } from "@/composables/useToast";

const props = withDefaults(defineProps<{
  modelValue: string | null;
  disabled?: boolean;
  compact?: boolean;
  autoSelect?: boolean;
  modelChoice?: ModelChoice | null;
}>(), { disabled: false, compact: false, autoSelect: true });

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "validation-change": [value: ExecutionBackendCompatibility];
}>();
const { t } = useI18n();
const options = ref<ExecutionBackendOption[]>([]);
const providers = ref<Provider[]>([]);
const loading = ref(false);
const requestGate = createLatestRequestGate();
const compatibility = (item: ExecutionBackendOption) =>
  executionBackendCompatibility(item, props.modelChoice ?? null, providers.value);
const fallback = computed(() =>
  options.value.find((item) => item.default && compatibility(item).allowed)?.id ??
  options.value.find((item) => compatibility(item).allowed)?.id ?? "",
);
const selected = computed(() => props.modelValue || fallback.value);
const selectedAvailable = computed(() => options.value.some((item) => item.id === props.modelValue));
const selectedCompatibility = computed<ExecutionBackendCompatibility>(() => {
  const option = options.value.find((item) => item.id === selected.value);
  return option ? compatibility(option) : { allowed: false, reason: "model_required" };
});

function reasonLabel(reason: ExecutionBackendCompatibilityReason): string {
  if (reason === "model_required") return t("common.executionBackendNeedsModel");
  if (reason === "protocol_incompatible") return t("common.executionBackendProtocolIncompatible");
  return "";
}

function optionLabel(item: ExecutionBackendOption): string {
  const suffix = reasonLabel(compatibility(item).reason);
  return `${item.displayName}${item.default ? ` · ${t("common.default")}` : ""}${suffix ? ` · ${suffix}` : ""}`;
}

function onChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value) emit("update:modelValue", value);
}

async function loadOptions(warn = true): Promise<void> {
	const request = requestGate.begin();
  loading.value = true;
  const [backendResult, providerResult] = await Promise.allSettled([
    listExecutionBackends(),
    listProviders(),
  ]);
	if (!request.isCurrent()) return;
  if (backendResult.status === "fulfilled") options.value = backendResult.value;
  else if (warn) toast.warning(t("common.executionBackendLoadFailed"));
  if (providerResult.status === "fulfilled") providers.value = providerResult.value;
  else if (warn) toast.warning(t("common.modelLoadFailed"));
  loading.value = false;

  if (backendResult.status === "fulfilled") {
    const initial = fallback.value;
    if (props.autoSelect && !props.modelValue && initial) emit("update:modelValue", initial);
  }
}

function onSessionChange(event: Event): void {
  const authenticated = (event as CustomEvent<{ authenticated?: unknown }>).detail?.authenticated === true;
  if (!authenticated) {
	requestGate.invalidate();
    options.value = [];
    providers.value = [];
    loading.value = false;
    return;
  }
  void loadOptions(false);
}

// A restored selection can equal the fallback while the parent has reset its
// validation state for another conversation. Revalidate the input as well.
watch(
  [selectedCompatibility, () => props.modelValue, () => props.modelChoice],
  ([value]) => emit("validation-change", value),
  { immediate: true },
);

onMounted(() => {
  window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange);
  void loadOptions();
});

onBeforeUnmount(() => {
	requestGate.invalidate();
	window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
});
</script>

<template>
  <label class="execution-backend-picker" :class="{ compact }">
    <span v-if="!compact" class="execution-backend-picker-label">{{ t('common.executionBackend') }}</span>
    <select
      class="execution-backend-picker-select"
      :value="selected"
      :disabled="disabled || loading || options.length === 0"
      :title="t('common.executionBackend')"
      @change="onChange"
    >
      <option v-if="modelValue && !selectedAvailable" :value="modelValue" selected disabled>
        {{ t('common.executionBackendCurrentUnavailable', { backend: modelValue }) }}
      </option>
      <option
        v-for="item in options"
        :key="item.id"
        :value="item.id"
        :disabled="!compatibility(item).allowed"
      >
        {{ optionLabel(item) }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.execution-backend-picker { display: inline-flex; align-items: center; gap: 6px; font: 13px var(--font-body); }
.execution-backend-picker-label { color: var(--text-secondary); white-space: nowrap; }
.execution-backend-picker-select { max-width: 190px; padding: 5px 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); color: var(--text-primary); font: inherit; cursor: pointer; text-overflow: ellipsis; }
.execution-backend-picker-select:focus { outline: none; border-color: var(--teal-300); }
.execution-backend-picker-select:disabled { opacity: .5; cursor: not-allowed; }
.execution-backend-picker.compact .execution-backend-picker-select { max-width: 116px; width: auto; flex: 0 1 auto; padding: 4px 6px; font-size: 12.5px; border-color: transparent; background: transparent; color: var(--text-tertiary); }
.execution-backend-picker.compact .execution-backend-picker-select:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }
</style>
