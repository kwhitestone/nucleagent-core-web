import type { MyAgent } from "../api/agent";

type Agent = Pick<MyAgent, "templateId" | "name" | "description" | "disabled" | "lastSessionAt" | "config">;

// Six existing aurora.css gradients; cover and fallback avatar share one per agent.
const GRADIENTS = ["teal-indigo", "violet-fuchsia", "amber-rose", "cyan-teal", "emerald-cyan", "sunset"];
export const avatarGradient = (id: number) => `var(--grad-${GRADIENTS[Math.abs(id) % GRADIENTS.length]})`;

/** Public read-only model name from /mine; older Core omits it. */
export const agentModel = (a: Agent) => (typeof a.config?.model === "string" ? a.config.model : "");

/** "unconfigured" only when Core sends model at all (hasModelField); otherwise a disabled agent is just "disabled". */
export function agentStatus(a: Agent, hasModelField: boolean): "active" | "disabled" | "unconfigured" {
  if (!a.disabled) return "active";
  return hasModelField && !agentModel(a) ? "unconfigured" : "disabled";
}

export function matchesQuery(a: Agent, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return !q || `${a.name}\n${a.description ?? ""}`.toLocaleLowerCase().includes(q);
}

/** Most recently used first, never-used after them by id; same order as the shell sidebar. */
export function groupAgents<T extends Agent>(list: readonly T[], query: string): { active: T[]; inactive: T[] } {
  const sorted = list.filter((a) => matchesQuery(a, query)).sort((a, b) =>
    (b.lastSessionAt ?? "").localeCompare(a.lastSessionAt ?? "") || a.templateId - b.templateId);
  return { active: sorted.filter((a) => !a.disabled), inactive: sorted.filter((a) => a.disabled) };
}
