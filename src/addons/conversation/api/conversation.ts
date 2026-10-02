import { ApiError, getPlatformRuntime } from "@/contracts/platform-runtime";
import { conversationNavigation } from "../composables/conversationNavigation";
import type {
  AttachmentRef,
  Conversation,
  CreateConversationRequest,
  Message,
  ModelChoice,
  ExecutionBackendOption,
  ExecutionBackendId,
  SSEEventName,
  SSEMessageEvent,
} from "./types";

const BASE = "/api/v1/addons/conversation";
const http = () => getPlatformRuntime().http;

/** 后端列表/详情返回 { code, message, data } 信封；data 才是业务载荷。 */
interface Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

/** 列表分页参数：beforeId 为上一页最小 id 游标，limit 控制每页大小。 */
export interface ListConversationsParams {
  beforeId?: number;
  limit?: number;
}

/** 列表响应：data 为本页对话，hasMore 指示是否还有下一页。 */
export interface ListConversationsResult {
  data: Conversation[];
  hasMore: boolean;
}

/**
 * GET /conversation — list conversations for the current user (游标分页).
 *
 * 后端返回 { code, data: Conversation[], hasMore }。beforeId 省略时拉首页；
 * 翻页时传上一页最小 id。解包取 { data, hasMore }。
 */
export async function listConversations(
  params?: ListConversationsParams,
): Promise<ListConversationsResult> {
  const response = await http().get<Envelope<Conversation[]> & { hasMore?: boolean }>(BASE, {
    params: {
      beforeId: params?.beforeId,
      limit: params?.limit,
    },
  });
  return {
    data: response.data?.data ?? [],
    hasMore: response.data?.hasMore ?? false,
  };
}

/**
 * POST /conversation — create a conversation and kick off execution.
 * Body: { mode, input, model? }.
 */
export async function createConversation(
  payload: CreateConversationRequest,
): Promise<Conversation> {
  const response = await http().post<Envelope<Conversation>>(BASE, payload);
  return response.data?.data as Conversation;
}

/** GET /conversation/:id — load persisted conversation settings and status. */
export async function getConversation(
  conversationId: number | string,
): Promise<Conversation> {
  return conversationNavigation.loadConversation(String(conversationId), async () => {
    const response = await http().get<Envelope<Conversation>>(`${BASE}/${conversationId}`);
    return response.data?.data as Conversation;
  });
}

export async function listExecutionBackends(deviceId?: string): Promise<ExecutionBackendOption[]> {
  const response = await http().get<Envelope<ExecutionBackendOption[]>>(`${BASE}/execution-backends`, { params: { deviceId: deviceId || undefined } });
  return response.data?.data ?? [];
}

/**
 * GET /conversation/:id/messages — message history for a conversation.
 */
export async function getMessages(conversationId: number | string, signal?: AbortSignal): Promise<Message[]> {
  const response = await http().get<Envelope<Message[]>>(`${BASE}/${conversationId}/messages`, { signal });
  return response.data?.data ?? [];
}

/**
 * POST /conversation/:id/follow-up — append a message and re-execute (multi-turn).
 */
export async function followUp(
  conversationId: number | string,
  input: string,
  attachments?: AttachmentRef[],
  model?: ModelChoice,
  executionBackend?: ExecutionBackendId | string,
): Promise<Conversation> {
  // 无附件/未切换模型时不带对应字段，请求体与改动前逐字节一致。
  const body: Record<string, unknown> = { input };
  if (attachments?.length) body.attachments = attachments;
  if (model) {
    body.providerId = model.providerId;
    body.model = model.model;
  }
  if (executionBackend) body.executionBackend = executionBackend;
  const response = await http().post<Envelope<Conversation>>(
    `${BASE}/${conversationId}/follow-up`,
    body,
  );
  return response.data?.data as Conversation;
}

/**
 * POST /conversation/:id/clarify — 回答 clarify 交互请求。
 * answer 为文本；多选场景由 UI 层把选中项合并成一句。
 */
export async function respondClarify(
  conversationId: number | string,
  requestId: string,
  answer: string,
): Promise<void> {
  await http().post(`${BASE}/${conversationId}/clarify`, { requestId, answer });
}

/**
 * POST /conversation/:id/cancel — 取消正在执行的对话（后端取消 runner，
 * 对话置 cancelled）。对话未在执行时后端返回 404。
 */
export async function cancelConversation(conversationId: number | string): Promise<void> {
  await http().post(`${BASE}/${conversationId}/cancel`);
}

/**
 * PATCH /conversation/:id — 切换对话使用的模型/提供商。
 *
 * 只落库，下一轮执行才生效（后端会在下次 dispatch 时让 executor 重建
 * hermes session —— 模型是建 session 时固化的，不重建改不掉）。
 */
export async function updateConversationModel(
  conversationId: number | string,
  model: ModelChoice,
): Promise<Conversation> {
  const response = await http().patch<Envelope<Conversation>>(`${BASE}/${conversationId}`, {
    providerId: model.providerId,
    model: model.model,
  });
  return response.data?.data as Conversation;
}

export async function updateConversationBackend(
  conversationId: number | string,
  executionBackend: ExecutionBackendId | string,
): Promise<Conversation> {
  const response = await http().patch<Envelope<Conversation>>(`${BASE}/${conversationId}`, {
    executionBackend,
  });
  return response.data?.data as Conversation;
}

/** Atomically switch provider/model and execution backend between turns. */
export async function updateConversationSettings(
  conversationId: number | string,
  model: ModelChoice | null,
  executionBackend: ExecutionBackendId | string,
): Promise<Conversation> {
  const body: Record<string, unknown> = { executionBackend };
  if (model) {
    body.providerId = model.providerId;
    body.model = model.model;
  } else {
    body.clearModel = true;
  }
  const response = await http().patch<Envelope<Conversation>>(`${BASE}/${conversationId}`, body);
  return response.data?.data as Conversation;
}

/**
 * Build the absolute SSE URL. When apiBase() is empty (standalone dev) the
 * relative URL is fine for fetch; under a micro-app shell apiBase() carries the
 * configured origin.
 */
function streamUrl(conversationId: number | string): string {
  const path = `${BASE}/${conversationId}/messages/stream`;
  return `${getPlatformRuntime().apiBase()}${path}`;
}

/**
 * Parse a single SSE frame block into an SSEMessageEvent.
 *
 * 后端帧格式（router.go writeSSEEvent）：
 *   id: <messageId>
 *   event: message-created | message-updated | message-deleted
 *   data: { ...完整 Message... }
 *
 * 返回 undefined 表示 keep-alive/注释帧（无 data）。
 */
function parseFrame(block: string): SSEMessageEvent | undefined {
  const lines = block.split("\n");
  const dataLines = lines
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trimStart());
  if (dataLines.length === 0) return undefined;

  let id = 0;
  let eventName: SSEEventName = "message-created";
  for (const line of lines) {
    if (line.startsWith("id:")) {
      id = Number(line.slice(3).trim()) || 0;
    } else if (line.startsWith("event:")) {
      const v = line.slice(6).trim() as SSEEventName;
      if (v === "message-created" || v === "message-updated" || v === "message-deleted") {
        eventName = v;
      }
    }
  }

  const payload = dataLines.join("\n");
  let message: Message | undefined;
  try {
    message = JSON.parse(payload) as Message;
  } catch {
    return undefined;
  }
  return { event: eventName, id, message };
}

/**
 * GET /conversation/:id/messages/stream — SSE subscription.
 *
 * Yields decoded SSEMessageEvents as they arrive. Uses the raw fetch +
 * ReadableStream decoder (axios cannot stream). Handles frames split across
 * chunk boundaries by buffering until a frame terminator (\n\n) is seen.
 *
 * Non-OK responses are thrown as ApiError so callers share the same error path
 * as the REST calls.
 */
export async function* streamMessages(
  conversationId: number | string,
  signal?: AbortSignal,
  cursor?: string,
): AsyncGenerator<SSEMessageEvent, void, unknown> {
  // 外部 signal + 看门狗共用一个 controller：任一触发都断开 fetch。
  const controller = new AbortController();
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const headers = getPlatformRuntime().authHeaders();
  const lastEventId = cursor && /^\d{1,20}$/.test(cursor) && cursor !== "0" ? cursor : undefined;
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;
  const response = await fetch(streamUrl(conversationId), {
    method: "GET",
    headers,
    signal: controller.signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      getPlatformRuntime().handleUnauthorizedResponse(headers.Authorization);
    }
    let code = `HTTP_${response.status}`;
    let message = `Stream request failed (${response.status})`;
    try {
      const body = (await response.json()) as { code?: string; message?: string };
      if (body.code) code = body.code;
      if (body.message) message = body.message;
    } catch {
      // Body was not JSON; keep the default HTTP-level message.
    }
    throw new ApiError(message, code, response.status);
  }

  const body = response.body;
  if (!body) {
    throw new ApiError("No response body for stream", "NO_BODY", response.status);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  // 帧看门狗：服务端每 15s 发心跳注释帧（router.go serveSSE）。超过 30s
  // 没有任何字节到达 = 连接已被中间层静默掐死（TCP 半开，read 永不返回、
  // 也永不报错）——主动 abort 让 fetch 抛错，触发上层重连。没有这个看门狗，
  // 挂死的 transport 会让组件停在"connected"假状态，之后的消息全部丢失
  // （对话 158 卡显示的直接原因）。
  const watchdog = { timer: undefined as ReturnType<typeof setTimeout> | undefined };
  const armWatchdog = () => {
    if (watchdog.timer) clearTimeout(watchdog.timer);
    watchdog.timer = setTimeout(() => controller.abort(), 30_000);
  };
  const disarmWatchdog = () => {
    if (watchdog.timer) clearTimeout(watchdog.timer);
  };

  try {
    armWatchdog();
    for (;;) {
      const { done, value } = await reader.read();
      armWatchdog();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line. Split on \n\n and keep the
      // trailing partial frame in the buffer for the next chunk.
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const event = parseFrame(trimmed);
        if (event) yield event;
      }
    }
    // Flush any trailing frame that lacked a final terminator.
    const trimmed = buffer.trim();
    if (trimmed) {
      const event = parseFrame(trimmed);
      if (event) yield event;
    }
  } finally {
    disarmWatchdog();
    reader.releaseLock();
  }
}

export interface PrivateDevice {
  id: string;
  name: string;
  os: string;
  expiresAt: string;
  revokedAt?: string;
}
export async function listPrivateDevices(): Promise<PrivateDevice[]> {
  const response = await http().get<Envelope<PrivateDevice[]>>("/api/v1/addons/executor-devices");
  return response.data?.data ?? [];
}
export async function confirmPrivateDevice(id: string, userCode: string): Promise<void> {
  await http().post("/api/v1/addons/executor-devices/bind/confirm", { id, userCode });
}
