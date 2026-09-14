import type {
  CommandResult,
  ConversationAdapter,
  ConversationAttachment,
  ConversationCommand,
  ConversationEvent,
  ConversationItem,
  ConversationPage,
  ConversationSnapshot,
  OlderPageRequest,
  SnapshotRequest,
  SubscribeRequest,
  UploadOptions,
} from "@/addons/conversation/task-conversation/core";
import type {
  AttachmentRef,
  Message,
  MessageAttachment,
} from "@/addons/conversation/api/types";
import {
  streamMessages,
  getMessages,
  getConversation,
  followUp,
  cancelConversation,
  respondClarify,
} from "@/addons/conversation/api/conversation";
import { uploadFile } from "@/addons/conversation/api/storage";
import { ApiError } from "@/contracts/platform-runtime";
import {
  advanceMessageCursor,
  createConversationStreamVersionTracker,
  snapshotMessageCursor,
} from "./conversationStreamPolicy";
import { normalizeProcessToolDetails, normalizeProcessPlan } from "@/addons/conversation/task-conversation/toolDetails";
import { messageTimingData, snapshotTiming } from "./conversationTiming";
import { executionPhaseLabel } from "../task-conversation/vue/executionPhasePresentation";
import { conversationNavigation } from "./conversationNavigation";

/**
 * 把 nucleagent 后端（REST + 全量 Message SSE）桥接到 task-conversation
 * 组件的 ConversationAdapter（V2 协议、增量事件）。
 *
 * 两套模型的差异与映射策略：
 *
 * 1. 消息 → ConversationItem
 *    后端推**完整 Message 行**（message-created/-updated/-deleted），没有
 *    stream.append 增量。所以 subscribe 一律产出 item.upsert：流式行每次
 *    整行替换，reducer 按 item.id upsert，效果等同增量。msgType=streaming
 *    的行给 status="streaming"，终态（result/error/text）给 "complete"/"failed"。
 *
 * 2. revision/seq 版本号（关键，不能偷懒）
 *    reducer.compareVersion 要求同一 stream 内事件版本严格 +1 递增，否则
 *    判 duplicate/gap 丢弃甚至触发重拉快照。本 adapter 在**订阅生命周期内**
 *    为每个 item.id 维护已发 revision：首帧 revision=1，后续每帧 +1。
 *    seq 沿用消息 id（reducer 只对同一 item 的版本做连续性比较）。
 *
 * 3. lane / userReadable / title
 *    - user / text / result → answer（主内容区）
 *    - streaming / tool_call / plan / status → process（过程区，思考气泡）
 *    注意 selectTurns 会过滤 lane=process 且 userReadable!==true 的条目，
 *    所以过程条目必须显式 userReadable: true 才能显示。
 *    title 由 senderName 映射（如 "agent.thinking" → 「思考中」）。
 *    error → system lane + 自定义 renderer。
 *
 * 4. 分页
 *    后端 messages 接口不分页（一次全量返回）。loadSnapshot 返回全部历史，
 *    hasOlder 恒为 false，loadOlder 不会被触发。
 *
 * 5. 命令
 *    send → followUp（乐观 item 由组件 controller 自己加）。
 *    stop → cancel。retry/rerun 后端没有对应接口，返回 not accepted。
 */

/**
 * 已发送未确认的乐观消息：`{conversationId}:{clientMessageId}` → content。
 *
 * 必须放模块级：controller 的订阅 generator 在页面加载时创建、持有创建时
 * adapter 实例的闭包；而 execute 每次调用走的是 props 上较新的实例
 * （视图重渲染/HMR 会重建 computed adapter）。放实例内会导致记录与消费
 * 分属两个实例、乐观条目永远无法与 SSE 真实 user 消息对账（重复气泡根因）。
 * 按 conversationId 前缀隔离，避免多对话串号。
 */
const pendingSends = new Map<string, string>();

export const isIdempotentStopError = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404;

/**
 * 本轮未终结的 thinking 消息缓存（adapter 实例内）：主答案终态时补发
 * complete 状态，驱动"思考中"动画停止。见 subscribe 里的补发逻辑。
 */
const thinkingItemsByConversation = new Map<string, Map<number, Message>>();
const executionPhaseItemsByConversation = new Map<string, Map<number, Message>>();

function thinkingItemsFor(conversationKey: string): Map<number, Message> {
  const existing = thinkingItemsByConversation.get(conversationKey);
  if (existing) return existing;
  const created = new Map<number, Message>();
  thinkingItemsByConversation.set(conversationKey, created);
  return created;
}

function executionPhaseItemsFor(conversationKey: string): Map<number, Message> {
  const existing = executionPhaseItemsByConversation.get(conversationKey);
  if (existing) return existing;
  const created = new Map<number, Message>();
  executionPhaseItemsByConversation.set(conversationKey, created);
  return created;
}

/** senderName → 过程条目标题（对用户可读的中文标签）。 */
/** thinking 行标题：进行中「思考中」，结束「思考过程」——静止的历史条
 *  不能还挂着"思考中"（用户会以为还在跑）。工具调用行沿用工具名。 */
function thinkingTitle(isActive: boolean): string {
  return isActive ? "思考中" : "思考过程";
}

/** 每条后端消息固定归入同一个 turn（后端没有 turn 概念）。 */
const TURN_ID = "main";

/**
 * 主 agent 的 streaming 行（senderName=agent，无 .thinking 后缀）是**正在输出的
 * 答案正文**，必须走 answer lane —— 前端才会立即出现助手输出气泡（组件对
 * answer lane 的 streaming item 渲染 .atc-stream-text）。
 * 只有 thinking（senderName 带 .thinking）和工具调用才是 process。
 */
function mapLane(msg: Message) {
  if (msg.senderType === "user") return "answer" as const;
  switch (msg.msgType) {
    case "streaming":
      return msg.senderName.endsWith(".thinking") ? ("process" as const) : ("answer" as const);
    case "tool_call":
      // clarify 用统一消息气泡渲染（answer lane + role=assistant），交互区
      // 嵌在气泡内（MessageItem 检测 item.data.interactionId）。
      return msg.senderName === "clarify" ? ("answer" as const) : ("process" as const);
    case "plan":
    case "status":
      return "process" as const;
    case "error":
      return "system" as const;
    default:
      return "answer" as const;
  }
}

/** clarify 消息的 metadata → 组件交互卡契约（data.interactionId/interactionStatus/choices）。 */
function clarifyData(
  msg: Message,
  answeredClarifyIds: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (msg.senderName !== "clarify" || msg.msgType !== "tool_call") return undefined;
  const meta = msg.metadata as Record<string, unknown> | undefined;
  const requestId = typeof meta?.request_id === "string" ? meta.request_id : undefined;
  if (!requestId) return undefined;
  // 该请求是否已被回答：回答消息的 metadata.clarify_request_id 与之相同。
  // answered 由 answeredClarifyIds 集合跟踪（subscribe 期间与快照填充）。
  const answered = meta?.answered === true || answeredClarifyIds.has(requestId);
  const choices = Array.isArray(meta?.choices)
    ? (meta.choices as unknown[]).filter((c): c is string => typeof c === "string")
    : undefined;
  return {
    interactionId: requestId,
    interactionStatus: answered ? "answered" : "pending",
    ...(choices?.length ? { choices } : {}),
  };
}

/** 已回答的 clarify request_id 集合（判定交互卡是否仍 pending）。 */
const answeredClarifyIdsByConversation = new Map<string, Set<string>>();

function answeredClarifyIdsFor(conversationKey: string): Set<string> {
  const existing = answeredClarifyIdsByConversation.get(conversationKey);
  if (existing) return existing;
  const created = new Set<string>();
  answeredClarifyIdsByConversation.set(conversationKey, created);
  return created;
}

function mapStatus(msg: Message): ConversationItem["status"] {
  const metadata = msg.metadata as Record<string, unknown> | undefined;
  if (isExecutionPhase(msg)) {
    switch (metadata?.phase_status) {
      case "running":
        return "streaming";
      case "failed":
        return "failed";
      case "cancelled":
        return "cancelled";
      default:
        return "complete";
    }
  }
  if (msg.msgType === "tool_call") {
    if (metadata?.tool_status === "running") return "streaming";
    if (metadata?.tool_status === "failed") return "failed";
  }
  switch (msg.msgType) {
    case "streaming":
      return "streaming";
    case "error":
      return "failed";
    default:
      return "complete";
  }
}

function safeMessageContent(msg: Message, status: ConversationItem["status"]): string {
  // Lifecycle content is a transport fallback. The process row presents its
  // state through a localized title and its duration through the elapsed slot.
  if (isExecutionPhase(msg)) return "";
  if (!msg.senderName.endsWith(".thinking")) return msg.content || "";
  if (msg.metadata?.thinkingStatus === true) {
    return msg.content ||
      (status === "streaming" || status === "pending"
        ? "正在等待模型返回可展示内容…"
        : "已完成等待");
  }
  if (
    msg.metadata?.thinkingVisibility === "summary" ||
    msg.metadata?.thinkingVisibility === "full"
  ) {
    return msg.content ||
      (status === "streaming" || status === "pending"
        ? "正在分析请求并准备下一步…"
        : "已完成分析");
  }
  return status === "streaming" || status === "pending"
    ? "正在分析请求并准备下一步…"
    : "已完成分析";
}

function processTitle(msg: Message, active: boolean): string {
  if (msg.senderName.endsWith(".thinking")) return thinkingTitle(active);
  if (isExecutionPhase(msg)) {
    return executionPhaseLabel(messageTimingData(msg), "zh-CN") ?? msg.senderName;
  }
  return (
    {
      webSearch: "联网搜索",
      web_search: "联网搜索",
      reasoning: "分析",
      terminal: "命令执行",
      file_change: "文件修改",
      plan: "规划",
      contextCompaction: "上下文整理",
      subagent: "子代理",
      subagent_wait: "等待子代理",
      subagent_activity: "子代理活动",
      subagent_message: "子代理消息",
      subagent_resume: "恢复子代理",
    } as Record<string, string>
  )[msg.senderName] ?? msg.senderName;
}

function isExecutionPhase(msg: Message): boolean {
  return msg.msgType === "status" &&
    ["agent_initialization", "execution_queue"].includes(String(msg.metadata?.execution_phase));
}

function toolLifecycleData(msg: Message): Record<string, unknown> | undefined {
  if (msg.msgType !== "tool_call") return undefined;
  const metadata = msg.metadata as Record<string, unknown> | undefined;
  const toolDetails = normalizeProcessToolDetails(metadata?.tool_details);
  const plan = normalizeProcessPlan(metadata?.plan);
  const toolCallId =
    typeof metadata?.tool_call_id === "string"
      ? metadata.tool_call_id
      : undefined;
  if (!toolCallId && !toolDetails && !plan) return undefined;
  return {
    ...(toolCallId
      ? {
          toolCallId,
          toolStatus: metadata?.tool_status,
          durationMs: metadata?.duration_ms,
        }
      : {}),
    ...(toolDetails ? { toolDetails } : {}),
    ...(plan ? { plan } : {}),
  };
}

function conversationItemData(
  msg: Message,
  answeredClarifyIds: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const existing = clarifyData(msg, answeredClarifyIds) ?? toolLifecycleData(msg);
  return {
    ...existing,
    ...messageTimingData(msg),
    ...(msg.senderName.endsWith(".thinking") ? { thinking: true } : {}),
  };
}

function inferredPhaseDurationMs(startedAt: string, stoppedAt?: string): number | undefined {
  if (!stoppedAt) return undefined;
  const start = Date.parse(startedAt);
  const stop = Date.parse(stoppedAt);
  if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < start) return undefined;
  return stop - start;
}

function settleOrphanedExecutionPhase(
  item: ConversationItem,
  msg: Message,
  conversationStatus: ConversationSnapshot["status"],
  stoppedAt?: string,
): ConversationItem {
  if (!isExecutionPhase(msg) || msg.metadata?.phase_status !== "running" ||
      !["completed", "failed", "cancelled"].includes(conversationStatus)) return item;
  const {
    phaseDurationMs: _phaseDurationMs,
    phaseDurationEstimated: _phaseDurationEstimated,
    phaseBoundary: _phaseBoundary,
    ...data
  } = item.data ?? {};
  if (conversationStatus === "completed") {
    return {
      ...item,
      status: "complete",
      title: executionPhaseLabel({ ...data, phaseStatus: "unavailable" }, "zh-CN"),
      data: { ...data, phaseStatus: "unavailable" },
    };
  }
  const durationMs = inferredPhaseDurationMs(msg.createdAt, stoppedAt);
  const failed = conversationStatus === "failed";
  return {
    ...item,
    status: failed ? "failed" : "cancelled",
    title: executionPhaseLabel({ ...data, phaseStatus: failed ? "failed" : "cancelled" }, "zh-CN"),
    data: {
      ...data,
      phaseStatus: failed ? "failed" : "cancelled",
      ...(data.executionPhase === "agent_initialization" ? { phaseBoundary: "core_terminated_before_ready" } : {}),
      ...(durationMs === undefined ? {} : {
        phaseDurationMs: durationMs,
        phaseDurationEstimated: true,
      }),
    },
  };
}

/** 旧视图的可见性规则收窄到 kind 上：空 tool_call / 纯状态行不产出 item。 */
function shouldEmit(msg: Message): boolean {
  // thinkingStatus is a transport-only placeholder. Older Core versions
  // archived it as plan, so hide those settled rows from historical snapshots.
  if (msg.metadata?.thinkingStatus === true && msg.msgType !== "streaming") {
    return false;
  }
  if (msg.msgType === "tool_call") {
    const metadata = msg.metadata as Record<string, unknown> | undefined;
    const metadataTool =
      typeof metadata?.tool === "string"
        ? metadata.tool.trim().toLowerCase()
        : "";
    if (
      msg.senderName.trim().toLowerCase() === "reasoning" ||
      metadataTool === "reasoning"
    ) {
      return false;
    }
    // clarify 的耗时完成行（"✓ 15.6s"，由 tool.complete 落库）对用户没有
    // 信息量，且会渲染成一张空交互卡 —— 丢弃。
    if (msg.senderName === "clarify") return !/^✓ [\d.]+m?s$/.test((msg.content || "").trim());
    return (msg.content || "").trim() !== "" || metadata?.tool_status === "running";
  }
  // "✓ 0.3s" 之类的纯完成状态行没有信息量，折叠条目里只会堆噪音。
  if (msg.msgType === "status") return isExecutionPhase(msg);
  return ["text", "result", "error", "tool_call", "streaming", "plan"].includes(msg.msgType);
}

function mapAttachments(m: Message): ConversationAttachment[] | undefined {
  const raw = m.metadata?.attachments;
  if (!Array.isArray(raw)) return undefined;
  const list = raw.filter(
    (a): a is MessageAttachment =>
      typeof a === "object" && a !== null && typeof (a as MessageAttachment).fileId === "string",
  );
  if (!list.length) return undefined;
  return list.map((a) => ({
    id: a.fileId,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    metadata: a.kind ? { kind: a.kind } : undefined,
  }));
}

/** Command transports may change; optimistic reconciliation stays in this adapter. */
export interface ConversationCommandHooks {
  send?: (input: string, attachments: AttachmentRef[] | undefined, options: { signal: AbortSignal }) => Promise<CommandResult>;
  stop?: (options: { signal: AbortSignal }) => Promise<CommandResult>;
}

export function createConversationAdapter(
  conversationId: () => string,
  commands: ConversationCommandHooks = {},
): ConversationAdapter {
  // 一个 adapter 实例只服务创建当下的会话。若在 await/SSE 生命周期中反复
  // 读取响应式 props.id，路由切换后 A 的迟到帧会被误记进 B 的缓存与事件。
  const conversationKey = conversationId();
  const key = () => conversationKey;
  const { send, stop } = commands;
  const navigation = conversationNavigation.forConversation(conversationKey);

  const versionTracker = createConversationStreamVersionTracker();
  let cursorHighWater: string | undefined;
  let conversationStatusRevision = 0;

  function toItem(msg: Message): ConversationItem {
    const lane = mapLane(msg);
    const isProcess = lane === "process";
    const status = mapStatus(msg);
    return {
      id: `msg-${msg.id}`,
      turnId: TURN_ID,
      streamId: `msg-${msg.id}`,
      lane,
      role:
        msg.senderName === "clarify" || msg.senderType === "agent"
          ? "assistant"
          : msg.senderType,
      kind: msg.msgType,
      content: safeMessageContent(msg, status),
      status,
      revision: 0, // 事件封装时由 per-stream version tracker 赋值
      seq: 0,
      timestamp: msg.createdAt,
      // process lane 条目必须显式标记 userReadable，否则 selectTurns 会过滤掉。
      // Agent initialization is an execution step and belongs in this lane.
      userReadable: isProcess ? true : undefined,
      title: isProcess ? processTitle(msg, status === "streaming") : undefined,
      data: conversationItemData(msg, answeredClarifyIdsFor(key())),
      attachments: mapAttachments(msg),
    };
  }

  function baseEventFields(conversationKey: string, item: ConversationItem, cursor: string) {
    return {
      protocolVersion: 2 as const,
      conversationKey,
      // eventId 必须每帧唯一：reducer 按 seenEventIds 去重，同 id 的第二帧
      //（流式更新）会被当重复事件丢弃。
      eventId: `${item.id}-r${item.revision}`,
      cursor,
      turnId: item.turnId,
      streamId: item.streamId,
      lane: item.lane,
      seq: item.seq,
      revision: item.revision,
      timestamp: item.timestamp,
    };
  }

  return {
    readCachedSnapshot: navigation.read,
    cacheSnapshot: navigation.write,
    async loadSnapshot(request: SnapshotRequest): Promise<ConversationSnapshot> {
      const [list, conversation] = await Promise.all([
        getMessages(key(), request.signal), getConversation(key()),
      ]).catch((error: unknown) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) navigation.forget();
        throw error;
      });
      request.signal?.throwIfAborted();
      if (!navigation.isCurrent()) throw new DOMException("Conversation session changed", "AbortError");
      const timing = snapshotTiming(conversation);
      // 模块级缓存必须按 conversation 隔离；快照是该会话的权威全量状态，
      // 每次重拉先清空旧桶，避免切换会话或重连后补发幽灵 thinking/clarify。
      const answeredClarifyIds = answeredClarifyIdsFor(key());
      answeredClarifyIds.clear();
      thinkingItemsByConversation.delete(key());
      executionPhaseItemsByConversation.delete(key());
      // 收集已回答的 clarify（快照里用户回答消息带 metadata.clarify_request_id）。
      for (const m of list) {
        const meta = m.metadata as Record<string, unknown> | undefined;
        if (m.senderType === "user" && typeof meta?.clarify_request_id === "string") {
          answeredClarifyIds.add(meta.clarify_request_id as string);
        }
      }
      // 每个 stream 的 revision/seq 都独立从 1 起；数组本身承载消息顺序。
      // 只有后面已经出现终态 answer 的 thinking 才是历史。尾部仍在生成的
      // thinking 必须保留 streaming，否则首次快照会把活跃过程误判为结束。
      const visibleMessages = list.filter(shouldEmit);
      const latestUserId = [...list].reverse().find((message) =>
        message.senderType === "user" && typeof message.metadata?.clarify_request_id !== "string",
      )?.id;
      const latestSettledAnswerIndex = visibleMessages.reduce(
        (latest, message, index) =>
          messageTimingData(message).runTerminal === true
            ? index
            : latest,
        -1,
      );
      const terminalByStep = new Map<string, {
        status: "completed" | "failed";
        stoppedAt: string;
      }>();
      for (const message of list) {
        const data = messageTimingData(message);
        if (data.runTerminal !== true || typeof data.runStepId !== "string") continue;
        terminalByStep.set(data.runStepId, {
          status: message.msgType === "error" ? "failed" : "completed",
          stoppedAt: message.createdAt,
        });
      }
      const items = visibleMessages.map((m, i) => {
        const base = toItem(m);
        const settledThinking =
          m.msgType === "streaming" &&
          m.senderName.endsWith(".thinking") &&
          i < latestSettledAnswerIndex;
        const finalStatus = settledThinking ? ("complete" as const) : base.status;
        const item = {
          ...base,
          content: safeMessageContent(m, finalStatus),
          status: finalStatus,
          // 历史思考行的标题用终态文案（"思考过程"）；工具行保留工具名。
          title:
            settledThinking ? thinkingTitle(false) : base.title,
          revision: 1,
          seq: 1,
          ...(m.id === latestUserId && timing.stoppedAt
            ? { data: { ...base.data, runStoppedAt: timing.stoppedAt } }
            : {}),
        };
        const phaseStep = typeof m.metadata?.step_id === "string" ? m.metadata.step_id : undefined;
        const stepTerminal = phaseStep ? terminalByStep.get(phaseStep) : undefined;
        const isCurrentStep = phaseStep !== undefined && phaseStep === conversation.executionStepId;
        const settled = stepTerminal
          ? settleOrphanedExecutionPhase(item, m, stepTerminal.status, stepTerminal.stoppedAt)
          : isCurrentStep
            ? settleOrphanedExecutionPhase(item, m, timing.status, timing.stoppedAt)
            : item;
        if (isExecutionPhase(m) && m.metadata?.phase_status === "running" &&
            settled.status === "streaming") executionPhaseItemsFor(key()).set(m.id, m);
        return settled;
      });
      versionTracker.seed(items);
      conversationStatusRevision = 0;
      cursorHighWater = snapshotMessageCursor(list);
      return {
        items,
        status: timing.status,
        hasOlder: false,
        cursor: cursorHighWater,
      };
    },

    async loadOlder(request: OlderPageRequest): Promise<ConversationPage> {
      void request;
      // 后端 messages 接口不支持分页；快照已含全部历史。
      return { items: [], hasOlder: false };
    },

    async *subscribe(request: SubscribeRequest): AsyncIterable<ConversationEvent> {
      cursorHighWater = request.cursor ?? cursorHighWater;
      for await (const ev of streamMessages(key(), request.signal, request.cursor)) {
        if (!ev.message) continue;
        cursorHighWater = advanceMessageCursor(cursorHighWater, ev.id);
        const msg = ev.message;
        if (ev.event === "message-deleted") {
          // 删除帧的 data 只有 {id}（router.go writeSSEEvent 的 Deleted 分支），
          // 不能走 toItem —— msg 无 createdAt/content，timestamp undefined 会被
          // 事件 schema 拒绝，整条 remove 被丢（resequence 的旧行就永远留在
          // 原位）。这里合成一个合法的最小 item。
          const id = `msg-${ev.id}`;
          // reducer 的版本规则是「恰好 +1」而非「更大」：remove 事件必须比该
          // item 当前版本正好大 1，否则判 duplicate（≤）或 gap（>1）而被丢。
          // adapter 的计数器与 item 当前版本同步（每次 upsert 双方同 +1），
          // 再 +1 即为合法的下一版本。计数器缺失（重连后第一条就是删除）
          // 视为该 item 尚未出现过，版本 1 合法。
          const nextVersion = versionTracker.next(id);
          yield {
            protocolVersion: 2 as const,
            conversationKey: key(),
            eventId: `rm-${id}-${nextVersion.revision}`,
            cursor: cursorHighWater,
            turnId: "main",
            streamId: id,
            lane: "system",
            seq: nextVersion.seq,
            revision: nextVersion.revision,
            timestamp: new Date().toISOString(),
            type: "item.remove" as const,
            itemId: id,
          };
          continue;
        }
        if (!shouldEmit(msg)) continue;
        const id = `msg-${msg.id}`;
        // 记录本轮 thinking 行（senderName 带 .thinking），答案终态时补发 complete。
        if (msg.msgType === "streaming" && msg.senderName.endsWith(".thinking")) {
          thinkingItemsFor(key()).set(msg.id, msg);
        }
        if (isExecutionPhase(msg)) {
          const phaseItems = executionPhaseItemsFor(key());
          if (msg.metadata?.phase_status === "running") phaseItems.set(msg.id, msg);
          else phaseItems.delete(msg.id);
        }
        // user 消息：按内容匹配 pending 乐观发送，补挂 clientMessageId
        // 让 reducer 替换（而非追加）乐观条目。
        let clientMessageId: string | undefined;
        if (msg.senderType === "user") {
          const meta = msg.metadata as Record<string, unknown> | undefined;
          if (typeof meta?.clarify_request_id === "string") {
            answeredClarifyIdsFor(key()).add(meta.clarify_request_id as string);
          }
        }
        if (msg.senderType === "user") {
          const prefix = `${key()}:`;
          for (const [k, content] of pendingSends) {
            if (k.startsWith(prefix) && content === msg.content) {
              clientMessageId = k.slice(prefix.length);
              pendingSends.delete(k);
              break;
            }
          }
        }
        const nextVersion = versionTracker.next(id);
        const item = {
          ...toItem(msg),
          revision: nextVersion.revision,
          seq: nextVersion.seq,
          clientMessageId,
        };
        yield {
          ...baseEventFields(key(), item, cursorHighWater),
          type: "item.upsert" as const,
          item,
        };
        // 主答案终态到达 → 本轮 thinking 行补发 complete。
        // 后端只 finalize 主答案（stream_upsert），thinking 行永远停留在
        // msg_type=streaming；不补发的话思考条的"进行中"状态（如呼吸动画）
        // 永不消失。
        if (
          item.data?.runTerminal === true
        ) {
          // thinking 行的 item id 形如 msg-<id>；从缓存补发
          const thinkingItems = thinkingItemsFor(key());
          for (const m of thinkingItems.values()) {
            const tid = `msg-${m.id}`;
            const doneVersion = versionTracker.next(tid);
            const done = {
              ...toItem(m),
              content: safeMessageContent(m, "complete"),
              status: "complete" as const,
              // 标题同步换成终态文案（toItem 按消息的 msgType=streaming
              // 会算出"思考中"，补发时必须覆盖为"思考过程"）。
              title: thinkingTitle(false),
              revision: doneVersion.revision,
              seq: doneVersion.seq,
            };
            yield {
              ...baseEventFields(key(), done, cursorHighWater),
              type: "item.upsert" as const,
              item: done,
            };
          }
          thinkingItems.clear();
          thinkingItemsByConversation.delete(key());

          // If a historical executor or a lost stream frame left initialization
          // running, stop its UI clock without claiming that readiness completed.
          const executionPhaseItems = executionPhaseItemsFor(key());
          for (const m of executionPhaseItems.values()) {
            if (m.metadata?.step_id !== item.data?.runStepId) continue;
            const phaseID = `msg-${m.id}`;
            const phaseVersion = versionTracker.next(phaseID);
            const settledPhase = {
              ...settleOrphanedExecutionPhase(
                toItem(m),
                m,
                msg.msgType === "error" ? "failed" : "completed",
                msg.createdAt,
              ),
              revision: phaseVersion.revision,
              seq: phaseVersion.seq,
            };
            yield {
              ...baseEventFields(key(), settledPhase, cursorHighWater),
              type: "item.upsert" as const,
              item: settledPhase,
            };
            executionPhaseItems.delete(m.id);
          }
          if (executionPhaseItems.size === 0) executionPhaseItemsByConversation.delete(key());

          conversationStatusRevision += 1;
          yield {
            protocolVersion: 2 as const,
            conversationKey: key(),
            eventId: `conversation-status-${msg.id}-${conversationStatusRevision}`,
            cursor: cursorHighWater,
            turnId: item.turnId,
            streamId: "conversation-status",
            lane: "system" as const,
            seq: conversationStatusRevision,
            revision: conversationStatusRevision,
            timestamp: msg.createdAt,
            type: "conversation.status" as const,
            status:
              msg.msgType === "error"
                ? ("failed" as const)
                : ("completed" as const),
          };
        }
      }
    },

    async execute(
      command: ConversationCommand,
      options: { signal: AbortSignal },
    ): Promise<CommandResult> {
      switch (command.type) {
        case "send": {
          const atts = command.attachments?.map((a) => ({ fileId: a.id, name: a.name }));
          // 必须在 await followUp 之前登记：后端在 follow-up HTTP 响应返回【前】
          // 就会向 SSE 通道 publish user 消息（svc.FollowUp 写库后立即
          // PublishCreated），若先 await 再登记，订阅循环处理 user 帧时
          // pendingSends 里还没有这条 → clientMessageId 挂不上 → 乐观条目
          // 不被替换（重复气泡）。
          const pendingKey = command.clientMessageId
            ? `${key()}:${command.clientMessageId}`
            : undefined;
          if (pendingKey) pendingSends.set(pendingKey, command.content);
          try {
            if (send) {
              const result = await send(command.content, atts, options);
              if ((!result.accepted || result.activeAccepted === false) && pendingKey) pendingSends.delete(pendingKey);
              return result;
            }
            await followUp(key(), command.content, atts);
          } catch (error) {
            // 发送失败：撤销登记，否则下一条同内容消息会误吞 clientMessageId。
            if (pendingKey) pendingSends.delete(pendingKey);
            throw error;
          }
          return { accepted: true };
        }
        case "stop": {
          if (stop) return stop(options);
          try {
            await cancelConversation(key());
          } catch (error) {
            // 后端对「未在执行」返回 404 —— 视为已停止，不向用户报错。
            if (!isIdempotentStopError(error)) throw error;
          }
          return { accepted: true };
        }
        case "interaction.respond": {
          // clarify 交互卡回答 → POST /conversation/:id/clarify。
          await respondClarify(key(), command.interactionId, String(command.value));
          answeredClarifyIdsFor(key()).add(command.interactionId);
          return { accepted: true };
        }
        default:
          // retry / rerun / feedback 后端暂无对应接口。
          return { accepted: false, message: "Unsupported command" };
      }
    },

    async uploadAttachment(file: File, options: UploadOptions): Promise<ConversationAttachment> {
      void options;
      const a = await uploadFile(file);
      return { id: a.fileId, name: a.name, mimeType: a.mimeType, size: a.size };
    },
  };
}
