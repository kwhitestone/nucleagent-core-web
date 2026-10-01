/**
 * Agent definitions (admin) — addons/admin/router/agents.go.
 *
 * No delete: retiring a definition is isActive=false (one row, checked at read
 * time). The instances list is metadata only; session content and memory never
 * leave the owner.
 */
import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { Envelope } from "./admin";

const http = () => getPlatformRuntime().http;
const BASE = "/api/v1/addons/admin/agents";

export interface AgentDefaults {
  executionBackend?: string;
  providerId?: number;
  model?: string;
}

export interface AgentDefinition {
  id: number;
  name: string;
  slug: string;
  config?: { description?: string; prompt?: string; memory?: boolean; defaults?: AgentDefaults; [key: string]: unknown };
  isActive: boolean;
  authAgentUserId?: number | null;
  instanceCount: number;
  sessions7d: number;
}

export interface AgentDefinitionInput {
  name?: string;
  slug?: string;
  description?: string;
  prompt?: string;
  memory?: boolean;
  defaults?: AgentDefaults;
  /** 0 clears the IM identity. */
  authAgentUserId?: number;
  isActive?: boolean;
}

export interface AgentInstanceMeta {
  instanceId: number;
  userId: number;
  nickName: string;
  firstUsedAt: string;
  sessionCount: number;
  lastSessionAt: string | null;
}

export async function listAgentDefinitions(): Promise<AgentDefinition[]> {
  const response = await http().get<Envelope<AgentDefinition[]>>(BASE);
  return response.data?.data ?? [];
}

export async function createAgentDefinition(body: AgentDefinitionInput): Promise<void> {
  await http().post(BASE, body);
}

export async function updateAgentDefinition(id: number, body: AgentDefinitionInput): Promise<void> {
  await http().patch(`${BASE}/${id}`, body);
}

export async function listAgentInstances(
  id: number,
  offset = 0,
  limit = 20,
): Promise<{ items: AgentInstanceMeta[]; total: number }> {
  const response = await http().get<Envelope<AgentInstanceMeta[]> & { total?: number }>(`${BASE}/${id}/instances`, {
    params: { offset, limit },
  });
  return { items: response.data?.data ?? [], total: response.data?.total ?? 0 };
}
