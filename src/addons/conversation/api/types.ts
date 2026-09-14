/**
 * Shared API type definitions matching the nucleagent-core backend contract
 * (see nucleagent-docs/03-data-models.md and 04-api-contracts.md).
 *
 * 后端 Go struct 的 json tag 全部使用 camelCase（userId/createdAt/senderType
 * 等），前端类型定义必须与之对齐。后端列表/详情返回 { code, message, data }
 * 信封，由 api/conversation.ts 的 Envelope<T> 解包。
 *
 * Errors use a string `code`.
 */

/** Error envelope returned by core on failure: { code, message }. */
export interface ApiErrorBody {
  code: string;
  message: string;
}

/** Conversation row (conversations table). 后端 json tag 是 camelCase。 */
export interface Conversation {
  id: number;
  userId: number;
  agentId?: number | null;
  projectId?: number | null;
  title: string;
  mode: ConversationMode;
  status: ConversationStatus;
  providerId?: number | null;
  model?: string;
  executionBackend?: ExecutionBackendId | string;
  executionStepId?: string;
  state?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export type ConversationMode = "a2a" | "a2a_agent" | "a2a_employee";
export type ConversationStatus =
  | "drafting"
  | "executing"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

/** Message row (messages table). 后端 json tag 是 camelCase。 */
export interface Message {
  id: number;
  conversationId: number;
  senderType: MessageSender;
  senderName: string;
  msgType: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type MessageSender = "user" | "agent" | "system" | "tool";
export type MessageType =
  | "text"
  | "streaming"
  | "plan"
  | "result"
  | "error"
  | "tool_call"
  | "status";

/**
 * 消息附件。与后端 a2a.Attachment 同形（camelCase json tag）。
 *
 * 注意没有 url 字段：下载链接由后端按需签发（有效期 1800s），不随消息存储；
 * 前端要下载时调 api/storage 的 getDownloadUrl 现取。
 */
export interface MessageAttachment {
  fileId: string;
  name: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  /** 由后端按 mimeType 归一，前端只用它选图标。 */
  kind?: "image" | "pdf" | "file";
}

/** 上传完成后回传给后端的附件引用（后端用 fileId 去 storage 核对真实元数据）。 */
export interface AttachmentRef {
  fileId: string;
  name?: string;
}

/**
 * 一次模型选择。**必须成对**：llmproxy 按 providerId 查库解密 API key，
 * 同名模型可能挂在不同 provider 下，光有模型名无法确定用谁的凭据。
 */
export interface ModelChoice {
  providerId: number;
  model: string;
}

export type ExecutionBackendId = "codex" | "hermes" | "opencode" | "claude-code" | "gemini-cli" | "deepseek-harness";

export interface ExecutionBackendOption {
  id: ExecutionBackendId | string;
  type: string;
  displayName: string;
  streaming: boolean;
  default: boolean;
  /** Native upstream protocol required by this executor. */
  requiredApiFormat?: string;
  /** Provider protocols supported by Core, including available translation. */
  supportedApiFormats?: string[];
  /** Native agents that cannot safely fall back to the executor service model. */
  requiresExplicitModel?: boolean;
}

/** POST /conversation body. */
export interface CreateConversationRequest {
  mode: ConversationMode;
  input: string;
  model?: string;
  /** LLM 提供商 ID。与 model 成对提供，缺一后端会拒。 */
  providerId?: number;
  executionBackend?: ExecutionBackendId | string;
  /** 暂存执行模式/输出格式等前端-only 元数据（后端暂未持久化，预留给未来字段）。 */
  metadata?: Record<string, unknown>;
  /** 附件引用（先经 storage 上传拿到 fileId）。 */
  attachments?: AttachmentRef[];
  /**
   * 创建时预选的技能 ID。后端校验存在且启用后，在同一事务内写入
   * SkillBinding(owner_type=conversation)，调用方不需要再单独调绑定接口。
   *
   * **省略/为空时不要下发空数组**：后端据此走自动语义匹配兜底
   * （dispatch 阶段 MatchSkills）。显式选了技能才关掉自动匹配。
   */
  skillIds?: number[];
}

/** POST /conversation/broadcast. An omitted/empty backend list selects all available backends. */
export interface BroadcastRequest extends Omit<CreateConversationRequest, "executionBackend"> {
  executionBackends?: string[];
  agentId?: number;
  projectId?: number;
}

export type BroadcastSkippedReason =
  | "offline"
  | "model_required"
  | "protocol_incompatible"
  | "busy"
  | "unavailable"
  | "queue_full"
  | "invalid_model"
  | "invalid_attachment"
  | "internal_error";

export interface BroadcastSkipped {
  backend: string;
  reason: BroadcastSkippedReason;
}

export interface BroadcastResult {
  groupId: string;
  conversations: Conversation[];
  /** Go nil slices serialize as null. */
  skipped: BroadcastSkipped[] | null;
}

export interface BroadcastSiblingBrief {
  id: number;
  executionBackend: string;
  status: ConversationStatus;
  title: string;
  createdAt: string;
  completedAt?: string;
}

export interface BroadcastGroupDetail {
  groupId: string;
  siblings: BroadcastSiblingBrief[];
}

export interface BroadcastFollowUpRequest {
  input: string;
  attachments?: AttachmentRef[];
}

export interface BroadcastFollowUpOutcome {
  conversationId: number;
  backend: string;
  accepted: boolean;
  reason?: BroadcastSkippedReason;
}

export interface BroadcastFollowUpResult {
  groupId: string;
  outcomes: BroadcastFollowUpOutcome[];
  skipped: BroadcastSkipped[] | null;
}

export interface BroadcastCancelFailure {
  conversationId: number;
  backend: string;
  reason: BroadcastSkippedReason;
}

export interface BroadcastCancelResult {
  groupId: string;
  cancelled: number[] | null;
  failed: BroadcastCancelFailure[];
}

/** Member details included in Huma problem responses when the whole command fails. */
export interface BroadcastProblem {
  skipped?: BroadcastSkipped[] | null;
  outcomes?: BroadcastFollowUpOutcome[];
  failed?: BroadcastCancelFailure[];
}

/**
 * Skill row (skills table, GET /skill item)。后端返回 camelCase JSON。
 *
 * 该端点只返回启用项（is_active = true），所以列表里的 isActive 恒为 true；
 * 字段保留是为了与后端 model 对齐，不作为前端过滤依据。
 */
export interface Skill {
  id: number;
  name: string;
  slug: string;
  config?: {
    category?: string;
    description?: string;
    source_url?: string;
    version?: string;
    is_system?: boolean;
    [key: string]: unknown;
  };
  i18n?: Record<string, unknown>;
  isActive: boolean;
  version?: string;
  sourceSha256?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Agent template row (agent_templates table, GET /agent/templates item).
 *  后端返回 camelCase JSON（isActive/createdAt/updatedAt），类型与之对齐。 */
export interface AgentTemplate {
  id: number;
  name: string;
  slug: string;
  config?: {
    category?: string;
    role?: string;
    personality?: string;
    prompt?: string;
    avatar?: string;
    color?: string;
    sort_order?: number;
    [key: string]: unknown;
  };
  i18n?: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Decoded SSE frame from GET /conversation/:id/messages/stream.
 *
 * 后端 SSE 扇出（router.go serveSSE）按 broker 事件推送完整 Message 对象，
 * 帧格式为：
 *   id: <messageId>
 *   event: message-created | message-updated | message-deleted
 *   data: { ...完整 Message(camelCase)... }
 *
 * 即每个 SSE 事件携带的是整条消息（创建/更新/删除），不是增量 delta。
 * 前端按 event 类型 upsert 到消息列表即可。
 */
export type SSEEventName = "message-created" | "message-updated" | "message-deleted";

export interface SSEMessageEvent {
  /** SSE 帧的 event: 字段。 */
  event: SSEEventName;
  /** SSE 帧的 id: 字段（= message id），用于 Last-Event-ID 重连。 */
  id: number;
  /** message-created/updated 时是完整 Message；message-deleted 时是 {id}。 */
  message?: Message;
}
