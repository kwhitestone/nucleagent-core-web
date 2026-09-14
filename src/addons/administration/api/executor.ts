import { z } from "zod";
import { ApiError, getPlatformRuntime } from "@/contracts/platform-runtime";
import type { ExecutorSnapshot, RuntimeUpdate, RuntimeUpdateResult } from "../executors/types";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const processStatus = z.object({ slot: z.string(), generation: count, state: z.string(), activeSessions: count });
const backendStatus = z.object({
  backend: z.string().min(1), mode: z.string(), minProcesses: count, maxProcesses: count, sessionsPerProcess: count, maxActiveSessions: count,
  readyProcesses: count, startingProcesses: count, drainingProcesses: count, residentProcesses: count,
  activeSessions: count, targetCapacity: count, admissionCapacity: count, state: z.string(),
  errorCode: z.string().optional(), processes: z.array(processStatus).optional(),
});
const runtimeStatus = z.object({
  revision: count, configurable: z.boolean(), isolationMode: z.string(), maxConcurrency: count,
  backends: z.array(backendStatus),
});
const executorSnapshot = z.object({
  updatedAt: z.string(), instances: z.array(z.object({
    instanceId: z.string().min(1), deviceId: z.string(), deviceName: z.string(), os: z.string(), appVersion: z.string().optional(),
    connectedAt: z.string(), lastSeenAt: z.string(), activeExecutions: count, maxConcurrency: count,
    runtime: runtimeStatus.nullable(),
  })),
});
const updateResult = z.object({ accepted: z.boolean(), errorCode: z.string().optional(), message: z.string().optional(), status: runtimeStatus.optional() })
  .refine(result => !result.accepted || Boolean(result.status));

function unwrap<T>(body: unknown, schema: z.ZodType<T>): T {
  const result = z.object({ code: z.literal(0), data: schema }).safeParse(body);
  if (!result.success) throw new ApiError("Invalid executor management response", "INVALID_RESPONSE", 0);
  return result.data.data;
}

const BASE = "/api/v1/addons/admin/executors";

export async function listConnectedExecutors(signal: AbortSignal): Promise<ExecutorSnapshot> {
  const response = await getPlatformRuntime().http.get(BASE, { signal });
  return unwrap(response.data, executorSnapshot);
}

export async function updateExecutorRuntime(instanceId: string, body: RuntimeUpdate, signal: AbortSignal): Promise<RuntimeUpdateResult> {
  const response = await getPlatformRuntime().http.put(`${BASE}/${encodeURIComponent(instanceId)}/runtime`, body, { signal });
  return unwrap(response.data, updateResult);
}
