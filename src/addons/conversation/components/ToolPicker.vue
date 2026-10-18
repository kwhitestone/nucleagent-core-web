<script setup lang="ts">
/**
 * 工具多选器（G-TASK-TOOL-PICK-1900）—— 创建任务时额外选择工具，下发 toolIds
 * （后端写 tool_bindings(owner_type=conversation) 并逐个校验可选）。不选 = 现行为。
 * 数据由父组件传入（TaskSetup 加载 GET /tool/catalog），父组件提交前也要用同一份
 * 列表剔除已随所选技能提供的工具。交互与 SkillPicker 一致：OptionSheet + chip。
 * 样式复用 SkillPicker 的 skill-* 类（全局 picker 外观），不另起一套。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { coveredBySkills, toolLabel, toolOptions, type ToolCatalogItem } from "@/addons/conversation/api/toolCatalog";
import OptionSheet from "./OptionSheet.vue";
import { BINDINGS_MAX } from "../api/sessionBindings";

const props = withDefaults(defineProps<{
  modelValue: number[];
  tools: ToolCatalogItem[];
  /** Selected skills: their tools are shown as already provided, not pickable. */
  skillIds?: number[];
  loading?: boolean;
  failed?: boolean;
  disabled?: boolean;
  row?: boolean;
}>(), { skillIds: () => [], loading: false, failed: false, disabled: false, row: false });
const emit = defineEmits<{ "update:modelValue": [value: number[]]; retry: [] }>();
const { t, locale } = useI18n();
const open = ref(false);
const options = computed(() => toolOptions(props.tools, locale.value, t("common.skillBadgeImported"), props.skillIds, t("common.toolCoveredBySkill")).map((option) => ({
  ...option, disabled: props.disabled || option.disabled || (props.modelValue.length >= BINDINGS_MAX && !props.modelValue.includes(Number(option.value))),
})));
const chips = computed(() => props.modelValue.map((id) => {
  const tool = props.tools.find((x) => x.id === id);
  return { id, name: tool ? toolLabel(tool, locale.value) : `#${id}`, missing: !tool && !props.loading, covered: coveredBySkills(tool, props.skillIds) };
}));
const rowValue = computed(() => chips.value.length ? chips.value.map((c) => c.name).join("、") : t("common.toolNone"));
function onSheet(value: string | string[]): void {
  const ids = [value].flat().map(Number);
  if (!props.disabled && (ids.length <= BINDINGS_MAX || ids.length < props.modelValue.length)) emit("update:modelValue", ids);
}
function remove(id: number): void {
  if (!props.disabled) emit("update:modelValue", props.modelValue.filter((x) => x !== id));
}
</script>

<template>
  <OptionSheet
    :open="open"
    :title="t('common.tool')"
    :options="options"
    :model-value="modelValue.map(String)"
    :loading="loading"
    :error="failed ? t('common.toolLoadError') : ''"
    :empty-text="t('common.toolEmpty')"
    :search-placeholder="t('common.toolSearch')"
    multiple
    searchable
    @update:model-value="onSheet"
    @retry="emit('retry')"
    @close="open = false"
  />
  <button v-if="row" type="button" class="picker-row" data-testid="row-tools" :disabled="disabled" @click="open = true">
    <span class="picker-row-k">{{ t('common.tool') }}</span>
    <span class="picker-row-v">{{ rowValue }}</span>
    <svg class="picker-row-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
  </button>
  <div v-else class="tool-picker">
    <button class="tool-toggle" :class="{ active: modelValue.length > 0 }" type="button" data-testid="tool-picker-open"
      :disabled="disabled" aria-haspopup="dialog" :aria-expanded="open" @click="open = true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
      <span>{{ loading ? t('common.toolLoading') : t('common.toolSelect') }}</span>
      <span v-if="!loading && !failed" class="tool-total">{{ t('common.skillCount', { n: tools.length }) }}</span>
      <span v-if="modelValue.length > 0" class="tool-count">{{ modelValue.length }}</span>
    </button>
  </div>
  <div v-if="chips.length > 0" class="tool-chips" :class="{ 'tool-chips-row': row }" data-testid="tool-chips">
    <span v-for="chip in chips" :key="chip.id" class="tool-chip" :class="{ missing: chip.missing || chip.covered }">
      <span class="tool-chip-name" :title="chip.name">{{ chip.name }}</span>
      <span v-if="chip.missing" class="tool-chip-badge warn">{{ t('common.toolBadgeInactive') }}</span>
      <span v-else-if="chip.covered" class="tool-chip-badge">{{ t('common.toolCoveredBySkill') }}</span>
      <button class="tool-chip-remove" type="button" :disabled="disabled" :title="t('common.toolRemove')"
        :aria-label="`${t('common.toolRemove')} ${chip.name}`" @click="remove(chip.id)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </span>
  </div>
  <p v-if="modelValue.length >= BINDINGS_MAX" class="binding-limit" role="status">{{ t('common.bindingsLimit', { n: BINDINGS_MAX }) }}</p>
</template>

<style scoped>
/* Same look as SkillPicker (its styles are scoped, so mirrored here). */
.tool-picker { display: flex; flex-direction: column; align-items: flex-start; }
.tool-toggle { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: none; color: var(--text-tertiary); cursor: pointer; border-radius: var(--r-sm); padding: 6px 8px; font-size: 13px; font-family: var(--font-body); transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out); }
.tool-toggle:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }
.tool-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
.tool-toggle.active { color: var(--teal-600); }
.tool-toggle svg { width: 18px; height: 18px; }
.tool-count { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--teal-600); color: #fff; font-size: 11px; line-height: 16px; text-align: center; }
.tool-total { color: var(--text-tertiary); font-size: 12px; }
.tool-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tool-chips-row { padding: 0 16px 8px; margin-top: 0; }
.tool-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 260px; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); font-size: 12.5px; font-family: var(--font-body); }
.tool-chip.missing { border-color: var(--amber-500, #f59e0b); }
.tool-chip-badge { flex-shrink: 0; padding: 0 5px; border-radius: 8px; background: var(--bg-subtle); color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.tool-chip-badge.warn { color: var(--amber-600, #d97706); }
.tool-chip-name { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-chip-remove { display: inline-flex; background: none; border: none; padding: 0; color: var(--text-tertiary); cursor: pointer; flex-shrink: 0; }
.tool-chip-remove:hover:not(:disabled) { color: var(--rose-500); }
.tool-chip-remove:disabled { opacity: 0.5; cursor: not-allowed; }
.tool-chip-remove svg { width: 13px; height: 13px; }
</style>
