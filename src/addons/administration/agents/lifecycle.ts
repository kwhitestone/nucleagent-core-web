/** AG1: which lifecycle actions an agent definition row offers, and the impact rows. */
import type { AgentImpact } from "../api/agent";

type Row = { isActive: boolean; deletedAt?: string | null };

/** Delete only a disabled definition (the server answers 409 otherwise). */
export const canDelete = (agent: Row): boolean => !agent.isActive && !agent.deletedAt;
export const canRestore = (agent: Row): boolean => !!agent.deletedAt;

/** The admin confirms a delete by typing the definition's slug. */
export const confirmMatches = (slug: string, typed: string): boolean => typed.trim() === slug && slug !== "";

export const IMPACT_KEYS = ["instances", "conversations", "conversations_7d", "skill_bindings", "im_groups", "deliverables"] as const;

/** Every count in a fixed order; null = not countable here (shown as such, never as 0). */
export function impactRows(impact: AgentImpact): Array<{ key: (typeof IMPACT_KEYS)[number]; value: number | null }> {
  return IMPACT_KEYS.map((key) => ({ key, value: impact.unavailable?.includes(key) ? null : (impact[key] ?? null) }));
}
