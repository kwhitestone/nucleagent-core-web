import { z } from "zod";
import type { AxiosResponseTransformer } from "axios";
import { ApiError, getPlatformRuntime } from "@/contracts/platform-runtime";
import type {
  BroadcastCancelResult,
  BroadcastFollowUpRequest,
  BroadcastFollowUpResult,
  BroadcastGroupDetail,
  BroadcastProblem,
  BroadcastRequest,
  BroadcastResult,
} from "./types";

const BASE = "/api/v1/addons/conversation/broadcast";
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const groupId = z.string().min(1);
const status = z.enum(["drafting", "executing", "blocked", "completed", "failed", "cancelled"]);
const reason = z.enum([
  "offline", "model_required", "protocol_incompatible", "busy", "unavailable",
  "queue_full", "invalid_model", "invalid_attachment", "internal_error",
]);
const skipped = z.array(z.object({ backend: z.string(), reason })).nullable();
const conversation = z.object({
  id, userId: id, title: z.string(), mode: z.enum(["a2a", "a2a_agent", "a2a_employee"]), status,
  agentId: id.nullable().optional(), projectId: id.nullable().optional(),
  providerId: id.nullable().optional(), model: z.string().optional(),
  executionBackend: z.string().optional(), executionStepId: z.string().optional(),
  state: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().nullable().optional(),
});
const createResult = z.object({ groupId, conversations: z.array(conversation), skipped });
const groupDetail = z.object({
  groupId, siblings: z.array(z.object({
    id, executionBackend: z.string(), status, title: z.string(),
    createdAt: z.string(), completedAt: z.string().optional(),
  })),
});
const outcomes = z.array(z.object({
  conversationId: id, backend: z.string(), accepted: z.boolean(), reason: reason.optional(),
}));
const failed = z.array(z.object({ conversationId: id, backend: z.string(), reason }));
const followUpResult = z.object({ groupId, outcomes, skipped });
const cancelResult = z.object({
  groupId, cancelled: z.array(id).nullable(), failed,
});
const problem = z.object({ skipped: skipped.optional(), outcomes: outcomes.optional(), failed: failed.optional() });

export class BroadcastApiError extends ApiError {
  readonly details: BroadcastProblem;

  constructor(error: ApiError, details: BroadcastProblem) {
    super(error.message, error.code, error.status);
    this.name = "BroadcastApiError";
    this.details = details;
  }
}

async function request<T>(
  method: "get" | "post", path: string, payload: unknown, schema: z.ZodType<T>, signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const http = getPlatformRuntime().http;
  const transforms = http.defaults?.transformResponse;
  let errorBody: unknown;
  // Capture only this request's parsed body before the shared interceptor
  // normalizes it. Auth handling, cancellation and status validation stay intact.
  const captureProblem: AxiosResponseTransformer = (body, _headers, status) => {
    if (status !== undefined && status >= 400) errorBody = body;
    return body;
  };
  const config = {
    signal,
    transformResponse: [...(Array.isArray(transforms) ? transforms : transforms ? [transforms] : []), captureProblem],
  };
  try {
    const response = method === "get" ? await http.get(path, config) : await http.post(path, payload, config);
    signal?.throwIfAborted();
    const result = z.object({ code: z.literal(0), data: schema }).safeParse(response.data);
    if (!result.success) throw new ApiError("Invalid broadcast response", "INVALID_RESPONSE", 0);
    return result.data.data;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ApiError && error.status !== 401 && error.status !== 403) {
      const details = problem.safeParse(errorBody);
      if (details.success && Object.keys(details.data).length) throw new BroadcastApiError(error, details.data);
    }
    throw error;
  }
}

export function createBroadcast(payload: BroadcastRequest, signal?: AbortSignal): Promise<BroadcastResult> {
  return request("post", BASE, payload, createResult, signal);
}

export function getBroadcast(groupId: string, signal?: AbortSignal): Promise<BroadcastGroupDetail> {
  return request("get", `${BASE}/${encodeURIComponent(groupId)}`, undefined, groupDetail, signal);
}

export function broadcastFollowUp(
  groupId: string,
  payload: BroadcastFollowUpRequest,
  signal?: AbortSignal,
): Promise<BroadcastFollowUpResult> {
  return request("post", `${BASE}/${encodeURIComponent(groupId)}/follow-up`, payload, followUpResult, signal);
}

export function broadcastCancel(groupId: string, signal?: AbortSignal): Promise<BroadcastCancelResult> {
  return request("post", `${BASE}/${encodeURIComponent(groupId)}/cancel`, undefined, cancelResult, signal);
}
