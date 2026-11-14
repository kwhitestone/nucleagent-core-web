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
import { listProviders, listAllTypedModels, type Provider, type TypedModel } from "@/contracts/model-catalog";
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
import { externalStore, sendAppend, type ChatController } from "./externalStore";
import { useSingleSlotQueue } from "./singleSlotQueue";
import { isRunning, type MediaPartData, type ProcessPartData, type ToolResult } from "./threadMessages";
import { choiceValue, modelGroups, type Choice, type Group } from "./modelGroups";
import { composerActions, moveFocus } from "./composerState";
import {
  AlertMark, AssistantMark, FileMark, CheckMark, ChevronMark, CopyMark, CrossMark, ToolMark, ImageMark, PlusMark, ReloadMark, SendMark, StopMark, VideoMark,
} from "./icons";
import { useCoreConversation } from "./useCoreConversation";
import { downloadFile, fileKind, formatSize, storageAttachmentAdapter, type FileChip } from "./attachments";
import { toSuggestions } from "./suggestions";
import { fetchHomeSuggestions } from "./suggestions";
import type { IslandStrings } from "./islandStringsZh";
import { loadChatStrategy, cachedChatStrategy, initialChatModel, measurementHint, imageGuidance, type ChatStrategy } from "./chatStrategy";
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
  /** Island strings for `locale`, loaded by mount.tsx. */
  strings: IslandStrings;
}

const EMPTY = createConversationState("new");

// Island-only strings stay out of the main i18n bundle (default-path size, plan §9) and out of the island:
// only the current language's chunk is downloaded (islandStrings*.ts, loaded by mount.tsx).
const withIslandStrings = (t: Translate, strings: Record<string, string>): Translate => (key, named) =>
  key.startsWith("chatReact.") ? strings[key.slice(10)] ?? key : t(key, named);

export function ChatApp(props: ChatProps) {
  const { conversationId } = props;
  const locale = props.locale ?? "zh-CN";
  const t = useMemo(() => withIslandStrings(props.t, props.strings), [props.t, props.strings]);
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
        if (settings.busy) throw new Error(t("chatReact.loading"));
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

export type Settings = Pick<ReturnType<typeof useSettings>, "groups" | "model" | "backend" | "busy" | "pick"> & { imageHint?: string; modelHint?: string };

/**
 * Composer on aui primitives: autosize Input (1–8 rows), AddAttachment, Send (aui disables it while
 * empty), Cancel as the stop square while running, and a queue button once there is text during a run.
 */
export function Composer({ t, settings, placeholder }: { t: Translate; settings: Settings; placeholder: string }) {
  const hasImage = useAuiState((s) => s.composer.attachments.some((attachment) => attachment.type === "image" || attachment.contentType?.startsWith("image/")));
  const running = useAuiState((s) => s.thread.isRunning);
  const empty = useAuiState((s) => s.composer.isEmpty);
  const actions = composerActions(running, empty);
  return (
    <ComposerPrimitive.AttachmentDropzone className="mc-dropzone">
      <ComposerPrimitive.Root className="mc-composer">
        <ComposerAttachmentChips t={t} />
        {hasImage && settings.imageHint && <p className="mc-hint" role="status">{settings.imageHint}</p>}
        <ComposerPrimitive.Queue>
          {() => (
            <div className="mc-queued" data-testid="mc-queued">
              <span className="mc-queued-label">{t("chatReact.queued")}</span>
              <QueueItemPrimitive.Text className="mc-queued-text" />
              <QueueItemPrimitive.Remove className="mc-chip-remove" aria-label={t("chatReact.queuedRemove")} title={t("chatReact.queuedRemove")}>×</QueueItemPrimitive.Remove>
            </div>
          )}
        </ComposerPrimitive.Queue>
        <ComposerPrimitive.Input className="mc-input" rows={1} minRows={1} maxRows={8} autoFocus placeholder={placeholder} aria-label={placeholder} />
        <div className="mc-toolbar">
          <AttachButton t={t} />
          <MediaPill kind="image" t={t} />
          <MediaPill kind="video" t={t} />
          <ModelMenu t={t} groups={settings.groups} value={settings.model ? choiceValue({ kind: "chat", model: settings.model }) : ""}
            backend={settings.backend} disabled={settings.busy} onPick={settings.pick} />
          <span className="mc-spacer" />
          {actions.includes("send") && (
            <ComposerPrimitive.Send className="mc-send" data-testid="mc-send" disabled={settings.busy} aria-label={t("common.send")} title={t("common.send")}><SendMark /></ComposerPrimitive.Send>
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
      {settings.modelHint && <p className="mc-hint" role="status">{settings.modelHint}</p>}
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
              : attachment.file?.size ? <span className="mc-chip-meta">{formatSize(attachment.file.size)}</span> : null}
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
  const size = file.size ? <span className="mc-chip-meta">{formatSize(file.size)}</span> : null;
  if (!file.verified) {
    return <span className="mc-chip" data-verified="false" title={file.name}>{icon}<span className="mc-chip-name">{file.name}</span>{size}<span className="mc-chip-meta" role="status">{t("chatReact.attachmentPending")}</span></span>;
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
    const code = button.parentElement?.nextElementSibling?.querySelector("code")?.textContent ?? "";
    void copyRawBody(code, () => button.isConnected).then((r) => {
      if (!r) return;
      button.setAttribute("data-state", r);
      button.textContent = r === "copied" ? t("common.copied") : t("common.operationFailed");
      setTimeout(() => { button.removeAttribute("data-state"); button.textContent = t("common.copy"); }, 1500);
    });
  };
  return <div ref={root} className="mc-md" data-status={status.type} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Post-sanitize decoration (our own nodes; DOMPurify still forbids <button> in replies), idempotent:
 * a header (language label + copy button) above each fenced code block, and a scroll box around each
 * table so it can fill the column yet scroll when too wide. Text set via textContent, never HTML.
 */
export function addCodeCopyButtons(root: ParentNode, label: string) {
  for (const pre of root.querySelectorAll("pre")) {
    if (pre.previousElementSibling?.classList.contains("mc-code-head")) continue;
    const doc = pre.ownerDocument;
    const head = Object.assign(doc.createElement("div"), { className: "mc-code-head" });
    const lang = Object.assign(doc.createElement("span"), { className: "mc-code-lang" });
    lang.textContent = /language-([\w+#-]+)/.exec(pre.querySelector("code")?.className ?? "")?.[1] ?? "";
    const button = Object.assign(doc.createElement("button"), { type: "button", className: "mc-code-copy" });
    button.textContent = label;
    button.setAttribute("aria-label", label);
    head.append(lang, button);
    pre.before(head);
  }
  for (const table of root.querySelectorAll("table")) {
    if (table.parentElement?.classList.contains("mc-table-wrap")) continue;
    const wrap = Object.assign(table.ownerDocument.createElement("div"), { className: "mc-table-wrap" });
    table.before(wrap);
    wrap.append(table);
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
const coreStatus = (part: object) => ((part as { providerMetadata?: unknown }).providerMetadata as { core?: { status?: string } } | undefined)?.core?.status;
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
  const video = data.media.kind === "video";
  if (data.failed || !url) {
    return (
      <div className="mc-media mc-media--slot" data-failed={data.failed || undefined} role="status">
        <span className="mc-media-icon">{data.failed ? <AlertMark size={20} /> : video ? <VideoMark size={20} /> : <ImageMark size={20} />}</span>
        <span>{t(data.failed ? "chatReact.mediaFailed" : "chatReact.mediaPending")}</span>
        {data.prompt && <span className="mc-media-prompt">{data.prompt}</span>}
      </div>
    );
  }
  return video
    ? <video className="mc-media" src={url} controls preload="metadata" />
    : <a href={url} target="_blank" rel="noopener noreferrer"><img className="mc-media" src={url} alt={data.prompt} /></a>;
}

/** Contiguous Core process steps (the header part + reasoning/tool-call parts) render as one 执行过程 fold. */
const groupBy = (part: { type: string }) =>
  part.type === "data" || part.type === "reasoning" || part.type === "tool-call"
    ? (part.type === "data" && (part as { name?: string }).name !== "process" ? null : ["group-process" as const])
    : null;

/**
 * 执行过程 defaults: open while running or after a failure; after a failure the successful steps fold
 * into one "N 步成功" row so the failed step is what shows.
 */
export function foldView(states: readonly StepState[], running: boolean) {
  const failed = !running && states.includes("failed");
  const done = states.filter((s) => s === "done").length;
  return { open: running || failed, hideDone: failed && done > 0, done };
}

/** The 执行过程 fold over one GroupedParts group: it renders the header itself (from the data-process part) so it owns aria-expanded. */
function ProcessFold({ indices, running, t, children }: { indices: readonly number[]; running: boolean; t: Translate; children: ReactNode }) {
  const parts = useAuiState((s) => s.message.parts);
  const group = indices.map((i) => parts[i]!);
  const head = (group.find((p) => p.type === "data" && p.name === "process") as { data?: ProcessPartData } | undefined)?.data;
  const view = foldView(group.filter((p) => p.type !== "data").map((p) => stepState(coreStatus(p), p.status, (p as { isError?: boolean }).isError)), running);
  const [open, setOpen] = useState(view.open);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => { if (view.open) setOpen(true); }, [view.open]);
  const failed = head?.status === "failed";
  return (
    <details className="mc-process" data-status={head?.status} data-hide-done={(view.hideDone && !showDone) || undefined} open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="mc-process-head" aria-expanded={open} aria-label={`${t("chatReact.process")} · ${head?.summary ?? ""}`}>
        <span className="mc-process-chevron"><ChevronMark size={16} /></span>
        {failed ? <span className="mc-process-alert"><AlertMark /></span> : <span className="mc-process-dot" aria-hidden="true" />}
        <span className="mc-process-label">{t("chatReact.process")}</span>
        <span className="mc-process-summary">{head?.summary}</span>
        {head?.timing && <span className="mc-process-timing">{head.timing}</span>}
      </summary>
      {view.hideDone && !showDone && (
        <button type="button" className="mc-step-more" onClick={() => setShowDone(true)}><CheckMark size={13} />{`${view.done} ${t("chatReact.doneSteps")}`}</button>
      )}
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
            return <ProcessFold indices={part.indices} running={part.status.type === "running"} t={t}>{children}</ProcessFold>;
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
            // The header is drawn by ProcessFold.
            if (part.name === "process") return <></>;
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
        {/* The user side shows only the avatar ("你"), labelled for screen readers instead of a duplicate name. */}
        <span className="mc-avatar" aria-hidden={isUser ? undefined : "true"} role={isUser ? "img" : undefined} aria-label={isUser ? author : undefined}
          title={isUser ? time || undefined : undefined}>{isUser ? t("conversation.you") : <AssistantMark />}</span>
        {!isUser && <span className="mc-author" title={time || undefined}>{author}</span>}
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
 * Image/video models fold into one disabled 即将开放 row in the MVP (no paid calls).
 */
export function ModelMenu(props: { t: Translate; groups: Group[]; value: string; backend: string | null; disabled: boolean; onPick(choice: Choice | null): void; defaultOpen?: boolean }) {
  const { t, groups } = props;
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const backendValue = props.backend ? choiceValue({ kind: "executor", backend: props.backend }) : "";
  const options = groups.flatMap((g) => g.options);
  const model = options.find((o) => o.value === props.value)?.label ?? t("common.modelDefault");
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
  const item = (key: string, text: string, checked: boolean, onSelect: () => void, hint?: string) => (
    <button key={key} type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item" aria-checked={checked} onClick={onSelect}>
      <span className="mc-menu-text">{text}{hint && <span className="mc-menu-hint">{hint}</span>}</span>{checked && <CheckMark size={14} />}
    </button>
  );
  const media = groups.filter((g) => g.kind === "image" || g.kind === "video");
  return (
    <div className="mc-model" ref={root} onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" className="mc-pill mc-model-trigger" data-testid="mc-model" aria-haspopup="menu" aria-expanded={open}
        title={t("chatReact.pickerLabel")} disabled={props.disabled} onClick={() => setOpen((v) => !v)}>
        <span className="mc-model-name">{model}</span>{executor && <span className="mc-model-exec">· {executor}</span>}<ChevronMark size={12} />
      </button>
      <div className="mc-menu" role="menu" aria-label={t("chatReact.pickerLabel")} data-testid="mc-model-menu" hidden={!open}>
        {/* 默认模型 is a real radio of the chat group (checked when no model is pinned). */}
        <div role="group" aria-label={t("model.types.chat")} data-kind="chat" className="mc-menu-group">
          <div className="mc-menu-label" aria-hidden="true">{t("model.types.chat")}</div>
          {item("default", t("common.modelDefault"), props.value === "", () => choose(null))}
          {groups.find((g) => g.kind === "chat")?.options.map((o) => item(o.value, o.label, o.value === props.value, () => choose(o.choice), o.hint))}
        </div>
        {/* Image/video are not pickable in the MVP (no paid calls): one disabled row, not a list. */}
        {media.length > 0 && (
          <div role="group" data-kind="media" className="mc-menu-group">
            <div className="mc-menu-item" role="menuitem" aria-disabled="true" title={t("chatReact.mediaLaterTip")}>
              <span className="mc-menu-text">{media.map(label).join(" · ")}</span><span className="mc-menu-tag">{t("chatReact.mediaLater")}</span>
            </div>
          </div>
        )}
        {groups.filter((g) => g.kind === "executor").map((g) => (
          <div key={g.kind} role="group" aria-label={label(g)} data-kind={g.kind} className="mc-menu-group">
            {/* A lone executor named like its group shows once. */}
            {!(g.options.length === 1 && g.options[0]!.label === label(g)) && <div className="mc-menu-label" aria-hidden="true">{label(g)}</div>}
            {g.options.map((o) => item(o.value, o.label, o.value === backendValue, () => choose(o.choice)))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Model + executor of this conversation (or of the next new one); PATCH on change like Conversation.vue. */
export function useSettings(conversationId: string | undefined, t: Translate) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [backends, setBackends] = useState<ExecutionBackendOption[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [model, setModel] = useState<ModelChoice | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [strategy, setStrategy] = useState<ChatStrategy | null>(null);
  const [models, setModels] = useState<TypedModel[]>([]);
  const selectionRevision = useRef(0);

  useEffect(() => {
    let live = true;
    const revision = selectionRevision.current;
    let policy = cachedChatStrategy(window.location.origin);
    void loadChatStrategy(window.location.origin).then((loaded) => {
      policy = loaded;
      if (live) setStrategy(loaded);
    });
    setBusy(true);
    void Promise.all([
      listProviders().catch(() => [] as Provider[]),
      listAllTypedModels().catch(() => null),
      listExecutionBackends().catch(() => [] as ExecutionBackendOption[]),
      conversationId ? getConversation(conversationId).catch(() => null) : Promise.resolve(null),
    ]).then(([p, typed, b, conversation]) => {
      if (!live) return;
      const nextBackend = conversation?.executionBackend?.trim() || b.find((x) => x.default)?.id || b[0]?.id || null;
      const chatModels = typed?.chat ?? [];
      const nextGroups = modelGroups(p, typed, b);
      setProviders(p); setBackends(b); setModels(chatModels); setStrategy(policy);
      setGroups(nextGroups);
      if (selectionRevision.current === revision) {
        setModel(initialChatModel({
          strategy: policy, conversationId, selected: conversation ? conversationModelChoice(conversation) : null,
          explicit: false, backend: nextBackend, models: chatModels,
          allowed: (candidate) => {
            const option = b.find((entry) => entry.id === nextBackend);
            return !!option && executionBackendCompatibility(option, candidate, p).allowed;
          },
        }));
        setBackend(nextBackend);
      }
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
    selectionRevision.current += 1;
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

  const labeledGroups = strategy ? groups.map((group) => group.kind !== "chat" ? group : {
    ...group, options: group.options.map((option) => option.choice.kind !== "chat" ? option : ({ ...option, hint: `${option.hint ?? ""} · ${measurementHint(strategy, option.choice.model)}` })),
  }) : groups;
  return { groups: labeledGroups, model, backend, busy, pick, allowed: allowedFor(model, backend),
    imageHint: imageGuidance(strategy, model, models), modelHint: strategy && model ? measurementHint(strategy, model) : undefined };
}
