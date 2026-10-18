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
import EditField from "../../../components/agent-edit/EditField.vue";
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
  initial?: Partial<Draft> & { id: number; slug?: string };
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
const count = (s: string) => [...s].length;
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

// Avatar: picked here, uploaded by the parent only on submit (cancel stores nothing).
const avatarFile = ref<File>();

const dialog = ref<HTMLElement>();
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
onMounted(() => dialog.value?.querySelector<HTMLInputElement>("#ua-name")?.focus());
onBeforeUnmount(() => { previousFocus?.focus?.(); });

function submit() {
  if (props.busy) return;
  local.value = validateDraft(draft, !editing.value);
  if (Object.keys(local.value).length) { void locateErrors(local.value); return; }
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
      <div class="ua-layout">
      <!-- @vue-generic {Group} -->
      <EditSidebar :groups="sidebarGroups" :active="active" :aria-label="text('fields', locale)" @select="goTo" />
      <div class="ua-content">
      <section id="ua-group-basic" @focusin="active = 'basic'">
      <h3>{{ text(groupLabels.basic, locale) }}</h3>
      <p class="ua-hint">{{ t("agents.mine.wizardHint") }}</p>
      <AgentAvatarPicker id="ua-avatar" v-model="avatarFile" :name="draft.name" :disabled="busy" :error="errors.avatar" />

      <template v-if="editing && initial?.slug">
        <EditField id="ua-slug" :label="t('agents.mine.slug')" :model-value="initial.slug" :editable="false" :control-attrs="{ 'data-testid': 'ua-slug' }">
          <template #hint>{{ t("agents.mine.slugHint") }}</template>
        </EditField>
      </template>

      <EditField id="ua-name" :label="`${t('agents.mine.name')} *`" v-model="draft.name" required :invalid="!!message('name')">
        <template #hint><span class="ua-row"><span class="ua-err">{{ message("name") }}</span><span>{{ count(draft.name) }}/{{ LIMITS.name }}</span></span></template>
      </EditField>
      <EditField id="ua-desc" :label="t('agents.mine.description')" v-model="draft.description" kind="textarea" :rows="3" :invalid="!!message('description')">
        <template #hint><span class="ua-row"><span class="ua-err">{{ message("description") }}</span><span>{{ count(draft.description) }}/{{ LIMITS.description }}</span></span></template>
      </EditField>
      </section>
      <section id="ua-group-persona" @focusin="active = 'persona'">
      <h3>{{ text(groupLabels.persona, locale) }}</h3>
      <EditField id="ua-prompt" :label="t('agents.mine.prompt')" v-model="draft.prompt" kind="textarea" :rows="8"
        :placeholder="editing ? t('agents.mine.promptKeep') : ''" :invalid="!!message('prompt')">
        <template #hint><span class="ua-row"><span class="ua-err">{{ message("prompt") }}</span><span>{{ count(draft.prompt) }}/{{ LIMITS.prompt }}</span></span></template>
      </EditField>
      <EditField id="ua-memory" :label="t('agents.mine.memory')" v-model="draft.memory" kind="boolean" :control-attrs="{ 'data-testid': 'ua-memory' }">
        <template #hint>{{ message("memory") || t("agents.mine.memoryHint") }}</template>
      </EditField>
      </section>
      <section id="ua-group-model" @focusin="active = 'model'">
      <h3>{{ text(groupLabels.model, locale) }}</h3>
      <EditField id="ua-backend" :label="t('agents.mine.backend')" v-model="draft.executionBackend" kind="select"
        :choices="backendOptions.map(b => ({ value: b.id, label: b.displayName }))" :empty-label="t('agents.mine.platformDefault')"
        :invalid="!!message('executionBackend')" :control-attrs="{ 'data-testid': 'ua-backend' }">
        <template #hint>{{ message("executionBackend") }}</template>
      </EditField>
      <EditField id="ua-model" :label="`${t('agents.mine.model')} *`" v-model="draft.model" kind="select" required
        :choices="options.map(m => ({ value: m, label: m }))" :empty-label="t('agents.mine.modelPlaceholder')" empty-disabled :invalid="!!message('model')">
        <template #hint>{{ message("model") }}</template>
      </EditField>

      <fieldset v-if="kinds.length" class="ua-gen" data-testid="ua-gen">
        <legend>{{ t("agents.mine.genModels") }}</legend>
        <template v-for="kind in kinds" :key="kind">
          <EditField :id="`ua-gen-${kind}`" :label="kindLabel(kind)" v-model="draft.gen[kind]" kind="select"
            :choices="genOptions(kind).map(m => ({ value: m, label: m }))" :empty-label="t('agents.mine.platformDefault')"
            :control-attrs="{ 'data-testid': `ua-gen-${kind}` }" :invalid="!!message('gen')">
            <template #hint>{{ message("gen") }}</template>
          </EditField>
        </template>
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
      </div>
      <div v-if="formErrors.length" class="ua-form-err" role="alert" tabindex="-1" data-testid="ua-form-error">
        <p v-for="(error, index) in formErrors" :key="index">{{ error }}</p>
      </div>
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
.ua-wizard { width: min(1000px, calc(100vw - 32px)); height: min(800px, calc(100dvh - 48px)); overflow: hidden; padding: 18px 0 0; border-radius: var(--r-lg); background: var(--bg-card); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; gap: 6px; animation: fade-in-up 0.24s var(--ease-out) both; }
.ua-wizard > h2, .ua-wizard > .ua-form-err { padding: 0 24px; }
.ua-layout { display: grid; grid-template-columns: 176px minmax(0, 1fr); min-height: 0; flex: 1; border-block: 1px solid var(--border); }
.ua-content { overflow: auto; padding: 0 24px; min-width: 0; }
.ua-content section { display: grid; gap: 16px; padding: 20px 0; border-bottom: 1px solid var(--border); scroll-margin-top: 8px; }
.ua-content h3 { margin: 0; font-size: 15px; color: var(--text-primary); }
.ua-wizard h2 { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary); }
.ua-hint { margin: 0 0 8px; font-size: 12.5px; color: var(--text-tertiary); }
.ua-wizard [aria-invalid="true"] { border-color: var(--rose-500); }
.ua-row { margin: 0 0 4px; min-height: 16px; display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--text-tertiary); }
.ua-err, .ua-form-err { color: var(--rose-500); }
.ua-form-err { margin: 0; font-size: 12.5px; }
.ua-gen { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ua-gen legend { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); padding: 0 4px; }
.ua-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 24px 16px; flex-shrink: 0; }
.ua-actions button { height: 36px; padding: 0 16px; font-size: 13px; }
.ua-actions button:disabled { opacity: 0.6; cursor: progress; }
@media (prefers-reduced-motion: reduce) { .ua-wizard { animation: none; } }
@media (max-width: 600px) {
  .ua-wizard { width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0; }
  .ua-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .ua-content { padding: 0 16px; }
}
</style>
