import type { ModelChoice } from "../addons/conversation/api/types.ts";
import type { TypedModel } from "../contracts/model-catalog.ts";
import { fill } from "./singleSlotQueue.ts";

/**
 * MUYU-418 contract v1 (toolgate docs/muyu418-model-catalog-contract.md): per-model availability and
 * image-input capability, read only from the catalog fields. Nothing is inferred from a model name.
 */
export type Vision = "supported" | "unsupported" | "unverified";
export const UNAVAILABLE_REASONS = ["auth_401", "capacity", "route_disabled", "upstream_offline", "unknown"] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];
export type Availability = { state: "available" } | { state: "unprobed" } | { state: "unavailable"; reason: UnavailableReason };

const VISION: readonly string[] = ["supported", "unsupported", "unverified"];
const same = (a: ModelChoice, b: { providerId: number | string; model: string }) => String(a.providerId) === String(b.providerId) && a.model === b.model;

/** `vision_in` when sent; an old Core only has `capabilities` (the contract keeps them equal); anything else is unverified. */
export function visionOf(model: TypedModel | undefined): Vision {
  if (!model) return "unverified";
  if (model.vision_in !== undefined) return VISION.includes(model.vision_in) ? model.vision_in as Vision : "unverified";
  return model.capabilities?.includes("vision_in") ? "supported" : "unverified";
}

/** `available:false` always has a reason (unknown when missing); `null` = 未探测; an absent field (old Core) = no label. */
export function availabilityOf(model: TypedModel): Availability {
  if (model.available === false) {
    const reason = (UNAVAILABLE_REASONS as readonly string[]).includes(model.unavailableReason ?? "") ? model.unavailableReason as UnavailableReason : "unknown";
    return { state: "unavailable", reason };
  }
  return model.available === null ? { state: "unprobed" } : { state: "available" };
}

export interface ImageGate { state: Vision; block: boolean; model: string | null; alternatives: string[] }

/** What happens to an image upload with `selected` (null = server default, which has no evidence here). */
export function imageGate(selected: ModelChoice | null, models: TypedModel[]): ImageGate {
  const entry = selected ? models.find((m) => same(selected, m)) : undefined;
  const state = visionOf(entry);
  const alternatives = state === "supported" ? [] : models
    .filter((m) => visionOf(m) === "supported" && availabilityOf(m).state !== "unavailable" && !(selected && same(selected, m)))
    .map((m) => m.model);
  return { state, block: state === "unsupported", model: selected?.model ?? null, alternatives };
}

/** Deterministic composer text for an attached image; none when the model is known to read images. */
export function imageHint(gate: ImageGate, t: (key: string) => string): string | undefined {
  if (gate.state === "supported") return undefined;
  const name = gate.model ?? t("common.modelDefault");
  const others = gate.alternatives.length ? fill(t("chatReact.visionSwitchTo"), { models: gate.alternatives.join("、") }) : t("chatReact.visionNoAlternative");
  return `${name} ${t(gate.state === "unsupported" ? "chatReact.visionBlockedHint" : "chatReact.visionUnverifiedHint")}${others}`;
}
