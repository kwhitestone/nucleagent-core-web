import type { Provider, TypedModel, UserVisibleModel } from "@/contracts/model-catalog";

export interface PickerGroup {
  id: number;
  name: string;
  models: string[];
}

/**
 * config.models guarded: config is free JSON, so a dirty row must not break the
 * dropdown (same handling as the Providers page).
 */
export function modelsOf(p: Provider): string[] {
  const m = p.config?.models;
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : [];
}

/**
 * The picker's provider groups for one model type (MT2-coreweb).
 *
 * `typed` is `GET /provider/models?type=<type>`; `null` means an old Core
 * (404 or `typesAvailable:false`). chat = config.models ∩ typed chat, and on an
 * old Core plain config.models (a new Core keeps config.models chat-only
 * anyway). Any other type lists exactly the typed entries, nothing without them.
 */
export function pickerOptions(providers: Provider[], typed: TypedModel[] | null, type: string): PickerGroup[] {
  const active = providers.filter((p) => p.isActive);
  const keep = typed ? new Set(typed.filter((m) => m.type === type).map((m) => `${m.providerId}:${m.model}`)) : null;
  return active
    .map((p) => {
      const listed = type === "chat" ? modelsOf(p) : (typed ?? []).filter((m) => m.providerId === p.id).map((m) => m.model);
      return { id: p.id, name: p.name, models: keep ? listed.filter((m) => keep.has(`${p.id}:${m}`)) : type === "chat" ? listed : [] };
    })
    .filter((g) => g.models.length > 0);
}

/** Admin mode groups (v2 visible models) are chat recommendations: shown for chat only. */
export function visiblePickerOptions(visible: UserVisibleModel[], type: string): UserVisibleModel[] {
  return type === "chat" ? visible.filter((m) => m.targetModel && m.configId > 0) : [];
}
