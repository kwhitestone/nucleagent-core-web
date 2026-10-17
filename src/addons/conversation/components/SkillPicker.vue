<script setup lang="ts">
/**
 * 技能多选器 —— 创建任务时预选技能（写入 SkillBinding(owner_type=conversation)）。
 *
 * 形态选的是 AttachmentPicker + AttachmentChips 那套「选择入口 + chip 回显 +
 * 可移除」，而不是 ModelPicker 的单选下拉：技能是 0..N 且选完要能一眼看清
 * 选了哪些、逐个摘掉。原生 <select multiple> 不满足——它的多选交互（按住
 * Ctrl 点）在触控和普通用户手里基本不可用，且选中项无法单独移除。
 *
 * L7：几百个技能时桌面端也用 OptionSheet（桌面居中弹层）：来源分组（系统/
 * 导入/我的）、防抖搜索名称/描述/分类并高亮、每次 50 条分页、导入/需启用角标、
 * 加载/错误/空态。数据仍是 GET /skill 全量，后端不改（见 pickerSearch.ts）。
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
import OptionSheet, { type SheetGroup, type SheetOption } from "./OptionSheet.vue";
import { SKILL_SOURCES, skillSource, type SkillSource } from "./pickerSearch.ts";

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
/** Last load failed; the sheet shows an error with retry instead of "no skills". */
const failed = ref(false);
const loaded = ref(false);
const requestGate = createLatestRequestGate();

/**
 * 展示名：优先取 i18n 里当前语言的 name，回退到库里的 name。
 *
 * i18n 是自由 JSON（后端 model.Skill.I18n 是 JSON 列），必须逐层做类型守卫，
 * 脏数据不能让整个列表炸掉（与 ModelPicker.modelsOf 的 Array.isArray 同款考量）。
 */
function localized(skill: Skill, key: "name" | "description"): string {
  const bundle = skill.i18n?.[locale.value];
  if (bundle && typeof bundle === "object") {
    const value = (bundle as Record<string, unknown>)[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function displayName(skill: Skill): string {
  return localized(skill, "name") || skill.name || skill.slug;
}

function describe(skill: Skill): string {
  const desc = skill.config?.description;
  return localized(skill, "description") || (typeof desc === "string" ? desc : "");
}

const GROUP_LABEL: Record<SkillSource, string> = { system: "common.skillGroupSystem", imported: "common.skillGroupImported", mine: "common.skillGroupMine" };

/**
 * 已选 ID → chip。列表只含启用项；拿不到的 ID（停用/删除，常见于草稿或深链）
 * 以“需启用”chip 显示并可移除——否则它被静默提交，后端以“技能已停用”拒绝建任务。
 */
const chips = computed(() => props.modelValue.map((id) => {
  const skill = skills.value.find((s) => s.id === id);
  return skill
    ? { id, name: displayName(skill), imported: skillSource(skill) === "imported", missing: false }
    : { id, name: `#${id}`, imported: false, missing: loaded.value };
}));

const sheetOpen = ref(false);
const groups = computed<SheetGroup[]>(() => SKILL_SOURCES.map((value) => ({ value, label: t(GROUP_LABEL[value]) })));
const sheetOptions = computed<SheetOption[]>(() => skills.value.map((s) => {
  const source = skillSource(s);
  const category = s.config?.category;
  return {
    value: String(s.id),
    label: displayName(s),
    note: describe(s) || undefined,
    keywords: [s.name, s.slug, typeof category === "string" ? category : ""].join(" "),
    group: source,
    badges: source === "imported" ? [t("common.skillBadgeImported")] : undefined,
  };
}));
const rowValue = computed(() => chips.value.length
  ? chips.value.map((c) => c.name).join("、")
  : t("common.skillAuto"));
function onSheet(value: string | string[]): void {
  if (!props.disabled) emit("update:modelValue", (Array.isArray(value) ? value : [value]).map(Number));
}

function remove(id: number): void {
  if (props.disabled) return;
  emit("update:modelValue", props.modelValue.filter((x) => x !== id));
}

async function load(warn = true): Promise<void> {
  const request = requestGate.begin();
  loading.value = true;
  failed.value = false;
  try {
    const next = await listSkills();
    if (!request.isCurrent()) return;
    skills.value = next;
    loaded.value = true;
  } catch {
    // 拉不到技能不阻断建任务：不选技能时后端会走自动语义匹配兜底。
    if (!request.isCurrent()) return;
    failed.value = true;
    if (warn) toast.warning(t("common.skillLoadFailed"));
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
    loaded.value = false;
    sheetOpen.value = false;
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
  <OptionSheet
    :open="sheetOpen"
    :title="t('common.skill')"
    :options="sheetOptions"
    :model-value="modelValue.map(String)"
    :groups="groups"
    :loading="loading"
    :error="failed ? t('common.skillLoadError') : ''"
    :empty-text="t('common.skillEmpty')"
    :search-placeholder="t('common.skillSearch')"
    multiple
    searchable
    @update:model-value="onSheet"
    @retry="load()"
    @close="sheetOpen = false"
  />
  <button v-if="row" type="button" class="picker-row" data-testid="row-skills" :disabled="disabled" @click="sheetOpen = true">
    <span class="picker-row-k">{{ t('common.skill') }}</span>
    <span class="picker-row-v">{{ rowValue }}</span>
    <svg class="picker-row-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
  </button>
  <div v-else class="skill-picker">
    <button
      class="skill-toggle"
      :class="{ active: modelValue.length > 0 }"
      type="button"
      data-testid="skill-picker-open"
      :disabled="disabled"
      aria-haspopup="dialog"
      :aria-expanded="sheetOpen"
      @click="sheetOpen = true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
      <span>{{ loading ? t('common.skillLoading') : t('common.skillSelect') }}</span>
      <span v-if="!loading && loaded" class="skill-total">{{ t('common.skillCount', { n: skills.length }) }}</span>
      <span v-if="modelValue.length > 0" class="skill-count">{{ modelValue.length }}</span>
    </button>
  </div>
  <div v-if="chips.length > 0" class="skill-chips" :class="{ 'skill-chips-row': row }">
    <span v-for="chip in chips" :key="chip.id" class="skill-chip" :class="{ missing: chip.missing }">
      <span class="skill-chip-name" :title="chip.name">{{ chip.name }}</span>
      <span v-if="chip.imported" class="skill-chip-badge">{{ t('common.skillBadgeImported') }}</span>
      <span v-if="chip.missing" class="skill-chip-badge warn">{{ t('common.skillBadgeInactive') }}</span>
      <button
        class="skill-chip-remove"
        type="button"
        :disabled="disabled"
        :title="t('common.skillRemove')"
        :aria-label="`${t('common.skillRemove')} ${chip.name}`"
        @click="remove(chip.id)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </span>
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


.skill-total {
  color: var(--text-tertiary);
  font-size: 12px;
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

.skill-chips-row {
  padding: 0 16px 8px;
  margin-top: 0;
}

.skill-chip.missing {
  border-color: var(--amber-500, #f59e0b);
}

.skill-chip-badge {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--bg-subtle);
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.skill-chip-badge.warn {
  color: var(--amber-600, #d97706);
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
