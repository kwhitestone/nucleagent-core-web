<script setup lang="ts">
/**
 * 技能多选器 —— 创建任务时预选技能（写入 SkillBinding(owner_type=conversation)）。
 *
 * 形态选的是 AttachmentPicker + AttachmentChips 那套「选择入口 + chip 回显 +
 * 可移除」，而不是 ModelPicker 的单选下拉：技能是 0..N 且选完要能一眼看清
 * 选了哪些、逐个摘掉。原生 <select multiple> 不满足——它的多选交互（按住
 * Ctrl 点）在触控和普通用户手里基本不可用，且选中项无法单独移除。
 *
 * 展开面板用的是 checkbox 列表而非自绘浮层：项目没有下拉组件可复用
 * （element-plus 已被刻意弃用，见 main.ts 注释），checkbox 的键盘操作与
 * 可访问性天然正确。
 *
 * loading/disabled/防竞态（createLatestRequestGate + SESSION_CHANGE_EVENT）
 * 照 ModelPicker 的样板，保证换账号后旧响应不会把上个用户的技能列表灌进来。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { listSkills } from "@/addons/conversation/api/skill";
import { toast } from "@/composables/useToast";
import type { Skill } from "@/addons/conversation/api/types";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { createLatestRequestGate } from "@/addons/conversation/composables/latestRequestGate";
import OptionSheet, { type SheetOption } from "./OptionSheet.vue";

const props = withDefaults(
  defineProps<{
    /** 已选技能 ID（由父组件持有，本组件通过 v-model 更新）。 */
    modelValue: number[];
    disabled?: boolean;
    /** Phones (board §12): list row (default 自动匹配) + searchable multi-select sheet. */
    row?: boolean;
  }>(),
  { disabled: false, row: false },
);

const emit = defineEmits<{ "update:modelValue": [value: number[]] }>();

const { t, locale } = useI18n();
const skills = ref<Skill[]>([]);
const loading = ref(false);
const expanded = ref(false);
const requestGate = createLatestRequestGate();

/**
 * 展示名：优先取 i18n 里当前语言的 name，回退到库里的 name。
 *
 * i18n 是自由 JSON（后端 model.Skill.I18n 是 JSON 列），必须逐层做类型守卫，
 * 脏数据不能让整个列表炸掉（与 ModelPicker.modelsOf 的 Array.isArray 同款考量）。
 */
function displayName(skill: Skill): string {
  const bundle = skill.i18n?.[locale.value];
  if (bundle && typeof bundle === "object") {
    const name = (bundle as Record<string, unknown>).name;
    if (typeof name === "string" && name) return name;
  }
  return skill.name || skill.slug;
}

function describe(skill: Skill): string {
  const desc = skill.config?.description;
  return typeof desc === "string" ? desc : "";
}

/** 已选 ID → Skill。选中项可能在列表里找不到（技能被停用/删除），过滤掉。 */
const selectedSkills = computed(() =>
  props.modelValue
    .map((id) => skills.value.find((s) => s.id === id))
    .filter((s): s is Skill => s !== undefined),
);

const sheetOpen = ref(false);
const sheetOptions = computed<SheetOption[]>(() =>
  skills.value.map((s) => ({ value: String(s.id), label: displayName(s), note: describe(s) || undefined })));
const rowValue = computed(() => selectedSkills.value.length
  ? selectedSkills.value.map(displayName).join("、")
  : t("common.skillAuto"));
function onSheet(value: string | string[]): void {
  if (!props.disabled) emit("update:modelValue", (Array.isArray(value) ? value : [value]).map(Number));
}

function isSelected(id: number): boolean {
  return props.modelValue.includes(id);
}

function toggle(id: number): void {
  if (props.disabled) return;
  emit(
    "update:modelValue",
    isSelected(id) ? props.modelValue.filter((x) => x !== id) : [...props.modelValue, id],
  );
}

function remove(id: number): void {
  if (props.disabled) return;
  emit("update:modelValue", props.modelValue.filter((x) => x !== id));
}

async function load(warn = true): Promise<void> {
  const request = requestGate.begin();
  loading.value = true;
  try {
    const next = await listSkills();
    if (!request.isCurrent()) return;
    skills.value = next;
  } catch {
    // 拉不到技能不阻断建任务：不选技能时后端会走自动语义匹配兜底。
    if (request.isCurrent() && warn) toast.warning(t("common.skillLoadFailed"));
  } finally {
    if (request.isCurrent()) loading.value = false;
  }
}

function onSessionChange(event: Event): void {
  const authenticated =
    (event as CustomEvent<{ authenticated?: unknown }>).detail?.authenticated === true;
  if (!authenticated) {
    requestGate.invalidate();
    skills.value = [];
    loading.value = false;
    expanded.value = false;
    // 换账号后旧账号的选择不能留着：技能 ID 对新账号没有意义。
    if (props.modelValue.length > 0) emit("update:modelValue", []);
    return;
  }
  void load(false);
}

onMounted(() => {
  window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange);
  void load();
});

onBeforeUnmount(() => {
  requestGate.invalidate();
  window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
});
</script>

<template>
  <template v-if="row">
    <button type="button" class="picker-row" data-testid="row-skills" :disabled="disabled || loading" @click="sheetOpen = true">
      <span class="picker-row-k">{{ t('common.skill') }}</span>
      <span class="picker-row-v">{{ rowValue }}</span>
      <svg class="picker-row-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
    </button>
    <OptionSheet
      :open="sheetOpen"
      :title="t('common.skill')"
      :options="sheetOptions"
      :model-value="modelValue.map(String)"
      multiple
      searchable
      @update:model-value="onSheet"
      @close="sheetOpen = false"
    />
  </template>
  <div v-else class="skill-picker">
    <button
      class="skill-toggle"
      :class="{ active: modelValue.length > 0 }"
      type="button"
      :disabled="disabled || loading"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
      <span>{{ loading ? t('common.skillLoading') : t('common.skillSelect') }}</span>
      <span v-if="modelValue.length > 0" class="skill-count">{{ modelValue.length }}</span>
    </button>

    <div v-if="expanded" class="skill-options">
      <p v-if="!loading && skills.length === 0" class="skill-empty">{{ t('common.skillEmpty') }}</p>
      <label v-for="skill in skills" :key="skill.id" class="skill-option">
        <input
          type="checkbox"
          :checked="isSelected(skill.id)"
          :disabled="disabled"
          @change="toggle(skill.id)"
        />
        <span class="skill-option-body">
          <span class="skill-option-name">{{ displayName(skill) }}</span>
          <span v-if="describe(skill)" class="skill-option-desc">{{ describe(skill) }}</span>
        </span>
      </label>
    </div>

    <div v-if="selectedSkills.length > 0" class="skill-chips">
      <span v-for="skill in selectedSkills" :key="skill.id" class="skill-chip">
        <span class="skill-chip-name" :title="displayName(skill)">{{ displayName(skill) }}</span>
        <button
          class="skill-chip-remove"
          type="button"
          :disabled="disabled"
          :title="t('common.skillRemove')"
          @click="remove(skill.id)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.skill-picker {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.skill-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--r-sm);
  padding: 6px 8px;
  font-size: 13px;
  font-family: var(--font-body);
  transition:
    color 0.2s var(--ease-out),
    background 0.2s var(--ease-out);
}

.skill-toggle:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.skill-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.skill-toggle.active {
  color: var(--teal-600);
}

.skill-toggle svg {
  width: 18px;
  height: 18px;
}

.skill-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--teal-600);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}

.skill-options {
  align-self: stretch;
  margin-top: 6px;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-card);
  padding: 4px;
}

.skill-empty {
  padding: 8px 10px;
  font-size: 12.5px;
  color: var(--text-tertiary);
}

.skill-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 8px;
  border-radius: var(--r-sm);
  cursor: pointer;
  font-size: 13px;
}

.skill-option:hover {
  background: var(--bg-hover);
}

.skill-option input {
  margin-top: 2px;
  accent-color: var(--teal-600);
  cursor: pointer;
  flex-shrink: 0;
}

.skill-option-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.skill-option-name {
  color: var(--text-primary);
  font-weight: 500;
}

.skill-option-desc {
  color: var(--text-tertiary);
  font-size: 11.5px;
  line-height: 1.4;
}

.skill-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  font-size: 12.5px;
  font-family: var(--font-body);
}

.skill-chip-name {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-chip-remove {
  display: inline-flex;
  background: none;
  border: none;
  padding: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
}

.skill-chip-remove:hover:not(:disabled) {
  color: var(--rose-500);
}

.skill-chip-remove:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.skill-chip-remove svg {
  width: 13px;
  height: 13px;
}
</style>
