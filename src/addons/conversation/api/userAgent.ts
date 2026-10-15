/**
 * User-created private agents (USERAGENT U2). Contract = core main
 * app/src/server/addons/agent/router/definitions.go:
 *   POST   /mine/definitions        body ⊆ {name,description,prompt,avatar,model} → 201 {data: definition}
 *   PATCH  /mine/definitions/{id}   same keys + isActive (bool)                   → {data: definition}
 *   DELETE /mine/definitions/{id}                                                  → {data: definition}
 * Limits (runes, trimmed): name 32, description 80, prompt 4000, model 100 (definitions.go:37).
 * Skills are not in the server whitelist, so the wizard has none.
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
export const USER_AGENT_LIMIT = 5;
export const LIMITS = { name: 32, description: 80, prompt: 4000 } as const;

export interface UserDefinition {
  id: number;
  name: string;
  isActive: boolean;
  config?: { description?: string; avatar?: string; model?: string; [key: string]: unknown };
}
export interface Draft { name: string; description: string; model: string; prompt: string }
type Field = keyof Draft;

const status = (e: unknown) => (e as { status?: unknown } | null)?.status;
// Older core: no route (404/405), or GET falls through to /mine/{templateId} and fails to parse the id (422).
const unsupported = (e: unknown) => [404, 405, 422].includes(status(e) as number);

/** null = this core cannot list my definitions → hide the create entry (no error shown). */
export async function listMyDefinitions(): Promise<UserDefinition[] | null> {
  try {
    const r = await http().get<{ data?: UserDefinition[] }>(DEFS);
    return r.data?.data ?? [];
  } catch (e) {
    if (unsupported(e)) return null;
    throw e;
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

/** Trimmed; empty optional fields are left out. */
export function draftBody(d: Draft): Record<string, string> {
  const body: Record<string, string> = { name: d.name.trim() };
  for (const k of ["description", "model", "prompt"] as const) if (d[k].trim()) body[k] = d[k].trim();
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
export function validateDraft(d: Draft, creating: boolean): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  if (!d.name.trim()) out.name = "agents.mine.errNameRequired";
  for (const k of ["name", "description", "prompt"] as const) if (runes(d[k]) > LIMITS[k]) out[k] = "agents.mine.errTooLong";
  if (creating && !d.model) out.model = "agents.mine.errModelRequired";
  return out;
}

/** Changed fields only. The server never returns the prompt, so a blank prompt in edit means "keep". */
export function draftPatch(base: Draft, next: Draft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["name", "description", "model", "prompt"] as const) {
    const v = next[k].trim();
    if (v !== base[k].trim() && (v || (k !== "prompt" && k !== "model"))) out[k] = v;
  }
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
    templateId: d.id, name: d.name, slug: "", description: d.config?.description ?? "", config: d.config,
    disabled: !d.isActive, instanceId: null, sessionCount: 0, lastSessionAt: null,
  }))];
}
