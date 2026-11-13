import { useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider, AuiIf, useAuiState, useExternalStoreRuntime, type ExternalStoreAdapter, type ThreadMessageLike,
} from "@assistant-ui/react";
import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from "./auiPrimitives";
import { listProviders, listAllTypedModels, type Provider } from "@/contracts/model-catalog";
import { getConversation, listExecutionBackends, updateConversationSettings } from "@/addons/conversation/api/conversation";
import type { Conversation, CreateConversationRequest, ExecutionBackendOption, ModelChoice } from "@/addons/conversation/api/types";
import { conversationModelChoice } from "@/addons/conversation/composables/conversationModelRestore";
import { executionBackendCompatibility } from "@/addons/conversation/composables/executionBackendCompatibility";
import { modelErrorMessage } from "@/addons/conversation/composables/modelErrorMessage";
import { renderMarkdown } from "@/addons/conversation/task-conversation/markdown";
import { createConversationState } from "@/addons/conversation/task-conversation/core";
import { copyRawBody, formatMessageTime, type CopyState } from "@/addons/conversation/components/conversation/messageCopy";
import type { ConversationLocale } from "@/addons/conversation/task-conversation/core";
import { toast } from "@/composables/useToast";
import { externalStore } from "./externalStore";
import type { ProcessPartData } from "./threadMessages";
import { choiceValue, modelGroups, type Choice, type Group } from "./modelGroups";
import { useCoreConversation } from "./useCoreConversation";
import { storageAttachmentAdapter } from "./attachments";
import { AttachmentPrimitive } from "./auiPrimitives";
import { MAX_ATTACHMENTS } from "@/addons/conversation/task-conversation/core";
import "./chat.css";

export type Translate = (key: string, named?: Record<string, unknown>) => string;
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
  },
  "en-US": {
    stop: "Stop", executor: "Executors", mediaLater: " (not in MVP)", pickerLabel: "Model and executor",
    newPlaceholder: "Describe your task. Enter to send, Shift + Enter for a new line", loading: "Loading conversation…", process: "Process",
  },
};
const withIslandStrings = (t: Translate, locale: ConversationLocale): Translate => (key, named) =>
  key.startsWith("chatReact.") ? STRINGS[locale][key.slice(10)] ?? key : t(key, named);

export function ChatApp(props: ChatProps) {
  const { conversationId } = props;
  const locale = props.locale ?? "zh-CN";
  const t = useMemo(() => withIslandStrings(props.t, locale), [props.t, locale]);
  const report = useMemo(() => (error: Error) => toast.error(error.name === "ZodError" ? "消息格式异常，已跳过一条更新" : modelErrorMessage(error, t)), [t]);
  const core = useCoreConversation(conversationId, report);
  const settings = useSettings(conversationId, t);
  const attachments = useMemo(() => storageAttachmentAdapter((file, message) => toast.error(`${file.name}: ${message}`)), []);
  const view = { locale, nowMs: useClock(!!core && core.state.status === "running") };

  const adapter: ExternalStoreAdapter<ThreadMessageLike> = conversationId
    ? externalStore(core?.state ?? EMPTY, {
      send: (text, files) => core ? core.controller.send(text, files) : Promise.reject(new Error(t("chatReact.loading"))),
      stop: () => core?.controller.stop() ?? Promise.resolve(),
    }, view, attachments)
    : externalStore(EMPTY, {
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
    }, undefined, attachments);
  const runtime = useExternalStoreRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="mc-root" data-conversation-key={conversationId ?? ""}>
        <ThreadPrimitive.Viewport className="mc-viewport">
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <p className="mc-empty">{conversationId && !core ? t("chatReact.loading") : t("conversation.empty")}</p>
          </AuiIf>
          <ThreadPrimitive.Messages>{({ message }) => <MessageRow role={message.role} t={t} />}</ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="mc-composer">
          <ComposerAttachmentChips t={t} />
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
              <ComposerPrimitive.Cancel className="mc-btn" data-testid="mc-stop">{t("chatReact.stop")}</ComposerPrimitive.Cancel>
            </AuiIf>
          </div>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
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

const AssistantMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" /><path d="M12 22V12" /><path d="M4 7l8 5 8-5" />
  </svg>
);
const CopyMark = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="8" y="8" width="14" height="14" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

/** Raw text of a message (what "复制" puts on the clipboard, like MessageItem.vue). */
const rawBody = (content: readonly { type: string; text?: string }[]) =>
  content.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n\n");

function CopyButton({ id, body, t }: { id: string; body: string; t: Translate }) {
  const [state, setState] = useState<CopyState>("");
  const [copying, setCopying] = useState(false);
  const live = useRef({ mounted: true, id, body });
  live.current.id = id; live.current.body = body;
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false; }; }, []);
  useEffect(() => setState(""), [id, body]);
  async function copy() {
    if (copying) return;
    setCopying(true); setState("");
    const current = () => live.current.mounted && live.current.id === id && live.current.body === body;
    try {
      const result = await copyRawBody(body, current);
      if (result) setState(result);
    } finally {
      if (live.current.mounted) setCopying(false);
    }
  }
  return (
    <>
      <button type="button" className="mc-copy" aria-label={t("common.copy")} title={t("common.copy")} disabled={copying} onClick={copy}><CopyMark /></button>
      <span className="mc-copy-status" role="status">{state === "copied" ? t("common.copied") : state === "error" ? t("common.operationFailed") : ""}</span>
    </>
  );
}

const ClipMark = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
  </svg>
);

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
            <span className="mc-chip-name">{attachment.name}</span>
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
function MessageAttachmentChips() {
  const list = useAuiState((s) => s.message.attachments);
  if (!list?.length) return null;
  return (
    <div className="mc-chips mc-chips--sent">
      {list.map((a) => <span key={a.id} className="mc-chip" data-kind={a.type}><span className="mc-chip-name">{a.name}</span></span>)}
    </div>
  );
}

function ProcessGroup({ data, t }: { data: ProcessPartData; t: Translate }) {
  const title = t("chatReact.process");
  return (
    <details className="mc-process" data-status={data.status} open={data.status === "streaming" || data.status === "pending"}>
      <summary aria-label={`${title} · ${data.summary}`}>
        <span className="mc-process-label">{title}</span>
        <span className="mc-process-summary">{data.summary}</span>
        {data.timing && <span className="mc-process-timing">{data.timing}</span>}
      </summary>
      <ol className="mc-process-steps">
        {data.steps.map((step) => (
          <li key={step.id} data-status={step.status}>
            {step.title && <b>{step.title}</b>}
            {step.content && <pre>{step.content}</pre>}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function MessageRow({ role, t }: { role: string; t: Translate }) {
  const id = useAuiState((s) => s.message.id);
  const createdAt = useAuiState((s) => s.message.createdAt);
  const body = useAuiState((s) => rawBody(s.message.content));
  const isUser = role === "user";
  const time = formatMessageTime(createdAt?.toISOString());
  return (
    <MessagePrimitive.Root className="mc-msg" data-message-role={role}>
      <div className="mc-avatar" aria-hidden="true">{isUser ? t("conversation.you") : <AssistantMark />}</div>
      <div className="mc-main">
        <div className="mc-header">
          <span className="mc-author">{isUser ? t("conversation.you") : t("home.greeting")}</span>
          {time && <span className="mc-time">{time}</span>}
          {body && <CopyButton id={id} body={body} t={t} />}
        </div>
        <div className="mc-bubble">
          <MessagePrimitive.Parts>
            {({ part }) => part.type === "text"
              ? <div className="mc-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }} />
              : part.type === "data" && part.name === "process"
                ? <ProcessGroup data={part.data as ProcessPartData} t={t} />
                : part.type === "reasoning"
                  ? <details className="mc-reasoning"><summary>{part.text.split("\n")[0]}</summary><pre>{part.text.split("\n").slice(1).join("\n")}</pre></details>
                  : null}
          </MessagePrimitive.Parts>
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
