<script setup lang="ts">
/**
 * Bottom option sheet (board §12 ④): one component for single choice (model,
 * backend, mode, format) and multi choice with search (skills). Replaces native
 * <select> on phones, which truncates names and cannot say why an option is off.
 * L7: hundreds of options — group tabs, debounced search with highlight, paging,
 * badges, loading/error states, arrow-key navigation; centred dialog on desktop.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { PAGE_SIZE, SEARCH_DEBOUNCE_MS, countByGroup, debounce, filterOptions, highlight } from "./pickerSearch.ts";

export interface SheetOption {
  value: string;
  label: string;
  /** Grey second line; for disabled options, the reason. */
  note?: string;
  disabled?: boolean;
  /** Searched but not shown (e.g. category, slug). */
  keywords?: string;
  /** Matches a `groups[].value` tab. */
  group?: string;
  badges?: string[];
}

export interface SheetGroup {
  value: string;
  label: string;
}

const SELECTED = "__selected";

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  options: SheetOption[];
  modelValue: string | string[];
  multiple?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  groups?: SheetGroup[];
  loading?: boolean;
  /** Non-empty = load failed; shows the message and a retry button. */
  error?: string;
  emptyText?: string;
}>(), { multiple: false, searchable: false, searchPlaceholder: "", groups: () => [], loading: false, error: "", emptyText: "" });

const emit = defineEmits<{ "update:modelValue": [value: string | string[]]; close: []; retry: [] }>();
const { t } = useI18n();
const query = ref("");
const term = ref("");
const group = ref("");
const limit = ref(PAGE_SIZE);
const sheet = ref<HTMLElement | null>(null);

const setTerm = debounce((value: string) => { term.value = value; }, SEARCH_DEBOUNCE_MS);
watch(query, (value) => setTerm(value));
watch([term, group], () => { limit.value = PAGE_SIZE; });
onBeforeUnmount(() => setTerm.cancel());

const selected = (value: string) =>
  Array.isArray(props.modelValue) ? props.modelValue.includes(value) : props.modelValue === value;

const counts = computed(() => countByGroup(props.options));
const tabs = computed(() => props.groups.length
  ? [
      { value: "", label: t("common.skillGroupAll"), count: props.options.length },
      ...(props.multiple ? [{ value: SELECTED, label: t("common.skillGroupSelected"), count: props.options.filter((o) => selected(o.value)).length }] : []),
      ...props.groups.filter((g) => counts.value[g.value]).map((g) => ({ ...g, count: counts.value[g.value] })),
    ]
  : []);

const shown = computed(() => group.value === SELECTED
  ? filterOptions(props.options.filter((o) => selected(o.value)), term.value)
  : filterOptions(props.options, term.value, group.value));
const visible = computed(() => shown.value.slice(0, limit.value));

function pick(option: SheetOption): void {
  if (option.disabled) return;
  if (!props.multiple) {
    emit("update:modelValue", option.value);
    emit("close");
    return;
  }
  const current = Array.isArray(props.modelValue) ? props.modelValue : [];
  emit("update:modelValue", selected(option.value)
    ? current.filter((v) => v !== option.value)
    : [...current, option.value]);
}

/** ArrowUp/Down walk search box + rows; Tab still works as usual. */
function onArrow(event: KeyboardEvent): void {
  const items = Array.from(sheet.value?.querySelectorAll<HTMLElement>(".osheet-search, .osheet-row:not([disabled]), .osheet-more") ?? []);
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = items[at + (event.key === "ArrowDown" ? 1 : -1)];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

watch(() => props.open, async (open) => {
  if (!open) return;
  setTerm.cancel();
  query.value = "";
  term.value = "";
  group.value = "";
  limit.value = PAGE_SIZE;
  await nextTick();
  const first = props.searchable
    ? sheet.value?.querySelector<HTMLElement>(".osheet-search")
    : sheet.value?.querySelector<HTMLElement>("[aria-checked=true], .osheet-row:not([disabled])");
  first?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="osheet-scrim" data-testid="option-sheet" @click.self="emit('close')" @keydown.esc="emit('close')">
      <div ref="sheet" class="osheet" role="dialog" aria-modal="true" :aria-label="title" @keydown.down="onArrow" @keydown.up="onArrow">
        <div class="osheet-grab" aria-hidden="true" />
        <div class="osheet-head">
          <b>{{ title }}</b>
          <button v-if="multiple" type="button" class="osheet-done" @click="emit('close')">{{ t('common.done') }}</button>
        </div>
        <input
          v-if="searchable"
          v-model="query"
          class="osheet-search"
          type="search"
          data-testid="option-sheet-search"
          :placeholder="searchPlaceholder || t('common.search')"
          :aria-label="searchPlaceholder || t('common.search')"
        />
        <div v-if="tabs.length" class="osheet-tabs" role="group">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            type="button"
            class="osheet-tab"
            :aria-pressed="group === tab.value"
            @click="group = tab.value"
          >{{ tab.label }} <span class="osheet-tab-n">{{ tab.count }}</span></button>
        </div>
        <p v-if="loading" class="osheet-empty" role="status">{{ t('common.loading') }}</p>
        <div v-else-if="error" class="osheet-empty osheet-error" role="alert">
          <span>{{ error }}</span>
          <button type="button" class="osheet-more" @click="emit('retry')">{{ t('common.retry') }}</button>
        </div>
        <div v-else class="osheet-list" :role="multiple ? 'group' : 'radiogroup'">
          <button
            v-for="option in visible"
            :key="option.value"
            type="button"
            class="osheet-row"
            :role="multiple ? 'checkbox' : 'radio'"
            :aria-checked="selected(option.value)"
            :disabled="option.disabled"
            @click="pick(option)"
          >
            <span class="osheet-text">
              <span class="osheet-label">
                <template v-for="(seg, i) in highlight(option.label, term)" :key="i"><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template>
                <span v-for="badge in option.badges ?? []" :key="badge" class="osheet-badge">{{ badge }}</span>
              </span>
              <small v-if="option.note"><template v-for="(seg, i) in highlight(option.note, term)" :key="i"><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></small>
            </span>
            <svg v-if="selected(option.value)" class="osheet-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
          </button>
          <button v-if="shown.length > visible.length" type="button" class="osheet-more" data-testid="option-sheet-more" @click="limit += PAGE_SIZE">
            {{ t('common.skillShowMore', { n: shown.length - visible.length }) }}
          </button>
          <p v-if="!shown.length" class="osheet-empty">{{ (options.length ? '' : emptyText) || t('common.empty') }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.osheet-scrim { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-end; background: rgba(15, 23, 42, 0.36); }
.osheet {
  width: 100%; max-height: 85%; display: flex; flex-direction: column; gap: 8px;
  padding: 8px 16px calc(12px + env(safe-area-inset-bottom));
  background: var(--bg-card); color: var(--text-primary);
  border-radius: var(--r-2xl) var(--r-2xl) 0 0; box-shadow: 0 -12px 48px rgba(15, 23, 42, 0.18);
}
.osheet-grab { width: 36px; height: 5px; margin: 0 auto 4px; border-radius: 3px; background: var(--border-strong); flex: none; }
.osheet-head { display: flex; align-items: center; min-height: 44px; flex: none; }
.osheet-head b { font-size: 17px; }
.osheet-done { margin-left: auto; min-width: 44px; min-height: 44px; border: 0; background: transparent; color: var(--accent, var(--teal-600)); font: inherit; font-weight: 650; }
.osheet-search { flex: none; height: 44px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-subtle); color: var(--text-primary); font-size: 16px; }
.osheet-tabs { display: flex; gap: 6px; flex: none; overflow-x: auto; padding-bottom: 2px; }
.osheet-tab { flex: none; min-height: 32px; padding: 0 12px; border: 1px solid var(--border); border-radius: 16px; background: transparent; color: var(--text-secondary, var(--text-primary)); font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.osheet-tab[aria-pressed=true] { border-color: var(--teal-600); color: var(--teal-600); font-weight: 600; }
.osheet-tab:focus-visible, .osheet-more:focus-visible { outline: 2px solid var(--teal-500); outline-offset: 1px; }
.osheet-tab-n { color: var(--text-tertiary); font-size: 12px; }
.osheet-list { overflow-y: auto; min-height: 0; border: 1px solid var(--border); border-radius: var(--r-lg); }
.osheet-row {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 8px 16px;
  border: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 15px; text-align: left; cursor: pointer;
}
.osheet-row + .osheet-row { border-top: 1px solid var(--border); }
.osheet-row[disabled] { color: var(--text-tertiary); cursor: default; }
.osheet-row:focus-visible { outline: 2px solid var(--teal-500); outline-offset: -2px; }
.osheet-text { display: grid; gap: 2px; min-width: 0; flex: 1; }
.osheet-label { overflow-wrap: anywhere; }
.osheet-text small { font-size: 12.5px; color: var(--text-tertiary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.osheet-text mark { background: rgba(20, 184, 166, 0.22); color: inherit; border-radius: 2px; }
.osheet-badge { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px; background: var(--bg-subtle); color: var(--text-tertiary); font-size: 11px; line-height: 18px; vertical-align: middle; }
.osheet-check { width: 20px; height: 20px; flex: none; fill: none; stroke: var(--teal-600); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.osheet-more { display: block; width: 100%; min-height: 44px; border: 0; border-top: 1px solid var(--border); background: transparent; color: var(--accent, var(--teal-600)); font: inherit; font-size: 14px; cursor: pointer; }
.osheet-empty { padding: 16px; color: var(--text-tertiary); font-size: 14px; }
.osheet-error { display: flex; align-items: center; gap: 12px; }
.osheet-error .osheet-more { width: auto; border: 0; min-height: 32px; padding: 0 8px; }
@media (min-width: 768px) {
  .osheet-scrim { align-items: center; justify-content: center; }
  .osheet { width: min(640px, calc(100vw - 48px)); max-height: 80vh; border-radius: var(--r-2xl); padding-bottom: 16px; }
  .osheet-grab { display: none; }
}
@media (prefers-reduced-motion: no-preference) { .osheet { animation: slide-up-sheet 0.2s ease-out; } }
@keyframes slide-up-sheet { from { transform: translateY(24px); opacity: 0.6; } }
</style>
