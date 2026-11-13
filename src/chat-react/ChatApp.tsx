import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AssistantRuntimeProvider, AuiIf, useAuiState, useExternalStoreRuntime, type ExternalStoreAdapter, type ThreadMessageLike,
} from "@assistant-ui/react";
import { useActionBarCopy } from "@assistant-ui/core/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
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
import { externalStore, sendAppend, type ChatController } from "./externalStore";
import { useSingleSlotQueue } from "./singleSlotQueue";
import { isRunning, type MediaPartData, type ProcessPartData, type ToolResult } from "./threadMessages";
import { choiceValue, modelGroups, type Choice, type Group } from "./modelGroups";
import { useCoreConversation } from "./useCoreConversation";
import { storageAttachmentAdapter } from "./attachments";
import { toSuggestions } from "./suggestions";
import { fetchHomeSuggestions } from "@/addons/conversation/api/homeSuggestions";
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
    newPlaceholder: "描述你的任务，Enter 发送，Shift + Enter 换行", loading: "正在加载对话…", process: "执行过程",
    queued: "待发送 1 条", queuedRemove: "移除待发送消息", badUpdate: "消息格式异常，已跳过一条更新",
    reload: "重新生成", toBottom: "回到底部", earlier: "加载更早消息", running: "进行中", done: "完成", failed: "失败",
    query: "查询", sources: "来源", mediaPending: "生成中…", mediaFailed: "生成失败", thinking: "正在思考…", greeting: "今天想完成什么？",
  },
  "en-US": {
    stop: "Stop", executor: "Executors", mediaLater: " (not in MVP)", pickerLabel: "Model and executor",
    newPlaceholder: "Describe your task. Enter to send, Shift + Enter for a new line", loading: "Loading conversation…", process: "Process",
    queued: "1 queued", queuedRemove: "Remove queued message", badUpdate: "Malformed message update skipped",
    reload: "Regenerate", toBottom: "Scroll to bottom", earlier: "Load earlier messages", running: "Running", done: "Done", failed: "Failed",
    query: "Query", sources: "Sources", mediaPending: "Generating…", mediaFailed: "Generation failed", thinking: "Thinking…", greeting: "What can I help you finish today?",
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
            <ComposerPrimitive.AttachmentDropzone className="mc-dropzone">
              <ComposerPrimitive.Root className="mc-composer">
                <ComposerAttachmentChips t={t} />
                <ComposerPrimitive.Queue>
                  {() => (
                    <div className="mc-queued" data-testid="mc-queued">
                      <span className="mc-queued-label">{t("chatReact.queued")}</span>
                      <QueueItemPrimitive.Text className="mc-queued-text" />
                      <QueueItemPrimitive.Remove className="mc-chip-remove" aria-label={t("chatReact.queuedRemove")}>×</QueueItemPrimitive.Remove>
                    </div>
                  )}
                </ComposerPrimitive.Queue>
                <ComposerPrimitive.Input
                  className="mc-input" rows={2} autoFocus
                  placeholder={conversationId ? t("conversation.inputPlaceholder") : t("chatReact.newPlaceholder")}
                />
                <div className="mc-toolbar">
                  <AttachButton t={t} />
                  <ModelGroupPicker t={t} groups={settings.groups} value={settings.model ? choiceValue({ kind: "chat", model: settings.model }) : ""}
                    backend={settings.backend} disabled={settings.busy} onPick={settings.pick} />
                  <AuiIf condition={(s) => !s.thread.isRunning}>
                    <ComposerPrimitive.Send className="mc-btn mc-btn--primary" data-testid="mc-send">{t("common.send")}</ComposerPrimitive.Send>
                  </AuiIf>
                  <AuiIf condition={(s) => s.thread.isRunning}>
                    <ComposerPrimitive.Send className="mc-btn" data-testid="mc-send">{t("common.send")}</ComposerPrimitive.Send>
                    <ComposerPrimitive.Cancel className="mc-btn mc-btn--primary" data-testid="mc-stop">{t("chatReact.stop")}</ComposerPrimitive.Cancel>
                  </AuiIf>
                </div>
              </ComposerPrimitive.Root>
            </ComposerPrimitive.AttachmentDropzone>
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

const Icon = ({ d, size = 14 }: { d: ReactNode; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const AssistantMark = () => <Icon size={15} d={<><path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" /><path d="M12 22V12" /><path d="M4 7l8 5 8-5" /></>} />;
const CopyMark = () => <Icon d={<><rect x="8" y="8" width="14" height="14" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>} />;
const ReloadMark = () => <Icon d={<><path d="M21 12a9 9 0 11-3-6.7L21 8" /><path d="M21 3v5h-5" /></>} />;
const ClipMark = () => <Icon size={16} d={<path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />} />;

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
      <button type="button" className="mc-icon-btn" aria-label={t("common.copy")} title={t("common.copy")} disabled={disabled} onClick={copy}><CopyMark /></button>
      <span className="mc-copy-status" role="status">{isCopied ? t("common.copied") : failed ? t("common.operationFailed") : ""}</span>
    </>
  );
}

/** Paperclip button; the cap matches Core's MAX_ATTACHMENTS like AttachmentPicker.vue's `max`. */
function AttachButton({ t }: { t: Translate }) {
  const count = useAuiState((s) => s.composer.attachments.length);
  const uploading = useAuiState((s) => s.composer.attachments.some((a) => a.status.type === "running"));
  return (
    <ComposerPrimitive.AddAttachment className="mc-attach" data-testid="mc-attach" title={t("common.attachment")} aria-label={t("common.attachment")}
      disabled={count >= MAX_ATTACHMENTS}>
      <ClipMark />{uploading ? <span>{t("common.attachmentUploading")}</span> : count > 0 ? <span className="mc-attach-count">{count}</span> : null}
    </ComposerPrimitive.AddAttachment>
  );
}

function ComposerAttachmentChips({ t }: { t: Translate }) {
  return (
    <div className="mc-chips">
      <ComposerPrimitive.Attachments>
        {({ attachment }) => (
          <AttachmentPrimitive.Root className="mc-chip" data-status={attachment.status.type}>
            <AttachmentPrimitive.Name />
            {attachment.status.type === "running" && <span className="mc-chip-meta">{Math.round(("progress" in attachment.status ? attachment.status.progress : 0) * 100)}%</span>}
            {attachment.status.type === "incomplete" && <span className="mc-chip-meta" role="status">{t("common.attachmentUploadFailed")}</span>}
            <AttachmentPrimitive.Remove className="mc-chip-remove" aria-label={t("common.delete")}>×</AttachmentPrimitive.Remove>
          </AttachmentPrimitive.Root>
        )}
      </ComposerPrimitive.Attachments>
    </div>
  );
}

/** Sent attachments on a user message (names only; shortcut: no download/preview yet, AttachmentChips.vue still owns that). */
const MessageAttachmentChips = () => (
  <div className="mc-chips mc-chips--sent">
    <MessagePrimitive.Attachments>
      {({ attachment }) => <AttachmentPrimitive.Root className="mc-chip" data-kind={attachment.type}><AttachmentPrimitive.Name /></AttachmentPrimitive.Root>}
    </MessagePrimitive.Attachments>
  </div>
);

/**
 * Markdown body via aui's MarkdownTextPrimitive (react-markdown + smooth streaming). Same policy as
 * task-conversation/markdown.ts: raw HTML is never rendered (react-markdown without rehype-raw), images
 * are dropped, task-list checkboxes become ☐/☑ text, links keep react-markdown's safe-protocol filter
 * and sealed tool links open through Core (openSealedLinkOnClick).
 */
const MARKDOWN_COMPONENTS = {
  img: () => null,
  input: ({ checked }: { checked?: boolean }) => <>{checked ? "☑" : "☐"} </>,
};
const MarkdownText = () => (
  <MarkdownTextPrimitive className="mc-md" remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}
    containerProps={{ onClick: (e) => void openSealedLinkOnClick(e.nativeEvent) }} />
);

const statusKey = (status: { type: string }, isError?: boolean) =>
  status.type === "running" ? "running" : isError || status.type === "incomplete" ? "failed" : "done";

/** Generic Core tool-call card: name, state, and the outcome (query / sources / text) folded. */
function ToolCard({ toolName, result, isError, status, t }: { toolName: string; result?: unknown; isError?: boolean; status: { type: string }; t: Translate }) {
  const r = result as ToolResult | undefined;
  const state = statusKey(status, isError);
  const sources = (r?.sources ?? []).filter((s) => s.url && /^https?:\/\//i.test(s.url));
  return (
    <details className="mc-tool" data-status={state}>
      <summary><span className="mc-tool-name">{toolName}</span><span className="mc-tool-state">{t(`chatReact.${state}`)}</span></summary>
      {r?.query && <p className="mc-tool-row"><b>{t("chatReact.query")}</b> {r.query}</p>}
      {sources.length > 0 && (
        <ul className="mc-tool-sources" aria-label={t("chatReact.sources")}>
          {sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.domain || s.url}</a></li>)}
        </ul>
      )}
      {r?.content && <pre className="mc-tool-result">{r.content}</pre>}
    </details>
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

function Parts({ t }: { t: Translate }) {
  return (
    <MessagePrimitive.GroupedParts groupBy={groupBy} indicator="empty">
      {({ part, children }) => {
        switch (part.type) {
          case "group-process":
            return <details className="mc-process" open={part.status.type === "running"}>{children}</details>;
          case "indicator":
            return <p className="mc-thinking" role="status">{t("chatReact.thinking")}</p>;
          case "text":
            return <MarkdownText />;
          case "reasoning": {
            const [title, ...rest] = part.text.split("\n");
            return <div className="mc-step"><b>{title}</b>{rest.length > 0 && <pre>{rest.join("\n")}</pre>}</div>;
          }
          case "tool-call":
            return <ToolCard toolName={part.toolName} result={part.result} isError={part.isError} status={part.status} t={t} />;
          case "data":
            if (part.name === "process") {
              const data = part.data as ProcessPartData;
              return (
                <summary aria-label={`${t("chatReact.process")} · ${data.summary}`}>
                  <span className="mc-process-label">{t("chatReact.process")}</span>
                  <span className="mc-process-summary">{data.summary}</span>
                  {data.timing && <span className="mc-process-timing">{data.timing}</span>}
                </summary>
              );
            }
            if (part.name === "media") return <MediaCard data={part.data as MediaPartData} t={t} />;
            if (part.name === "files") {
              return <div className="mc-chips mc-chips--sent">{(part.data as { id: string; name: string }[]).map((f) => <span key={f.id} className="mc-chip">{f.name}</span>)}</div>;
            }
            return <></>;
          default:
            return <></>;
        }
      }}
    </MessagePrimitive.GroupedParts>
  );
}

export function MessageRow({ role, t }: { role: string; t: Translate }) {
  const createdAt = useAuiState((s) => s.message.createdAt);
  const failed = useAuiState((s) => (s.message.metadata.custom as { failed?: boolean }).failed === true);
  const isUser = role === "user";
  const time = formatMessageTime(createdAt?.toISOString());
  return (
    <MessagePrimitive.Root className="mc-msg" data-message-role={role} data-failed={failed || undefined}>
      <div className="mc-avatar" aria-hidden="true">{isUser ? t("conversation.you") : <AssistantMark />}</div>
      <div className="mc-main">
        <div className="mc-header">
          <span className="mc-author">{isUser ? t("conversation.you") : t("home.greeting")}</span>
          {time && <span className="mc-time">{time}</span>}
          <ActionBarPrimitive.Root className="mc-actions" hideWhenRunning autohide="never">
            <CopyAction t={t} />
            {!isUser && (
              <ActionBarPrimitive.Reload className="mc-icon-btn" aria-label={t("chatReact.reload")} title={t("chatReact.reload")}><ReloadMark /></ActionBarPrimitive.Reload>
            )}
          </ActionBarPrimitive.Root>
        </div>
        <div className="mc-bubble">
          <Parts t={t} />
          {isUser && <MessageAttachmentChips />}
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function ModelGroupPicker(props: { t: Translate; groups: Group[]; value: string; backend: string | null; disabled: boolean; onPick(choice: Choice | null): void }) {
  const { t, groups } = props;
  const options = groups.flatMap((g) => g.options);
  const label = (g: Group) => (g.kind === "executor" ? t("chatReact.executor") : t(`model.types.${g.kind}`));
  const pick = (value: string) => props.onPick(options.find((o) => o.value === value)?.choice ?? null);
  // Two selects over one grouped catalog: a conversation stores model and executor separately.
  return (
    <div className="mc-picker" role="group" aria-label={t("chatReact.pickerLabel")}>
      <select className="mc-select" data-testid="mc-model" value={props.value} disabled={props.disabled} onChange={(e) => pick(e.target.value)}>
        <option value="">{t("common.modelDefault")}</option>
        {groups.filter((g) => g.kind !== "executor").map((g) => (
          <optgroup key={g.kind} label={label(g)} data-kind={g.kind}>
            {g.options.map((o) => (
              // shortcut: image/video only listed; generation is not wired in the MVP (no paid calls).
              <option key={o.value} value={o.value} disabled={g.kind !== "chat"}>{o.label}{g.kind !== "chat" ? t("chatReact.mediaLater") : ""}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {groups.filter((g) => g.kind === "executor").map((g) => (
        <select key="executor" className="mc-select" data-testid="mc-executor" aria-label={label(g)}
          value={props.backend ? choiceValue({ kind: "executor", backend: props.backend }) : ""}
          disabled={props.disabled} onChange={(e) => pick(e.target.value)}>
          <optgroup label={label(g)} data-kind="executor">
            {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        </select>
      ))}
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
