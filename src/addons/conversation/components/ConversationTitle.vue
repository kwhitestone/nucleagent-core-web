<script setup lang="ts">
// MUYU-410: inline rename like OWUI Sidebar/ChatItem.svelte:452-488 (dblclick/menu → input; Enter/blur save, Esc cancel, IME-safe).
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ title: string; save: (title: string) => Promise<unknown> }>();
const { t } = useI18n();
const shown = ref(props.title);
const draft = ref("");
const editing = ref(false);
const field = ref<HTMLInputElement | null>(null);
watch(() => props.title, (value) => { shown.value = value; });

async function start(): Promise<void> {
  draft.value = shown.value;
  editing.value = true;
  await nextTick();
  field.value?.focus();
  field.value?.select();
}
async function commit(): Promise<void> {
  if (!editing.value) return;
  editing.value = false;
  const next = draft.value.trim();
  if (!next || next === shown.value) return;
  const previous = shown.value;
  shown.value = next;
  try {
    await props.save(next);
  } catch {
    shown.value = previous; // caller toasts; the view must not keep an unsaved title
  }
}
function onKey(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === "Enter") { event.preventDefault(); void commit(); }
  else if (event.key === "Escape") { event.stopPropagation(); editing.value = false; }
}
defineExpose({ start });
</script>

<template>
  <input
    v-if="editing"
    ref="field"
    v-model="draft"
    class="conv-title-input"
    data-testid="conv-title-input"
    dir="auto"
    maxlength="80"
    :aria-label="t('conversation.rename.label')"
    @keydown="onKey"
    @blur="commit"
  />
  <strong v-else data-testid="conv-title" dir="auto" :title="t('conversation.rename.label')" @dblclick="start">{{ shown || t('common.untitled') }}</strong>
</template>

