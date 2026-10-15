<script setup lang="ts">
/** Create / edit one of my agents (UI-DESIGN-5 §3.8). Presentational: the parent submits and maps errors. */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { trapDialogFocus } from "../../administration/agents/definition/focus";
import { LIMITS, validateDraft, type Draft } from "../api/userAgent";

const props = defineProps<{
  models: string[];
  busy: boolean;
  /** Already-translated messages per field, plus `form`; shown as text only. */
  errors: Record<string, string>;
  initial?: Draft & { id: number };
}>();
const emit = defineEmits<{ submit: [draft: Draft]; cancel: [] }>();
const { t } = useI18n();

const draft = reactive<Draft>({ name: "", description: "", model: "", prompt: "", ...props.initial });
const local = ref<Partial<Record<keyof Draft, string>>>({});
const editing = computed(() => !!props.initial);
// Keep the current model selectable even if it was later closed to users.
const options = computed(() => (draft.model && !props.models.includes(draft.model) ? [draft.model, ...props.models] : props.models));
const count = (s: string) => [...s].length;
const message = (field: string) => (local.value[field as keyof Draft] ? t(local.value[field as keyof Draft]!) : props.errors[field] ?? "");

const dialog = ref<HTMLElement>();
const nameInput = ref<HTMLInputElement>();
const previousFocus = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
onMounted(() => nameInput.value?.focus());
onBeforeUnmount(() => previousFocus?.focus?.());

function submit() {
  if (props.busy) return;
  local.value = validateDraft(draft, !editing.value);
  if (Object.keys(local.value).length) return;
  emit("submit", { ...draft });
}
</script>

<template>
  <div class="ua-scrim" @click.self="emit('cancel')">
    <form ref="dialog" class="ua-wizard" role="dialog" aria-modal="true" aria-labelledby="ua-title" data-testid="ua-wizard" novalidate
      @submit.prevent="submit" @keydown.esc="emit('cancel')" @keydown="trapDialogFocus">
      <h2 id="ua-title">{{ editing ? t("agents.mine.editTitle") : t("agents.mine.wizardTitle") }}</h2>
      <p class="ua-hint">{{ t("agents.mine.wizardHint") }}</p>

      <div class="ua-avatar" data-testid="ua-avatar-default">
        <span class="ua-av" aria-hidden="true">{{ [...(draft.name.trim() || "?")][0] }}</span>
        <span>{{ t("agents.mine.avatar") }} · {{ t("agents.mine.avatarDefault") }}</span>
      </div>

      <label for="ua-name">{{ t("agents.mine.name") }} *</label>
      <input id="ua-name" ref="nameInput" v-model="draft.name" type="text" required :aria-invalid="!!message('name')"
        aria-describedby="ua-name-err">
      <p id="ua-name-err" class="ua-row"><span class="ua-err">{{ message("name") }}</span><span>{{ count(draft.name) }}/{{ LIMITS.name }}</span></p>

      <label for="ua-desc">{{ t("agents.mine.description") }}</label>
      <input id="ua-desc" v-model="draft.description" type="text" :aria-invalid="!!message('description')" aria-describedby="ua-desc-err">
      <p id="ua-desc-err" class="ua-row"><span class="ua-err">{{ message("description") }}</span><span>{{ count(draft.description) }}/{{ LIMITS.description }}</span></p>

      <label for="ua-model">{{ t("agents.mine.model") }} *</label>
      <select id="ua-model" v-model="draft.model" required :aria-invalid="!!message('model')" aria-describedby="ua-model-err">
        <option value="" disabled>{{ t("agents.mine.modelPlaceholder") }}</option>
        <option v-for="m in options" :key="m" :value="m">{{ m }}</option>
      </select>
      <p id="ua-model-err" class="ua-row"><span class="ua-err">{{ message("model") }}</span></p>

      <label for="ua-prompt">{{ t("agents.mine.prompt") }}</label>
      <textarea id="ua-prompt" v-model="draft.prompt" rows="6" :placeholder="editing ? t('agents.mine.promptKeep') : ''"
        :aria-invalid="!!message('prompt')" aria-describedby="ua-prompt-err" />
      <p id="ua-prompt-err" class="ua-row"><span class="ua-err">{{ message("prompt") }}</span><span>{{ count(draft.prompt) }}/{{ LIMITS.prompt }}</span></p>

      <p v-if="errors.form" class="ua-form-err" role="alert" data-testid="ua-form-error">{{ errors.form }}</p>
      <div class="ua-actions">
        <button type="button" class="btn-ghost" @click="emit('cancel')">{{ t("agents.mine.cancel") }}</button>
        <button type="submit" class="btn-primary" :disabled="busy" :aria-busy="busy" data-testid="ua-submit">
          {{ editing ? t("agents.mine.submitSave") : t("agents.mine.submitCreate") }}
        </button>
      </div>
    </form>
  </div>
</template>

<style>
/* Non-scoped like AgentCard; ua-* is core-private. Tokens and aurora.css keyframes only. */
.ua-scrim { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center; background: rgba(15, 23, 42, 0.36); }
.ua-wizard { width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto; padding: 22px 24px; border-radius: var(--r-lg); background: var(--bg-card); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; gap: 6px; animation: fade-in-up 0.24s var(--ease-out) both; }
.ua-wizard h2 { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary); }
.ua-hint { margin: 0 0 8px; font-size: 12.5px; color: var(--text-tertiary); }
.ua-wizard label { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); }
.ua-wizard input, .ua-wizard select, .ua-wizard textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-primary); font: inherit; font-size: 13px; transition: border-color 0.15s var(--ease); }
.ua-wizard input:focus, .ua-wizard select:focus, .ua-wizard textarea:focus { outline: none; border-color: var(--teal-500); }
.ua-wizard [aria-invalid="true"] { border-color: var(--rose-500); }
.ua-row { margin: 0 0 4px; min-height: 16px; display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--text-tertiary); }
.ua-err, .ua-form-err { color: var(--rose-500); }
.ua-form-err { margin: 0; font-size: 12.5px; }
.ua-avatar { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 12.5px; color: var(--text-tertiary); }
.ua-av { width: 40px; height: 40px; border-radius: var(--r-lg); display: grid; place-items: center; background: var(--grad-brand); color: #fff; font-weight: 600; }
.ua-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.ua-actions button { height: 36px; padding: 0 16px; font-size: 13px; }
.ua-actions button:disabled { opacity: 0.6; cursor: progress; }
@media (prefers-reduced-motion: reduce) { .ua-wizard { animation: none; } }
</style>
