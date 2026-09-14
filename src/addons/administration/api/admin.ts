/**
 * 管理端 API：默认模型（v1/v2）、MCP 探测、技能管理。
 *
 * 后端契约（addons/admin/router/router.go，{ code, message, data } 信封）：
 *   GET    /api/v1/addons/admin/default-llm
 *   PUT    /api/v1/addons/admin/default-llm        （modeConfig 非空 = v2；否则 v1）
 *   DELETE /api/v1/addons/admin/default-llm
 *   POST   /api/v1/addons/admin/mcp-probe
 *   GET    /api/v1/addons/admin/skill               全量列表（含停用）
 *   PATCH  /api/v1/addons/admin/skill/:id           启停/改名
 *   DELETE /api/v1/addons/admin/skill/:id
 *   GET    /api/v1/addons/admin/skill/:id/files     文件树
 *   GET    /api/v1/addons/admin/skill/:id/file      单文件文本
 *   GET    /api/v1/addons/admin/skill/:id/download  presign 直链
 *
 * 供应商管理与工具 CRUD 复用 ./provider.ts 与 ./tool.ts。
 */
import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { Skill } from "./types";

const http = () => getPlatformRuntime().http;

/** 后端数字信封。 */
export interface Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

function unwrap<T>(data: Envelope<T> | undefined, fallback: T): T {
  return data?.data ?? fallback;
}

// ===== 默认模型（v1 + v2） =====

export type DefaultLLMModeKey = "quick" | "thinking" | "expert";

export interface DefaultLLMConfig {
  providerId: number;
  model: string;
}

export interface LLMModeSection {
  defaultGroupId?: string;
  groupIds?: string[];
}

export interface LLMModelGroup {
  id: string;
  slug: string;
  name: string;
  i18n?: unknown;
  enabled: boolean;
  modeKeys: string[];
  profileIds: string[];
  defaultProfileId: string;
  sortOrder: number;
}

export interface LLMModelProfile {
  id: string;
  providerId: number;
  model: string;
  displayName: string;
  params?: Record<string, unknown> | null;
  enabled: boolean;
}

export interface DefaultLLMModeConfig {
  version: 2;
  modes: Record<DefaultLLMModeKey, LLMModeSection>;
  groups: LLMModelGroup[];
  profiles: LLMModelProfile[];
}

export interface DefaultLLMEffective {
  providerId: number;
  model: string;
  source: string;
}

export interface DefaultLLMResponse {
  configured: boolean;
  source: "mode_config" | "configured" | "fallback";
  config: DefaultLLMConfig | null;
  modeConfig: DefaultLLMModeConfig | null;
  effective: DefaultLLMEffective | null;
}

const DEFAULT_LLM_BASE = "/api/v1/addons/admin/default-llm";

export async function fetchDefaultLLM(): Promise<DefaultLLMResponse> {
  const response = await http().get<Envelope<DefaultLLMResponse>>(DEFAULT_LLM_BASE);
  // data 字段本身即业务体；信封缺 data 时给未配置兜底（列表页照常渲染回退态）。
  return (
    response.data?.data ?? {
      configured: false,
      source: "fallback",
      config: null,
      modeConfig: null,
      effective: null,
    }
  );
}

export async function updateDefaultLLM(
  payload: DefaultLLMConfig | { modeConfig: DefaultLLMModeConfig },
): Promise<DefaultLLMResponse> {
  const response = await http().put<Envelope<DefaultLLMResponse>>(DEFAULT_LLM_BASE, payload);
  return unwrap(response.data, { configured: false, source: "fallback", config: null, modeConfig: null, effective: null });
}

export async function clearDefaultLLM(): Promise<DefaultLLMResponse> {
  const response = await http().delete<Envelope<DefaultLLMResponse>>(DEFAULT_LLM_BASE);
  return unwrap(response.data, { configured: false, source: "fallback", config: null, modeConfig: null, effective: null });
}

// ===== MCP 探测 =====

export interface MCPProbeTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export type MCPTransport = "sse" | "streamable-http";

export async function probeMCPServer(
  url: string,
  transport: MCPTransport,
  timeoutSec?: number,
): Promise<MCPProbeTool[]> {
  const response = await http().post<Envelope<MCPProbeTool[]>>(
    "/api/v1/addons/admin/mcp-probe",
    { url, transport, ...(timeoutSec ? { timeoutSec } : {}) },
  );
  return unwrap(response.data, []);
}

// ===== 技能管理 =====

export interface SkillFileNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  children?: SkillFileNode[];
}

const SKILL_ADMIN_BASE = "/api/v1/addons/admin/skill";

export async function listAllSkills(): Promise<Skill[]> {
  const response = await http().get<Envelope<Skill[]>>(SKILL_ADMIN_BASE);
  return unwrap(response.data, []);
}

export async function updateSkill(
  id: number,
  body: { name?: string; isActive?: boolean },
): Promise<Skill | null> {
  const response = await http().patch<Envelope<Skill>>(`${SKILL_ADMIN_BASE}/${id}`, body);
  return response.data?.data ?? null;
}

export async function deleteSkill(id: number): Promise<void> {
  await http().delete(`${SKILL_ADMIN_BASE}/${id}`);
}

export async function listSkillFiles(id: number): Promise<SkillFileNode[]> {
  const response = await http().get<Envelope<SkillFileNode[]>>(`${SKILL_ADMIN_BASE}/${id}/files`);
  return unwrap(response.data, []);
}

export async function readSkillFile(id: number, path: string): Promise<string> {
  const response = await http().get<Envelope<string>>(`${SKILL_ADMIN_BASE}/${id}/file`, {
    params: { path },
  });
  return response.data?.data ?? "";
}

export async function fetchSkillDownloadURL(id: number): Promise<string> {
  const response = await http().get<Envelope<{ url: string }>>(`${SKILL_ADMIN_BASE}/${id}/download`);
  return response.data?.data?.url ?? "";
}
