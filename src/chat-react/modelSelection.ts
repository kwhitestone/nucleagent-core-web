import { useEffect, useRef, useState } from "react";
import { ApiError, getPlatformRuntime } from "@/contracts/platform-runtime";
import { cap } from "./requestEffort";
import { fill } from "./singleSlotQueue";

/**
 * MUYU-365 exp113 (design exp109/WEB-STAGE2-DESIGN.md, MUYU-418 WEB-CONTRACT): stage-2 call protocol / thinking level.
 * The only switch is Core's `protocols.<p>.selectable` for the actual executionBackend; vendor/native/upstream
 * verification flags are never read. With no selectable protocol (all four environments today) nothing is shown,
 * nothing new is sent and the v0.1.44 effort/profile turn goes out unchanged.
 */
export const PROTOCOLS = ["chat.completions", "responses", "gemini.generateContent", "messages"] as const;
export const LEVELS = ["off", "low", "medium", "high"] as const;
export type Level = (typeof LEVELS)[number];
export interface LevelView { level: Level; selectable: boolean; reason?: string }
export interface ProtocolView { name: string; selectable: boolean; reason?: string; levels: LevelView[] }
export type SelectionView = { state: "hidden" } | { state: "visible"; revision: number; protocols: ProtocolView[] };
export interface SelectionChoice { protocol: string; level: Level | null }
export interface ModelSelection { callProtocol: string; thinkingLevel: Level | null; capabilityRevision: number }
type Translate = (key: string) => string;
type Obj = Record<string, unknown>;

const HIDDEN: SelectionView = { state: "hidden" };
const obj = (value: unknown): value is Obj => !!value && typeof value === "object" && !Array.isArray(value);
/** Core's Chinese reason only on a disabled item; the machine code, evidence and verification flags never reach the view. */
const note = (on: boolean, raw: Obj) => on || typeof raw.reason !== "string" || !raw.reason ? {} : { reason: raw.reason };

/** Gate: the exact model's declaration for this backend, offered only when at least one protocol is selectable. */
export function capabilityView(capability: unknown, backend: string | null | undefined, scope?: { model: string }): SelectionView {
  if (!backend || !obj(capability) || !obj(capability.protocols) || (scope && capability.model !== scope.model)) return HIDDEN;
  const revision = capability.capability_revision;
  if (!Number.isSafeInteger(revision)) return HIDDEN;
  const declared = capability.protocols;
  const protocols = PROTOCOLS.flatMap((name): ProtocolView[] => {
    const raw = declared[name];
    if (!obj(raw)) return [];
    const selectable = raw.selectable === true;
    const levels = obj(raw.thinking_levels) ? raw.thinking_levels : {};
    return [{ name, selectable, ...note(selectable, raw), levels: LEVELS.map((level) => {
      const entry = obj(levels[level]) ? levels[level] as Obj : {};
      // Core's selectable level status is "supported" (llmproxy model_capability.go:201; the RED-time guess was "verified").
      const on = selectable && entry.status === "supported";
      return { level, selectable: on, ...note(on, entry) };
    }) }];
  });
  return protocols.some((p) => p.selectable) ? { state: "visible", revision: revision as number, protocols } : HIDDEN;
}

/** The per-turn field: only an explicit choice the view really offers, with Core's own revision. Absent otherwise. */
export function selectionRequest(view: SelectionView, choice: SelectionChoice | null | undefined): { modelSelection?: ModelSelection } {
  if (view.state !== "visible" || !choice) return {};
  const protocol = view.protocols.find((p) => p.name === choice.protocol && p.selectable);
  const level = choice.level;
  if (!protocol || (level !== null && !protocol.levels.some((l) => l.level === level && l.selectable))) return {};
  return { modelSelection: { callProtocol: protocol.name, thinkingLevel: level, capabilityRevision: view.revision } };
}

type Legacy = string | { profileId?: string; modelParams?: { reasoningEffort?: string } };
/**
 * This turn's fields. Hidden: the legacy turn as is (v0.1.44). Visible (D-1): the legacy effort is not sent, so it can
 * never collide with the new selection or a silent operator_default. With an explicit selection (D-2) only
 * modelSelection goes out — no reasoningEffort, modelParams or profileId.
 */
export function turnFields<T extends Legacy>(view: SelectionView, choice: SelectionChoice | null | undefined, legacy: T): T | { modelSelection: ModelSelection } | { profileId?: string } | "" {
  if (view.state !== "visible") return legacy;
  const picked = selectionRequest(view, choice);
  if (picked.modelSelection) return { modelSelection: picked.modelSelection };
  return typeof legacy === "string" ? "" : legacy.profileId ? { profileId: legacy.profileId } : "";
}

/**
 * design-1123 A (P2 phase 1 = C): a preset carries protocol + level in `params`. When the current declaration really
 * offers that combination the turn sends modelSelection only (D-2). Otherwise the preset is stale: no modelSelection,
 * only profileId (protocol/level fall back to 默认（继承）), and the caller says so. A preset without a protocol, and no
 * preset, keep today's fields.
 */
export function presetFields<T extends Legacy>(view: SelectionView, params: Record<string, string> | undefined, legacy: T) {
  const protocol = params?.callProtocol;
  if (!protocol) return { fields: turnFields(view, null, legacy), stale: false };
  const level = params.thinkingLevel ?? null;
  const picked = selectionRequest(view, { protocol, level: level as Level | null });
  if (picked.modelSelection) return { fields: { modelSelection: picked.modelSelection }, stale: false };
  return { fields: typeof legacy === "object" && legacy.profileId ? { profileId: legacy.profileId } : "" as const, stale: true };
}

/** MUYU-365 GAP G-2: why a stale preset is not usable — Core's own reason on the protocol, else on the level; none if usable or undeclared. */
export function staleReason(view: SelectionView, params: Record<string, string> | undefined): string | undefined {
  const protocol = params?.callProtocol;
  if (!protocol || view.state !== "visible") return undefined;
  const p = view.protocols.find((entry) => entry.name === protocol);
  if (!p) return undefined;
  if (!p.selectable) return p.reason;
  return p.levels.find((entry) => entry.level === params.thinkingLevel && !entry.selectable)?.reason;
}

export type SelectionErrorAction =
  | { action: "default" } | { action: "refetch-retry" } | { action: "reset"; message: string }
  | { action: "show"; message: string; supported: string[]; refetch: boolean };

/** 409 stale revision: re-read and retry once; 422 capability errors: Core's detail + supported values; else today's path. */
export function classifySelectionError(error: unknown, attempt: number): SelectionErrorAction {
  const e = error as { status?: number; body?: unknown; problem?: unknown; message?: string } | null;
  const body = (obj(e?.body) ? e!.body : obj(e?.problem) ? e!.problem : {}) as Obj;
  const code = body.reason_code;
  if (typeof code !== "string" || !code) return { action: "default" };
  if (e?.status === 409 && code === "stale_capability_revision") return attempt < 1 ? { action: "refetch-retry" } : { action: "reset", message: "chatReact.selectionStale" };
  if (e?.status !== 422) return { action: "default" };
  if (code === "ambiguous_thinking_parameters") return console.warn(code), { action: "show", message: "common.operationFailed", supported: [], refetch: false };
  const supported = Array.isArray(body.supported_values) ? body.supported_values.filter((v): v is string => typeof v === "string") : [];
  return { action: "show", message: typeof body.detail === "string" && body.detail ? body.detail : e.message ?? "", supported, refetch: true };
}

/** Values exactly as Core named them, joined; "" when there are none. */
export const supportedHint = (values: readonly string[], t: Translate) =>
  values.length ? fill(t("chatReact.selectionSupported"), { values: values.join("、") }) : "";

export interface EffectiveSelection { source?: string; effective_protocol?: string | null; effective_level?: string | null }
/** 「responses · 高」: what this turn was dispatched with. null (legacy) shows nothing — it is neither off nor verified. */
export function effectiveSelectionLabel(data: EffectiveSelection | null | undefined, t: Translate) {
  if (!data?.effective_protocol) return "";
  const level = data.effective_level && (LEVELS as readonly string[]).includes(data.effective_level) ? t(`chatReact.effort${cap(data.effective_level)}`) : "";
  return level ? `${data.effective_protocol} · ${level}` : data.effective_protocol;
}

/** Read-only, owned-conversation GET; `data` verbatim (null for a legacy step). */
export async function readEffectiveSelection(http: { get(url: string): Promise<{ data: { data?: EffectiveSelection | null } }> }, conversationId: string, stepId: string) {
  const response = await http.get(`/api/v1/addons/conversation/${encodeURIComponent(conversationId)}/steps/${encodeURIComponent(stepId)}/effective-selection`);
  return response.data?.data ?? null;
}

export type Fields = Legacy | { modelSelection: ModelSelection };
/**
 * Sends one turn. 409 stale revision: re-read the declaration and resend once if the same choice is still selectable,
 * otherwise reset to default. 422: Core's reason (+ supported values). The rethrown error has status 0, so the
 * single-slot queue never parks it; the caller's existing failure path shows its message and keeps the draft.
 */
export async function sendWithSelection<R>(send: (fields: Fields) => Promise<R>, fields: Fields, ctl: { refetch(): Promise<Fields>; reset(): void; t: Translate }): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try { return await send(fields); } catch (error) {
      let verdict = classifySelectionError(error, attempt);
      if (verdict.action === "default") throw error;
      if (verdict.action === "refetch-retry") {
        const next = await ctl.refetch().catch(() => "" as Fields);
        if (typeof next === "object" && "modelSelection" in next) { fields = next; continue; }
        verdict = { action: "reset", message: "chatReact.selectionStale" };
      }
      if (verdict.action === "reset") ctl.reset();
      else if (verdict.refetch) void ctl.refetch().catch(() => {});
      const text = [ctl.t(verdict.message), verdict.action === "show" ? supportedHint(verdict.supported, ctl.t) : ""].filter(Boolean).join(" ");
      throw new ApiError(text, "model_selection", 0);
    }
  }
}

type Row = { providerId: number; model: string; modelCapability?: unknown };
/** The exact model's declaration for the actual backend (same route as the catalog, plus executionBackend). */
export function useModelCapability(backend: string | null, providerId: number | undefined, model: string | undefined) {
  const key = backend && providerId && model ? `${backend}:${providerId}:${model}` : "";
  const [state, setState] = useState<{ key: string; capability?: unknown }>();
  const latest = useRef(key);
  latest.current = key;
  const read = async () => {
    if (!key) return undefined;
    const response = await getPlatformRuntime().http.get<{ data?: Row[] }>("/api/v1/addons/provider/models", { params: { type: "chat", executionBackend: backend } });
    const rows = Array.isArray(response.data?.data) ? response.data.data : [];
    const capability = rows.find((row) => String(row.providerId) === String(providerId) && row.model === model)?.modelCapability;
    if (latest.current === key) setState({ key, capability });
    return capability;
  };
  // A failed read leaves the controls hidden (the legacy turn is sent).
  useEffect(() => { void read().catch(() => {}); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = capabilityView(state?.key === key ? state.capability : undefined, backend, model ? { model } : undefined);
  return { view, key, loaded: state?.key === key, refetch: async () => capabilityView(await read(), backend, model ? { model } : undefined) };
}
