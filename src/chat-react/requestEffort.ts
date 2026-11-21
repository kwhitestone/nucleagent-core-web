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
export type EffortNote = "backend" | "unverified" | "ineffective" | "effective" | "server";

/** What the selector may offer: non-codex → disabled; levels outside the evidence → off; note = honest effect label. */
export function effortView(backend: string | null, evidence: EffortEvidence | undefined) {
  if (backend !== "codex") return { disabled: true, off: [...EFFORT_LEVELS] as EffortLevel[], note: "backend" as EffortNote };
  if (!evidence) return { disabled: true, off: [...EFFORT_LEVELS] as EffortLevel[], note: "unverified" as EffortNote };
  return { disabled: evidence.levels.length === 0, off: EFFORT_LEVELS.filter((level) => !evidence.levels.includes(level)), note: (evidence.source === "core" ? "server" : evidence.effective ? "effective" : "ineffective") as EffortNote };
}

/** MUYU-365 exp3: Core /model-profiles `efforts` (levels the upstream accepted) as evidence; effect itself unmeasured. */
export function serverEvidence(profiles: { efforts?: string[] }[] | undefined): EffortEvidence | undefined {
  const listed = profiles?.find((profile) => profile.efforts?.length)?.efforts;
  const levels = EFFORT_LEVELS.filter((level) => listed?.includes(level));
  return levels.length ? { levels, effective: false, source: "core" } : undefined;
}

/** Never send a level the view disables. */
export const sentEffort = (choice: EffortChoice, view: ReturnType<typeof effortView>): EffortChoice =>
  !view.disabled && choice && !view.off.includes(choice) ? choice : "";

/** Adds reasoningEffort only for a chosen level on codex (Core rejects it elsewhere). */
export function withRequestEffort<T extends object>(payload: T, level: EffortChoice, backend: string | null | undefined): T {
  return level && backend === "codex" ? { ...payload, reasoningEffort: level } : payload;
}
