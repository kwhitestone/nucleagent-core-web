/**
 * Tool CRUD —— 与后端 addons/tool/router/router.go 对接。
 *
 * Tool 是全局资源；写端点要求管理员（internal/adminmw，HTTP 403 兜底）。
 * config.mcp_config 约定（见 addons/mcp/tools.go）：
 *   { type: "builtin" | "http", description, input_schema, url, server_name }
 */
import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { Envelope } from "./admin";

const http = () => getPlatformRuntime().http;

/** Tool row（tools 表）。config 是自由 JSON。 */
export interface Tool {
  id: number;
  name: string;
  slug: string;
  config?: ToolConfig;
  i18n?: Record<string, unknown>;
  isActive: boolean;
}

/** Tool.config JSON —— mcp_config 为 MCP 网关消费的投影配置。 */
export interface ToolConfig {
  mcp_config?: {
    type?: string;
    description?: string;
    input_schema?: Record<string, unknown>;
    url?: string;
    server_name?: string;
  };
  [key: string]: unknown;
}

const BASE = "/api/v1/addons/tool";

export async function listTools(): Promise<Tool[]> {
  const response = await http().get<Envelope<Tool[]>>(BASE);
  return response.data?.data ?? [];
}

export async function createTool(body: {
  name: string;
  slug: string;
  config?: ToolConfig;
  isActive?: boolean;
}): Promise<Tool | null> {
  const response = await http().post<Envelope<Tool>>(BASE, body);
  return response.data?.data ?? null;
}

/**
 * PATCH —— 字段全可选。slug 唯一，改重会 500（后端提示「slug 可能重复」）。
 */
export async function updateTool(
  id: number,
  body: { name?: string; slug?: string; config?: ToolConfig; isActive?: boolean },
): Promise<Tool | null> {
  const response = await http().patch<Envelope<Tool>>(`${BASE}/${id}`, body);
  return response.data?.data ?? null;
}

export async function deleteTool(id: number): Promise<void> {
  await http().delete(`${BASE}/${id}`);
}
