/**
 * Agent definitions (admin) — addons/admin/router/agents.go.
 *
 * Retiring a definition is isActive=false (one row, checked at read time).
 * Delete (AG1) is a tombstone on a disabled definition: nothing cascades, history
 * stays readable, sends are refused, the IM account is disabled; restore undoes it.
 * The instances list is metadata only; session content and memory never leave
 * the owner.
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
  config?: { description?: string; prompt?: string; avatar?: string; memory?: boolean; defaults?: AgentDefaults; [key: string]: unknown };
  isActive: boolean;
  authAgentUserId?: number | null;
  deletedAt?: string | null;
  deletedBy?: number | null;
  instanceCount: number;
  sessions7d: number;
}

export interface AgentDefinitionInput {
  name?: string;
  slug?: string;
  description?: string;
  prompt?: string;
  /** Stored as config.avatar (an image URL). */
  avatar?: string;
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

/** What deleting touches; null + listed in `unavailable` when that table is not in Core's database. */
export interface AgentImpact {
  instances: number;
  conversations: number;
  conversations_7d: number;
  skill_bindings: number;
  im_groups: number | null;
  deliverables: number | null;
  unavailable: string[];
  counted_at: string;
}

/** Prompt text is never in an audit row, only its SHA-256 before/after. */
export interface AgentAudit {
  id: number;
  action: "create" | "update" | "disable" | "enable" | "delete" | "restore";
  actorUserId: number;
  fields: string[];
  promptSha256Before: string;
  promptSha256After: string;
  createdAt: string;
}

export async function listAgentDefinitions(options: { includeDeleted?: boolean } = {}): Promise<AgentDefinition[]> {
  const response = await http().get<Envelope<AgentDefinition[]>>(BASE,
    options.includeDeleted ? { params: { include_deleted: 1 } } : undefined);
  return response.data?.data ?? [];
}

/** 409 agent_definition_active unless disabled first. Idempotent. */
export async function deleteAgentDefinition(id: number): Promise<void> {
  await http().delete(`${BASE}/${id}`);
}

export async function restoreAgentDefinition(id: number): Promise<void> {
  await http().post(`${BASE}/${id}/restore`);
}

export async function getAgentImpact(id: number): Promise<AgentImpact> {
  const response = await http().get<Envelope<AgentImpact>>(`${BASE}/${id}/impact`);
  if (!response.data?.data) throw new Error("impact unavailable");
  return response.data.data;
}

export async function listAgentAudits(id: number, offset = 0, limit = 50): Promise<{ items: AgentAudit[]; total: number }> {
  const response = await http().get<Envelope<AgentAudit[]> & { total?: number }>(`${BASE}/${id}/audits`, { params: { offset, limit } });
  return { items: response.data?.data ?? [], total: response.data?.total ?? 0 };
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
