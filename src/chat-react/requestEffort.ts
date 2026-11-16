import { configValue } from "../runtimeConfig.ts";

/**
 * MUYU-365 gap2: per-request reasoning effort. Core (v0.1.11+) accepts `reasoningEffort` low|medium|high
 * on create and follow-up for the codex backend only (400 otherwise); "" = omit = executor default.
 */
/** Island string keys join a prefix and a capitalised value: `effort` + "low" → chatReact.effortLow, `usage` + "pending". */
export const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
export const EFFORT_LEVELS = ["low", "medium", "high"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export type EffortChoice = EffortLevel | "";
/** Measured per-model evidence (chat-strategy.json `effort`): levels accepted and whether effort changed anything. */
export interface EffortEvidence { levels: EffortLevel[]; effective: boolean; source: string }
export type EffortNote = "backend" | "unverified" | "ineffective" | "effective";

const KEY = "nucleagent_chat_effort";
const valid = (v: unknown): v is EffortChoice => v === "" || (EFFORT_LEVELS as readonly unknown[]).includes(v);

/** Environment default (runtime-config CHAT_EFFORT_DEFAULT); anything else = backend default. */
export function defaultEffort(read: () => string = () => configValue("CHAT_EFFORT_DEFAULT")): EffortChoice {
  try { const v = read(); return valid(v) ? v : ""; } catch { return ""; }
}

type Store = Pick<Storage, "getItem" | "setItem">;
const readAll = (s: Store | undefined): Record<string, unknown> => {
  try { const v = JSON.parse(s?.getItem(KEY) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
};
/** The user's last choice for this model ("providerId:model"), or undefined. */
export function storedEffort(model: string, s: Store | undefined = globalThis.localStorage): EffortChoice | undefined {
  const v = readAll(s)[model];
  return valid(v) ? v : undefined;
}
export function storeEffort(model: string, level: EffortChoice, s: Store | undefined = globalThis.localStorage) {
  try { s?.setItem(KEY, JSON.stringify({ ...readAll(s), [model]: level })); } catch { /* storage blocked: this page only */ }
}

/** What the selector may offer: non-codex → disabled; levels outside the evidence → off; note = honest effect label. */
export function effortView(backend: string | null, evidence: EffortEvidence | undefined) {
  if (backend !== "codex") return { disabled: true, off: [...EFFORT_LEVELS] as EffortLevel[], note: "backend" as EffortNote };
  if (!evidence) return { disabled: true, off: [...EFFORT_LEVELS] as EffortLevel[], note: "unverified" as EffortNote };
  return { disabled: evidence.levels.length === 0, off: EFFORT_LEVELS.filter((level) => !evidence.levels.includes(level)), note: (evidence.effective ? "effective" : "ineffective") as EffortNote };
}

/** Never send a level the view disables. */
export const sentEffort = (choice: EffortChoice, view: ReturnType<typeof effortView>): EffortChoice =>
  !view.disabled && choice && !view.off.includes(choice) ? choice : "";

/** Adds reasoningEffort only for a chosen level on codex (Core rejects it elsewhere). */
export function withRequestEffort<T extends object>(payload: T, level: EffortChoice, backend: string | null | undefined): T {
  return level && backend === "codex" ? { ...payload, reasoningEffort: level } : payload;
}
