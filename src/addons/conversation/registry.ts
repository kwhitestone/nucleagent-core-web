// UI-IMPL-6: media kind registry — same rows as core
// app/src/server/addons/media/registry.go (change both in one PR). The server
// validates; hiding a value here is UX only. Relative imports only (node --test).
import type { MediaModel } from "./composables/generation.ts";

export type MediaKindId = "image" | "video" | "music";
export interface ParamDecl { key: string; default: string; values: string[] }
export interface MediaKindRow {
  kind: MediaKindId;
  enabled: boolean;
  /** i18n key of the entry label under chatGen.kinds.<kind>. */
  icon: "image" | "video" | "music";
  params: ParamDecl[];
  expectSec: number;
  busyLimit: number;
  card: "image-grid" | "video-player" | "audio-wave";
}

export const MEDIA_KINDS: Record<MediaKindId, MediaKindRow> = {
  image: {
    kind: "image", enabled: true, icon: "image",
    params: [
      { key: "aspect", default: "1:1", values: ["1:1", "3:4", "4:3", "9:16", "16:9"] },
      { key: "count", default: "1", values: ["1", "2", "3", "4"] },
    ],
    expectSec: 20, busyLimit: 4, card: "image-grid",
  },
  video: {
    kind: "video", enabled: true, icon: "video",
    params: [
      { key: "aspect", default: "16:9", values: ["16:9", "9:16", "1:1"] },
      { key: "duration", default: "4", values: ["4", "5", "8"] },
      { key: "resolution", default: "480p", values: ["480p", "720p"] },
      { key: "count", default: "1", values: ["1"] },
    ],
    expectSec: 120, busyLimit: 2, card: "video-player",
  },
  // Reserved (D57): no entry this phase.
  music: { kind: "music", enabled: false, icon: "music", params: [], expectSec: 0, busyLimit: 1, card: "audio-wave" },
};

export type GenKind = "image" | "video";
export const enabledKinds = (): MediaKindRow[] => Object.values(MEDIA_KINDS).filter((k) => k.enabled);
export const isKind = (k: unknown): k is MediaKindId => typeof k === "string" && k in MEDIA_KINDS;
/** Agent config.defaults key of a kind's default model (`<kind>Model`). */
export const modelKey = (kind: MediaKindId): string => `${kind}Model`;
export const kindOf = (meta: { kind?: string } | null | undefined): GenKind => (meta?.kind === "video" ? "video" : "image");

export type GenParams = Record<string, string>;
export const defaultParams = (kind: MediaKindId): GenParams =>
  Object.fromEntries(MEDIA_KINDS[kind].params.map((p) => [p.key, p.default]));

const NUMERIC = new Set(["count", "duration"]);
/** POST body fields for these params; the image body stays { aspect, count }. */
export function requestParams(kind: MediaKindId, params: GenParams): Record<string, string | number> {
  return Object.fromEntries(MEDIA_KINDS[kind].params.map((p) => {
    const v = params[p.key] ?? p.default;
    return [p.key, NUMERIC.has(p.key) ? Number(v) : v];
  }));
}

/** Params of a stored media message (for regenerate / retry). */
export function paramsFromMeta(meta: Record<string, unknown> | null | undefined): GenParams {
  const kind = kindOf(meta as { kind?: string });
  const out = defaultParams(kind);
  for (const key of Object.keys(out)) if (meta?.[key] != null && meta[key] !== "") out[key] = String(meta[key]);
  return out;
}

/** Preselect the agent default when the list has it; otherwise today's behavior (first). */
export function pickModel(models: MediaModel[], preferred: string | undefined): { model: MediaModel | null; agentDefault: boolean } {
  const hit = preferred ? models.find((m) => m.model === preferred) : undefined;
  return hit ? { model: hit, agentDefault: true } : { model: models[0] ?? null, agentDefault: false };
}

/** `<kind>Model` strings from an agent config (public view); anything else is ignored. */
export function agentDefaults(config: { defaults?: Record<string, unknown> } | null | undefined): Partial<Record<GenKind, string>> {
  const out: Partial<Record<GenKind, string>> = {};
  for (const k of enabledKinds()) {
    const v = config?.defaults?.[modelKey(k.kind)];
    if (typeof v === "string" && v) out[k.kind as GenKind] = v;
  }
  return out;
}

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const SKIP = "chatGen.videoConfirmSkip:";
const local = (): KV | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);
/** Video asks once per conversation until "don't remind me" (browser-local, never stored server-side). */
export function needsConfirm(kind: GenKind, conversationId: string, ls: KV | undefined = local()): boolean {
  if (kind !== "video") return false;
  try { return ls?.getItem(SKIP + conversationId) !== "1"; } catch { return true; }
}
export function skipConfirm(conversationId: string, ls: KV | undefined = local()): void {
  try { ls?.setItem(SKIP + conversationId, "1"); } catch { /* private mode: ask again next time */ }
}
