import type { ExecutionTiming } from "../addons/conversation/task-conversation/vue/executionTiming.ts";

/** First-token readout for one run; every field absent = shown as "—", never 0. */
export interface TtftReadout {
  progressMs?: number;
  preparationMs?: number;
  firstMs?: number;
  /** server: executor first_body_write + Core queue; client: Core message timestamps (approximate). */
  firstSource?: "server" | "client";
  queueMs?: number;
  uploadMs?: number;
  agentMs?: number;
  upstreamMs?: number;
}

/** server_timing offsets are ms since executor receipt; -1 / non-numbers = not reached. */
const ms = (v: unknown) => (typeof v === "number" && v >= 0 ? v : undefined);
const span = (from: unknown, to: unknown) => (ms(from) !== undefined && ms(to) !== undefined ? Math.max(0, ms(to)! - ms(from)!) : undefined);

/** metadata.server_timing (v2–v4) + Core timing → readout. Clocks are only added, never subtracted across. */
export function ttftReadout(serverTiming: unknown, timing: ExecutionTiming | undefined, hasAttachments: boolean): TtftReadout | undefined {
  if (!timing) return undefined;
  const st = (serverTiming ?? {}) as Record<string, unknown>;
  const version = typeof st.version === "number" && st.version >= 2 ? st.version : 0;
  const write = version && st.first_body_write_outcome === "written" ? ms(st.first_body_write_ms) : undefined;
  const out: TtftReadout = { queueMs: timing.queueMs, agentMs: timing.agentInitializationMs ?? (version ? ms(st.agent_ready_ms) : undefined) };
  if (timing.firstProgressMs !== undefined) Object.assign(out, { progressMs: timing.firstProgressMs, preparationMs: timing.skillPreparationMs });
  if (write !== undefined) Object.assign(out, { firstMs: write + (timing.queueMs ?? 0) + (timing.skillPreparationMs ?? 0), firstSource: "server" });
  // Final-only history has no first streaming timestamp; a still-waiting run has no first token yet.
  else if (!version && timing.active && !timing.awaitingResponse && timing.waitingMs !== undefined) Object.assign(out, { firstMs: timing.waitingMs, firstSource: "client" });
  // v2 attachments_prepared includes skill downloads, so upload is only shown from v3 (skills_projected split out).
  if (version >= 3 && hasAttachments) out.uploadMs = span(st.skills_projected_ms, st.attachments_prepared_ms);
  if (version >= 4) out.upstreamMs = span(st.upstream_forwarded_ms, st.upstream_first_body_ms);
  return out;
}

type Translate = (key: string) => string;

/** Head text ("首字 2.5 秒", empty when unknown) and the expanded detail line. */
export function formatReadout(r: TtftReadout, t: Translate) {
  const s = (key: string) => t(`chatReact.${key}`);
  const sec = (v?: number) => (v === undefined ? "—" : `${(v / 1000).toFixed(1)}${s("sec")}`);
  const first = r.firstMs === undefined ? "—" : `${r.firstSource === "client" ? s("approx") : ""}${sec(r.firstMs)}`;
  const detail = [
    ...(r.progressMs !== undefined ? [`${s("progress")} ${sec(r.progressMs)}`] : []),
    `${s("queue")} ${sec(r.queueMs)}`,
    ...(r.preparationMs !== undefined ? [`${s("skillPreparation")} ${sec(r.preparationMs)}`] : []),
    ...(r.uploadMs !== undefined ? [`${s("upload")} ${sec(r.uploadMs)}`] : []),
    `${s("agentReady")} ${sec(r.agentMs)}`,
    `${s("firstToken")} ${first}${r.firstSource === "server" ? `（${s("serverMeasured")}）` : ""}`,
    ...(r.upstreamMs !== undefined ? [`${s("upstreamFirst")} ${sec(r.upstreamMs)}`] : []),
  ].join(" · ");
  return { head: r.firstMs === undefined ? "" : `${s("firstToken")} ${first}`, detail };
}
