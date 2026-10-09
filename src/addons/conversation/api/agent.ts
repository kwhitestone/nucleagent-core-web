import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { AgentTemplate } from "./types";

const http = () => getPlatformRuntime().http;

const BASE = "/api/v1/addons/agent/templates";

/** 后端返回 { code, message, data } 信封；data 才是业务载荷。 */
interface Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

/**
 * GET /agent/templates - list available agent templates.
 * 后端返回 { code, message, data: AgentTemplate[] }，解包取 data。
 */
export async function listAgentTemplates(): Promise<AgentTemplate[]> {
  const response = await http().get<Envelope<AgentTemplate[]>>(BASE);
  return response.data?.data ?? [];
}

/** One of "my agents": an enabled definition joined with my personal instance. */
export interface MyAgent {
  templateId: number;
  name: string;
  slug: string;
  description: string;
  config?: AgentTemplate["config"];
  i18n?: Record<string, unknown>;
  disabled: boolean;
  /** The definition was deleted by an admin (only on the single-item endpoint). */
  deleted?: boolean;
  /** Null until first use: everyone owns every agent before a row exists. */
  instanceId: number | null;
  sessionCount: number;
  lastSessionAt: string | null;
  memory?: string | null;
  memoryFoldedAt?: string | null;
}

const MINE = "/api/v1/addons/agent/mine";

export async function listMyAgents(): Promise<MyAgent[]> {
  const response = await http().get<Envelope<MyAgent[]>>(MINE);
  return response.data?.data ?? [];
}

export async function getMyAgent(templateId: number): Promise<MyAgent | null> {
  const response = await http().get<Envelope<MyAgent>>(`${MINE}/${templateId}`);
  return response.data?.data ?? null;
}

/** The definition behind one of my instances (a conversation carries the instance id). */
export async function getInstanceTemplateId(instanceId: number): Promise<number | null> {
  const response = await http().get<Envelope<{ templateId: number }>>(`/api/v1/addons/agent/instances/${instanceId}`);
  return response.data?.data?.templateId ?? null;
}

/** Owner edits memory; an empty string clears it. */
export async function updateAgentMemory(instanceId: number, memory: string): Promise<void> {
  await http().patch(`/api/v1/addons/agent/instances/${instanceId}`, { memory });
}
