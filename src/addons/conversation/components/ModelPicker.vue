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
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  fetchVisibleModels,
  listProviders,
  type Provider,
  type UserVisibleModel,
} from "@/contracts/model-catalog";
import { toast } from "@/composables/useToast";
import type { ModelChoice } from "@/addons/conversation/api/types";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { createLatestRequestGate } from "@/addons/conversation/composables/latestRequestGate";

const props = withDefaults(
  defineProps<{
    /** 当前选择；null 表示「用服务端默认」。 */
    modelValue: ModelChoice | null;
    disabled?: boolean;
    /** Existing conversations must keep showing their persisted model. */
    allowDefault?: boolean;
    /** 紧凑态：Home 的图标行空间紧张，不显示 label 文字。 */
    compact?: boolean;
  }>(),
  { disabled: false, allowDefault: true, compact: false },
);

const emit = defineEmits<{ "update:modelValue": [value: ModelChoice | null] }>();

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

/**
 * 取 provider 的模型清单。
 *
 * config 与 models 都是可选，且 config 是自由 JSON —— 必须做 Array.isArray 守卫，
 * 否则脏数据会让整个下拉炸掉（与 Providers.vue 的 modelsOf 同一处理）。
 */
function modelsOf(p: Provider): string[] {
  const m = p.config?.models;
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : [];
}

/** 只保留启用且配了模型清单的 provider —— 没配 models 的选不出东西来。 */
const usable = computed(() => providers.value.filter((p) => p.isActive && modelsOf(p).length > 0));

/**
 * 可见模型组选项：只保留能解析出具体落点（targetModel 非空）的组。
 * value 直接用具体 "{configId}:{targetModel}"，与全量列表的编码一致 ——
 * onChange 无需区分来源。
 */
const visibleOptions = computed(() =>
  visibleModels.value.filter((m) => m.targetModel && m.configId > 0),
);

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
    (provider) => provider.id === props.modelValue?.providerId &&
      modelsOf(provider).includes(props.modelValue.model),
  );
});

function onChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value;
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
	const [nextProviders, nextVisible] = await Promise.all([
	  listProviders(),
	  // 可见模型拉不到不视为失败（未配置时本来就是空数组）。
	  fetchVisibleModels().catch(() => []),
	]);
	if (!request.isCurrent()) return;
	providers.value = nextProviders;
	visibleModels.value = nextVisible;
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
  <label class="model-picker" :class="{ compact }">
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
        {{ t('common.modelCurrentUnavailable', { model: modelValue.model }) }}
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
            v-for="m in modelsOf(p)"
            :key="`${p.id}:${m}`"
            :value="`${p.id}:${m}`"
            :selected="selected === `${p.id}:${m}`"
          >
            {{ m }}
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
