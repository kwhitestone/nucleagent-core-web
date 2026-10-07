<script setup lang="ts">
/**
 * 首页建议卡（UNI-T14）：左列表编辑 + 右侧实时预览，整表保存。
 * 校验与 Core PUT 同规则；409 = 他人已保存，需刷新。导入 JSON 只替换编辑区，保存仍走同一 PUT。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, isInShell, useEmbeddedAuthorization } from "@/contracts/platform-runtime";
import { toast } from "@/composables/useToast";
import SuggestionChip from "@/components/SuggestionChip.vue";
import {
  ICON_CATEGORIES, LIMITS, MAX_CARDS, exportJSON, iconFor, localize, parseImport, searchIcons, validateItems,
  type HomeSuggestionItem, type IconCategory, type Invalid,
} from "@/composables/homeSuggestions";
import { getHomeSuggestions, resetHomeSuggestions, saveHomeSuggestions } from "../../api/homeSuggestions";

const { t } = useI18n();
const authorization = useEmbeddedAuthorization();
const canWrite = computed(() => !isInShell() || authorization.can("core:admin:write"));

const items = ref<HomeSuggestionItem[]>([]);
const revision = ref(0);
const baseline = ref("");
const loading = ref(true);
const loadError = ref("");
const busy = ref(false);
const conflict = ref(false);
const selected = ref(0);
const previewLocale = ref<"zh" | "en">("zh");
const iconCategory = ref<IconCategory | "all">("all");
const iconQuery = ref("");
const fileInput = ref<HTMLInputElement>();

const dirty = computed(() => JSON.stringify(items.value) !== baseline.value);
const current = computed(() => items.value[selected.value]);
const invalid = computed(() => validateItems(items.value));
const preview = computed(() => items.value.filter((i) => i.enabled).map((i) => localize(i, previewLocale.value)));
const icons = computed(() => searchIcons(iconCategory.value, iconQuery.value));

const FIELD_LABEL: Record<string, string> = {
  titleZh: "fieldTitle", descZh: "fieldDesc", promptZh: "fieldPrompt", titleEn: "fieldTitle", descEn: "fieldDesc", promptEn: "fieldPrompt",
};
function describe(problem: Invalid): string {
  if (problem.reason === "count") return t("admin.homeSuggestions.limit", { max: MAX_CARDS });
  if (problem.reason === "noneEnabled") return t("admin.homeSuggestions.needOneEnabled");
  const field = t(`admin.homeSuggestions.${FIELD_LABEL[problem.field] ?? "fieldId"}`) + (problem.field.endsWith("En") ? " (EN)" : "");
  return t("admin.homeSuggestions.invalid", { n: problem.index + 1, reason: t(`admin.homeSuggestions.reasons.${problem.reason}`, { field }) });
}
const count = (value: string) => [...value.trim()].length;

function adopt(config: { items: HomeSuggestionItem[]; revision: number }): void {
  items.value = config.items;
  revision.value = config.revision;
  baseline.value = JSON.stringify(config.items);
  selected.value = Math.min(selected.value, Math.max(config.items.length - 1, 0));
  conflict.value = false;
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    adopt(await getHomeSuggestions());
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : t("admin.homeSuggestions.loadFailed");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function run(action: () => Promise<{ items: HomeSuggestionItem[]; revision: number }>, success: string): Promise<void> {
  busy.value = true;
  try {
    adopt(await action());
    toast.success(success);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      conflict.value = true;
      toast.error(t("admin.homeSuggestions.conflict"));
    } else {
      toast.error(error instanceof Error ? error.message : t("common.operationFailed"));
    }
  } finally {
    busy.value = false;
  }
}

function save(): void {
  if (invalid.value || busy.value) return;
  void run(() => saveHomeSuggestions(items.value, revision.value), t("admin.homeSuggestions.saved"));
}
function reset(): void {
  if (!window.confirm(t("admin.homeSuggestions.resetConfirm"))) return;
  void run(resetHomeSuggestions, t("admin.homeSuggestions.saved"));
}
function discard(): void {
  items.value = JSON.parse(baseline.value);
  selected.value = 0;
}

function add(): void {
  if (items.value.length >= MAX_CARDS) return;
  const taken = new Set(items.value.map((i) => i.id.toLowerCase()));
  let n = items.value.length + 1;
  while (taken.has(`card${n}`)) n++;
  items.value.push({ id: `card${n}`, enabled: true, icon: "sparkles", action: "prefill", titleZh: "", descZh: "", promptZh: "", titleEn: "", descEn: "", promptEn: "" });
  selected.value = items.value.length - 1;
}
function remove(index: number): void {
  const item = items.value[index];
  if (!window.confirm(t("admin.homeSuggestions.deleteConfirm", { title: item.titleZh || item.id }))) return;
  items.value.splice(index, 1);
  selected.value = Math.min(selected.value, items.value.length - 1);
}
function move(index: number, delta: number): void {
  const to = index + delta;
  if (to < 0 || to >= items.value.length) return;
  const [item] = items.value.splice(index, 1);
  items.value.splice(to, 0, item);
  selected.value = to;
}
// Native drag reordering; the up/down buttons are the keyboard path.
const dragFrom = ref<number | null>(null);
function drop(index: number): void {
  if (dragFrom.value !== null && dragFrom.value !== index) move(dragFrom.value, index - dragFrom.value);
  dragFrom.value = null;
}
/** Only cards that have never been saved may change their id. */
const savedIds = computed(() => new Set((JSON.parse(baseline.value || "[]") as HomeSuggestionItem[]).map((i) => i.id)));

function exportFile(): void {
  const url = URL.createObjectURL(new Blob([exportJSON(items.value)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `home-suggestions-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
async function importFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  try {
    items.value = parseImport(await file.text());
    selected.value = 0;
    toast.success(t("admin.homeSuggestions.importHint"));
  } catch (error) {
    toast.error(t("admin.homeSuggestions.importFailed", { reason: error instanceof Error ? error.message : String(error) }));
  }
}

onBeforeRouteLeave(() => !dirty.value || window.confirm(t("admin.homeSuggestions.unsaved")));
const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty.value) e.preventDefault(); };
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>

<template>
  <div class="hs-view" data-testid="home-suggestions-admin">
    <div class="hs-head">
      <div>
        <h2 class="hs-title">{{ t("admin.homeSuggestions.title") }}</h2>
        <p class="section-hint">{{ t("admin.homeSuggestions.subtitle") }}</p>
      </div>
      <div v-if="!loading && !loadError" class="hs-toolbar">
        <span v-if="!canWrite" class="badge off" data-testid="hs-readonly">{{ t("admin.homeSuggestions.readonly") }}</span>
        <button class="btn-ghost" type="button" data-testid="hs-export" @click="exportFile">{{ t("admin.homeSuggestions.export") }}</button>
        <template v-if="canWrite">
          <button class="btn-ghost" type="button" data-testid="hs-import" @click="fileInput?.click()">{{ t("admin.homeSuggestions.import") }}</button>
          <input ref="fileInput" type="file" accept="application/json,.json" hidden data-testid="hs-import-file" @change="importFile" />
          <button class="btn-ghost danger" type="button" :disabled="busy" data-testid="hs-reset" @click="reset">{{ t("admin.homeSuggestions.reset") }}</button>
          <button class="btn-ghost" type="button" :disabled="!dirty || busy" data-testid="hs-discard" @click="discard">{{ t("admin.homeSuggestions.discard") }}</button>
          <button class="btn-primary" type="button" :disabled="!dirty || !!invalid || busy || conflict" data-testid="hs-save" @click="save">{{ t("admin.homeSuggestions.save") }}</button>
        </template>
      </div>
    </div>

    <p v-if="loading" class="empty-hint">{{ t("common.loading") }}</p>
    <div v-else-if="loadError" class="empty-hint" data-testid="hs-load-error">
      <p>{{ loadError }}</p>
      <button class="btn-ghost" type="button" @click="load">{{ t("common.retry") }}</button>
    </div>

    <template v-else>
      <p v-if="conflict" class="hs-alert" role="alert" data-testid="hs-conflict">
        {{ t("admin.homeSuggestions.conflict") }}
        <button class="btn-ghost" type="button" @click="load">{{ t("admin.homeSuggestions.refresh") }}</button>
      </p>
      <p v-else-if="invalid && dirty" class="hs-alert" role="alert" data-testid="hs-invalid">{{ describe(invalid) }}</p>

      <div class="hs-body">
        <div class="hs-left">
          <ol class="hs-list">
            <li
              v-for="(item, i) in items" :key="i" class="hs-row" :class="{ active: i === selected, off: !item.enabled }"
              :draggable="canWrite" data-testid="hs-row"
              @click="selected = i" @dragstart="dragFrom = i" @dragover.prevent @drop="drop(i)"
            >
              <span class="hs-grip" aria-hidden="true">≡</span>
              <span class="chip-icon hs-icon" :style="{ background: iconFor(item.icon).bg, color: iconFor(item.icon).color }">
                <component :is="iconFor(item.icon).component" aria-hidden="true" />
              </span>
              <span class="hs-name">{{ item.titleZh || t("admin.homeSuggestions.untitled") }}</span>
              <span class="type-chip">{{ item.action === "prefill" ? t("admin.homeSuggestions.actionPrefill") : t("admin.homeSuggestions.actionFillTitle") }}</span>
              <label class="switch-row" @click.stop>
                <input v-model="item.enabled" type="checkbox" class="switch" :disabled="!canWrite" data-testid="hs-enabled" />{{ t("admin.homeSuggestions.enabled") }}
              </label>
              <span v-if="canWrite" class="hs-row-actions" @click.stop>
                <button class="btn-icon" type="button" :disabled="i === 0" :aria-label="t('admin.homeSuggestions.moveUp')" @click="move(i, -1)">↑</button>
                <button class="btn-icon" type="button" :disabled="i === items.length - 1" :aria-label="t('admin.homeSuggestions.moveDown')" @click="move(i, 1)">↓</button>
                <button class="btn-icon danger" type="button" :aria-label="t('admin.homeSuggestions.delete')" data-testid="hs-delete" @click="remove(i)">×</button>
              </span>
            </li>
          </ol>
          <button v-if="canWrite" class="btn-ghost hs-add" type="button" :disabled="items.length >= MAX_CARDS" :title="t('admin.homeSuggestions.limit', { max: MAX_CARDS })" data-testid="hs-add" @click="add">
            + {{ t("admin.homeSuggestions.add") }}（{{ items.length }}/{{ MAX_CARDS }}）
          </button>

          <fieldset v-if="current" class="hs-editor" :disabled="!canWrite" data-testid="hs-editor">
            <label class="field"><span class="field-label">{{ t("admin.homeSuggestions.fieldId") }}</span>
              <input v-model.trim="current.id" type="text" maxlength="40" :readonly="savedIds.has(current.id)" data-testid="hs-id" /></label>

            <div class="field">
              <span class="field-label">{{ t("admin.homeSuggestions.icon") }}</span>
              <div class="icon-tabs" role="tablist">
                <button v-for="c in ['all', ...ICON_CATEGORIES]" :key="c" type="button" role="tab" class="icon-tab"
                  :class="{ active: iconCategory === c }" :aria-selected="iconCategory === c" @click="iconCategory = c as IconCategory | 'all'">
                  {{ t(`admin.homeSuggestions.categories.${c}`) }}
                </button>
              </div>
              <input v-model="iconQuery" type="search" class="icon-search" :placeholder="t('admin.homeSuggestions.iconSearch')" data-testid="hs-icon-search" />
              <div class="icon-grid" role="radiogroup" :aria-label="t('admin.homeSuggestions.icon')">
                <button v-for="icon in icons" :key="icon.id" type="button" role="radio" class="icon-option"
                  :class="{ active: current.icon === icon.id }" :aria-checked="current.icon === icon.id" :title="`${icon.label} · ${icon.id}`"
                  :data-icon="icon.id" @click="current.icon = icon.id">
                  <span class="chip-icon" :style="{ background: icon.bg, color: icon.color }"><component :is="icon.component" aria-hidden="true" /></span>
                </button>
              </div>
            </div>

            <div class="field">
              <span class="field-label">{{ t("admin.homeSuggestions.action") }}</span>
              <label class="switch-row"><input v-model="current.action" type="radio" value="fill-title" />{{ t("admin.homeSuggestions.actionFillTitle") }}</label>
              <label class="switch-row"><input v-model="current.action" type="radio" value="prefill" data-testid="hs-action-prefill" />{{ t("admin.homeSuggestions.actionPrefill") }}</label>
            </div>

            <div class="field-row">
              <label class="field"><span class="field-label">中文 {{ t("admin.homeSuggestions.fieldTitle") }} *</span>
                <input v-model="current.titleZh" type="text" data-testid="hs-title-zh" :class="{ invalid: count(current.titleZh) > LIMITS.title }" />
                <span class="counter">{{ count(current.titleZh) }}/{{ LIMITS.title }}</span></label>
              <label class="field"><span class="field-label">中文 {{ t("admin.homeSuggestions.fieldDesc") }}</span>
                <input v-model="current.descZh" type="text" data-testid="hs-desc-zh" :class="{ invalid: count(current.descZh) > LIMITS.desc }" />
                <span class="counter">{{ count(current.descZh) }}/{{ LIMITS.desc }}</span></label>
            </div>
            <label class="field"><span class="field-label">中文 {{ t("admin.homeSuggestions.fieldPrompt") }}</span>
              <textarea v-model="current.promptZh" rows="3" data-testid="hs-prompt-zh" />
              <span class="counter">{{ t("admin.homeSuggestions.promptHint") }} · {{ count(current.promptZh) }}/{{ LIMITS.prompt }}</span></label>

            <p class="section-hint">English · {{ t("admin.homeSuggestions.enHint") }}</p>
            <div class="field-row">
              <label class="field"><span class="field-label">Title</span>
                <input v-model="current.titleEn" type="text" data-testid="hs-title-en" :class="{ invalid: count(current.titleEn) > LIMITS.title }" />
                <span class="counter">{{ count(current.titleEn) }}/{{ LIMITS.title }}</span></label>
              <label class="field"><span class="field-label">Description</span>
                <input v-model="current.descEn" type="text" :class="{ invalid: count(current.descEn) > LIMITS.desc }" />
                <span class="counter">{{ count(current.descEn) }}/{{ LIMITS.desc }}</span></label>
            </div>
            <label class="field"><span class="field-label">Prompt</span>
              <textarea v-model="current.promptEn" rows="3" /></label>
          </fieldset>
        </div>

        <aside class="hs-preview" data-testid="hs-preview">
          <div class="hs-preview-head">
            <span class="field-label">{{ t("admin.homeSuggestions.preview") }}</span>
            <span class="hs-locale">
              <button type="button" :class="{ active: previewLocale === 'zh' }" @click="previewLocale = 'zh'">中</button>
              <button type="button" :class="{ active: previewLocale === 'en' }" @click="previewLocale = 'en'">EN</button>
            </span>
          </div>
          <div class="suggestion-grid">
            <SuggestionChip v-for="card in preview" :key="card.id" :card="card" />
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hs-view { display: flex; flex-direction: column; gap: 14px; }
.hs-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.hs-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.hs-toolbar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.hs-alert { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: var(--r-md); background: #fff1f2; color: var(--rose-500); font-size: 13px; }
.hs-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.hs-left { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.hs-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.hs-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md);
}
.hs-row.active { border-color: var(--teal-400); box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1); }
.hs-row.off .hs-name { color: var(--text-tertiary); text-decoration: line-through; }
.hs-grip { color: var(--text-tertiary); cursor: grab; }
.hs-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hs-row-actions { display: flex; gap: 2px; }
.chip-icon { width: 28px; height: 28px; border-radius: var(--r-sm); display: inline-flex; align-items: center; justify-content: center; flex: none; }
.chip-icon :deep(svg) { width: 16px; height: 16px; }
.btn-icon { width: 26px; height: 26px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); color: var(--text-secondary); cursor: pointer; }
.btn-icon:disabled { opacity: 0.35; cursor: default; }
.btn-icon.danger:hover { color: var(--rose-500); border-color: var(--rose-400); }
.hs-add { align-self: flex-start; }
.hs-editor { border: 1px solid var(--border); border-radius: var(--r-lg); padding: 14px; display: flex; flex-direction: column; gap: 12px; background: var(--bg-card); min-width: 0; }
.icon-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.icon-tab { padding: 3px 9px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg-card); font-size: 12px; color: var(--text-secondary); cursor: pointer; }
.icon-tab.active { background: var(--grad-brand-soft); color: var(--indigo-600); border-color: transparent; font-weight: 600; }
.icon-search { margin-bottom: 6px; }
.icon-grid { display: grid; grid-template-columns: repeat(auto-fill, 38px); gap: 4px; max-height: 172px; overflow-y: auto; padding: 2px; }
.icon-option { width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid transparent; border-radius: var(--r-md); background: transparent; cursor: pointer; }
.icon-option:hover { border-color: var(--border); }
.icon-option.active { border-color: var(--teal-500); box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.2); }
.counter { display: block; font-size: 11px; color: var(--text-tertiary); margin-top: 3px; text-align: right; }
.hs-preview { position: sticky; top: 0; padding: 14px; border: 1px dashed var(--border); border-radius: var(--r-lg); background: var(--bg-subtle); }
.hs-preview-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.hs-locale button { padding: 2px 8px; border: 1px solid var(--border); background: var(--bg-card); font-size: 12px; cursor: pointer; }
.hs-locale button.active { background: var(--teal-50); color: var(--teal-600); border-color: var(--teal-300); }
.section-hint { font-size: 12px; color: var(--text-tertiary); }
.empty-hint { color: var(--text-tertiary); text-align: center; padding: 32px 0; font-size: 13px; }
.type-chip { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; background: var(--bg-hover); color: var(--text-secondary); white-space: nowrap; }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
.badge.off { background: var(--slate-100); color: var(--text-tertiary); }
.field-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.field-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 5px; }
.field input:not([type=checkbox]):not([type=radio]), .field textarea, .icon-search {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--bg-card); color: var(--text-primary); font-size: 13px; font-family: inherit;
}
.field input:focus, .field textarea:focus { outline: none; border-color: var(--teal-500); }
.field input[readonly] { background: var(--bg-subtle); color: var(--text-tertiary); }
.field input.invalid { border-color: var(--rose-400); }
.switch-row { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; margin-right: 12px; white-space: nowrap; }
.switch { accent-color: var(--teal-500); }
.btn-primary {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: none; border-radius: var(--r-md);
  background: var(--grad-teal-indigo); color: white; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--bg-card); color: var(--text-secondary); font-size: 12.5px; cursor: pointer; white-space: nowrap;
}
.btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost:hover { border-color: var(--border-strong); color: var(--text-primary); }
.btn-ghost.danger:hover { border-color: var(--rose-400); color: var(--rose-500); }
@media (max-width: 1023.98px) { .hs-body { grid-template-columns: 1fr; } .hs-preview { position: static; } }
</style>
