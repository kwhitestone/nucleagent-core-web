import type { Provider, TypedModel } from "../contracts/model-catalog.ts";
import type { ExecutionBackendOption, ModelChoice } from "../addons/conversation/api/types.ts";
import { pickerOptions } from "../addons/conversation/components/modelPickerOptions.ts";
import { availabilityOf, visionOf, type UnavailableReason, type Vision } from "./modelCaps.ts";

export type GroupKind = "chat" | "image" | "video" | "executor";
export type Choice =
  | { kind: "chat" | "image" | "video"; model: ModelChoice }
  | { kind: "executor"; backend: string };
/** `label` is the model (or executor) name; `hint` the provider; `upstream` the real gateway upstream, when the catalog says. */
/** MUYU-418: `vision` (chat only), `unavailable` reason (greyed, not pickable), `unprobed` = no availability evidence yet. */
export interface Option { value: string; label: string; hint?: string; upstream?: string; vision?: Vision; unavailable?: UnavailableReason | "unwired" | "no_prompt" | "not_enabled"; unprobed?: true; choice: Choice }
export interface Group { kind: GroupKind; options: Option[] }

/** Stable `<option value>` for a choice. */
export const choiceValue = (c: Choice): string =>
  c.kind === "executor" ? `executor:${c.backend}` : `${c.kind}:${c.model.providerId}:${c.model.model}`;

/** House names for Toolgate upstreams (TEST: 2 aihub-gateway, 3 everai-yunyi); others show their own name. */
const UPSTREAM_NAMES: Record<string, string> = { "aihub-gateway": "AIHub", "everai-yunyi": "云一/everai" };

/**
 * Plan §4 unified dropdown: chat / image / video model groups from the Toolgate typed
 * catalog (same narrowing as ModelPicker via pickerOptions), plus Core's executors.
 * Empty groups are dropped.
 */
export function modelGroups(providers: Provider[], typed: Record<string, TypedModel[]> | null, backends: ExecutionBackendOption[]): Group[] {
  const models = (["chat", "image", "video"] as const).map((kind): Group => {
    const entries = typed?.[kind] ?? [];
    const upstreams = new Map(entries.filter((m) => m.upstream).map((m) => [`${m.providerId}:${m.model}`, m.upstream!]));
    const byKey = new Map(entries.map((m) => [`${m.providerId}:${m.model}`, m]));
    return {
      kind,
      options: pickerOptions(providers, typed?.[kind] ?? [], kind).flatMap((g) => g.models.map((model) => {
        const choice: Choice = { kind, model: { providerId: g.id, model } };
        const upstream = upstreams.get(`${g.id}:${model}`);
        const entry = byKey.get(`${g.id}:${model}`);
        const availability = entry ? availabilityOf(entry) : undefined;
        return { value: choiceValue(choice), label: model, hint: g.name, ...(upstream ? { upstream: UPSTREAM_NAMES[upstream] ?? upstream } : {}),
          ...(kind === "chat" && entry ? { vision: visionOf(entry) } : {}),
          ...(availability?.state === "unavailable" ? { unavailable: availability.reason } : availability?.state === "unprobed" ? { unprobed: true as const } : {}), choice };
      })),
    };
  });
  const executors: Group = {
    kind: "executor",
    options: backends.map((b) => {
      const choice: Choice = { kind: "executor", backend: String(b.id) };
      return { value: choiceValue(choice), label: b.displayName || String(b.id), choice };
    }),
  };
  return [...models, executors].filter((g) => g.options.length > 0);
}
