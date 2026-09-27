<script setup lang="ts">
/**
 * Bottom option sheet (board §12 ④): one component for single choice (model,
 * backend, mode, format) and multi choice with search (skills). Replaces native
 * <select> on phones, which truncates names and cannot say why an option is off.
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

export interface SheetOption {
  value: string;
  label: string;
  /** Grey second line; for disabled options, the reason. */
  note?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  options: SheetOption[];
  modelValue: string | string[];
  multiple?: boolean;
  searchable?: boolean;
}>(), { multiple: false, searchable: false });

const emit = defineEmits<{ "update:modelValue": [value: string | string[]]; close: [] }>();
const { t } = useI18n();
const query = ref("");
const sheet = ref<HTMLElement | null>(null);

const shown = computed(() => {
  const q = query.value.trim().toLocaleLowerCase();
  return q ? props.options.filter((o) => `${o.label} ${o.note ?? ""}`.toLocaleLowerCase().includes(q)) : props.options;
});
const selected = (value: string) =>
  Array.isArray(props.modelValue) ? props.modelValue.includes(value) : props.modelValue === value;

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

watch(() => props.open, async (open) => {
  if (!open) return;
  query.value = "";
  await nextTick();
  sheet.value?.querySelector<HTMLElement>("[aria-checked=true], button:not([disabled])")?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="osheet-scrim" data-testid="option-sheet" @click.self="emit('close')" @keydown.esc="emit('close')">
      <div ref="sheet" class="osheet" role="dialog" aria-modal="true" :aria-label="title">
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
          :placeholder="t('common.search')"
          :aria-label="t('common.search')"
        />
        <div class="osheet-list" :role="multiple ? 'group' : 'radiogroup'">
          <button
            v-for="option in shown"
            :key="option.value"
            type="button"
            class="osheet-row"
            :role="multiple ? 'checkbox' : 'radio'"
            :aria-checked="selected(option.value)"
            :disabled="option.disabled"
            @click="pick(option)"
          >
            <span class="osheet-text">
              <span class="osheet-label">{{ option.label }}</span>
              <small v-if="option.note">{{ option.note }}</small>
            </span>
            <svg v-if="selected(option.value)" class="osheet-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
          </button>
          <p v-if="!shown.length" class="osheet-empty">{{ t('common.empty') }}</p>
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
.osheet-text small { font-size: 12.5px; color: var(--text-tertiary); }
.osheet-check { width: 20px; height: 20px; flex: none; fill: none; stroke: var(--teal-600); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.osheet-empty { padding: 16px; color: var(--text-tertiary); font-size: 14px; }
@media (prefers-reduced-motion: no-preference) { .osheet { animation: slide-up-sheet 0.2s ease-out; } }
@keyframes slide-up-sheet { from { transform: translateY(24px); opacity: 0.6; } }
</style>
