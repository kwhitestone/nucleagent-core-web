<script setup lang="ts">
/**
 * Create / edit one of my agents (UI-DESIGN-5 §3.8; UA-EDIT-FIELDS-1230: same fields as the admin editor
 * minus server-managed ones). Presentational: the parent submits, uploads the picked avatar and maps errors.
 * Every pickable value comes from a server list; "" = platform default. Nothing is stored until submit.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { trapDialogFocus } from "../../administration/agents/definition/focus";
import { LIMITS, emptyDraft, validateDraft, type Draft, type UserAgentBackend } from "../api/userAgent";
import AgentAvatarPicker from "../../../shared/AgentAvatarPicker.vue";
import { coveredBySkills, effectiveToolIds, toolLabel, type ToolCatalogItem } from "../api/toolCatalog";
import type { Skill } from "../api/types";
import EditSidebar from "../../../components/agent-edit/EditSidebar.vue";
import EditorFields, { type EditorField } from "../../../components/agent-edit/EditorFields.vue";
import { definitionFields } from "../../administration/agents/definition/draft";
import DiscardDialog from "../../../components/agent-edit/DiscardDialog.vue";
import EditorLayout from "../../../components/agent-edit/EditorLayout.vue";
import SkillPicker from "../../../components/agent-edit/SkillPicker.vue";
import ToolBindings from "../../../components/agent-edit/ToolBindings.vue";
import { ownerGroups, groupLabels, type Group } from "../../../components/agent-edit/groups";
import { text } from "../../administration/agents/definition/messages";

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
  initial?: Partial<Draft> & { id: number; slug?: string; avatar?: string };
}>();
const emit = defineEmits<{ submit: [draft: Draft, avatar?: File]; cancel: [] }>();
const { t, te, locale } = useI18n();

const draft = reactive<Draft>(emptyDraft(props.initial));
const local = ref<Partial<Record<string, string>>>({});
const editing = computed(() => !!props.initial);
const active = ref<Group>("basic");
const sidebarGroups = computed(() => ownerGroups.map(id => ({ id, label: text(groupLabels[id], locale.value) })));
function goTo(group: Group) {
  active.value = group;
  dialog.value?.querySelector(`#ua-group-${group}`)?.scrollIntoView({ behavior: "auto", block: "start" });
}
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
// Picked ids no longer listed stay visible (checked, flagged) so the owner can untick them.
const withMissing = <T extends { id: number }>(list: T[], picked: number[], stub: (id: number) => T) =>
  [...list, ...picked.filter((id) => !list.some((x) => x.id === id)).map(stub)];
const skillRows = computed(() => (props.skills ?? []).map(s => ({ ...s, name: skillName(s), isActive: true })));
const toolRows = computed(() => withMissing((props.tools ?? []).map((x) => ({ id: x.id, name: toolLabel(x, locale.value), missing: false,
  covered: coveredBySkills(x, draft.skillIds) })), draft.toolIds, (id) => ({ id, name: `#${id}`, missing: true, covered: false })));
function skillName(s: Skill): string {
  const bundle = s.i18n?.[locale.value];
  const name = bundle && typeof bundle === "object" ? (bundle as Record<string, unknown>).name : undefined;
  return (typeof name === "string" && name) || s.name || s.slug;
}
function toggle(list: "skillIds" | "toolIds", id: number, on: boolean): void {
  draft[list] = on ? [...new Set([...draft[list], id])] : draft[list].filter((x) => x !== id);
}
const message = (field: string) => (local.value[field] ? t(local.value[field]!) : props.errors[field] ?? "");
const ownerKeys = {
  "/name": "name", "/config/description": "description", "/config/prompt": "prompt",
  "/config/memory": "memory", "/config/defaults/executionBackend": "executionBackend",
  "/config/defaults/model": "model",
} as const;
const ownerControls = computed<EditorField[]>(() => definitionFields.flatMap(field => {
  const key = ownerKeys[field.path as keyof typeof ownerKeys];
  if (!key && !(field.genKind && kinds.value.includes(field.genKind))) return [];
  const gen = field.genKind;
  const errorKey = gen ? "gen" : key;
  return [{
    path: field.path, id: gen ? `ua-gen-${gen}` : `ua-${key === "description" ? "desc" : key === "executionBackend" ? "backend" : key}`,
    label: gen ? kindLabel(gen) : t(`agents.mine.${field.label}`),
    modelValue: gen ? draft.gen[gen] : draft[key],
    kind: field.kind === "textarea" ? "textarea" : field.kind === "boolean" ? "boolean"
      : ["backend", "model", "genModel"].includes(field.kind) ? "select" : "text",
    editable: !props.busy, required: key === "name" || key === "model",
    rows: key === "prompt" ? 8 : 3,
    placeholder: key === "prompt" && editing.value ? t("agents.mine.promptKeep") : "",
    choices: gen ? genOptions(gen).map(value => ({ value, label: value }))
      : key === "executionBackend" ? backendOptions.value.map(b => ({ value: b.id, label: b.displayName }))
      : key === "model" ? options.value.map(value => ({ value, label: value })) : [],
    emptyLabel: t(key === "model" ? "agents.mine.modelPlaceholder" : "agents.mine.platformDefault"),
    emptyDisabled: key === "model", invalid: !!message(errorKey),
    hint: message(errorKey) || (key === "memory" ? t("agents.mine.memoryHint") : ""),
    max: key === "name" || key === "description" || key === "prompt" ? LIMITS[key] : undefined,
    controlAttrs: { "data-testid": gen ? `ua-gen-${gen}` : `ua-${key === "executionBackend" ? "backend" : key}` },
  } satisfies EditorField];
}));
function controls(group: "basic" | "persona" | "model" | "gen") {
  return ownerControls.value.filter(field => group === "basic" ? ["/name", "/config/description"].includes(field.path)
    : group === "persona" ? ["/config/prompt", "/config/memory"].includes(field.path)
    : group === "model" ? ["/config/defaults/executionBackend", "/config/defaults/model"].includes(field.path)
    : definitionFields.some(schema => schema.path === field.path && schema.genKind));
}
function changeField(path: string, value: string | boolean) {
  if (props.busy || !ownerControls.value.some(field => field.path === path)) return;
  const key = ownerKeys[path as keyof typeof ownerKeys];
  if (key === "memory") { if (typeof value === "boolean") draft.memory = value; }
  else if (typeof value === "string") {
    if (key) draft[key] = value;
    else {
      const gen = definitionFields.find(field => field.path === path)?.genKind;
      if (gen && kinds.value.includes(gen)) draft.gen[gen] = value;
    }
  }
}

// Avatar: picked here, uploaded by the parent only on submit (cancel stores nothing).
const avatarFile = ref<File>();
const baseline = JSON.stringify(draft);
const dirty = computed(() => !!avatarFile.value || JSON.stringify(draft) !== baseline);
const discard = ref(false);
let leaving: ((allow: boolean) => void) | undefined;

const dialog = ref<HTMLDialogElement>();
const errorTargets = computed(() => [
  { field: "avatar", group: "basic", id: "ua-avatar" },
  { field: "name", group: "basic", id: "ua-name" },
  { field: "description", group: "basic", id: "ua-desc" },
  { field: "prompt", group: "persona", id: "ua-prompt" },
  { field: "memory", group: "persona", id: "ua-memory" },
  { field: "executionBackend", group: "model", id: "ua-backend" },
  { field: "model", group: "model", id: "ua-model" },
  ...(kinds.value.length ? [{ field: "gen", group: "model", id: `ua-gen-${kinds.value[0]}` }] : []),
  { field: "bindings", group: "skills", id: "ua-bindings-err" },
] as { field: string; group: Group; id: string }[]);
const formErrors = computed(() => Object.entries(props.errors)
  .filter(([field, error]) => error && !errorTargets.value.some(target => target.field === field))
  .map(([, error]) => error));
async function locateErrors(errors: Partial<Record<string, string>>) {
  const target = errorTargets.value.find(target => errors[target.field]);
  if (target) active.value = target.group;
  await nextTick();
  const element = dialog.value?.querySelector<HTMLElement>(target ? `#${target.id}` : ".ua-form-err");
  // Scroll the whole field so its hint stays visible alongside the focused control.
  (element?.closest(".edit-field") ?? element)?.scrollIntoView({ behavior: "auto", block: "center" });
  element?.focus({ preventScroll: true });
}
watch(() => props.errors, errors => {
  if (Object.values(errors).some(Boolean)) void locateErrors(errors);
}, { deep: true, immediate: true });
const previousFocus = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || props.busy) { event.preventDefault(); event.returnValue = ""; }
}
onMounted(() => {
  dialog.value?.showModal?.();
  dialog.value?.querySelector<HTMLInputElement>("#ua-name")?.focus();
  if (typeof window !== "undefined") window.addEventListener("beforeunload", beforeUnload);
});
onBeforeUnmount(() => {
  leaving?.(false);
  if (typeof window !== "undefined") window.removeEventListener("beforeunload", beforeUnload);
  dialog.value?.close?.(); previousFocus?.focus?.();
});

function cancel() {
  if (props.busy) return;
  if (dirty.value) discard.value = true;
  else emit("cancel");
}
function keepEditing() {
  discard.value = false; leaving?.(false); leaving = undefined;
}
function discardChanges() {
  if (props.busy) return;
  discard.value = false;
  if (leaving) { leaving(true); leaving = undefined; }
  else emit("cancel");
}
function escape() {
  if (props.busy) return;
  if (discard.value) keepEditing();
  else cancel();
}
function requestLeave(): Promise<boolean> {
  if (props.busy || leaving) return Promise.resolve(false);
  if (!dirty.value) return Promise.resolve(true);
  discard.value = true;
  return new Promise(resolve => { leaving = resolve; });
}
defineExpose({ requestLeave });
function submit() {
  if (props.busy || discard.value) return;
  local.value = validateDraft(draft, !editing.value);
  if (Object.keys(local.value).length) { void locateErrors(local.value); return; }
  // A tool a picked skill brings is dropped (the server refuses the pair: tool_covered_by_skill).
  emit("submit", { ...draft, gen: { ...draft.gen }, skillIds: [...draft.skillIds],
    toolIds: effectiveToolIds(draft.toolIds, props.tools ?? [], draft.skillIds) }, avatarFile.value);
}
</script>

<template>
  <dialog ref="dialog" class="ua-scrim" aria-labelledby="ua-title" @cancel.prevent="escape" @click.self="cancel">
    <form class="ua-wizard" data-testid="ua-wizard" novalidate
      @submit.prevent="submit" @keydown="trapDialogFocus">
      <h2 id="ua-title">{{ editing ? t("agents.mine.editTitle") : t("agents.mine.wizardTitle") }}</h2>
      <EditorLayout class="ua-layout">
      <template #navigation>
      <!-- @vue-generic {Group} -->
      <EditSidebar :groups="sidebarGroups" :active="active" :aria-label="text('fields', locale)" @select="goTo" />
      </template>
      <div class="ua-content">
      <section id="ua-group-basic" @focusin="active = 'basic'">
      <h3>{{ text(groupLabels.basic, locale) }}</h3>
      <p class="ua-hint">{{ t("agents.mine.wizardHint") }}</p>
      <AgentAvatarPicker id="ua-avatar" v-model="avatarFile" :current="initial?.avatar" :name="draft.name" :disabled="busy" :error="errors.avatar" />

      <template v-if="editing && initial?.slug">
        <EditorFields :fields="[{ path: '/slug', id: 'ua-slug', label: t('agents.mine.slug'), modelValue: initial.slug,
          editable: false, hint: t('agents.mine.slugHint'), controlAttrs: { 'data-testid': 'ua-slug' } }]" />
      </template>

      <EditorFields :fields="controls('basic')" @change="changeField" />
      </section>
      <section id="ua-group-persona" @focusin="active = 'persona'">
      <h3>{{ text(groupLabels.persona, locale) }}</h3>
      <EditorFields :fields="controls('persona')" @change="changeField" />
      </section>
      <section id="ua-group-model" @focusin="active = 'model'">
      <h3>{{ text(groupLabels.model, locale) }}</h3>
      <EditorFields :fields="controls('model')" @change="changeField" />

      <fieldset v-if="kinds.length" class="ua-gen" data-testid="ua-gen">
        <legend>{{ t("agents.mine.genModels") }}</legend>
        <EditorFields :fields="controls('gen')" @change="changeField" />
        <p id="ua-gen-err" class="ua-row"><span class="ua-err">{{ message("gen") }}</span></p>
      </fieldset>
      </section>
      <section id="ua-group-skills" @focusin="active = 'skills'">
      <h3>{{ text(groupLabels.skills, locale) }}</h3>
      <fieldset class="ua-gen" data-testid="ua-skills">
        <legend>{{ t("agents.mine.skills") }}</legend>
        <p class="ua-row"><span>{{ t("agents.mine.bindingsHint") }}</span></p>
        <SkillPicker :skills="skillRows" :selected="draft.skillIds" :editable="!busy" @toggle="(id, checked) => toggle('skillIds', id, checked)" />
      </fieldset>
      <fieldset class="ua-gen" data-testid="ua-tools">
        <legend>{{ t("agents.mine.tools") }}</legend>
        <p v-if="!toolRows.length" class="ua-row"><span>{{ t("agents.mine.bindingsEmpty") }}</span></p>
        <ToolBindings :rows="toolRows" :selected="draft.toolIds" :editable="!busy" omit-covered
          :covered-label="t('common.toolCoveredBySkill')" :unavailable-label="t('agents.mine.bindingUnavailable')"
          @toggle="(id, checked) => toggle('toolIds', id, checked)" />
        <p id="ua-bindings-err" class="ua-row" tabindex="-1"><span class="ua-err">{{ message("bindings") }}</span></p>
      </fieldset>
      </section>
      </div>
      </EditorLayout>
      <div v-if="formErrors.length" class="ua-form-err" role="alert" tabindex="-1" data-testid="ua-form-error">
        <p v-for="(error, index) in formErrors" :key="index">{{ error }}</p>
      </div>
      <div class="ua-actions">
        <button type="button" class="btn-ghost" :disabled="busy" data-testid="ua-cancel" @click="cancel">{{ t("agents.mine.cancel") }}</button>
        <button type="submit" class="btn-primary" :disabled="busy" :aria-busy="busy" data-testid="ua-submit">
          {{ editing ? t("agents.mine.submitSave") : t("agents.mine.submitCreate") }}
        </button>
      </div>
    </form>
    <DiscardDialog v-if="discard" :title="text('discard', locale)" :keep-label="text('keepEditing', locale)"
      :discard-label="text('discardChanges', locale)" :busy="busy" @keep="keepEditing" @discard="discardChanges" />
  </dialog>
</template>

<style>
/* Non-scoped like AgentCard; ua-* is core-private. Tokens and aurora.css keyframes only. */
.ua-scrim { position: fixed; inset: 0 0 0 auto; margin: 0; padding: 0; border: 0; width: min(1040px, 94vw); max-width: 100%; height: 100dvh; max-height: 100dvh; background: var(--bg-card); color: var(--text-primary); box-shadow: var(--shadow-lg); }
.ua-scrim::backdrop { background: rgba(15, 23, 42, 0.36); }
.ua-wizard { box-sizing: border-box; width: 100%; height: 100%; overflow: hidden; padding: 12px 0 0; background: var(--bg-card); display: flex; flex-direction: column; gap: 12px; animation: slide-in-right 0.24s var(--ease-out) both; }
.ua-wizard > h2, .ua-wizard > .ua-form-err { padding: 0 16px; }
.ua-layout { border-block: 1px solid var(--border); }
.ua-content { overflow: auto; padding: 0 20px 32px; min-width: 0; }
.ua-content section { display: grid; gap: 16px; padding: 20px 0; border-bottom: 1px solid var(--border); scroll-margin-top: 8px; }
.ua-content h3 { margin: 0; font-size: 15px; color: var(--text-primary); }
.ua-wizard h2 { margin: 0; font-size: 17px; font-weight: 700; color: var(--text-primary); overflow-wrap: anywhere; }
.ua-hint { margin: 0 0 8px; font-size: 12.5px; color: var(--text-tertiary); }
.ua-wizard [aria-invalid="true"] { border-color: var(--rose-500); }
.ua-row { margin: 0 0 4px; min-height: 16px; display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--text-tertiary); }
.ua-err, .ua-form-err { color: var(--rose-500); }
.ua-form-err { margin: 0; font-size: 12.5px; }
.ua-gen { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ua-gen legend { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); padding: 0 4px; }
.ua-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; flex-shrink: 0; }
.ua-actions button { height: 36px; padding: 0 16px; font-size: 13px; }
.ua-actions button:disabled { opacity: 0.6; cursor: progress; }
@media (prefers-reduced-motion: reduce) { .ua-wizard { animation: none; } }
@media (max-width: 600px) {
  .ua-scrim { width: 100%; }
  .ua-wizard { width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0; }
  .ua-content { padding: 0 16px; }
  .ua-actions { padding-bottom: calc(10px + env(safe-area-inset-bottom)); }
  .ua-actions button { min-height: 44px; }
}
</style>
