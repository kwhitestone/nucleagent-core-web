<script setup lang="ts">
/**
 * 模型选择器 —— 三处入口（Home / TaskSetup / Conversation）共用。
 *
 * 用原生 <select> 而不自绘浮层：本项目没有可复用的下拉组件（全仓库只有几处原生
 * select，且 element-plus 已被刻意弃用 —— 见 main.ts 注释，其样式与 Aurora 冲突）。
 * 原生 select 的键盘操作与可访问性天然正确，先用它，需要更花的样式再说。
 *
 * value 编码成 "{providerId}:{model}"：**光有模型名不足以定位 provider** ——
 * 后端 llmproxy 按 providerId 查库解密 API key，同名模型可能挂在不同 provider 下。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  fetchVisibleModels,
  listAllTypedModels,
  listProviders,
  type ModelType,
  type Provider,
  type TypedModel,
  type UserVisibleModel,
} from "@/contracts/model-catalog";
import { toast } from "@/composables/useToast";
import type { ModelChoice } from "@/addons/conversation/api/types";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { createLatestRequestGate } from "@/addons/conversation/composables/latestRequestGate";
import { modelTypeName } from "@/addons/conversation/composables/modelErrorMessage";
import OptionSheet, { type SheetOption } from "./OptionSheet.vue";
import { narrowTo, pickerOptions, visiblePickerOptions } from "./modelPickerOptions";

const props = withDefaults(
  defineProps<{
    /** 当前选择；null 表示「用服务端默认」。 */
    modelValue: ModelChoice | null;
    disabled?: boolean;
    /** Existing conversations must keep showing their persisted model. */
    allowDefault?: boolean;
    /** 紧凑态：Home 的图标行空间紧张，不显示 label 文字。 */
    compact?: boolean;
    /** Phones (board §12): a 52px list row that opens an option sheet instead of a <select>. */
    row?: boolean;
    /** Model type to list (MT2-coreweb); chat boxes and the task page keep the default. */
    type?: string;
    /** MT3: allowed "{providerId}:{model}" keys (`/media/models?kind=`); unset = no extra filter. */
    only?: string[];
    /** MT3: note shown after an option, by "{providerId}:{model}" (e.g. unverified). */
    notes?: Record<string, string>;
  }>(),
  { disabled: false, allowDefault: true, compact: false, row: false, type: "chat" },
);

const emit = defineEmits<{
  "update:modelValue": [value: ModelChoice | null];
  /** Row mode: the display name of the current choice, for a parent's summary pill. */
  label: [value: string];
}>();

const { t } = useI18n();
const providers = ref<Provider[]>([]);
const loading = ref(false);
const requestGate = createLatestRequestGate();
/**
 * 管理端 v2 模式组派生的「用户可见模型」列表。
 *
 * 非空时下拉展示组（alias=组名）替代全量 provider×model；选中值仍解码为
 * 该组默认 profile 的具体 {providerId, model}——conversation 持久化的是
 * 具体对，不做组引用（组配置改了不该改写历史会话的模型语义）。
 * 列表拉不到/未配置时回退全量列表（与旧行为一致）。
 */
const visibleModels = ref<UserVisibleModel[]>([]);
/** All types from `/provider/models?type=`; null = old Core (fallback to config.models). */
const typedAll = ref<Record<ModelType, TypedModel[]> | null>(null);
const typed = computed(() => typedAll.value?.[props.type as ModelType] ?? null);

/** Active providers with this type's models (chat: config.models ∩ typed chat). */
const usable = computed(() => narrowTo(pickerOptions(providers.value, typed.value, props.type), props.only));
const noteOf = (key: string): string => (props.notes?.[key] ? ` · ${props.notes[key]}` : "");

/**
 * 可见模型组选项：只保留能解析出具体落点（targetModel 非空）的组。
 * value 直接用具体 "{configId}:{targetModel}"，与全量列表的编码一致 ——
 * onChange 无需区分来源。
 */
const visibleOptions = computed(() => visiblePickerOptions(visibleModels.value, props.type));

/** 当前选中项编码。空串 = 用服务端默认。 */
const selected = computed(() =>
  props.modelValue ? `${props.modelValue.providerId}:${props.modelValue.model}` : "",
);

const selectedAvailable = computed(() => {
  if (!props.modelValue) return true;
  // 可见模型组模式下，「在组清单里」也算可用（组即推荐入口）。
  if (visibleOptions.value.some(
    (m) => m.configId === props.modelValue?.providerId && m.targetModel === props.modelValue?.model,
  )) return true;
  return usable.value.some(
    (group) => group.id === props.modelValue?.providerId && group.models.includes(props.modelValue.model),
  );
});

/** Type name of an unavailable current model, when the typed lists know it and it is not this picker's type. */
const unavailableType = computed(() => {
  const current = props.modelValue;
  if (!current || selectedAvailable.value || !typedAll.value) return "";
  for (const [type, list] of Object.entries(typedAll.value)) {
    if (type !== props.type && list.some((m) => m.providerId === current.providerId && m.model === current.model)) return type;
  }
  return "";
});
const unavailableLabel = computed(() => {
  const base = t("common.modelCurrentUnavailable", { model: props.modelValue?.model ?? "" });
  return unavailableType.value && props.type === "chat"
    ? `${base} · ${t("common.modelNotChat", { type: modelTypeName(unavailableType.value, t) })}`
    : base;
});

/** The same options as the <select>, flattened for the phone sheet. */
const sheetOptions = computed<SheetOption[]>(() => {
  const out: SheetOption[] = [];
  if (props.allowDefault || !props.modelValue) out.push({ value: "", label: t("common.modelDefault") });
  if (visibleOptions.value.length) {
    for (const m of visibleOptions.value) out.push({ value: `${m.configId}:${m.targetModel}`, label: m.alias || m.model });
  } else {
    for (const p of usable.value) for (const m of p.models) out.push({ value: `${p.id}:${m}`, label: m + noteOf(`${p.id}:${m}`), note: p.name });
  }
  return out;
});
const selectedLabel = computed(() =>
  sheetOptions.value.find((o) => o.value === selected.value)?.label ??
  (props.modelValue ? props.modelValue.model : t("common.modelDefault")));
watch(selectedLabel, (value) => emit("label", value), { immediate: true });
const sheetOpen = ref(false);
function onSheetPick(value: string | string[]): void {
  onValue(String(value));
}

function onChange(event: Event): void {
  onValue((event.target as HTMLSelectElement).value);
}

function onValue(raw: string): void {
  if (!raw) {
    emit("update:modelValue", null);
    return;
  }
  // 模型名里可能含冒号，只按第一个冒号切分。
  const idx = raw.indexOf(":");
  const providerId = Number(raw.slice(0, idx));
  const model = raw.slice(idx + 1);
  if (!providerId || !model) {
    emit("update:modelValue", null);
    return;
  }
  emit("update:modelValue", { providerId, model });
}

async function loadModels(warn = true): Promise<void> {
	const request = requestGate.begin();
  loading.value = true;
  try {
	const [nextProviders, nextVisible, nextTyped] = await Promise.all([
	  listProviders(),
	  // 可见模型拉不到不视为失败（未配置时本来就是空数组）。
	  fetchVisibleModels().catch(() => []),
	  // Typed lists: old Core (404) or a failed read falls back to config.models.
	  listAllTypedModels().catch(() => null),
	]);
	if (!request.isCurrent()) return;
	providers.value = nextProviders;
	visibleModels.value = nextVisible;
	typedAll.value = nextTyped;
  } catch {
    // 取不到清单不阻断发送：留空即用服务端默认模型。
	if (request.isCurrent() && warn) toast.warning(t("common.modelLoadFailed"));
  } finally {
	if (request.isCurrent()) loading.value = false;
  }
}

function onSessionChange(event: Event): void {
  const authenticated = (event as CustomEvent<{ authenticated?: unknown }>).detail?.authenticated === true;
  if (!authenticated) {
	requestGate.invalidate();
    providers.value = [];
    visibleModels.value = [];
    typedAll.value = null;
    loading.value = false;
    return;
  }
  void loadModels(false);
}

onMounted(() => {
  window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange);
  void loadModels();
});

onBeforeUnmount(() => {
	requestGate.invalidate();
	window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
});
</script>

<template>
  <template v-if="row">
    <button type="button" class="picker-row" data-testid="row-model" :disabled="disabled || loading" @click="sheetOpen = true">
      <span class="picker-row-k">{{ t('common.model') }}</span>
      <span class="picker-row-v">{{ selectedLabel }}</span>
      <svg class="picker-row-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
    </button>
    <OptionSheet :open="sheetOpen" :title="t('common.model')" :options="sheetOptions" :model-value="selected" @update:model-value="onSheetPick" @close="sheetOpen = false" />
  </template>
  <label v-else class="model-picker" :class="{ compact }">
    <span v-if="!compact" class="model-picker-label">{{ t('common.model') }}</span>
    <select
      class="model-picker-select"
      :value="selected"
      :disabled="disabled || loading"
      :title="t('common.model')"
      @change="onChange"
    >
      <!-- 空值 = 用服务端默认模型（executor 的兜底配置） -->
      <option
        v-if="allowDefault || !modelValue"
        value=""
        :selected="selected === ''"
      >
        {{ t('common.modelDefault') }}
      </option>
      <option
        v-if="modelValue && !selectedAvailable"
        :value="selected"
        selected
        disabled
      >
        {{ unavailableLabel }}
      </option>
      <!-- 管理端可见模型组（v2 配置存在时）：显示名优先，落点仍是具体模型。
           组清单非空时隐藏全量列表（组即运营圈定的推荐面），空则回退全量。 -->
      <option
        v-for="m in visibleOptions"
        :key="m.model"
        :value="`${m.configId}:${m.targetModel}`"
        :selected="selected === `${m.configId}:${m.targetModel}`"
      >
        {{ m.alias || m.model }}
      </option>
      <template v-if="!visibleOptions.length">
        <optgroup v-for="p in usable" :key="p.id" :label="p.name">
          <option
            v-for="m in p.models"
            :key="`${p.id}:${m}`"
            :value="`${p.id}:${m}`"
            :selected="selected === `${p.id}:${m}`"
          >
            {{ m + noteOf(`${p.id}:${m}`) }}
          </option>
        </optgroup>
      </template>
    </select>
  </label>
</template>

<style scoped>
.model-picker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-family: var(--font-body);
}

.model-picker-label {
  color: var(--text-secondary);
  white-space: nowrap;
}

.model-picker-select {
  max-width: 190px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
  text-overflow: ellipsis;
}

.model-picker-select:focus {
  outline: none;
  border-color: var(--teal-300);
}

.model-picker-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 紧凑态用于 Home 的 36px 图标行：再窄一点，避免挤压 textarea。 */
.model-picker.compact .model-picker-select {
  max-width: 116px; width: auto; flex: 0 1 auto;
  padding: 4px 6px;
  font-size: 12.5px;
  border-color: transparent;
  background: transparent;
  color: var(--text-tertiary);
}

.model-picker.compact .model-picker-select:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
}
</style>
