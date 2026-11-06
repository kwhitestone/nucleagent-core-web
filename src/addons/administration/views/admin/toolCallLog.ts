/**
 * MUYU-181: pure rules for the "my tool calls" log (unit tested).
 * Rows come from Core's owner-scoped GET /conversation/tool-calls; this file only classifies them.
 */
import type { ToolCallItem } from "../../../conversation/api/conversation";

/** Rows are produced and redacted by Core (GET /conversation/tool-calls). */
export type ToolCallRow = ToolCallItem;

/** Task IDs are positive integers (the conversation id); anything else is rejected before any request. */
export function parseTaskId(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null; // repeated ?taskId=…&taskId=… is ambiguous
  const text = value.trim();
  if (!text) return "";
  return /^[1-9][0-9]{0,18}$/.test(text) ? text : null;
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
