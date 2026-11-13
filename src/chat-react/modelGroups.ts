import type { Provider, TypedModel } from "../contracts/model-catalog.ts";
import type { ExecutionBackendOption, ModelChoice } from "../addons/conversation/api/types.ts";
import { pickerOptions } from "../addons/conversation/components/modelPickerOptions.ts";

export type GroupKind = "chat" | "image" | "video" | "executor";
export type Choice =
  | { kind: "chat" | "image" | "video"; model: ModelChoice }
  | { kind: "executor"; backend: string };
/** `label` is the model (or executor) name; `hint` the provider, shown as secondary text. */
export interface Option { value: string; label: string; hint?: string; choice: Choice }
export interface Group { kind: GroupKind; options: Option[] }

/** Stable `<option value>` for a choice. */
export const choiceValue = (c: Choice): string =>
  c.kind === "executor" ? `executor:${c.backend}` : `${c.kind}:${c.model.providerId}:${c.model.model}`;

/**
 * Plan §4 unified dropdown: chat / image / video model groups from the Toolgate typed
 * catalog (same narrowing as ModelPicker via pickerOptions), plus Core's executors.
 * Empty groups are dropped.
 */
export function modelGroups(providers: Provider[], typed: Record<string, TypedModel[]> | null, backends: ExecutionBackendOption[]): Group[] {
  const models = (["chat", "image", "video"] as const).map((kind): Group => ({
    kind,
    options: pickerOptions(providers, typed?.[kind] ?? null, kind).flatMap((g) => g.models.map((model) => {
      const choice: Choice = { kind, model: { providerId: g.id, model } };
      return { value: choiceValue(choice), label: model, hint: g.name, choice };
    })),
  }));
  const executors: Group = {
    kind: "executor",
    options: backends.map((b) => {
      const choice: Choice = { kind: "executor", backend: String(b.id) };
      return { value: choiceValue(choice), label: b.displayName || String(b.id), choice };
    }),
  };
  return [...models, executors].filter((g) => g.options.length > 0);
}
