import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  AssistantRuntimeProvider, AuiIf, useAuiState, useExternalStoreRuntime, type ExternalStoreAdapter, type ThreadMessageLike,
} from "@assistant-ui/react";
import { useActionBarCopy } from "@assistant-ui/core/react";
import { useMessagePartText, useSmooth } from "@assistant-ui/react";
import { renderMarkdown } from "@/addons/conversation/task-conversation/markdown";
import { formatProcessDuration } from "@/addons/conversation/task-conversation/vue/processPresentation";
import {
  ActionBarPrimitive, AttachmentPrimitive, ComposerPrimitive, MessagePrimitive, QueueItemPrimitive, SuggestionPrimitive, ThreadPrimitive,
} from "./auiPrimitives";
import { listProviders, listAllTypedModels, type Provider } from "@/contracts/model-catalog";
import { getConversation, listExecutionBackends, updateConversationSettings } from "@/addons/conversation/api/conversation";
import type { Conversation, CreateConversationRequest, ExecutionBackendOption, ModelChoice } from "@/addons/conversation/api/types";
import { freshDownloadUrl } from "@/addons/conversation/api/media";
import { conversationModelChoice } from "@/addons/conversation/composables/conversationModelRestore";
import { executionBackendCompatibility } from "@/addons/conversation/composables/executionBackendCompatibility";
import { modelErrorMessage } from "@/addons/conversation/composables/modelErrorMessage";
import { createConversationState, MAX_ATTACHMENTS, type ConversationLocale } from "@/addons/conversation/task-conversation/core";
import { openSealedLinkOnClick } from "./sealedLink";
import { copyRawBody, formatMessageTime } from "@/addons/conversation/components/conversation/messageCopy";
import { toast } from "@/composables/useToast";
import { formatAttachmentSize } from "@/addons/conversation/components/attachmentPresentation";
import { externalStore, sendAppend, type ChatController } from "./externalStore";
import { useSingleSlotQueue } from "./singleSlotQueue";
import { isRunning, type MediaPartData, type ProcessPartData, type ToolResult } from "./threadMessages";
import { choiceValue, modelGroups, type Choice, type Group } from "./modelGroups";
import { composerActions, moveFocus } from "./composerState";
import {
  AlertMark, AssistantMark, FileMark, CheckMark, ChevronMark, CopyMark, CrossMark, ToolMark, ImageMark, PlusMark, ReloadMark, SendMark, StopMark, VideoMark,
} from "./icons";
import { useCoreConversation } from "./useCoreConversation";
import { downloadFile, fileKind, storageAttachmentAdapter, type FileChip } from "./attachments";
import { toSuggestions } from "./suggestions";
import { fetchHomeSuggestions } from "./suggestions";
import "./chat.css";

export type Translate = (key: string, named?: Record<string, unknown>) => string;
/** A home suggestion card resolved for the locale (suggestions.ts). */
export interface ChatSuggestion { title: string; label: string; prompt: string }
export interface ChatProps {
  conversationId?: string;
  t: Translate;
  locale?: ConversationLocale;
  navigate(path: string): void;
  create(payload: CreateConversationRequest): Promise<Conversation>;
}

const EMPTY = createConversationState("new");

// Island-only strings live in the lazy chunk, not in the main i18n bundle (default-path size, plan §9).
const STRINGS: Record<ConversationLocale, Record<string, string>> = {
  "zh-CN": {
    stop: "停止", executor: "目鱼执行器", mediaLater: "（MVP 未接入）", pickerLabel: "模型与执行器",
    newPlaceholder: "描述你的任务", hint: "Enter 发送 · Shift + Enter 换行", queueSend: "加入待发送（当前回复结束后发出）",
    genImage: "生成图片", genVideo: "生成视频", mediaLaterTip: "生图 / 生视频本期未接入 React 聊天，请在旧版界面使用", attach: "添加附件", loading: "正在加载对话…", process: "执行过程",
    queued: "待发送 1 条", queuedRemove: "移除待发送消息", badUpdate: "消息格式异常，已跳过一条更新",
    reload: "重新生成", toBottom: "回到底部", earlier: "加载更早消息", running: "进行中", done: "完成", failed: "失败",
    query: "查询", sources: "来源", cancelled: "已停止", tool: "工具", mediaPending: "生成中…", mediaFailed: "生成失败", thinking: "正在思考…", greeting: "今天想完成什么？",
  },
  "en-US": {
    stop: "Stop", executor: "Executors", mediaLater: " (not in MVP)", pickerLabel: "Model and executor",
    newPlaceholder: "Describe your task", hint: "Enter to send · Shift + Enter for a new line", queueSend: "Queue (sent when the current reply ends)",
    genImage: "Generate image", genVideo: "Generate video", mediaLaterTip: "Image / video generation is not in the React chat yet; use the classic view", attach: "Add attachment", loading: "Loading conversation…", process: "Process",
    queued: "1 queued", queuedRemove: "Remove queued message", badUpdate: "Malformed message update skipped",
    reload: "Regenerate", toBottom: "Scroll to bottom", earlier: "Load earlier messages", running: "Running", done: "Done", failed: "Failed",
    query: "Query", sources: "Sources", cancelled: "Stopped", tool: "Tool", mediaPending: "Generating…", mediaFailed: "Generation failed", thinking: "Thinking…", greeting: "What can I help you finish today?",
  },
};
const withIslandStrings = (t: Translate, locale: ConversationLocale): Translate => (key, named) =>
  key.startsWith("chatReact.") ? STRINGS[locale][key.slice(10)] ?? key : t(key, named);

export function ChatApp(props: ChatProps) {
  const { conversationId } = props;
  const locale = props.locale ?? "zh-CN";
  const t = useMemo(() => withIslandStrings(props.t, locale), [props.t, locale]);
  const report = useMemo(() => (error: Error) => toast.error(error.name === "ZodError" ? t("chatReact.badUpdate") : modelErrorMessage(error, t)), [t]);
  const core = useCoreConversation(conversationId, report);
  const settings = useSettings(conversationId, t);
  const attachments = useMemo(() => storageAttachmentAdapter((file, message) => toast.error(`${file.name}: ${message}`)), []);
  const view = { locale, nowMs: useClock(!!core && core.state.status === "running") };
  const suggestions = useSuggestions(!conversationId, locale);

  const controller: ChatController = {
    send: (text, files) => core ? core.controller.send(text, files) : Promise.reject(new Error(t("chatReact.loading"))),
    stop: () => core?.controller.stop() ?? Promise.resolve(),
    loadOlder: () => core?.controller.loadOlder() ?? Promise.resolve(),
  };
  // Only an existing conversation queues; the new-chat composer is never running.
  const slot = useSingleSlotQueue(conversationId, !!core && isRunning(core.state), (m) => sendAppend(controller, m));
  const adapter: ExternalStoreAdapter<ThreadMessageLike> = conversationId
    ? externalStore(core?.state ?? EMPTY, controller, view, attachments, slot)
    : { ...externalStore(EMPTY, {
      async send(input, files) {
        if (!settings.allowed) throw new Error(t("common.executionBackendSelectionInvalid"));
        try {
          const created = await props.create({
            mode: "a2a_agent", input,
            model: settings.model?.model ?? "", providerId: settings.model?.providerId,
            executionBackend: settings.backend ?? undefined,
            ...(files?.length ? { attachments: files.map((f) => ({ fileId: f.id, name: f.name })) } : {}),
          });
          props.navigate(`/c/${created.id}`);
        } catch (error) {
          toast.error(modelErrorMessage(error, t, t("home.createFailed")));
          throw error;
        }
      },
      stop: () => Promise.resolve(),
    }, undefined, attachments), suggestions };
  const runtime = useExternalStoreRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="mc-root" data-conversation-key={conversationId ?? ""}>
        <ThreadPrimitive.Viewport className="mc-viewport">
          <AuiIf condition={(s) => s.thread.hasEarlier}>
            <ThreadPrimitive.LoadEarlier className="mc-earlier">{t("chatReact.earlier")}</ThreadPrimitive.LoadEarlier>
          </AuiIf>
          <ThreadPrimitive.Empty>
            {conversationId
              ? <p className="mc-empty">{core ? t("conversation.empty") : t("chatReact.loading")}</p>
              : <Welcome t={t} />}
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages>{({ message }) => <MessageRow role={message.role} t={t} />}</ThreadPrimitive.Messages>
          <ThreadPrimitive.ViewportFooter className="mc-footer">
            <ThreadPrimitive.ScrollToBottom className="mc-to-bottom" aria-label={t("chatReact.toBottom")} title={t("chatReact.toBottom")}>↓</ThreadPrimitive.ScrollToBottom>
            <Composer t={t} settings={settings}
              placeholder={conversationId ? t("conversation.inputPlaceholder") : t("chatReact.newPlaceholder")} />
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

/** New-chat empty state: greeting + the home suggestion cards (they only fill the composer, never send). */
export function Welcome({ t }: { t: Translate }) {
  return (
    <div className="mc-welcome">
      <h2 className="mc-welcome-title">{t("chatReact.greeting")}</h2>
      <div className="mc-suggestions">
        <ThreadPrimitive.Suggestions>
          {() => (
            <SuggestionPrimitive.Trigger className="mc-suggestion" send={false}>
              <SuggestionPrimitive.Title className="mc-suggestion-title" />
              <SuggestionPrimitive.Description className="mc-suggestion-desc" />
            </SuggestionPrimitive.Trigger>
          )}
        </ThreadPrimitive.Suggestions>
      </div>
    </div>
  );
}

/** Home suggestion cards for the new-chat empty state (fetched once; failure = no cards, like Home.vue). */
function useSuggestions(active: boolean, locale: string) {
  const [list, setList] = useState<ChatSuggestion[]>([]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    fetchHomeSuggestions().then((data) => live && setList(toSuggestions(data, locale)), () => {});
    return () => { live = false; };
  }, [active, locale]);
  return list;
}

/** Ticks once a second while a run is active so "已用 N 秒" moves, like the Vue view's process clock. */
function useClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * aui's copy action (text parts joined, stale-message guard, isCopied feedback) writing through the
 * shared session-guarded copyRawBody, so nothing is copied while the session revalidates (same as MessageItem.vue).
 */
function CopyAction({ t }: { t: Translate }) {
  const [failed, setFailed] = useState(false);
  const { copy, disabled, isCopied } = useActionBarCopy({
    copyToClipboard: async (text) => {
      setFailed(false);
      const result = await copyRawBody(text, () => true);
      if (result === "error") setFailed(true);
      if (result !== "copied") throw new Error("not copied");
    },
  });
  return (
    <>
      <button type="button" className="mc-icon-btn" aria-label={t("common.copy")} title={t("common.copy")} disabled={disabled} onClick={copy}
        data-copied={isCopied || undefined}>{isCopied ? <CheckMark /> : <CopyMark />}</button>
      <span className="mc-copy-status" role="status">{isCopied ? t("common.copied") : failed ? t("common.operationFailed") : ""}</span>
    </>
  );
}

/** Round "+" attach button; the cap matches Core's MAX_ATTACHMENTS like AttachmentPicker.vue's `max`. */
function AttachButton({ t }: { t: Translate }) {
  const count = useAuiState((s) => s.composer.attachments.length);
  const uploading = useAuiState((s) => s.composer.attachments.some((a) => a.status.type === "running"));
  const label = uploading ? t("common.attachmentUploading") : t("chatReact.attach");
  return (
    <ComposerPrimitive.AddAttachment className="mc-round" data-testid="mc-attach" title={label} aria-label={label}
      data-busy={uploading || undefined} disabled={count >= MAX_ATTACHMENTS}>
      <PlusMark />
    </ComposerPrimitive.AddAttachment>
  );
}

/** Old-Vue entry points kept visible; generation is not wired in the React MVP (no paid calls), so they only explain why. */
function MediaPill({ kind, t }: { kind: "image" | "video"; t: Translate }) {
  const tip = t("chatReact.mediaLaterTip");
  return (
    <button type="button" className="mc-pill mc-pill--off" aria-disabled="true" title={tip} data-testid={`mc-gen-${kind}`}
      onClick={() => toast.info(tip)}>
      {kind === "image" ? <ImageMark /> : <VideoMark />}<span className="mc-pill-text">{t(kind === "image" ? "chatReact.genImage" : "chatReact.genVideo")}</span>
    </button>
  );
}

export type Settings = Pick<ReturnType<typeof useSettings>, "groups" | "model" | "backend" | "busy" | "pick">;

/**
 * Composer on aui primitives: autosize Input (1–8 rows), AddAttachment, Send (aui disables it while
 * empty), Cancel as the stop square while running, and a queue button once there is text during a run.
 */
export function Composer({ t, settings, placeholder }: { t: Translate; settings: Settings; placeholder: string }) {
  const running = useAuiState((s) => s.thread.isRunning);
  const empty = useAuiState((s) => s.composer.isEmpty);
  const actions = composerActions(running, empty);
  return (
    <ComposerPrimitive.AttachmentDropzone className="mc-dropzone">
      <ComposerPrimitive.Root className="mc-composer">
        <ComposerAttachmentChips t={t} />
        <ComposerPrimitive.Queue>
          {() => (
            <div className="mc-queued" data-testid="mc-queued">
              <span className="mc-queued-label">{t("chatReact.queued")}</span>
              <QueueItemPrimitive.Text className="mc-queued-text" />
              <QueueItemPrimitive.Remove className="mc-chip-remove" aria-label={t("chatReact.queuedRemove")} title={t("chatReact.queuedRemove")}>×</QueueItemPrimitive.Remove>
            </div>
          )}
        </ComposerPrimitive.Queue>
        <ComposerPrimitive.Input className="mc-input" minRows={1} maxRows={8} autoFocus placeholder={placeholder} aria-label={placeholder} />
        <div className="mc-toolbar">
          <AttachButton t={t} />
          <MediaPill kind="image" t={t} />
          <MediaPill kind="video" t={t} />
          <ModelMenu t={t} groups={settings.groups} value={settings.model ? choiceValue({ kind: "chat", model: settings.model }) : ""}
            backend={settings.backend} disabled={settings.busy} onPick={settings.pick} />
          <span className="mc-spacer" />
          {actions.includes("send") && (
            <ComposerPrimitive.Send className="mc-send" data-testid="mc-send" aria-label={t("common.send")} title={t("common.send")}><SendMark /></ComposerPrimitive.Send>
          )}
          {actions.includes("queue") && (
            <ComposerPrimitive.Send className="mc-round" data-testid="mc-send" aria-label={t("chatReact.queueSend")} title={t("chatReact.queueSend")}><SendMark /></ComposerPrimitive.Send>
          )}
          {actions.includes("stop") && (
            <ComposerPrimitive.Cancel className="mc-send mc-send--stop" data-testid="mc-stop" aria-label={t("chatReact.stop")} title={t("chatReact.stop")}><StopMark /></ComposerPrimitive.Cancel>
          )}
        </div>
      </ComposerPrimitive.Root>
      <p className="mc-hint">{t("chatReact.hint")}</p>
    </ComposerPrimitive.AttachmentDropzone>
  );
}

function ComposerAttachmentChips({ t }: { t: Translate }) {
  return (
    <div className="mc-chips">
      <ComposerPrimitive.Attachments>
        {({ attachment }) => (
          <AttachmentPrimitive.Root className="mc-chip" data-status={attachment.status.type}>
            <span className="mc-chip-icon"><FileMark kind={fileKind(attachment.name, attachment.contentType)} /></span>
            <span className="mc-chip-name" title={attachment.name}><AttachmentPrimitive.Name /></span>
            {attachment.status.type === "running"
              ? <span className="mc-chip-meta">{Math.round(("progress" in attachment.status ? attachment.status.progress : 0) * 100)}%</span>
              : attachment.file?.size ? <span className="mc-chip-meta">{formatAttachmentSize(attachment.file.size)}</span> : null}
            {attachment.status.type === "incomplete" && <span className="mc-chip-meta" role="status">{t("common.attachmentUploadFailed")}</span>}
            <AttachmentPrimitive.Remove className="mc-chip-remove" aria-label={t("common.attachmentRemove")} title={t("common.attachmentRemove")}><CrossMark size={12} /></AttachmentPrimitive.Remove>
          </AttachmentPrimitive.Root>
        )}
      </ComposerPrimitive.Attachments>
    </div>
  );
}

/**
 * A stored file (sent attachment or produced file): type icon, truncated name, size; verified files
 * download through the same Storage path as AttachmentChips.vue. Unverified ones show the state only
 * (shortcut: no 重新核验 button; the Vue view's revalidate hook is not wired into the island).
 */
export function FileChipView({ file, t }: { file: FileChip; t: Translate }) {
  const [busy, setBusy] = useState(false);
  const icon = <span className="mc-chip-icon"><FileMark kind={fileKind(file.name, file.mimeType)} /></span>;
  const size = file.size ? <span className="mc-chip-meta">{formatAttachmentSize(file.size)}</span> : null;
  if (!file.verified) {
    return <span className="mc-chip" data-verified="false" title={file.name}>{icon}<span className="mc-chip-name">{file.name}</span>{size}<span className="mc-chip-meta" role="status">{t("common.attachmentVerificationFailed")}</span></span>;
  }
  const download = () => {
    setBusy(true);
    downloadFile(file).catch(() => toast.error(t("common.attachmentDownloadFailed"))).finally(() => setBusy(false));
  };
  return (
    <button type="button" className="mc-chip mc-chip--link" title={`${t("common.attachmentDownload")} ${file.name}`} aria-busy={busy || undefined} disabled={busy} onClick={download}>
      {icon}<span className="mc-chip-name">{file.name}</span>{size}
    </button>
  );
}

/** Sent attachments on a user message (chip data from threadMessages.ts). */
const MessageAttachmentChips = ({ t }: { t: Translate }) => (
  <div className="mc-chips mc-chips--sent">
    <MessagePrimitive.Attachments>
      {({ attachment }) => {
        const chip = (attachment as { chip?: FileChip }).chip ?? { id: attachment.id, name: attachment.name, verified: false };
        return <AttachmentPrimitive.Root className="mc-chip-slot"><FileChipView file={chip} t={t} /></AttachmentPrimitive.Root>;
      }}
    </MessagePrimitive.Attachments>
  </div>
);

/**
 * Markdown body: aui's text part + smooth streaming (useMessagePartText/useSmooth), rendered by the
 * same markdown-it + DOMPurify policy as MarkdownContent.vue (task-conversation/markdown.ts), which the
 * default Vue chunk already ships; sealed tool links open through Core (openSealedLinkOnClick).
 */
function MarkdownText({ t }: { t: Translate }) {
  const { text, status } = useSmooth(useMessagePartText());
  const html = useMemo(() => renderMarkdown(text), [text]);
  const root = useRef<HTMLDivElement>(null);
  // Copy buttons are our own nodes added after sanitizing (DOMPurify still forbids <button> in replies); one delegated click handler.
  useEffect(() => { if (root.current) addCodeCopyButtons(root.current, t("common.copy")); }, [html, t]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const button = (e.target as Element).closest?.("button.mc-code-copy");
    if (!button) return void openSealedLinkOnClick(e.nativeEvent);
    const code = button.parentElement?.querySelector("code")?.textContent ?? "";
    void copyRawBody(code, () => button.isConnected).then((r) => {
      if (!r) return;
      button.setAttribute("data-state", r);
      button.textContent = r === "copied" ? t("common.copied") : t("common.operationFailed");
      setTimeout(() => { button.removeAttribute("data-state"); button.textContent = t("common.copy"); }, 1500);
    });
  };
  return <div ref={root} className="mc-md" data-status={status.type} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Adds one text-only copy button to each fenced code block (idempotent; text set via textContent, never HTML). */
export function addCodeCopyButtons(root: ParentNode, label: string) {
  for (const pre of root.querySelectorAll("pre")) {
    if (pre.querySelector(":scope > button.mc-code-copy")) continue;
    const button = pre.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "mc-code-copy";
    button.textContent = label;
    button.setAttribute("aria-label", label);
    pre.prepend(button);
  }
}

/** Core step status (threadMessages.ts stores it in providerMetadata.core) → the four states the UI shows. */
type StepState = "running" | "done" | "failed" | "cancelled";
export const stepState = (core: unknown, aui: { type: string }, isError?: boolean): StepState => {
  if (core === "pending" || core === "streaming") return "running";
  if (core === "failed" || isError) return "failed";
  if (core === "cancelled") return "cancelled";
  return core === undefined && aui.type === "running" ? "running" : "done";
};
const coreStatus = (part: { providerMetadata?: unknown }) => (part.providerMetadata as { core?: { status?: string } } | undefined)?.core?.status;
const elapsed = (timing?: { startedAt: number; completedAt?: number }) =>
  timing?.completedAt === undefined ? "" : formatProcessDuration(timing.completedAt - timing.startedAt);

const StepIcon = ({ state }: { state: StepState }) => (
  <span className="mc-step-icon" data-state={state} aria-hidden="true">
    {state === "running" ? <span className="mc-spinner" /> : state === "failed" ? <AlertMark size={13} /> : state === "cancelled" ? <CrossMark size={12} /> : <CheckMark size={13} />}
  </span>
);

/** One row of the 执行过程 list: status icon, name, (tool tag), duration, then the step's summary or tool outcome. */
function Step({ state, name, tool, duration, t, children }: { state: StepState; name: string; tool?: boolean; duration: string; t: Translate; children?: ReactNode }) {
  return (
    <div className="mc-step" data-state={state}>
      <div className="mc-step-head">
        <StepIcon state={state} />
        <span className="mc-step-name">{name}</span>
        {tool && <span className="mc-step-tag"><ToolMark />{t("chatReact.tool")}</span>}
        {state !== "done" && <span className="mc-step-state">{t(`chatReact.${state}`)}</span>}
        {duration && <span className="mc-step-time">{duration}</span>}
      </div>
      {children}
    </div>
  );
}

/** Generic Core tool step: name, state, duration and the outcome (query / sources / text). Core sends no args. */
function ToolStep({ part, t }: { part: { toolName: string; result?: unknown; isError?: boolean; status: { type: string }; timing?: { startedAt: number; completedAt?: number }; providerMetadata?: unknown }; t: Translate }) {
  const r = part.result as ToolResult | undefined;
  const sources = (r?.sources ?? []).filter((s) => s.url && /^https?:\/\//i.test(s.url));
  return (
    <Step state={stepState(coreStatus(part), part.status, part.isError)} name={part.toolName} tool duration={elapsed(part.timing)} t={t}>
      {r?.query && <p className="mc-step-detail"><b>{t("chatReact.query")}</b> {r.query}</p>}
      {sources.length > 0 && (
        <ul className="mc-tool-sources" aria-label={t("chatReact.sources")}>
          {sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.domain || s.url}</a></li>)}
        </ul>
      )}
      {r?.content && <pre className="mc-step-detail">{r.content}</pre>}
    </Step>
  );
}

/** Image/video produced by a media generation task: a fresh signed link per render (never cached). */
function MediaCard({ data, t }: { data: MediaPartData; t: Translate }) {
  const [url, setUrl] = useState<string | null>(null);
  const taskId = data.media.taskId;
  useEffect(() => {
    let live = true;
    if (!data.failed && typeof taskId === "number") freshDownloadUrl(taskId).then((u) => live && setUrl(u), () => {});
    return () => { live = false; };
  }, [taskId, data.failed]);
  if (data.failed) return <p className="mc-media mc-media--failed" role="status">{t("chatReact.mediaFailed")}</p>;
  if (!url) return <p className="mc-media" role="status">{t("chatReact.mediaPending")}</p>;
  return data.media.kind === "video"
    ? <video className="mc-media" src={url} controls preload="metadata" />
    : <a href={url} target="_blank" rel="noopener noreferrer"><img className="mc-media" src={url} alt={data.prompt} /></a>;
}

/** Contiguous Core process steps (the header part + reasoning/tool-call parts) render as one 执行过程 fold. */
const groupBy = (part: { type: string }) =>
  part.type === "data" || part.type === "reasoning" || part.type === "tool-call"
    ? (part.type === "data" && (part as { name?: string }).name !== "process" ? null : ["group-process" as const])
    : null;

/** The 执行过程 fold: GroupedParts puts the header <summary> and the step rows in it. Opens while the run is live, like the Vue view. */
function ProcessFold({ running, children }: { running: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(running);
  useEffect(() => { if (running) setOpen(true); }, [running]);
  return (
    <details className="mc-process" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      {children}
    </details>
  );
}

function Parts({ t }: { t: Translate }) {
  return (
    <MessagePrimitive.GroupedParts groupBy={groupBy} indicator="empty">
      {({ part, children }) => {
        switch (part.type) {
          case "group-process":
            return <ProcessFold running={part.status.type === "running"}>{children}</ProcessFold>;
          case "indicator":
            return <p className="mc-thinking" role="status">{t("chatReact.thinking")}</p>;
          case "text":
            return <MarkdownText t={t} />;
          case "reasoning": {
            const [title, ...rest] = part.text.split("\n");
            return (
              <Step state={stepState(coreStatus(part), part.status)} name={title ?? ""} duration={elapsed(part.timing)} t={t}>
                {rest.length > 0 && <pre className="mc-step-detail">{rest.join("\n")}</pre>}
              </Step>
            );
          }
          case "tool-call":
            return <ToolStep part={part} t={t} />;
          case "data":
            if (part.name === "process") {
              const data = part.data as ProcessPartData;
              return (
                <summary className="mc-process-head" data-status={data.status} aria-label={`${t("chatReact.process")} · ${data.summary}`}>
                  <span className="mc-process-chevron"><ChevronMark /></span>
                  <span className="mc-process-dot" aria-hidden="true" />
                  <span className="mc-process-label">{t("chatReact.process")}</span>
                  {data.status === "failed" && <span className="mc-process-alert"><AlertMark /></span>}
                  <span className="mc-process-summary">{data.summary}</span>
                  {data.timing && <span className="mc-process-timing">{data.timing}</span>}
                </summary>
              );
            }
            if (part.name === "media") return <MediaCard data={part.data as MediaPartData} t={t} />;
            if (part.name === "files") {
              return <div className="mc-chips mc-chips--sent">{(part.data as unknown as FileChip[]).map((f) => <FileChipView key={f.id} file={f} t={t} />)}</div>;
            }
            return <></>;
          default:
            return <></>;
        }
      }}
    </MessagePrimitive.GroupedParts>
  );
}

/**
 * One message: small avatar + name (exact time only on hover, via title and a hover-revealed stamp),
 * the bubble (brand gradient for the user, frameless for the assistant), and aui's ActionBar under it.
 * The bar stays in the DOM and is shown by CSS on hover or keyboard focus (aui autohide only tracks the
 * pointer), and always on the last reply.
 */
export function MessageRow({ role, t }: { role: string; t: Translate }) {
  const createdAt = useAuiState((s) => s.message.createdAt);
  const failed = useAuiState((s) => (s.message.metadata.custom as { failed?: boolean }).failed === true);
  const isLast = useAuiState((s) => s.message.isLast);
  const isUser = role === "user";
  const time = formatMessageTime(createdAt?.toISOString());
  const author = isUser ? t("conversation.you") : t("home.greeting");
  return (
    <MessagePrimitive.Root className="mc-msg" data-message-role={role} data-failed={failed || undefined} data-last={isLast || undefined}>
      <div className="mc-header">
        <span className="mc-avatar" aria-hidden="true">{isUser ? t("conversation.you") : <AssistantMark />}</span>
        <span className="mc-author" title={time || undefined}>{author}</span>
        {time && <time className="mc-time" dateTime={createdAt?.toISOString()}>{time}</time>}
      </div>
      <div className="mc-bubble">
        <Parts t={t} />
        {isUser && <MessageAttachmentChips t={t} />}
      </div>
      <ActionBarPrimitive.Root className="mc-actions" hideWhenRunning autohide="never">
        <CopyAction t={t} />
        {!isUser && (
          <ActionBarPrimitive.Reload className="mc-icon-btn" aria-label={t("chatReact.reload")} title={t("chatReact.reload")}><ReloadMark /></ActionBarPrimitive.Reload>
        )}
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

/**
 * Model + executor menu over modelGroups.ts (chat / image / video / executor). A popover of
 * menuitemradio buttons: arrows/Home/End move, Enter/Space pick, Escape or an outside click closes.
 * Image/video models are listed but not pickable in the MVP (no paid calls).
 */
export function ModelMenu(props: { t: Translate; groups: Group[]; value: string; backend: string | null; disabled: boolean; onPick(choice: Choice | null): void; defaultOpen?: boolean }) {
  const { t, groups } = props;
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const backendValue = props.backend ? choiceValue({ kind: "executor", backend: props.backend }) : "";
  const options = groups.flatMap((g) => g.options);
  const model = options.find((o) => o.value === props.value)?.label.split(" · ").pop() ?? t("common.modelDefault");
  const executor = options.find((o) => o.value === backendValue)?.label;
  const label = (g: Group) => (g.kind === "executor" ? t("chatReact.executor") : t(`model.types.${g.kind}`));
  const items = () => [...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]:not([aria-disabled=true])") ?? [])];

  useEffect(() => {
    if (!open) return;
    (items().find((b) => b.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const shut = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (choice: Choice | null) => { shut(); props.onPick(choice); };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape" || e.key === "Tab") { if (e.key === "Escape") e.preventDefault(); shut(); return; }
    const list = items();
    const next = moveFocus(list.length, list.indexOf(document.activeElement as HTMLButtonElement), e.key);
    if (next !== null) { e.preventDefault(); list[next]!.focus(); }
  };
  const item = (key: string, text: string, checked: boolean, onSelect: (() => void) | null) => (
    <button key={key} type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item" aria-checked={checked}
      aria-disabled={onSelect ? undefined : true} onClick={onSelect ?? undefined}>
      <span className="mc-menu-text">{text}</span>{checked && <CheckMark size={14} />}
    </button>
  );
  return (
    <div className="mc-model" ref={root} onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" className="mc-pill mc-model-trigger" data-testid="mc-model" aria-haspopup="menu" aria-expanded={open}
        title={t("chatReact.pickerLabel")} disabled={props.disabled} onClick={() => setOpen((v) => !v)}>
        <span className="mc-model-name">{model}</span>{executor && <span className="mc-model-exec">· {executor}</span>}<ChevronMark size={12} />
      </button>
      <div className="mc-menu" role="menu" aria-label={t("chatReact.pickerLabel")} data-testid="mc-model-menu" hidden={!open}>
        {item("default", t("common.modelDefault"), props.value === "", () => choose(null))}
        {groups.map((g) => {
          const media = g.kind === "image" || g.kind === "video";
          return (
            <div key={g.kind} role="group" aria-label={label(g)} data-kind={g.kind} className="mc-menu-group">
              <div className="mc-menu-label" aria-hidden="true">{label(g)}{media ? t("chatReact.mediaLater") : ""}</div>
              {g.options.map((o) => item(o.value, o.label, o.value === (g.kind === "executor" ? backendValue : props.value),
                media ? null : () => choose(o.choice)))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Model + executor of this conversation (or of the next new one); PATCH on change like Conversation.vue. */
function useSettings(conversationId: string | undefined, t: Translate) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [backends, setBackends] = useState<ExecutionBackendOption[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [model, setModel] = useState<ModelChoice | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let live = true;
    setBusy(true);
    void Promise.all([
      listProviders().catch(() => [] as Provider[]),
      listAllTypedModels().catch(() => null),
      listExecutionBackends().catch(() => [] as ExecutionBackendOption[]),
      conversationId ? getConversation(conversationId).catch(() => null) : Promise.resolve(null),
    ]).then(([p, typed, b, conversation]) => {
      if (!live) return;
      setProviders(p); setBackends(b); setGroups(modelGroups(p, typed, b));
      setModel(conversation ? conversationModelChoice(conversation) : null);
      setBackend(conversation?.executionBackend?.trim() || b.find((x) => x.default)?.id || b[0]?.id || null);
      setBusy(false);
    });
    return () => { live = false; };
  }, [conversationId]);

  const allowedFor = (m: ModelChoice | null, id: string | null) => {
    const option = backends.find((b) => b.id === id);
    return !option || executionBackendCompatibility(option, m, providers).allowed;
  };

  async function pick(choice: Choice | null) {
    const nextModel = choice === null ? null : choice.kind === "chat" ? choice.model : model;
    const nextBackend = choice?.kind === "executor" ? choice.backend : backend;
    if (choice && choice.kind !== "chat" && choice.kind !== "executor") return;
    if (!allowedFor(nextModel, nextBackend)) { toast.warning(t("common.executionBackendSelectionInvalid")); return; }
    if (!conversationId || !nextBackend) { setModel(nextModel); setBackend(nextBackend); return; }
    setBusy(true);
    try {
      const saved = await updateConversationSettings(conversationId, nextModel, nextBackend);
      setModel(conversationModelChoice(saved) ?? nextModel);
      setBackend(saved.executionBackend?.trim() || nextBackend);
      toast.success(t("common.executionSettingsSwitched"));
    } catch (error) {
      toast.error(modelErrorMessage(error, t, t("common.executionSettingsSwitchFailed")));
    } finally {
      setBusy(false);
    }
  }

  return { groups, model, backend, busy, pick, allowed: allowedFor(model, backend) };
}
