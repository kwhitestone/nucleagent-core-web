import type { Provider, TypedModel } from "../contracts/model-catalog.ts";
import type { ExecutionBackendOption, ModelChoice } from "../addons/conversation/api/types.ts";
import { modelsOf } from "../addons/conversation/components/modelPickerOptions.ts";
import { availabilityOf, visionOf, type UnavailableReason, type Vision } from "./modelCaps.ts";

export type GroupKind = "chat" | "image" | "video" | "executor";
export type Choice =
  | { kind: "chat" | "image" | "video"; model: ModelChoice }
  | { kind: "executor"; backend: string };
/** `label` is the model (or executor) name; `hint` the provider; `upstream` the real gateway upstream, when the catalog says. */
/** MUYU-418: `vision` (chat only), `unavailable` reason (greyed, not pickable), `unprobed` = no availability evidence yet. */
/** design-1123 C: `denied` = Core's explicit negative combination code, `incompatible` = not usable with the current executor, `stale` = kept only because it is the current choice. */
export interface Option { pinned?: boolean; value: string; label: string; hint?: string; upstream?: string; vision?: Vision; unavailable?: UnavailableReason; unprobed?: true; denied?: string; incompatible?: true; stale?: true; choice: Choice }
export interface Group { kind: GroupKind; options: Option[] }

/** Stable `<option value>` for a choice. */
export const choiceValue = (c: Choice): string =>
  c.kind === "executor" ? `executor:${c.backend}` : `${c.kind}:${c.model.providerId}:${c.model.model}`;

/** Toolgate's explicit output declarations; input modalities and general tool access are independent. */
export function generates(kind: "image" | "video" | "music", entry: Pick<TypedModel, "type" | "capabilities">): boolean {
  const outputs = { image: ["t2i", "i2i"], video: ["t2v", "i2v"], music: ["music"] };
  return entry.type === (kind === "music" ? "audio" : kind) && outputs[kind].some(cap => entry.capabilities?.includes(cap));
}

/** House names for Toolgate upstreams (TEST: 2 aihub-gateway, 3 everai-yunyi); others show their own name. */
const UPSTREAM_NAMES: Record<string, string> = { "aihub-gateway": "AIHub", "everai-yunyi": "云一/everai" };

/**
 * Plan §4 unified dropdown: chat / image / video model groups from the Toolgate typed
 * catalog (same narrowing as ModelPicker via pickerOptions), plus Core's executors.
 * Empty groups are dropped.
 */
export function modelGroups(providers: Provider[], typed: Record<string, TypedModel[]> | null, backends: ExecutionBackendOption[]): Group[] {
  const active = new Map(providers.filter(provider => provider.isActive).map(provider => [provider.id, provider]));
  const models = (["chat", "image", "video"] as const).map((kind): Group => ({
    kind,
    options: (typed?.[kind] ?? []).flatMap(entry => {
      const provider = active.get(entry.providerId);
      if (!provider || entry.type !== kind || (kind === "chat" && !modelsOf(provider).includes(entry.model))) return [];
      if (kind !== "chat" && !generates(kind, entry)) return [];
      const choice: Choice = { kind, model: { providerId: provider.id, model: entry.model } };
      const availability = availabilityOf(entry);
      return [{
        value: choiceValue(choice), label: entry.model, hint: provider.name, choice,
        ...(entry.pinned ? { pinned: true } : {}),
        ...(entry.upstream ? { upstream: UPSTREAM_NAMES[entry.upstream] ?? entry.upstream } : {}),
        ...(kind === "chat" ? { vision: visionOf(entry) } : {}),
        ...(availability.state === "unavailable" ? { unavailable: availability.reason }
          : availability.state === "unprobed" ? { unprobed: true as const } : {}),
      }];
    }),
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

/** Core machine codes that state a combination will never work (MUYU-418); any other code is not a negative fact. */
export const DENIED_CODES: readonly string[] = ["upstream_protocol_unsupported", "official_unsupported", "translation_unsupported"];

/**
 * design-1123 rule C: what a menu lists. Unavailable, explicitly denied and executor-incompatible options are left out;
 * the current choice stays, marked `stale`, so it is never silently swapped. `unprobed` and vision limits pass through.
 */
export function visibleOptions(options: readonly Option[], currentValue: string): Option[] {
  return options.flatMap((option) => {
    const hidden = !!option.unavailable || !!option.incompatible || (!!option.denied && DENIED_CODES.includes(option.denied));
    return !hidden ? [option] : option.value === currentValue ? [{ ...option, stale: true as const }] : [];
  });
}

/**
 * MUYU-365 V5 (protomedia-v5 split()): the button's middle ellipsis. The tail starts where `name` departs from its closest
 * look-alike (longest shared prefix ≥ 8), aligned back to a `-`, so the part that tells two models apart is never cut and
 * still fits a narrow pill. Without a look-alike the last 8 characters (aligned the same way) are kept; a tail shorter
 * than 8 gains one more segment so it stays readable (`flash-260910`, not `260910`).
 */
export function splitName(name: string, siblings: readonly string[]): [string, string] {
  let shared = -1;
  for (const other of siblings) {
    if (other === name) continue;
    let i = 0;
    while (i < name.length && name[i] === other[i]) i++;
    if (i >= 8) shared = Math.max(shared, i);
  }
  let cut = shared >= 0 ? shared : Math.max(0, name.length - 8);
  cut = name.lastIndexOf("-", cut - 1) + 1 || cut;
  if (cut > 1 && name.length - cut < 8) cut = name.lastIndexOf("-", cut - 2) + 1 || cut;
  return [name.slice(0, cut), name.slice(cut)];
}

/**
 * MUYU-365 V5 rule 「不静默换模型」: an executor that cannot run the current model is still taken (locally, nothing saved,
 * the model kept and flagged, send disabled). A model or default pick Core would refuse stays refused.
 */
export function pickPlan(choice: Choice | null, fits: boolean): "save" | "local" | "refuse" {
  if (fits) return "save";
  return choice?.kind === "executor" ? "local" : "refuse";
}
