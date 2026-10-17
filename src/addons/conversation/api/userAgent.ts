/**
 * User-created private agents (USERAGENT U2). Contract = core main
 * app/src/server/addons/agent/router/definitions.go:
 *   POST   /mine/definitions        body ⊆ {name,description,prompt,avatar,model,executionBackend,memory,<kind>Model} → 201 {data: definition}
 *   PATCH  /mine/definitions/{id}   same keys + isActive (bool)                   → {data: definition}
 *   DELETE /mine/definitions/{id}                                                  → {data: definition}
 * Limits (runes, trimmed): name 32, description 80, prompt 4000, model 100 (definitions.go:37).
 * UA-EDIT-FIELDS-1230: executionBackend from GET /mine/backends, <kind>Model from GET /mine/gen-models
 * (names only), memory bool. "" = platform default. Slug stays server-generated (read-only).
 * Skills/tools (L8) are not in the server whitelist yet: add them to Draft + GEN/TEXT keys below.
 *
 * BLOCKER (core main has neither; the UI fails closed until they ship):
 *   GET /mine/definitions → [{id,name,isActive,config{description,avatar,model}}] (my live private definitions)
 *   GET /mine/models      → [{model}] (read-only view of AppSetting user_agent_models)
 */
import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { MyAgent } from "./agent";

const http = () => getPlatformRuntime().http;
const DEFS = "/api/v1/addons/agent/mine/definitions";
const MODELS = "/api/v1/addons/agent/mine/models";
const BACKENDS = "/api/v1/addons/agent/mine/backends";
const GEN_MODELS = "/api/v1/addons/agent/mine/gen-models";
export const USER_AGENT_LIMIT = 5;
export const LIMITS = { name: 32, description: 80, prompt: 4000 } as const;

export interface UserDefinition {
  id: number;
  name: string;
  /** Server-generated (u-<uuid>); read-only for the owner. */
  slug?: string;
  isActive: boolean;
  config?: { description?: string; avatar?: string; model?: string; [key: string]: unknown };
}
export interface Draft {
  name: string; description: string; model: string; prompt: string;
  executionBackend: string; memory: boolean;
  /** <kind>Model per enabled kind; "" = platform default. */
  gen: Record<string, string>;
}
type Field = "name" | "description" | "model" | "prompt" | "executionBackend" | "gen" | "memory";
export interface UserAgentBackend { id: string; displayName: string }

/** Defaults for the fields older call sites do not pass. */
export const emptyDraft = (d: Partial<Draft> = {}): Draft =>
  ({ name: "", description: "", model: "", prompt: "", executionBackend: "", memory: true, ...d, gen: { ...d.gen } });

/** Owner fields from GET /mine/definitions config (core ownerDefinition). */
export function draftFromConfig(config: UserDefinition["config"] | undefined, kinds: readonly string[]): Pick<Draft, "executionBackend" | "memory" | "gen"> {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    executionBackend: str(config?.executionBackend),
    memory: config?.memory !== false,
    gen: Object.fromEntries(kinds.map((k) => [k, str(config?.[`${k}Model`])])),
  };
}

const status = (e: unknown) => (e as { status?: unknown } | null)?.status;
// Older core: no route (404/405), or GET falls through to /mine/{templateId} and fails to parse the id (422).
const unsupported = (e: unknown) => [404, 405, 422].includes(status(e) as number);

/** null = this core cannot list my definitions → hide the create entry (no error shown). */
export async function listMyDefinitions(): Promise<UserDefinition[] | null> {
  try {
    const r = await http().get<{ data?: UserDefinition[] }>(DEFS);
    return r.data?.data ?? [];
  } catch (e) {
    if (!unsupported(e)) throw e;
    // 422 = kill switch NUCLEAGENT_USER_AGENTS_ENABLE off (or older core). Status only, never server text.
    console.info("[user-agent-entry-hidden] status", status(e));
    return null;
  }
}

/** Models opened to ordinary users; [] when none are open or this core has no such route. */
export async function listUserAgentModels(): Promise<string[]> {
  try {
    const r = await http().get<{ data?: { model?: unknown }[] }>(MODELS);
    return (r.data?.data ?? []).map((m) => m.model).filter((m): m is string => typeof m === "string" && !!m);
  } catch (e) {
    if (unsupported(e)) return [];
    throw e;
  }
}

/** Backends users may pick (server list); [] when none or this core has no such route. */
export async function listUserAgentBackends(): Promise<UserAgentBackend[]> {
  try {
    const r = await http().get<{ data?: { id?: unknown; displayName?: unknown }[] }>(BACKENDS);
    return (r.data?.data ?? []).filter((b) => typeof b.id === "string" && !!b.id)
      .map((b) => ({ id: b.id as string, displayName: typeof b.displayName === "string" && b.displayName ? b.displayName : (b.id as string) }));
  } catch (e) {
    if (unsupported(e)) return [];
    throw e;
  }
}

/** Generation models per enabled kind, names only; {} when this core has no such route. */
export async function listUserAgentGenModels(): Promise<Record<string, string[]>> {
  try {
    const r = await http().get<{ data?: Record<string, unknown> }>(GEN_MODELS);
    const out: Record<string, string[]> = {};
    for (const [kind, names] of Object.entries(r.data?.data ?? {})) {
      if (Array.isArray(names)) out[kind] = names.filter((n): n is string => typeof n === "string" && !!n);
    }
    return out;
  } catch (e) {
    if (unsupported(e)) return {};
    throw e;
  }
}

/** Trimmed; empty optional fields are left out (create = platform default). */
export function draftBody(draft: Draft): Record<string, string | boolean> {
  const d = emptyDraft(draft);
  const body: Record<string, string | boolean> = { name: d.name.trim() };
  for (const k of ["description", "model", "prompt", "executionBackend"] as const) if (d[k].trim()) body[k] = d[k].trim();
  for (const [kind, name] of Object.entries(d.gen)) if (name.trim()) body[`${kind}Model`] = name.trim();
  if (!d.memory) body.memory = false;
  return body;
}

export async function createUserAgent(d: Draft): Promise<UserDefinition> {
  const r = await http().post<{ data: UserDefinition }>(DEFS, draftBody(d));
  return r.data.data;
}
export async function updateUserAgent(id: number, patch: Record<string, unknown>): Promise<void> {
  await http().patch(`${DEFS}/${id}`, patch);
}
export const setUserAgentActive = (id: number, active: boolean) => updateUserAgent(id, { isActive: active });
export async function deleteUserAgent(id: number): Promise<void> {
  await http().delete(`${DEFS}/${id}`);
}

const runes = (s: string) => [...s.trim()].length;

/** Same rules as the server; values are i18n keys. creating: "create and enable" needs a model. */
export function validateDraft(d: Pick<Draft, "name" | "description" | "model" | "prompt">, creating: boolean): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  if (!d.name.trim()) out.name = "agents.mine.errNameRequired";
  for (const k of ["name", "description", "prompt"] as const) if (runes(d[k]) > LIMITS[k]) out[k] = "agents.mine.errTooLong";
  if (creating && !d.model) out.model = "agents.mine.errModelRequired";
  return out;
}

/**
 * Changed fields only. The server never returns the prompt, so a blank prompt in edit means "keep";
 * a blank model keeps it too. Backend and <kind>Model: "" is sent as "" (= back to the platform default).
 */
export function draftPatch(base: Draft, next: Draft): Record<string, string | boolean> {
  const b = emptyDraft(base), n = emptyDraft(next);
  const out: Record<string, string | boolean> = {};
  for (const k of ["name", "description", "model", "prompt", "executionBackend"] as const) {
    const v = n[k].trim();
    if (v !== b[k].trim() && (v || (k !== "prompt" && k !== "model"))) out[k] = v;
  }
  for (const kind of new Set([...Object.keys(b.gen), ...Object.keys(n.gen)])) {
    const v = (n.gen[kind] ?? "").trim();
    if (v !== (b.gen[kind] ?? "").trim()) out[`${kind}Model`] = v;
  }
  if (n.memory !== b.memory) out.memory = n.memory;
  return out;
}

export type UserAgentError = { key: string; field?: Field } | { text: string };

/** Machine codes → i18n keys; anything else echoes the server text (rendered as text, never HTML). */
export function userAgentError(e: unknown): UserAgentError {
  const code = status(e);
  const msg = e instanceof Error ? e.message : String(e);
  if (code === 404) return { key: "agents.mine.errNotFound" };
  if (code === 409 && msg === "user_agent_quota_exceeded") return { key: "agents.mine.errQuota" };
  if (code === 429 && msg === "user_agent_daily_limit") return { key: "agents.mine.errDaily" };
  if (code === 409 && msg === "agent_name_taken") return { field: "name", key: "agents.mine.errNameTaken" };
  if (code === 422) {
    if (msg === "name is required") return { field: "name", key: "agents.mine.errNameRequired" };
    if (msg === "model_not_open_to_users") return { field: "model", key: "agents.mine.errModelClosed" };
    if (msg === "an active agent requires a model") return { field: "model", key: "agents.mine.errModelRequired" };
    if (msg === "execution_backend_not_open_to_users") return { field: "executionBackend", key: "agents.mine.errBackendClosed" };
    if (msg === "execution_backend_incompatible") return { field: "executionBackend", key: "agents.mine.errBackendIncompatible" };
    if (msg === "model_type_mismatch") return { field: "gen", key: "agents.mine.errGenType" };
    if (msg === "model_not_supported") return { field: "gen", key: "agents.mine.errGenClosed" };
    const field = /^invalid (name|description|prompt|model)$/.exec(msg)?.[1] as Field | undefined;
    if (field) return { field, key: "agents.mine.errTooLong" };
  }
  return { text: msg };
}

export function entryState(defs: readonly unknown[] | null, models: readonly string[]): "hidden" | "full" | "noModels" | "ok" {
  if (!defs) return "hidden";
  if (defs.length >= USER_AGENT_LIMIT) return "full";
  return models.length ? "ok" : "noModels";
}

/** Drops calls made while one is in flight (double-click on submit). */
export function singleFlight<A extends unknown[]>(fn: (...a: A) => Promise<void>) {
  let running = false;
  return async (...a: A): Promise<void> => {
    if (running) return;
    running = true;
    try { await fn(...a); } finally { running = false; }
  };
}

/** /mine skips disabled definitions I never used; my own still belong on the page. */
export function mergeOwned(mine: MyAgent[], defs: UserDefinition[] | null): MyAgent[] {
  if (!defs) return mine;
  const listed = new Set(mine.map((a) => a.templateId));
  return [...mine, ...defs.filter((d) => !listed.has(d.id)).map((d): MyAgent => ({
    templateId: d.id, name: d.name, slug: d.slug ?? "", description: d.config?.description ?? "", config: d.config,
    disabled: !d.isActive, instanceId: null, sessionCount: 0, lastSessionAt: null,
  }))];
}
