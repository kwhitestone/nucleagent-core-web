<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { definitionFields, genModelState, readPath, validateChanges, type Changes } from "./draft";
import type { MediaModel } from "../../../conversation/composables/generation.ts";
import { text, type MessageKey } from "./messages";
import EditorFields, { type EditorField } from "../../../../components/agent-edit/EditorFields.vue";

export interface Choice { value: string | number; label: string }
export interface ReadonlyField { path: string; type: string; reason: string; value?: unknown; hidden?: boolean }
const props = defineProps<{
  baseline: unknown;
  changes: Changes;
  editablePaths: string[];
  readonlyFields: ReadonlyField[];
  backends: Choice[];
  providers: Choice[];
  models: Choice[];
  /** UI-IMPL-6: media catalog per kind; null = read failed (no "delisted" claim). */
  genModels?: Record<string, MediaModel[] | null>;
  busy?: boolean;
  only?: readonly string[];
}>();
const emit = defineEmits<{ change: [path: string, value: unknown] }>();
const { locale } = useI18n();
const label = (key: MessageKey) => text(key, locale.value);
const errors = computed(() => validateChanges(props.baseline, props.changes));
const touched = ref(new Set<string>());
const shownError = (path: string) => touched.value.has(path) || Object.hasOwn(props.changes, path) ? errors.value[path] : undefined;
const fields = computed(() => props.only ? definitionFields.filter(field => props.only!.includes(field.path)) : definitionFields);
const value = (path: string) => Object.hasOwn(props.changes, path) ? props.changes[path] : readPath(props.baseline, path);
const allowed = (path: string) => props.editablePaths.includes(path) && !props.busy;
const id = (path: string) => `definition${path.replaceAll("/", "-")}`;
const choices = (kind: string) => kind === "backend" ? props.backends : kind === "provider" ? props.providers : props.models;
const genList = (kind?: string) => kind ? props.genModels?.[kind] : undefined;
const genState = (path: string, kind?: string) => genModelState(value(path), genList(kind));
const reason = (path: string) => props.readonlyFields.find((field) => field.path === path)?.reason || label("readonly");
function change(path: string, value: string | boolean, kind: string) {
  if (!allowed(path)) return;
  emit("change", path, kind === "provider" ? (value ? Number(value) : null) : value);
}
function fieldChoices(field: typeof definitionFields[number]) {
  const current = value(field.path);
  const list = field.kind === "genModel"
    ? (genList(field.genKind) ?? []).map(m => ({ value: m.model, label: `${m.model} · ${label(m.kind as MessageKey)} · ${m.verified ? label('genVerified') : label('genUnverified')}` }))
    : choices(field.kind);
  return current && !list.some(c => c.value === current)
    ? [{ value: String(current), label: field.kind === "genModel" ? String(current) : `${current} (${label("unavailable")})`, disabled: true }, ...list] : list;
}
function errorLabel(error: string) {
  const key = ({ slug: "slugError", avatar: "avatarError", provider: "providerError" } as Record<string, MessageKey>)[error] ?? error;
  return text(key as MessageKey, locale.value);
}
const display = (field: ReadonlyField) => field.hidden ? label("preserved")
  : field.value === undefined ? label("unknown") : typeof field.value === "string" ? field.value : JSON.stringify(field.value, null, 2);
const controls = computed<EditorField[]>(() => fields.value.map(field => {
  const delisted = field.kind === "genModel" && genState(field.path, field.genKind) === "delisted";
  const error = shownError(field.path);
  return {
    path: field.path, id: id(field.path), label: label(field.label as MessageKey), modelValue: value(field.path),
    kind: field.kind === "boolean" ? "boolean" : field.kind === "textarea" ? "textarea"
      : ["backend", "provider", "model", "genModel"].includes(field.kind) ? "select" : "text",
    editable: allowed(field.path), rows: field.label === "prompt" ? 8 : 3, choices: fieldChoices(field),
    emptyLabel: field.kind === "genModel" ? label("genInherit") : label("inherit"),
    invalid: !!error || delisted, controlAttrs: { autocomplete: field.label === "name" ? "off" : undefined },
    hint: delisted ? label("genDelisted") : error ? errorLabel(error) : !props.editablePaths.includes(field.path)
      ? reason(field.path) : field.label === "memory" ? label("memoryNote") : "",
    max: field.max,
  };
}));
function update(path: string, value: string | boolean) {
  const field = fields.value.find(field => field.path === path);
  if (field) change(path, value, field.kind);
}
</script>

<template>
  <div class="definition-fields">
    <EditorFields :fields="controls" @change="update" @touch="touched.add($event)" />
    <details v-if="readonlyFields.length && !only?.length" class="definition-metadata">
      <summary>{{ label('metadata') }}</summary>
      <dl>
        <template v-for="field in readonlyFields" :key="field.path">
          <dt><code>{{ field.path }}</code> <small>{{ field.type }}</small></dt>
          <dd><pre>{{ display(field) }}</pre><small>{{ field.reason }}</small></dd>
        </template>
      </dl>
    </details>
  </div>
</template>

<style scoped>
.definition-fields { display: grid; gap: 16px; min-width: 0; }
.definition-field { display: grid; gap: 6px; min-width: 0; }
label { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; font-weight: 600; font-size: 13px; color: var(--text-primary); }
code, small { font-size: 12px; font-weight: 400; overflow-wrap: anywhere; color: var(--text-secondary); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.definition-error { color: var(--rose-500); }
.definition-metadata { border-top: 1px solid var(--border); padding-top: 12px; }
summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; }
dl { margin: 0; } dt { margin-top: 14px; } dd { margin: 4px 0 0; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin: 4px 0; }
</style>
