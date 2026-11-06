/**
 * MUYU-181: pure rules for the "my tool calls" log (unit tested).
 * Input is the caller's own conversation messages (GET /conversation/:id/messages);
 * nothing here widens what the user could already read in the conversation itself.
 */
import type { Message } from "../../../conversation/api/types";

export interface ToolCallRow {
  conversationId: number;
  conversationTitle: string;
  messageId: number;
  tool: string;
  status: "completed" | "failed" | "running" | "unknown";
  at: string;
  durationMs?: number;
  callId?: string;
  stepId?: string;
  summary: string;
  error: string;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/([?&](?:token|access_token|key|api_key|apikey|secret|signature|sig|auth|code)=)[^&#\s"'\\]+/gi, "$1***"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 ***"],
  [/("(?:token|access_token|refresh_token|api_key|apiKey|secret|password|authorization|data)"\s*:\s*")[^"]*(")/gi, "$1***$2"],
  [/\b(?:sk|pk|ak)-[A-Za-z0-9]{12,}\b/g, "***"],
  [/\b[0-9a-f]{40,}\b/gi, "***"],
];

/** Removes credential-shaped substrings; display text only, never sent anywhere. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

const SUMMARY_LIMIT = 200;

function compact(text: string): string {
  const flat = redact(text).replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_LIMIT ? `${flat.slice(0, SUMMARY_LIMIT)}…` : flat;
}

/** "Mcp error: -32602: mcp upstream unavailable(...)" and similar → the reason line. */
export function errorReason(text: string): string {
  // Most specific cause first: the wrapper line "tool call error: ..." says nothing about why.
  for (const pattern of [/Mcp error[^\n"\\]*/i, /unexpected status[^\n"\\]*/i, /tool call (?:error|failed)[^\n"\\]*/i]) {
    const match = text.match(pattern);
    if (match) return compact(match[0]);
  }
  return "";
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function statusOf(v: unknown): ToolCallRow["status"] {
  return v === "completed" || v === "failed" || v === "running" ? v : "unknown";
}

/**
 * One row per tool_call message carrying a tool_call_id. The result shown is the
 * next result/error message of the same execution step (the agent's answer to that call).
 */
export function extractToolCalls(conversationId: number, conversationTitle: string, messages: readonly Message[]): ToolCallRow[] {
  const rows: ToolCallRow[] = [];
  messages.forEach((msg, index) => {
    if (msg.msgType !== "tool_call") return;
    const md = (msg.metadata ?? {}) as Record<string, unknown>;
    const callId = str(md.tool_call_id);
    if (!callId) return;
    const stepId = str(md.step_id);
    const status = statusOf(md.tool_status);
    const next = messages.slice(index + 1).find((m) =>
      (m.msgType === "result" || m.msgType === "error") &&
      (!stepId || str((m.metadata as Record<string, unknown> | undefined)?.step_id) === stepId));
    const text = next?.content ?? "";
    const reason = errorReason(text) || (next?.msgType === "error" ? compact(text) : "");
    rows.push({
      conversationId,
      conversationTitle,
      messageId: msg.id,
      tool: str(md.tool) ?? msg.senderName ?? "",
      status,
      at: msg.createdAt,
      durationMs: typeof md.duration_ms === "number" && Number.isFinite(md.duration_ms) ? md.duration_ms : undefined,
      callId,
      stepId,
      summary: status === "failed" ? "" : compact(text),
      error: status === "failed" ? reason || "—" : reason,
    });
  });
  return rows;
}

/** Distinct tools with at least one completed real call in the loaded records. */
export function toolsCalled(rows: readonly ToolCallRow[]): { tool: string; completed: number; failed: number }[] {
  const by = new Map<string, { tool: string; completed: number; failed: number }>();
  for (const row of rows) {
    const entry = by.get(row.tool) ?? { tool: row.tool, completed: 0, failed: 0 };
    if (row.status === "completed") entry.completed++;
    if (row.status === "failed") entry.failed++;
    by.set(row.tool, entry);
  }
  return [...by.values()].sort((a, b) => a.tool.localeCompare(b.tool));
}

/** Minimal tool row shape needed to classify (admin GET /tool/page). */
export interface TypedTool {
  id: number;
  name: string;
  slug: string;
  config?: { type?: unknown; description?: unknown; mcp_config?: { input_schema?: { properties?: Record<string, unknown> } } } & Record<string, unknown>;
}

export const TOOL_TYPES = ["dj", "identity", "train", "aihub", "workflow", "api", "mcp"] as const;
export type ToolType = (typeof TOOL_TYPES)[number];

/**
 * Groups by call chain (protocol / auth / data contract), not by name.
 * shortcut: rules mirror the MUYU-181 PROD catalog shapes; upgrade to a server-side type field when Core exposes one.
 */
export function toolType(tool: TypedTool): ToolType {
  const cfg = tool.config ?? {};
  if (cfg.type === "aihub") return "aihub";
  const props = cfg.mcp_config?.input_schema?.properties ?? {};
  const desc = typeof cfg.description === "string" ? cfg.description : "";
  if ("username" in props && "data" in props && "question" in props) return "dj";
  if (desc.includes("12306")) return "train";
  if (desc.includes("当前用户")) return "identity";
  if ("app_id" in props && "base_url" in props) return "workflow";
  if ("base_url" in props || "api_base_url" in props) return "api";
  return "mcp";
}

/** Call rows name the tool "<server>.<slug>"; match on the slug suffix. */
export function slugOf(callTool: string): string {
  const dot = callTool.lastIndexOf(".");
  return dot >= 0 ? callTool.slice(dot + 1) : callTool;
}

export interface TypeCoverage {
  type: ToolType;
  total: number;
  /** Tools of this type with at least one completed call in the loaded records. */
  calledOk: number;
  /** One completed call of the type exists → the type is represented; NOT every tool was called. */
  represented: boolean;
  representative?: ToolCallRow;
}

export function typeCoverage(tools: readonly TypedTool[], rows: readonly ToolCallRow[]): TypeCoverage[] {
  const typeBySlug = new Map(tools.map((t) => [t.slug, toolType(t)]));
  return TOOL_TYPES.map((type) => {
    const ofType = tools.filter((t) => typeBySlug.get(t.slug) === type);
    const ok = rows.filter((r) => r.status === "completed" && typeBySlug.get(slugOf(r.tool)) === type);
    const okSlugs = new Set(ok.map((r) => slugOf(r.tool)));
    return { type, total: ofType.length, calledOk: okSlugs.size, represented: ok.length > 0, representative: ok[0] };
  });
}
