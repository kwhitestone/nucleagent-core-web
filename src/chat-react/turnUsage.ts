export interface TurnScope { conversationId: string; turnId: string }
export interface SettlementEvidence extends TurnScope {
  state: "unknown" | "pending" | "settled";
  points?: unknown;
  /** exp106: Core's turn.points (per call rounded up, summed) and the top-level display rate; all optional (old Core). */
  shells?: unknown; pointsName?: unknown; creditsPerCny?: unknown; rate?: unknown;
  upstreams: readonly string[];
  revision: number;
}
/**
 * Every settlement row of one conversation the signed-in user owns. Production passes Core's projection
 * (addons/conversation/api/settlement.ts); without a reader every turn stays UNKNOWN.
 * Pass a stable function; a new identity re-reads.
 */
export type SettlementReader = (conversationId: string, signal: AbortSignal) => Promise<readonly SettlementEvidence[]>;

/** Trust boundary for a reader's result: a malformed row could be the newest revision, so it voids the whole read. */
export function settlementRows(raw: unknown): readonly SettlementEvidence[] {
  return Array.isArray(raw) && raw.every((row) => row && typeof row.conversationId === "string" && typeof row.turnId === "string"
    && Array.isArray(row.upstreams) && typeof row.revision === "number") ? raw : [];
}

export interface TurnUsageView { state: "unknown" | "pending" | "settled"; points: string; shells?: string; name?: Record<string, unknown>; cny?: string }

/** What every turn shows without authoritative evidence: no amount, never 0. */
export const UNKNOWN_USAGE: TurnUsageView = { state: "unknown", points: "—" };

export function turnUsage(scope: TurnScope, evidence: readonly SettlementEvidence[] = []): TurnUsageView {
  const unknown = UNKNOWN_USAGE;
  if (!scope.conversationId || !scope.turnId) return unknown;
  const matching = evidence.filter((entry) => entry.conversationId === scope.conversationId && entry.turnId === scope.turnId);
  if (matching.some((entry) => !Number.isSafeInteger(entry.revision) || entry.revision < 0)) return unknown;
  const latest = matching.reduce<SettlementEvidence | undefined>((previous, entry) => !previous || entry.revision > previous.revision ? entry : previous, undefined);
  if (!latest || matching.filter((entry) => entry.revision === latest.revision).length !== 1) return unknown;
  // Pending is a known state (a receipt is still expected), but it never carries an amount.
  if (latest.state === "pending") return { ...unknown, state: "pending" };
  // MUYU-365 exp101: the authority is Core's settled state with an amount; upstreams are display-only and not shown.
  if (latest.state !== "settled" || typeof latest.points !== "string" || !/^(0|[1-9]\d*)(\.\d+)?$/.test(latest.points)) return unknown;
  const { shells, pointsName: name, creditsPerCny: per, rate } = latest as SettlementEvidence & { rate?: Record<string, unknown> };
  // exp106: "N 贝壳（≈¥X.XXXX）" only with the whole contract (N = Core's points, never re-derived; ¥ = credits / creditsPerCny);
  // anything missing or off keeps the old "N 积分" and no ¥. The Web holds no rate of its own.
  const whole = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0;
  return typeof shells === "string" && /^\d+$/.test(latest.points) && name && typeof name === "object" && whole(per) && whole(rate?.creditsAmount) && whole(rate?.coinAmount)
    ? { state: "settled", points: latest.points, shells, name: name as Record<string, unknown>, cny: (+latest.points / (per as number)).toFixed(4) }
    : { state: "settled", points: latest.points };
}
