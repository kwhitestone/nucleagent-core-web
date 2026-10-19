<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useResourceOptions } from "@/composables/useResourceOptions";
import CollectionPager from "@/components/CollectionPager.vue";
import type { Skill } from "@/addons/conversation/api/types";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { BINDINGS_MAX } from "../api/sessionBindings";
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
const { rows: skills, known, selectedPage, hydratedLoaded: loaded, loading, failed, total, page, hasMore, load, go, filter } =
  useResourceOptions<Skill>("/api/v1/addons/skill", () => props.modelValue, true);

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
  const skill = known.value.find((s) => s.id === id);
  return skill
    ? { id, name: displayName(skill), imported: skillSource(skill) === "imported", missing: false }
    : { id, name: `#${id}`, imported: false, missing: loaded.value };
}));
const visibleChips = computed(() => chips.value.filter(chip =>
  selectedPage.rows.value.some(row => row.id === chip.id) || chip.missing));

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
    disabled: props.disabled || (props.modelValue.length >= BINDINGS_MAX && !props.modelValue.includes(s.id)),
  };
}));
const rowValue = computed(() => chips.value.length
  ? chips.value.map((c) => c.name).join("、")
  : t("common.skillAuto"));
function onSheet(value: string | string[]): void {
  const ids = (Array.isArray(value) ? value : [value]).map(Number);
  if (!props.disabled && (ids.length <= BINDINGS_MAX || ids.length < props.modelValue.length)) emit("update:modelValue", ids);
}

function remove(id: number): void {
  if (props.disabled) return;
  emit("update:modelValue", props.modelValue.filter((x) => x !== id));
}

function onSessionChange(event: Event): void {
  const authenticated =
    (event as CustomEvent<{ authenticated?: unknown }>).detail?.authenticated === true;
  if (!authenticated) {
    sheetOpen.value = false;
    // 换账号后旧账号的选择不能留着：技能 ID 对新账号没有意义。
    if (props.modelValue.length > 0) emit("update:modelValue", []);
    return;
  }
}

onMounted(() => {
  window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange);
});

onBeforeUnmount(() => {
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
    :remote-page="{ page, total, hasMore }"
    :loading="loading"
    :error="failed ? t('common.skillLoadError') : ''"
    :empty-text="t('common.skillEmpty')"
    :search-placeholder="t('common.skillSearch')"
    multiple
    searchable
    @update:model-value="onSheet"
    @retry="load()"
    @filter="filter"
    @page="go"
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
      <span v-if="!loading && !failed" class="skill-total">{{ t('common.skillCount', { n: total }) }}</span>
      <span v-if="modelValue.length > 0" class="skill-count">{{ modelValue.length }}</span>
    </button>
  </div>
  <div v-if="chips.length > 0" class="skill-chips" :class="{ 'skill-chips-row': row }">
    <span v-for="chip in visibleChips" :key="chip.id" class="skill-chip" :class="{ missing: chip.missing }">
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
  <CollectionPager v-if="selectedPage.total.value > 20 || selectedPage.failed.value" :page="selectedPage.page.value"
    :total="selectedPage.total.value" :has-more="selectedPage.hasMore.value" :loading="selectedPage.loading.value"
    :failed="selectedPage.failed.value" @page="selectedPage.go" @retry="selectedPage.load" />
  <p v-if="modelValue.length >= BINDINGS_MAX" class="binding-limit" role="status">{{ t('common.bindingsLimit', { n: BINDINGS_MAX }) }}</p>
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
