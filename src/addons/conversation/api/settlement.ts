/**
 * MUYU-406 per-turn settlement of one conversation the signed-in user owns:
 * `GET /api/v1/addons/conversation/{id}/settlement` (Core addons/conversation/router/settlement.go).
 * Core answers 404 for anyone else's conversation and 503 when the ledger cannot be read; both reject here.
 */
import { getPlatformRuntime } from "../../../contracts/platform-runtime.ts";
import type { SettlementReader } from "../../../chat-react/turnUsage.ts";

/**
 * Checks what only this contract knows: the unit, and that an amount (whole credits) exists exactly when a turn
 * is settled. Anything off, or a body of another shape (a TypeError), rejects the whole read. Ids, upstreams and
 * revisions are checked where every reader's rows are (settlementRows, turnUsage); source ids ride along unread.
 */
export const readSettlement: SettlementReader = async (conversationId, signal) => {
  const { data } = (await getPlatformRuntime().http.get<{ data: any }>(`/api/v1/addons/conversation/${encodeURIComponent(conversationId)}/settlement`, { signal })).data;
  return data.turns.map((turn: any) => {
    if (data.unit !== "credits" || (turn.state === "settled" ? !/^\d+$/.test(turn.credits) : turn.credits !== null)) throw new Error("settlement");
    return { ...turn, conversationId, turnId: turn.stepId, points: turn.credits };
  });
};
