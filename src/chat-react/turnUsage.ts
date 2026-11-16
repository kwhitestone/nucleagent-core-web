export interface TurnScope { conversationId: string; turnId: string }
export interface SettlementEvidence extends TurnScope {
  state: "unknown" | "pending" | "settled";
  points?: unknown;
  upstreams: readonly string[];
  revision: number;
}
export interface TurnUsageView { state: "unknown" | "pending" | "settled"; points: string; upstreams: readonly string[] }

export function turnUsage(scope: TurnScope, evidence: readonly SettlementEvidence[] = []): TurnUsageView {
  const unknown: TurnUsageView = { state: "unknown", points: "—", upstreams: [] };
  if (!scope.conversationId || !scope.turnId) return unknown;
  const matching = evidence.filter((entry) => entry.conversationId === scope.conversationId && entry.turnId === scope.turnId);
  if (matching.some((entry) => !Number.isSafeInteger(entry.revision) || entry.revision < 0)) return unknown;
  const latest = matching.reduce<SettlementEvidence | undefined>((previous, entry) => !previous || entry.revision > previous.revision ? entry : previous, undefined);
  if (!latest || matching.filter((entry) => entry.revision === latest.revision).length !== 1) return unknown;
  // Pending is a known state (a receipt is still expected), but it never carries an amount.
  if (latest.state === "pending") return { ...unknown, state: "pending" };
  if (latest.state !== "settled"
    || typeof latest.points !== "string" || !/^(0|[1-9]\d*)(\.\d+)?$/.test(latest.points)
    || !latest.upstreams.length || latest.upstreams.some((name) => typeof name !== "string" || !name.trim())) return unknown;
  return { state: "settled", points: latest.points, upstreams: [...new Set(latest.upstreams)] };
}
