<script setup lang="ts">
/**
 * Create / edit one of my agents (UI-DESIGN-5 §3.8; UA-EDIT-FIELDS-1230: same fields as the admin editor
 * minus server-managed ones). Presentational: the parent submits, uploads the picked avatar and maps errors.
 * Every pickable value comes from a server list; "" = platform default. Nothing is stored until submit.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { trapDialogFocus } from "../../administration/agents/definition/focus";
import { LIMITS, emptyDraft, validateDraft, type Draft, type UserAgentBackend } from "../api/userAgent";
import { USER_AVATAR_CONTRACT, checkAvatarFile } from "../api/userAvatar";
import { coveredBySkills, effectiveToolIds, toolLabel, type ToolCatalogItem } from "../api/toolCatalog";
import type { Skill } from "../api/types";

const props = defineProps<{
  models: string[];
  /** Backends users may pick (GET /mine/backends). */
  backends?: UserAgentBackend[];
  /** Generation models per enabled kind (GET /mine/gen-models); its keys are the kinds shown. */
  genModels?: Record<string, string[]>;
  /** G-TASK-TOOL-PICK-1900: enabled skills (GET /skill) and pickable tools (GET /tool/catalog). */
  skills?: Skill[];
  tools?: ToolCatalogItem[];
  busy: boolean;
  /** Already-translated messages per field, plus `form`; shown as text only. */
  errors: Record<string, string>;
  initial?: Partial<Draft> & { id: number; slug?: string };
}>();
const emit = defineEmits<{ submit: [draft: Draft, avatar?: File]; cancel: [] }>();
const { t, te, locale } = useI18n();

const draft = reactive<Draft>(emptyDraft(props.initial));
const local = ref<Partial<Record<string, string>>>({});
const editing = computed(() => !!props.initial);
// Keep the current value selectable even if it was later closed to users.
const keep = (current: string, list: string[]) => (current && !list.includes(current) ? [current, ...list] : list);
const options = computed(() => keep(draft.model, props.models));
const backendOptions = computed(() => {
  const list = props.backends ?? [];
  const cur = draft.executionBackend;
  return cur && !list.some((b) => b.id === cur) ? [{ id: cur, displayName: cur }, ...list] : list;
});
const kinds = computed(() => Object.keys(props.genModels ?? {}));
for (const k of kinds.value) draft.gen[k] ??= "";
const genOptions = (kind: string) => keep(draft.gen[kind] ?? "", props.genModels?.[kind] ?? []);
const kindLabel = (kind: string) => (te(`agents.mine.gen_${kind}`) ? t(`agents.mine.gen_${kind}`) : kind);
const count = (s: string) => [...s].length;
// Picked ids no longer listed stay visible (checked, flagged) so the owner can untick them.
const withMissing = <T extends { id: number }>(list: T[], picked: number[], stub: (id: number) => T) =>
  [...list, ...picked.filter((id) => !list.some((x) => x.id === id)).map(stub)];
const skillRows = computed(() => withMissing((props.skills ?? []).map((s) => ({ id: s.id, label: skillName(s), missing: false })),
  draft.skillIds, (id) => ({ id, label: `#${id}`, missing: true })));
const toolRows = computed(() => withMissing((props.tools ?? []).map((x) => ({ id: x.id, label: toolLabel(x, locale.value), missing: false,
  covered: coveredBySkills(x, draft.skillIds) })), draft.toolIds, (id) => ({ id, label: `#${id}`, missing: true, covered: false })));
function skillName(s: Skill): string {
  const bundle = s.i18n?.[locale.value];
  const name = bundle && typeof bundle === "object" ? (bundle as Record<string, unknown>).name : undefined;
  return (typeof name === "string" && name) || s.name || s.slug;
}
function toggle(list: "skillIds" | "toolIds", id: number, on: boolean): void {
  draft[list] = on ? [...new Set([...draft[list], id])] : draft[list].filter((x) => x !== id);
}
const message = (field: string) => (local.value[field] ? t(local.value[field]!) : props.errors[field] ?? "");

// Avatar: picked here, uploaded by the parent only on submit (cancel stores nothing).
const avatarFile = ref<File>();
const avatarPreview = ref("");
function onAvatar(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const bad = checkAvatarFile(file);
  local.value = { ...local.value, avatar: bad ? `agents.avatar_${bad}` : "" };
  if (bad) return;
  avatarFile.value = file;
  if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value);
  avatarPreview.value = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
}

const dialog = ref<HTMLElement>();
const nameInput = ref<HTMLInputElement>();
const previousFocus = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
onMounted(() => nameInput.value?.focus());
onBeforeUnmount(() => { previousFocus?.focus?.(); if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value); });

function submit() {
  if (props.busy) return;
  local.value = validateDraft(draft, !editing.value);
  if (Object.keys(local.value).length) return;
  // A tool a picked skill brings is dropped (the server refuses the pair: tool_covered_by_skill).
  emit("submit", { ...draft, gen: { ...draft.gen }, skillIds: [...draft.skillIds],
    toolIds: effectiveToolIds(draft.toolIds, props.tools ?? [], draft.skillIds) }, avatarFile.value);
}
</script>

<template>
  <div class="ua-scrim" @click.self="emit('cancel')">
    <form ref="dialog" class="ua-wizard" role="dialog" aria-modal="true" aria-labelledby="ua-title" data-testid="ua-wizard" novalidate
      @submit.prevent="submit" @keydown.esc="emit('cancel')" @keydown="trapDialogFocus">
      <h2 id="ua-title">{{ editing ? t("agents.mine.editTitle") : t("agents.mine.wizardTitle") }}</h2>
      <p class="ua-hint">{{ t("agents.mine.wizardHint") }}</p>

      <div class="ua-avatar" :data-testid="avatarFile ? 'ua-avatar-picked' : 'ua-avatar-default'">
        <span class="ua-av" aria-hidden="true">
          <img v-if="avatarPreview" :src="avatarPreview" alt="">
          <template v-else>{{ [...(draft.name.trim() || "?")][0] }}</template>
        </span>
        <label class="ua-avatar-pick" for="ua-avatar">{{ t("agents.mine.avatar") }} · {{ avatarFile ? avatarFile.name : t("agents.mine.avatarPick") }}</label>
        <input id="ua-avatar" class="ua-file" type="file" :accept="USER_AVATAR_CONTRACT.types.join(',')" data-testid="ua-avatar-input"
          aria-describedby="ua-avatar-err" @change="onAvatar">
      </div>
      <p id="ua-avatar-err" class="ua-row"><span class="ua-err">{{ local.avatar ? t(local.avatar, { mb: USER_AVATAR_CONTRACT.maxBytes >> 20, side: USER_AVATAR_CONTRACT.maxSide }) : errors.avatar ?? "" }}</span></p>

      <template v-if="editing && initial?.slug">
        <label for="ua-slug">{{ t("agents.mine.slug") }}</label>
        <input id="ua-slug" :value="initial.slug" type="text" readonly aria-readonly="true" data-testid="ua-slug">
        <p class="ua-row"><span>{{ t("agents.mine.slugHint") }}</span></p>
      </template>

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

      <label class="ua-check" for="ua-memory">
        <input id="ua-memory" v-model="draft.memory" type="checkbox" data-testid="ua-memory"> {{ t("agents.mine.memory") }}
      </label>
      <p class="ua-row"><span>{{ t("agents.mine.memoryHint") }}</span></p>

      <label for="ua-backend">{{ t("agents.mine.backend") }}</label>
      <select id="ua-backend" v-model="draft.executionBackend" :aria-invalid="!!message('executionBackend')" aria-describedby="ua-backend-err"
        data-testid="ua-backend">
        <option value="">{{ t("agents.mine.platformDefault") }}</option>
        <option v-for="b in backendOptions" :key="b.id" :value="b.id">{{ b.displayName }}</option>
      </select>
      <p id="ua-backend-err" class="ua-row"><span class="ua-err">{{ message("executionBackend") }}</span></p>

      <fieldset v-if="kinds.length" class="ua-gen" data-testid="ua-gen">
        <legend>{{ t("agents.mine.genModels") }}</legend>
        <template v-for="kind in kinds" :key="kind">
          <label :for="`ua-gen-${kind}`">{{ kindLabel(kind) }}</label>
          <select :id="`ua-gen-${kind}`" v-model="draft.gen[kind]" :data-testid="`ua-gen-${kind}`" :aria-invalid="!!message('gen')"
            aria-describedby="ua-gen-err">
            <option value="">{{ t("agents.mine.platformDefault") }}</option>
            <option v-for="m in genOptions(kind)" :key="m" :value="m">{{ m }}</option>
          </select>
        </template>
        <p id="ua-gen-err" class="ua-row"><span class="ua-err">{{ message("gen") }}</span></p>
      </fieldset>

      <fieldset class="ua-gen" data-testid="ua-skills">
        <legend>{{ t("agents.mine.skills") }}</legend>
        <p class="ua-row"><span>{{ t("agents.mine.bindingsHint") }}</span></p>
        <p v-if="!skillRows.length" class="ua-row"><span>{{ t("agents.mine.bindingsEmpty") }}</span></p>
        <label v-for="s in skillRows" :key="s.id" class="ua-check" :data-testid="`ua-skill-${s.id}`">
          <input type="checkbox" :checked="draft.skillIds.includes(s.id)" :disabled="s.missing && !draft.skillIds.includes(s.id)"
            @change="toggle('skillIds', s.id, ($event.target as HTMLInputElement).checked)"> {{ s.label }}
          <small v-if="s.missing" class="ua-err">{{ t("agents.mine.bindingUnavailable") }}</small>
        </label>
      </fieldset>
      <fieldset class="ua-gen" data-testid="ua-tools">
        <legend>{{ t("agents.mine.tools") }}</legend>
        <p v-if="!toolRows.length" class="ua-row"><span>{{ t("agents.mine.bindingsEmpty") }}</span></p>
        <label v-for="x in toolRows" :key="x.id" class="ua-check" :data-testid="`ua-tool-${x.id}`">
          <input type="checkbox" :checked="draft.toolIds.includes(x.id) && !x.covered" :disabled="x.covered || (x.missing && !draft.toolIds.includes(x.id))"
            @change="toggle('toolIds', x.id, ($event.target as HTMLInputElement).checked)"> {{ x.label }}
          <small v-if="x.covered">{{ t("common.toolCoveredBySkill") }}</small>
          <small v-else-if="x.missing" class="ua-err">{{ t("agents.mine.bindingUnavailable") }}</small>
        </label>
        <p id="ua-bindings-err" class="ua-row"><span class="ua-err">{{ message("bindings") }}</span></p>
      </fieldset>

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
.ua-av { width: 40px; height: 40px; border-radius: var(--r-lg); display: grid; place-items: center; background: var(--grad-brand); color: #fff; font-weight: 600; overflow: hidden; }
.ua-av img { width: 100%; height: 100%; object-fit: cover; }
.ua-avatar-pick { cursor: pointer; text-decoration: underline; }
.ua-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
.ua-file:focus-visible + * , .ua-avatar:focus-within .ua-avatar-pick { outline: 2px solid var(--teal-500); outline-offset: 2px; }
.ua-wizard input[readonly] { background: var(--bg-subtle, var(--bg-card)); color: var(--text-tertiary); }
.ua-check { display: flex; align-items: center; gap: 8px; }
.ua-wizard .ua-check input { width: auto; }
.ua-gen { border: 1px solid var(--border); border-radius: var(--r-md); padding: 8px 12px 4px; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.ua-gen legend { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); padding: 0 4px; }
.ua-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.ua-actions button { height: 36px; padding: 0 16px; font-size: 13px; }
.ua-actions button:disabled { opacity: 0.6; cursor: progress; }
@media (prefers-reduced-motion: reduce) { .ua-wizard { animation: none; } }
</style>
