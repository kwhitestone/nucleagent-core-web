import { useEffect, useId, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { PROFILE_UI_ENABLED } from "./profileFeature";
import ProfileControls from "./ProfileControls";
import ToolIO from "./ToolIO";
import {
  AssistantRuntimeProvider, AuiIf, useAuiState, useExternalStoreRuntime, type ExternalStoreAdapter, type ThreadMessageLike,
} from "@assistant-ui/react";
import { useActionBarCopy } from "@assistant-ui/core/react";
import { useMessagePartText, useSmooth } from "@assistant-ui/react";
import { renderMarkdown } from "@/addons/conversation/task-conversation/markdown";
import { formatReadout } from "./ttft";
import {
  ActionBarPrimitive, AttachmentPrimitive, ComposerPrimitive, MessagePrimitive, QueueItemPrimitive, SuggestionPrimitive, ThreadPrimitive,
} from "./auiPrimitives";
import { listProviders, listAllTypedModels, type Provider, type TypedModel } from "@/contracts/model-catalog";
import { getConversation, listExecutionBackends, updateConversationSettings } from "@/addons/conversation/api/conversation";
import type { Conversation, CreateConversationRequest, ExecutionBackendOption, ModelChoice } from "@/addons/conversation/api/types";
import type { ConversationAttachment } from "@/addons/conversation/task-conversation/core";
import { MediaCard } from "./MediaCard";
import { toolSchema, WorkflowForm } from "./WorkflowForm";
import { BINDINGS_EVENT, ToolGrantChips, ToolGrantList, useToolGrants, type ToolGrants } from "./ToolGrants";
import { DirectMediaFields } from "./DirectMediaFields";
import { StoredMediaPreview } from "./StoredMediaPreview";
import { guardMediaSend } from "./mediaPolicy";
import { directMediaRequest, directMediaTool, directMediaReady, mediaDefaults, mediaFrames, type DirectMedia, type Wired } from "./workflowParams";
import { listToolCatalogPages } from "@/addons/conversation/api/toolCatalog";
import { createGeneration, listGenerations } from "@/addons/conversation/api/media";
import { MEDIA_KINDS, requestParams } from "@/addons/conversation/registry";
import { getSessionBindings, updateSessionBindings, type SessionBindings } from "@/addons/conversation/api/sessionBindings";
import { conversationModelChoice } from "@/addons/conversation/composables/conversationModelRestore";
import { executionBackendCompatibility } from "@/addons/conversation/composables/executionBackendCompatibility";
import { modelErrorMessage } from "@/addons/conversation/composables/modelErrorMessage";
import { createConversationState, MAX_ATTACHMENTS, type ConversationLocale } from "@/addons/conversation/task-conversation/core";
import { openSealedLinkOnClick } from "@/addons/conversation/task-conversation/sealedLink";
import { copyRawBody, formatMessageTime } from "@/addons/conversation/components/conversation/messageCopy";
import { toast } from "@/composables/useToast";
import { externalStore, sendAppend, type ChatController } from "./externalStore";
import { failureOf, slotReason, useSingleSlotQueue, type SlotFailure } from "./singleSlotQueue";
import { isRunning, type MediaPartData, type ProcessPartData, type ToolResult } from "./threadMessages";
import { choiceValue, modelGroups, visibleOptions, type Choice, type Group, type Option } from "./modelGroups";
import { composerActions } from "./composerState";
import {
  AssistantMark, FileMark, CheckMark, ChevronMark, CopyMark, CrossMark, ToolMark, ImageMark, PlusMark, SendMark, StopMark, VideoMark,
} from "./icons";
import { useCoreConversation } from "./useCoreConversation";
import { downloadFile, fileKind, formatSize, storageAttachmentAdapter, type FileChip } from "./attachments";
import { toSuggestions } from "./suggestions";
import { fetchHomeSuggestions } from "./suggestions";
import type { IslandStrings } from "./islandStringsZh";
import { loadChatStrategy, cachedChatStrategy, initialChatModel, measurementHint, effortEvidence, type ChatStrategy } from "./chatStrategy";
import { availabilityOf, imageGate, imageHint, type ImageGate } from "./modelCaps";
import { withRequestEffort, type EffortChoice } from "./requestEffort";
import { ModelControls, useMenu } from "./ModelControls";
import { TurnUsage } from "./TurnUsage";
import { LOADING_EVIDENCE, settlementRows, turnUsage, type SettlementEvidence, type SettlementReader } from "./turnUsage";
import { profileRequest } from "./modelProfile";
import { useModelPreference } from "./useModelPreference";
import { effectiveSelectionLabel, presetFields, readEffectiveSelection, sendWithSelection, useModelCapability, type EffectiveSelection, type Fields } from "./modelSelection";
export { ModelControls, TurnUsage };
import "./chat.css";
import { MessageActions, useMessageActions, type MessageActionsController } from './MessageActions';
import { getPlatformRuntime, SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { ScrollViewport, ScrollToLatest } from './ScrollViewport';
import { ThinkingFold } from './ThinkingFold';

export type Translate = (key: string, named?: Record<string, unknown>) => string;
/** A home suggestion card resolved for the locale (suggestions.ts). */
export interface ChatSuggestion { title: string; label: string; prompt: string }
export interface ChatProps {
  conversationId?: string;
  t: Translate;
  locale?: ConversationLocale;
  navigate(path: string): void;
  create(payload: CreateConversationRequest): Promise<Conversation>;
  onFork?(conversation: Conversation): void;
  /** Island strings for `locale`, loaded by mount.tsx. */
  strings: IslandStrings;
  /** Per-turn settlement source; none exists yet, so the host passes nothing and usage shows "—". */
  settlementReader?: SettlementReader;
}

const EMPTY = createConversationState("new");

// Island-only strings stay out of the main i18n bundle (default-path size, plan §9) and out of the island:
// locale tables share a lazy compressed chunk (loaded by mount.tsx).
const withIslandStrings = (t: Translate, strings: Record<string, string>): Translate => (key, named) =>
  key.startsWith("chatReact.") ? strings[key.slice(10)] ?? key : t(key, named);

export function ChatApp(props: ChatProps) {
  const { conversationId } = props;
  const locale = props.locale ?? "zh-CN";
  const t = useMemo(() => withIslandStrings(props.t, props.strings), [props.t, props.strings]);
  const report = useMemo(() => (error: Error) => toast.error(error.name === "ZodError" ? t("chatReact.badUpdate") : modelErrorMessage(error, t)), [t]);
  const selectedSettings = useSettings(conversationId, t);
  const profileScope = `${conversationId ?? "new"}:${selectedSettings.backend}:${selectedSettings.model?.providerId}:${selectedSettings.model?.model}`;
  const preference = useModelPreference(profileScope, selectedSettings.backend ?? "", selectedSettings.model?.providerId, selectedSettings.model?.model ?? "");
  const resolved = preference.selection;
  const settings = { ...selectedSettings, model: selectedSettings.model ?? (resolved?.model && resolved.providerId ? { providerId: resolved.providerId, model: resolved.model } : null) };
  // design-1123 A: presets are the only control; protocol + level ride inside the preset (P2 phase 1 = C). A stored
  // legacy effort is no longer sent on its own — choosing a preset writes it back empty.
  const storedProfileId = preference.storedProfileId;
  const profile = PROFILE_UI_ENABLED ? preference.profile : null;
  const capability = useModelCapability(settings.backend, settings.model?.providerId, settings.model?.model);
  const selectable = capability.view.state === "visible";
  const params = profile ? preference.catalog.find((row) => row.id === profile.profileId)?.params : undefined;
  const legacy = profileRequest(profile, profileScope, "");
  const preset = presetFields(capability.view, params, legacy);
  const turn = preset.fields as Fields;
  const stale = preset.stale && capability.loaded;
  const selectionNow = useRef({ legacy, params, capability });
  selectionNow.current = { legacy, params, capability };
  const wrap = <R,>(send: (fields: Fields) => Promise<R>, fields: Fields) => sendWithSelection(send, fields, {
    t, reset: () => {},
    refetch: async () => { const now = selectionNow.current; return presetFields(await now.capability.refetch(), now.params, now.legacy).fields as Fields; },
  });
  // D6A/S1–S8: the 「思考」 pill exists only when this model has presets (or their load failed, S7).
  const pending = preference.pending;
  const shownId = pending ? pending.profileId : storedProfileId;
  const shown = preference.catalog.find((row) => row.id === shownId && shownId);
  const shownName = shown ? shown.displayName || shown.id : undefined;
  const profilePanel = PROFILE_UI_ENABLED && (preference.catalog.length > 0 || preference.error) ? {
    name: shownName, stale,
    page: <ProfileControls t={t} rows={preference.catalog} selected={shownId} saving={!!pending} rolledBack={preference.rolledBack} error={preference.error && !pending}
      stale={stale ? shownName : undefined} onChange={(profileId) => { void preference.save(profileId, ""); }} onRetry={preference.reload} />,
  } : undefined;
  const turnNow = useRef(turn);
  turnNow.current = turn;
  const defaultModelNow = useRef<ModelChoice | undefined>(undefined);
  defaultModelNow.current = !selectedSettings.model && preference.ready ? settings.model ?? undefined : undefined;
  const core = useCoreConversation(conversationId, report, () => turnNow.current as never, () => defaultModelNow.current, wrap as never);
  const grants = useToolGrants(conversationId, t, locale);
  const messageActions = useMessageActions(conversationId, !!core && isRunning(core.state), props.navigate, (fork) => props.onFork?.(fork), report);
  const attachments = useMemo(() => storageAttachmentAdapter((file, message) => toast.error(`${file.name}: ${message}`)), []);
  const view = { locale, nowMs: useClock(!!core && core.state.status === "running") };
  const suggestions = useSuggestions(!conversationId, locale);
  const settlementSteps = [...new Set(Object.values(core?.state.items ?? {}).flatMap((item) => item.data?.mainRun !== false && typeof item.data?.runStepId === 'string' ? [item.data.runStepId] : []))].sort().join(',');
  const evidence = useSettlement(conversationId, props.settlementReader, core?.state.status, settlementSteps);

  const guard = <A extends unknown[], R>(send: (...args: A) => Promise<R>) => guardMediaSend(settings.direct ? null : settings.media, send, t("chatReact.mediaUnavailable"));
  // MUYU-365 exp98: the first composer images are the job's owned frames; a missing frame is said on send.
  const media = (direct: DirectMedia, input: string, files: readonly ConversationAttachment[] = []) => {
    const frames = mediaFrames(direct, files);
    if (frames.missing) { toast.warning(t("chatReact.mediaFrameHint")); throw new Error(t("chatReact.mediaFrameHint")); }
    return { ...directMediaRequest(direct, { ...settings.params, ...frames.params }, input), files: files.filter((file) => !frames.used.includes(file.id)) };
  };
  // fix-media-365: a model without a usable job tool generates through Core's media API (text prompt + registry choices).
  const generate = async (input: string, files: readonly unknown[] = []) => {
    if (files.length) throw new Error(t("chatReact.mediaTextOnly"));
    const { kind, model } = settings.media!;
    const created = await createGeneration({ kind, providerId: Number(model.providerId), model: model.model, prompt: input, conversationId: Number(conversationId ?? 0), ...requestParams(kind, settings.params ?? {}) });
    if (!conversationId && created.conversationId) props.navigate(`/c/${created.conversationId}`);
  };
  // New conversation with the current model and executor, then open it.
  // withTurn: this turn's effort or profile; never on a media/workflow job, which carries its own parameters.
  const start = async (request: Partial<CreateConversationRequest> & { input: string }, withTurn = false) => {
    if (withTurn && !preference.ready) throw new Error(t("chatReact.preferenceError"));
    const payload: CreateConversationRequest = {
      mode: "a2a_agent", model: settings.model?.model ?? "", providerId: settings.model?.providerId,
      executionBackend: settings.backend ?? undefined, ...request,
    };
    const created = !withTurn ? await props.create(payload) : await wrap((fields) => props.create(typeof fields === "string" ? withRequestEffort(payload, fields as EffortChoice, settings.backend) : { ...payload, ...fields } as CreateConversationRequest), turn);
    props.navigate(`/c/${created.id}`);
  };
  const controller: ChatController = {
    send: guard(async (text, files) => {
      if (!settings.media && !preference.ready) throw new Error(t("chatReact.preferenceError"));
      if (!core) throw new Error(t("chatReact.loading"));
      if (!settings.direct) return core.controller.send(text, files);
      // A paid submission is never parked or replayed: not while a run is active, and an unconfirmed
      // result (no HTTP answer) is reported as unknown instead of reaching the 409 queue.
      if (isRunning(core.state)) throw new Error(t("chatReact.loading"));
      if (!settings.direct.toolId) return generate(text, files);
      const { toolInvocation, files: rest } = media(settings.direct, text, files);
      // fix-video-swallow: an HTTP answer keeps its ApiError (status/code/problem) so the queue can tell busy from bad.
      await core.controller.send(text, rest, toolInvocation).catch((error) => {
        throw (error as { status?: number }).status ? error : new Error(t("chatReact.workflowUnknown"));
      });
    }),
    stop: () => core?.controller.stop() ?? Promise.resolve(),
    loadOlder: () => core?.controller.loadOlder() ?? Promise.resolve(),
  };
  // Only an existing conversation queues; the new-chat composer is never running.
  const mediaLimit = settings.media && { kind: settings.media.kind, limit: MEDIA_KINDS[settings.media.kind].busyLimit };
  const slot = useSingleSlotQueue(conversationId, !!core && isRunning(core.state), (m) => sendAppend(controller, m), (failure) => {
    toast.show(slotReason(failure, t, mediaLimit || undefined), failure.retry === "auto" ? "warning" : "error", 6000);
  });
  // Existing conversations only: the new-chat pill switch stays request-free (mediaPanel), and a 429 there is still toasted.
  const inFlight = useMediaInFlight(conversationId ? settings.media?.kind : undefined, slot.failure);
  const adapter: ExternalStoreAdapter<ThreadMessageLike> = conversationId
    ? externalStore(core?.state ?? EMPTY, controller, view, attachments, slot)
    : { ...externalStore(EMPTY, {
      send: guard(async (input, files) => {
        if (settings.busy) throw new Error(t("chatReact.loading"));
        if (!settings.allowed) throw new Error(t("common.executionBackendSelectionInvalid"));
        const viaCore = settings.direct?.toolId === 0;
        const { files: rest = files, ...direct } = settings.direct && !viaCore ? media(settings.direct, input, files) : {};
        try {
          if (viaCore) return await generate(input, files);
          await start({
            input,
            ...(grants.ids.length ? { toolIds: grants.ids } : {}),
            ...direct,
            ...(rest?.length ? { attachments: rest.map((f) => ({ fileId: f.id, name: f.name })) } : {}),
          }, !settings.media);
        } catch (error) {
          const f = failureOf(error);
          toast.error(f.status === 429 ? slotReason({ ...f, retry: "manual", attempt: 1 }, t, mediaLimit || undefined) : modelErrorMessage(error, t, t("home.createFailed")));
          throw error;
        }
      }),
      stop: () => Promise.resolve(),
    }, undefined, attachments), suggestions };
  const runtime = useExternalStoreRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.ViewportProvider>
      <ThreadPrimitive.Root className="mc-root" data-conversation-key={conversationId ?? ""}>
        <ScrollViewport conversationId={conversationId} ready={!conversationId || (core?.state.conversationKey === conversationId && core.controller.authoritativeReady.value)} className="mc-viewport">
          <AuiIf condition={(s) => s.thread.hasEarlier}>
            <ThreadPrimitive.LoadEarlier className="mc-earlier">{t("chatReact.earlier")}</ThreadPrimitive.LoadEarlier>
          </AuiIf>
          <ThreadPrimitive.Empty>
            {conversationId
              ? <p className="mc-empty">{core ? t("conversation.empty") : t("chatReact.loading")}</p>
              : <Welcome t={t} />}
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages>{({ message }) => <MessageRow role={message.role} t={t} locale={locale} conversationId={conversationId} evidence={evidence} actions={messageActions} selection={selectable} />}</ThreadPrimitive.Messages>
        </ScrollViewport>
          <div className="mc-footer">
            <ScrollToLatest className="mc-to-bottom" aria-label={t("chatReact.toBottom")} title={t("chatReact.toBottom")}>↓</ScrollToLatest>
            <Composer t={t} settings={settings} grants={grants} inFlight={inFlight}
              queue={conversationId ? { failure: slot.failure, reason: slot.failure && slotReason(slot.failure, t, mediaLimit || undefined), retry: () => void slot.retryNow() } : undefined}
              workflow={!conversationId && <WorkflowForm t={t} disabled={settings.busy || !settings.allowed} submit={async (toolInvocation, name) => {
                await start({ input: `${t("chatReact.workflowRun")}: ${name}`, toolIds: [toolInvocation.toolId], toolInvocation });
              }} />}
              profile={profilePanel} controls={<>{preference.ready && !settings.model && <p role="status">{t("chatReact.defaultModelUnresolved")}</p>}{preference.error && <p role="alert">{t("chatReact.preferenceError")}</p>}</>}
              placeholder={conversationId ? t("conversation.inputPlaceholder") : t("chatReact.newPlaceholder")} />
          </div>
      </ThreadPrimitive.Root>
      </ThreadPrimitive.ViewportProvider>
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

const fillIn = (text: string, values: Record<string, unknown>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

/** fix-video-swallow: the queued row always says why it waits — reason, auto-retry countdown, 立即重试. */
function QueueReason({ t, queue }: { t: Translate; queue: { failure: SlotFailure | null; reason: string | null; retry(): void } }) {
  const at = queue.failure?.at;
  const now = useClock(!!at);
  const left = at ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
  return <>
    <span className="mc-queued-reason" role="alert" data-testid="mc-queued-reason">{queue.reason}{at ? ` · ${fillIn(t("chatReact.queueRetryIn"), { s: left })}` : ""}</span>
    {queue.failure?.status !== 409 && <button type="button" className="mc-pill" data-testid="mc-queued-retry" onClick={queue.retry}>{t("chatReact.queueRetry")}</button>}
  </>;
}

/** Media jobs of this kind still running for the user (Core's limit is per user); re-read every 10 s and after a refusal. */
function useMediaInFlight(kind: "image" | "video" | undefined, failure: unknown) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!kind) return;
    let live = true;
    const read = () => listGenerations(kind).then((rows) => {
      if (live) setCount(Array.isArray(rows) ? rows.filter((row) => ["queued", "submitting", "running", "ingesting"].includes(row?.status)).length : 0);
    }).catch(() => {});
    void read();
    const timer = setInterval(read, 10_000);
    return () => { live = false; clearInterval(timer); };
  }, [kind, failure]);
  return count;
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

function AttachButton({ t, onClick }: { t: Translate; onClick(): void }) {
  const count = useAuiState((s) => s.composer.attachments.length);
  const uploading = useAuiState((s) => s.composer.attachments.some((a) => a.status.type === "running"));
  const label = uploading ? t("common.attachmentUploading") : t("chatReact.attach");
  return (
    <ComposerPrimitive.AddAttachment className="mc-menu-item" role="menuitem" tabIndex={-1} onClick={onClick} data-testid="mc-attach" title={label} aria-label={label}
      data-busy={uploading || undefined} disabled={count >= MAX_ATTACHMENTS}>
      <FileMark kind="file" />{label}
    </ComposerPrimitive.AddAttachment>
  );
}

/**
 * MUYU-365 exp86c/exp98: switches at once to the first model that can send (read when the conversation mounted);
 * a second click leaves media mode; none = says why (not enabled here / upstream / none connected), never picks.
 */
function MediaPill({ kind, t, settings, running, inFlight = 0 }: { kind: "image" | "video"; t: Translate; settings: Settings; running: boolean; inFlight?: number }) {
  const limit = MEDIA_KINDS[kind].busyLimit;
  const options = settings.groups.find((group) => group.kind === kind)?.options ?? [];
  const none = settings.mediaNone?.(kind);
  const on = settings.media?.kind === kind;
  return (
    <button type="button" className="mc-pill" aria-disabled={!options.length || !!none || settings.busy || running} aria-pressed={on}
      aria-busy={on && settings.mediaPending || undefined} disabled={!options.length || settings.busy || running} data-testid={`mc-gen-${kind}`}
      aria-label={none ? `${t(`chatGen.kinds.${kind}`)} · ${none}` : undefined} title={none || undefined} onClick={() => settings.enter?.(kind)}>
      {kind === "image" ? <ImageMark /> : <VideoMark />}<span className="mc-pill-text">{t(`chatGen.kinds.${kind}`)}</span>
      {inFlight > 0 && <span className="mc-pill-count" data-testid={`mc-inflight-${kind}`}>{fillIn(t("chatReact.mediaInFlight"), { n: inFlight, m: limit })}</span>}
    </button>
  );
}

export type Settings = Pick<ReturnType<typeof useSettings>, "groups" | "model" | "backend" | "busy" | "pick"> & { compatible?(choice: Choice): boolean; media?: { kind: "image" | "video"; model: ModelChoice } | null; imageGate?: ImageGate; modelHint?: string; direct?: DirectMedia | null; mediaReady?: boolean; mediaPending?: boolean; loadWired?(fresh?: boolean): Promise<Wired>; enter?(kind: "image" | "video"): void; mediaNone?(kind: string): string | undefined; params?: Record<string, string>; setParam?(name: string, value: string): void };

/**
 * Composer on aui primitives: autosize Input (1–8 rows), AddAttachment, Send (aui disables it while
 * empty), Cancel as the stop square while running, and a queue button once there is text during a run.
 */
/** `controls` is the only way to add to the Controls menu: it renders inside the ModelControls panel, never as a second entry. */
export function Composer({ t, settings, placeholder, controls, workflow, grants, profile, queue, inFlight }: { queue?: { failure: SlotFailure | null; reason: string | null; retry(): void }; inFlight?: number; t: Translate; settings: Settings; placeholder: string; controls?: ReactNode; workflow?: ReactNode; grants?: ToolGrants; profile?: ComponentProps<typeof ModelControls>["profile"] }) {
  const menu = useMenu();
  const menuId = useId();
  const [toolsOpen, setToolsOpen] = useState<boolean | null>(null);
  const tools = useRef<HTMLDivElement>(null);
  const closeTools = () => { setToolsOpen(false); menu.trigger.current?.focus(); };
  useEffect(() => { if (toolsOpen) tools.current?.querySelector<HTMLElement>(".mc-grants button,select")?.focus(); }, [toolsOpen, grants?.loaded]);
  useEffect(() => {
    const reset = () => { setToolsOpen(null); menu.setOpen(false); };
    window.addEventListener(SESSION_CHANGE_EVENT, reset);
    return () => window.removeEventListener(SESSION_CHANGE_EVENT, reset);
  }, []);
  const hasImage = useAuiState((s) => s.composer.attachments.some((attachment) => attachment.type === "image" || attachment.contentType?.startsWith("image/")));
  const running = useAuiState((s) => s.thread.isRunning);
  const empty = useAuiState((s) => s.composer.isEmpty);
  const input = useAuiState((s) => s.composer.text);
  const actions = composerActions(running, empty);
  const sendLabel = t(running ? "chatReact.queueSend" : "common.send"); // queue while a reply runs
  // Media mode sends only with the model's job tool, every required choice made, and no active run (never queued).
  // MUYU-418: an image never goes to a model the catalog says cannot read it.
  const visionBlocked = hasImage && !settings.media && !!settings.imageGate?.block;
  const imageText = hasImage && !settings.media && settings.imageGate ? imageHint(settings.imageGate, t) : undefined;
  const full = !!settings.media && (inFlight ?? 0) >= MEDIA_KINDS[settings.media.kind].busyLimit;
  const blocked = settings.busy || visionBlocked || full || (!!settings.media && (running || !settings.direct
    || !directMediaReady(settings.direct, settings.params ?? {}, input)));
  return (
    <ComposerPrimitive.AttachmentDropzone className="mc-dropzone">
      <div className="mc-composer">
      {grants && toolsOpen !== null && <div ref={tools} className="mc-tools-panel" hidden={!toolsOpen} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeTools(); }
      }}>
        <div className="mc-tools-heading"><strong>{t("chatReact.toolGrant")}</strong><button type="button" className="mc-icon-btn" aria-label={t("chatReact.closeTools")} onClick={closeTools}><CrossMark /></button></div>
        <ToolGrantList grants={grants} t={t} />
        {workflow}
      </div>}
      <ComposerPrimitive.Root>
        <ComposerAttachmentChips t={t} />
        {grants && <ToolGrantChips grants={grants} t={t} />}
        {imageText && <p className="mc-hint" role="status" data-testid="mc-image-hint" data-vision={settings.imageGate!.state}>{imageText}</p>}
        <ComposerPrimitive.Queue>
          {() => (
            <div className="mc-queued" data-testid="mc-queued">
              <span className="mc-queued-label">{t("chatReact.queued")}</span>
              <QueueItemPrimitive.Text className="mc-queued-text" />
              {queue?.failure && <QueueReason t={t} queue={queue} />}
              <QueueItemPrimitive.Remove className="mc-chip-remove" aria-label={t("chatReact.queuedRemove")} title={t("chatReact.queuedRemove")}>×</QueueItemPrimitive.Remove>
            </div>
          )}
        </ComposerPrimitive.Queue>
        {settings.media && <div className="mc-media-panel" role="status" data-testid="mc-media-mode" aria-busy={settings.mediaPending || undefined}>
          <strong>{t(`model.types.${settings.media.kind}`)} · {settings.media.model.model}</strong>
          {full && <p className="mc-hint" role="alert" data-testid="mc-inflight-full">{fillIn(t("chatReact.mediaInFlightHint"), { n: inFlight, m: MEDIA_KINDS[settings.media.kind].busyLimit })}</p>}
          {settings.direct ? <DirectMediaFields direct={settings.direct} params={settings.params} setParam={settings.setParam} t={t} frame={!hasImage} /> : !settings.mediaPending && <p>{t("chatReact.mediaUnavailable")}</p>}
        </div>}
        <ComposerPrimitive.Input className="mc-input" rows={1} minRows={1} maxRows={8} autoFocus submitMode={(settings.media || visionBlocked) && blocked ? "none" : "enter"} placeholder={placeholder} aria-label={placeholder} />
        <div className="mc-toolbar">
          <div className="mc-model mc-add" ref={menu.root} onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) menu.setOpen(false);
          }} onKeyDown={event => {
            if (event.key === "Escape" && menu.open) { event.preventDefault(); event.stopPropagation(); menu.close(); }
            else if (event.key === "Tab") menu.setOpen(false);
            else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              if (!menu.open) menu.setOpen(true); else menu.rove(event.key);
            }
          }}>
            <button ref={menu.trigger} type="button" className="mc-round" aria-label={t("chatReact.addTools")} title={t("chatReact.addTools")} aria-haspopup="menu" aria-expanded={menu.open} aria-controls={menuId} onClick={() => menu.open ? menu.close() : menu.setOpen(true)}><PlusMark /></button>
            <div id={menuId} role="menu" className="mc-menu" hidden={!menu.open} aria-label={t("chatReact.addTools")}>
              <AttachButton t={t} onClick={menu.close} />
              {grants && <button type="button" role="menuitem" tabIndex={-1} className="mc-menu-item" onClick={() => { menu.setOpen(false); grants.load(); setToolsOpen(true); }}><ToolMark />{t("chatReact.toolGrant")}</button>}
            </div>
          </div>
          <MediaPill kind="image" t={t} settings={settings} running={running} inFlight={settings.media?.kind === "image" ? inFlight : undefined} />
          <MediaPill kind="video" t={t} settings={settings} running={running} inFlight={settings.media?.kind === "video" ? inFlight : undefined} />
          <ModelMenu t={t} groups={settings.groups} value={settings.media ? choiceValue(settings.media) : settings.model ? choiceValue({ kind: "chat", model: settings.model }) : ""}
            backend={settings.backend} disabled={settings.busy || running} onPick={settings.pick} hasImage={hasImage} compatible={settings.compatible} />
          {profile && !settings.media && <ModelControls t={t} disabled={settings.busy} profile={profile}>{controls}</ModelControls>}
          <span className="mc-spacer" />
          {actions[0] !== "stop" && (
            <ComposerPrimitive.Send className={running ? "mc-round" : "mc-send"} data-testid="mc-send" disabled={blocked} aria-label={sendLabel} title={sendLabel}><SendMark /></ComposerPrimitive.Send>
          )}
          {actions.includes("stop") && (
            <ComposerPrimitive.Cancel className="mc-send mc-send--stop" data-testid="mc-stop" aria-label={t("chatReact.stop")} title={t("chatReact.stop")}><StopMark /></ComposerPrimitive.Cancel>
          )}
        </div>
      </ComposerPrimitive.Root>
      </div>
      <p className="mc-hint">{t("chatReact.hint")}</p>
      {!settings.media && settings.modelHint && <p className="mc-hint" role="status">{settings.modelHint}</p>}
      {!profile && controls}
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
    <><button type="button" className="mc-chip mc-chip--link" title={`${t("common.attachmentDownload")} ${file.name}`} aria-busy={busy || undefined} disabled={busy} onClick={download}>
      {icon}<span className="mc-chip-name">{file.name}</span>{size}
    </button><StoredMediaPreview key={JSON.stringify(file)} file={file} t={t} /></>
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

function Step({ state, name, children }: { state: StepState; name: string; children?: ReactNode }) {
  return (
    <div className="mc-step" data-state={state} tabIndex={-1}>
      <div className="mc-step-head">
        <span className="mc-step-icon" aria-hidden="true" />
        <span className="mc-step-name">{name}</span>
      </div>
      {children}
    </div>
  );
}

function ToolStep({ part, t }: { part: { toolName: string; result?: unknown; isError?: boolean; status: { type: string }; timing?: { startedAt: number; completedAt?: number }; providerMetadata?: unknown }; t: Translate }) {
  const r = part.result as ToolResult | undefined;
  const sources = (r?.sources ?? []).filter((s) => s.url && /^https?:\/\//i.test(s.url));
  return (
    <Step state={stepState(coreStatus(part), part.status, part.isError)} name={part.toolName}>
      {r?.query && <p className="mc-step-detail"><b>{t("chatReact.query")}</b> {r.query}</p>}
      {sources.length > 0 && (
        <ul className="mc-tool-sources" aria-label={t("chatReact.sources")}>
          {sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.domain || s.url}</a></li>)}
        </ul>
      )}
      {r?.content && <details className="mc-call-record"><summary>{t("chatReact.callRecord")}</summary><pre className="mc-step-detail">{r.content}</pre></details>}
      {!!r?.messageId && getPlatformRuntime().useEmbeddedAuthorization().can("*:*:*") && <ToolIO key={r.messageId} messageId={r.messageId} failed={part.isError} t={t} />}
    </Step>
  );
}

const groupBy = (part: { type: string }) =>
  part.type === "data" || part.type === "tool-call"
    ? (part.type === "data" && !["process", "process-step"].includes((part as { name?: string }).name ?? "") ? null : ["group-process" as const])
    : null;

export function foldView(states: readonly StepState[]) {
  const done = states.filter((s) => s === "done").length;
  return { open: false, done };
}

/** The 执行过程 fold over one GroupedParts group: it renders the header itself (from the data-process part) so it owns aria-expanded. */
function ProcessFold({ indices, t, children }: { indices: readonly number[]; t: Translate; children: ReactNode }) {
  const parts = useAuiState((s) => s.message.parts);
  const group = indices.map((i) => parts[i]!);
  const head = (group.find((p) => p.type === "data" && p.name === "process") as { data?: ProcessPartData } | undefined)?.data;
  const view = foldView(group.filter((p) => p.type !== "data" || p.name === "process-step").map((p) => stepState(p.type === "data" ? (p.data as { status?: string }).status : coreStatus(p), p.status, (p as { isError?: boolean }).isError)));
  const [open, setOpen] = useState(view.open);
  const ttft = head?.ttft && formatReadout(head.ttft, t);
  return (
    <div className="mc-process-block">
    <details className="mc-process" data-status={head?.status} open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="mc-process-head" aria-expanded={open} aria-label={`${t("chatReact.process")} · ${head?.summary ?? ""}`}>
        <span className="mc-process-chevron"><ChevronMark size={16} /></span>
        <span className="mc-process-label">{t("chatReact.process")}</span>
        <span className="mc-process-summary">{head?.summary}</span>
      </summary>
      {ttft && <p className="mc-process-ttft" {...Object.fromEntries(Object.entries(head!.ttft!).map(([k, v]) => [`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v]))}>{ttft.detail}</p>}
      <div className="mc-process-history" tabIndex={0} role="region" aria-label={t("chatReact.process")}>{children}</div>
    </details>
    </div>
  );
}

function Parts({ t }: { t: Translate }) {
  const messageId = useAuiState((state) => state.message.id);
  return (
    <MessagePrimitive.GroupedParts groupBy={groupBy} indicator="empty">
      {({ part, children }) => {
        switch (part.type) {
          case "group-process":
            return <ProcessFold key={`${messageId}:${part.indices[0]}`} indices={part.indices} t={t}>{children}</ProcessFold>;
          case "indicator":
            return null;
          case "text":
            return <MarkdownText t={t} />;
          case "reasoning":
            return null;
          case "tool-call":
            return <ToolStep part={part} t={t} />;
          case "data":
            if (part.name === "thinking") {
              const thought = part.data as { text: string; active: boolean };
              return <ThinkingFold text={thought.text} label={t("chatReact.reasoning")} latest={t("chatReact.toBottom")} mark={<span className="mc-process-chevron"><ChevronMark size={16} /></span>} />;
            }
            if (part.name === "process-step") {
              return null;
            }
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
export function MessageRow({ role, t, locale, conversationId = "", evidence, actions, selection }: { role: string; t: Translate; locale?: string; conversationId?: string; evidence?: readonly SettlementEvidence[]; actions?: MessageActionsController; selection?: boolean }) {
  const messageId = useAuiState((state) => state.message.id);
  const createdAt = useAuiState((s) => s.message.createdAt);
  // Core's step_id for this reply (threadMessages.ts); the message id is not a turn.
  const turnId = useAuiState((s) => (s.message.metadata.custom as { turnId?: string }).turnId ?? "");
  const failed = useAuiState((s) => (s.message.metadata.custom as { failed?: boolean }).failed === true);
  const activity = useAuiState((state) => {
    const active = (state.message.metadata.custom as { turnActive?: boolean }).turnActive ?? state.message.status?.type === 'running';
    if (!active) return null;
    const call = [...state.message.parts].reverse().find(part => part.type === 'tool-call' && stepState(coreStatus(part), part.status, part.isError) === 'running');
    return call?.type === 'tool-call' ? call.toolName : '';
  });
  const isLast = useAuiState((s) => s.message.isLast);
  const isUser = role === "user";
  const time = formatMessageTime(createdAt?.toISOString());
  const author = isUser ? t("conversation.you") : t("home.greeting");
  const stamp = time && <time className="mc-time" dateTime={createdAt?.toISOString()}>{time}</time>;
  return (
    <MessagePrimitive.Root className="mc-msg" data-scroll-message={messageId} data-message-role={role} data-failed={failed || undefined} data-last={isLast || undefined}>
      {/* exp84 (OWUI UserMessage): the user side is the bubble alone; the exact time moves into its hover bar. */}
      {!isUser && <div className="mc-header">
        <span className="mc-avatar" aria-hidden="true"><AssistantMark /></span>
        <span className="mc-author" title={time || undefined}>{author}</span>
        {stamp}
      </div>}
      <div className="mc-bubble" aria-label={isUser ? author : undefined}>
        {!isUser && activity !== null && <p className="mc-process-current" role="status"><span className="mc-spinner" aria-hidden="true" /><span className="mc-shimmer">{activity || t('chatReact.processing')}</span></p>}
        <Parts t={t} />
        {isUser && <MessageAttachmentChips t={t} />}
      </div>
      <ActionBarPrimitive.Root className="mc-actions" aria-busy={actions?.busy} hideWhenRunning autohide="never">
        <MessageActions actions={actions} t={t} isUser={isUser} copy={<CopyAction t={t} />} />
        {isUser && stamp}
      </ActionBarPrimitive.Root>
      {!isUser && <TurnUsage t={t} locale={locale} usage={turnUsage({ conversationId, turnId }, evidence, activity !== null)} />}
      {!isUser && selection && conversationId && turnId && <Effective t={t} conversationId={conversationId} stepId={turnId} />}
    </MessagePrimitive.Root>
  );
}

const effective = new Map<string, Promise<EffectiveSelection | null>>();
/** exp113 (D-3): this turn's dispatched selection, read once per step and only where the stage-2 controls are shown. */
function Effective({ t, conversationId, stepId }: { t: Translate; conversationId: string; stepId: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const key = `${conversationId}/${stepId}`;
    let live = true;
    if (!effective.has(key)) effective.set(key, readEffectiveSelection(getPlatformRuntime().http, conversationId, stepId).catch(() => { effective.delete(key); return null; }));
    void effective.get(key)!.then((data) => { if (live) setText(effectiveSelectionLabel(data, t)); });
    return () => { live = false; };
  }, [conversationId, stepId, t]);
  return text ? <span className="mc-usage" data-testid="mc-effective-selection">{text}</span> : null;
}

const RECENT_KEY = "mc.recentModels";
/** 最近使用 (design-1123 P5 A): last 3 model values per executor, local only. */
function readRecent(): Record<string, string[]> {
  try { const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; }
}
/** Family heading for a chat model: the name up to its first "-" (deepseek-v4 → deepseek). */
const familyOf = (label: string) => label.split(/[-/]/)[0] || label;

/**
 * design-1123 B/C: one pill 「模型 · 执行器 ▾」 opening a searchable list, after OWUI c38885a Selector.svelte: the trigger
 * truncates the name (:937-938), the search box is a combobox that keeps focus with ↑↓ / Enter (:958-996), the list
 * scrolls at 18rem (:1114). Executors are a segmented control on top; 最近使用 first, then chat families, image, video.
 * Rule C: visibleOptions() drops unavailable / incompatible rows; the current one stays, marked ⚠.
 */
export function ModelMenu(props: { t: Translate; groups: Group[]; value: string; backend: string | null; disabled: boolean; onPick(choice: Choice | null): void; defaultOpen?: boolean; hasImage?: boolean; onOpen?(): void; compatible?(choice: Choice): boolean }) {
  const { t, groups } = props;
  const { open, setOpen, root, trigger, close: shut } = useMenu(props.defaultOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState(readRecent);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const backendValue = props.backend ? choiceValue({ kind: "executor", backend: props.backend }) : "";
  const all = groups.filter((g) => g.kind !== "executor").flatMap((g) => g.options);
  const current = all.find((o) => o.value === props.value);
  const executors = groups.find((g) => g.kind === "executor")?.options ?? [];
  const executor = executors.find((o) => o.value === backendValue)?.label;
  const stale = !!current && (!!current.unavailable || (props.compatible ? !props.compatible(current.choice) : false));
  const model = current?.label ?? t("common.modelDefault");
  const close = () => { shut(); setQuery(""); };
  useEffect(() => { if (open) { setActive(0); search.current?.focus(); } }, [open]);
  const needle = query.trim().toLowerCase();
  const visible = (g: Group) => visibleOptions(g.options.map((o) => props.compatible && g.kind === "chat" && !props.compatible(o.choice) ? { ...o, incompatible: true as const } : o), props.value)
    .filter((o) => !needle || o.label.toLowerCase().includes(needle));
  const chats = groups.find((g) => g.kind === "chat");
  const chatRows = chats ? visible(chats) : [];
  const mine = recent[props.backend ?? ""] ?? [];
  const recentRows = needle ? [] : mine.flatMap((v) => chatRows.filter((o) => o.value === v));
  const sections: { key: string; kind: string; title: string; rows: (Option | null)[] }[] = [];
  if (!needle) sections.push({ key: "default", kind: "chat", title: t("model.types.chat"), rows: [null] });
  if (recentRows.length) sections.push({ key: "recent", kind: "chat", title: t("chatReact.recent"), rows: recentRows });
  const families = new Map<string, Option[]>();
  for (const o of chatRows) if (!recentRows.includes(o)) families.set(familyOf(o.label), [...(families.get(familyOf(o.label)) ?? []), o]);
  for (const [family, rows] of families) sections.push({ key: `family:${family}`, kind: "chat", title: family, rows });
  for (const g of groups) if (g.kind === "image" || g.kind === "video") { const rows = visible(g); if (rows.length) sections.push({ key: g.kind, kind: g.kind, title: t(`model.types.${g.kind}`), rows }); }
  const flat = sections.flatMap((s) => s.rows);
  const at = Math.min(active, Math.max(flat.length - 1, 0));
  const blockedOf = (o: Option | null) => o && props.hasImage && o.vision === "unsupported" ? t("chatReact.visionBlocked") : undefined;
  const choose = (o: Option | null) => {
    if (blockedOf(o)) return;
    if (o?.choice.kind === "chat" && props.backend) {
      const next = { ...readRecent(), [props.backend]: [o.value, ...mine.filter((v) => v !== o.value)].slice(0, 3) };
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode: 最近使用 stays in memory */ }
      setRecent(next);
    }
    close(); props.onPick(o ? o.choice : null);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape" || e.key === "Tab") { if (e.key === "Escape") e.preventDefault(); close(); return; }
    if (e.target !== search.current) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(at + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(at - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat.length) choose(flat[at] ?? null); }
  };
  let index = -1;
  const row = (o: Option | null) => {
    const i = ++index;
    const value = o ? o.value : "";
    const blocked = blockedOf(o);
    return <div key={`${i}:${value}`} id={`${listId}-${i}`} role="option" className="mc-menu-item" aria-selected={value === props.value} data-active={i === at || undefined}
      aria-disabled={blocked ? true : undefined} title={blocked} onMouseMove={() => i !== at && setActive(i)} onClick={() => choose(o)}>
      <span className="mc-menu-text">{o ? o.label : t("common.modelDefault")}{o?.hint && <span className="mc-menu-hint">{o.hint}</span>}</span>
      {o?.stale && <span className="mc-menu-tag mc-tag-warn">⚠</span>}
      {o?.vision === "supported" && <span className="mc-menu-tag" data-testid="mc-vision">{t("chatReact.badgeVision")}</span>}
      {o?.unprobed && <span className="mc-menu-tag" data-testid="mc-unprobed">{t("chatReact.availabilityUnprobed")}</span>}
      {o?.upstream && <span className="mc-menu-tag" data-testid="mc-upstream">{o.upstream}</span>}
      {value === props.value && <CheckMark size={14} />}
    </div>;
  };
  const name = [model, executor].filter(Boolean).join(" · ");
  return (
    <div className="mc-model mc-model-picker" ref={root} onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" className="mc-pill mc-model-trigger" data-testid="mc-model" aria-haspopup="listbox" aria-expanded={open} data-stale={stale || undefined}
        aria-label={[t("chatReact.pickerLabel"), model, current?.hint, current?.upstream, executor, stale && t("chatReact.modelStale")].filter(Boolean).join(" · ")}
        title={[name, current?.upstream && `${t("chatReact.upstream")}: ${current.upstream}`].filter(Boolean).join(" · ")} disabled={props.disabled}
        onClick={() => { props.onOpen?.(); if (open) close(); else setOpen(true); }}>
        {stale && <span aria-hidden="true">⚠</span>}<span className="mc-model-name">{model}</span>{executor && <><span className="mc-model-sep" aria-hidden="true">·</span><span className="mc-model-exec">{executor}</span></>}<ChevronMark size={12} />
      </button>
      {open && <div className="mc-scrim" onClick={close} />}
      <div className="mc-menu" data-testid="mc-model-menu" hidden={!open} aria-label={t("chatReact.pickerLabel")}>
        <div className="mc-grab" aria-hidden="true" />
        {stale && <p className="mc-notice" role="status" data-testid="mc-model-stale">{t("chatReact.modelStale")}</p>}
        <div className="mc-search"><input ref={search} data-testid="mc-model-search" value={query} placeholder={t("chatReact.searchModel")} aria-label={t("chatReact.searchModel")}
          role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={flat.length ? `${listId}-${at}` : undefined} autoComplete="off"
          onChange={(e) => { setQuery(e.target.value); setActive(0); }} /></div>
        {executors.length > 1 && <div className="mc-segments" role="radiogroup" aria-label={t("chatReact.executor")} data-testid="mc-executors">
          {executors.map((o) => <button key={o.value} type="button" role="radio" aria-checked={o.value === backendValue} onClick={() => { if (o.value !== backendValue) props.onPick(o.choice); }}>{o.label}</button>)}
        </div>}
        <div id={listId} role="listbox" aria-label={t("chatReact.pickerLabel")} className="mc-list" style={{ maxHeight: "18rem" }}>
          {flat.length ? sections.map((s) => <div key={s.key} role="group" aria-label={s.title} data-kind={s.kind} className="mc-menu-group" data-testid={s.key === "recent" ? "mc-recent" : undefined}>
            {s.key !== "default" && <div className="mc-menu-label" aria-hidden="true">{s.title}</div>}{s.rows.map(row)}
          </div>) : <p className="mc-menu-label">{t("chatReact.noResults")}</p>}
        </div>
      </div>
    </div>
  );
}

/** Model + executor of this conversation (or of the next new one); PATCH on change like Conversation.vue. */
const NO_EVIDENCE: readonly SettlementEvidence[] = [];

/**
 * One conversation's settlement rows through the injected reader, read again whenever `refresh` changes and,
 * while a turn is still pending, after a growing wait (a receipt can land after the run ended).
 * Without a reader nothing is requested. A newer read cancels the older one; a failed or malformed read
 * drops what was shown instead of keeping a stale total.
 */
export function useSettlement(conversationId: string | undefined, read: SettlementReader | undefined, refresh?: unknown, steps = '') {
  // exp117: rows are kept with the conversation they answer for; until this conversation's first read answers (or 5 s
  // pass) the hook returns LOADING_EVIDENCE, so a settled turn does not flash 计费中 first.
  const [seen, setSeen] = useState<{ id?: string; rows: readonly SettlementEvidence[] }>({ rows: NO_EVIDENCE });
  const setEvidence = (rows: readonly SettlementEvidence[]) => setSeen({ id: conversationId, rows });
  useEffect(() => {
    if (!conversationId || !read) return;
    const abort = new AbortController();
    const slow = setTimeout(() => setSeen((was) => was.id === conversationId ? was : { id: conversationId, rows: NO_EVIDENCE }), 5000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outstanding = false;
    let pending = true;
    const load = (wait: number) => {
      if (outstanding || abort.signal.aborted) return;
      outstanding = true;
      // A rejection (an Error) is no rows, like any other malformed result.
      const show = (rows: unknown) => {
        if (abort.signal.aborted) return;
        outstanding = false;
        const next = settlementRows(rows);
        setEvidence(next);
        const expected = steps ? steps.split(',') : next.filter((row) => row.conversationId === conversationId).map((row) => row.turnId);
        pending = !expected.length || expected.some((turnId) => turnUsage({ conversationId, turnId }, next).state !== 'settled');
        if (wait < 1e5 && pending) timer = setTimeout(load, wait, wait * 2);
      };
      read(conversationId, abort.signal).then(show, show);
    };
    const resume = () => { if (pending && document.visibilityState !== 'hidden') { clearTimeout(timer); load(3000); } };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    load(3000);
    return () => { abort.abort(); clearTimeout(timer); clearTimeout(slow); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [conversationId, read, refresh, steps]);
  return !conversationId || !read ? NO_EVIDENCE : seen.id === conversationId ? seen.rows : LOADING_EVIDENCE;
}

/** fix-media-365: Core's media API as a job form: the text goes to `input`, each multi-valued registry param is a required choice. */
function coreJob(kind: "image" | "video", t: Translate): DirectMedia {
  const params = MEDIA_KINDS[kind].params.filter((param) => param.values.length > 1);
  return { toolId: 0, prompt: "input", schema: { invocation: { toolId: 0, revision: "0" }, inputSchema: { type: "object", additionalProperties: false, required: ["input", ...params.map((param) => param.key)],
    properties: { input: { type: "string" }, ...Object.fromEntries(params.map((param) => [param.key, { type: "string", enum: param.values, default: param.default, description: t(`chatGen.param.${param.key}`) }])) } } } };
}

export function useSettings(conversationId: string | undefined, t: Translate) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [backends, setBackends] = useState<ExecutionBackendOption[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [model, setModel] = useState<ModelChoice | null>(null);
  const [media, setMedia] = useState<{ kind: "image" | "video"; model: ModelChoice } | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [strategy, setStrategy] = useState<ChatStrategy | null>(null);
  const [models, setModels] = useState<TypedModel[]>([]);
  const selectionRevision = useRef(0);

  useEffect(() => {
    let live = true;
    setMedia(null);
    const revision = selectionRevision.current;
    let policy = cachedChatStrategy(window.location.origin);
    void loadChatStrategy(window.location.origin).then((loaded) => {
      policy = loaded;
      if (live) setStrategy(loaded);
    });
    setBusy(true);
    void Promise.all([
      listProviders().catch(() => [] as Provider[]),
      listAllTypedModels({ includeUnavailable: true }).catch(() => null),
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
          explicit: false, backend: nextBackend, models: chatModels.filter((entry) => availabilityOf(entry).state !== "unavailable"),
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

  // Direct media models: each one's Toolgate job tool and real parameters (null = a ready row whose schema cannot
  // carry the prompt). An existing conversation sends only with the tool bound to it (Core validates against the
  // conversation's tools): a cataloged job tool is bound on selection when the owner may edit (`bind`), else it is
  // `false` (not enabled here). MUYU-365 exp98: read once when the conversation mounts (and after a session change),
  // so a pill switches at once; only the newest read is shown. A failed read closes all.
  const [wired, setWired] = useState<{ key?: string; found: Wired }>();
  const [params, setParams] = useState<Record<string, string>>({});
  const [mediaPending, setPending] = useState(false);
  const mediaRun = useRef(0);
  const wiring = useRef<{ key?: string; read: Promise<Wired>; bound?: SessionBindings | null }>(undefined);
  const loadWired = (fresh?: unknown) => {
    if (fresh || !wiring.current || wiring.current.key !== conversationId) {
      const key = conversationId;
      const current: NonNullable<typeof wiring.current> = { key, read: Promise.all([listToolCatalogPages(), key ? getSessionBindings(key) : null]).then(([rows, bound]) => {
        current.bound = bound;
        const names = [...new Set(rows.flatMap((row) => row.imported && row.status === "ready" && row.mediaModel ? [row.mediaModel] : []))];
        const mine = bound ? rows.filter((row) => bound.toolIds.includes(row.id)) : rows;
        return Promise.all(names.map(async (name) => {
          const own = await directMediaTool(name, mine, toolSchema);
          const other = !own && bound && await directMediaTool(name, rows.filter((row) => !bound.toolIds.includes(row.id)), toolSchema);
          return [name, other ? bound.editable && { ...other, bind: true as const } : own] as const;
        }));
      }).then(Object.fromEntries, () => ({})) };
      wiring.current = current;
      void current.read.then((found) => { if (wiring.current === current) setWired({ key, found }); });
    }
    return wiring.current!.read;
  };
  useEffect(() => {
    const refresh = () => { if (wiring.current) void loadWired(true); };
    // The grants panel and this hook replace the same revisioned set.
    const bound = (event: Event) => { if (wiring.current?.bound) wiring.current.bound = (event as CustomEvent<SessionBindings>).detail; };
    void loadWired(true);
    window.addEventListener(SESSION_CHANGE_EVENT, refresh);
    window.addEventListener(BINDINGS_EVENT, bound);
    return () => { window.removeEventListener(SESSION_CHANGE_EVENT, refresh); window.removeEventListener(BINDINGS_EVENT, bound); };
  }, [conversationId]);
  const found = wired && wired.key === conversationId ? wired.found : undefined;
  // A job tool still to be bound to this conversation cannot send yet (Core checks the bound set). Any other model
  // (no job tool, no prompt field, not enabled here) sends through Core's media API with the registry's choices.
  const entry = media && found?.[media.model.model];
  const viaCore = useMemo(() => media && coreJob(media.kind, t), [media?.kind, t]);
  const direct = !media || !found || mediaPending ? null : entry ? entry.bind ? null : entry : viaCore;
  useEffect(() => { setParams(direct ? mediaDefaults(direct) : {}); }, [direct && direct.toolId, media?.model.model, media?.kind]);

  // Settles a media selection against the read: the preferred model if it can send (else, unless strict, the first
  // of its kind that can), binding its job tool to this conversation first when needed. Nothing = leave and say why.
  const settle = async (kind: "image" | "video", preferred: string, strict: boolean, run: number) => {
    const read = await loadWired();
    const live = () => run === mediaRun.current;
    if (!live()) return;
    const options = groups.find((group) => group.kind === kind)?.options.filter((option) => !option.unavailable) ?? [];
    const name = read[preferred] || strict ? preferred : options.find((option) => read[option.label])?.label ?? preferred;
    let entry = read[name];
    if (entry && entry.bind) {
      const current = wiring.current!;
      try {
        const bound = await updateSessionBindings(conversationId!, { toolIds: [...current.bound!.toolIds, entry.toolId], revision: current.bound!.revision });
        window.dispatchEvent(new window.CustomEvent(BINDINGS_EVENT, { detail: bound }));
        current.bound = bound;
        const { bind: _, ...ready } = entry;
        const next = { ...await current.read, [name]: ready };
        current.read = Promise.resolve(next);
        if (wiring.current === current) setWired({ key: current.key, found: next });
        entry = ready;
      } catch {
        if (live()) { setPending(false); setMedia(null); toast.error(t("common.bindingsSaveFailed")); }
        return;
      }
    }
    if (!live()) return;
    setPending(false);
    const option = options.find((option) => option.label === name);
    if (option) setMedia({ kind, model: (option.choice as { model: ModelChoice }).model });
    else if (!strict) setMedia(null);
  };
  const enter = (kind: "image" | "video") => {
    const run = ++mediaRun.current;
    if (media?.kind === kind) { setPending(false); setMedia(null); return; }
    const guess = labeledGroups.find((group) => group.kind === kind)?.options.find((option) => !option.unavailable);
    if (!guess) return void toast.info(noneReason(kind) ?? t("chatReact.mediaNone"));
    setMedia({ kind, model: (guess.choice as { model: ModelChoice }).model });
    setPending(true);
    void settle(kind, guess.label, false, run);
  };
  // Why a kind has nothing to send: every listed model is upstream-unavailable, or none is listed.
  const noneReason = (kind: string) => {
    const options = groups.find((group) => group.kind === kind)?.options ?? [];
    return options.some((option) => !option.unavailable) ? undefined : t(options.length ? "chatReact.mediaUpstream" : "chatReact.mediaNone");
  };

  const allowedFor = (m: ModelChoice | null, id: string | null) => {
    const option = backends.find((b) => b.id === id);
    return !option || executionBackendCompatibility(option, m, providers).allowed;
  };

  async function pick(choice: Choice | null) {
    if (choice?.kind === "image" || choice?.kind === "video") {
      const listed = groups.find((group) => group.kind === choice.kind)?.options.some((option) => option.value === choiceValue(choice));
      if (listed && !busy) await settle(choice.kind, choice.model.model, true, ++mediaRun.current);
      return;
    }
    mediaRun.current++;
    setPending(false);
    if (media && choice?.kind === "chat" && model && choice.model.model === model.model && String(choice.model.providerId) === String(model.providerId)) {
      setMedia(null);
      return;
    }
    const entry = choice?.kind === "chat" ? models.find((m) => String(m.providerId) === String(choice.model.providerId) && m.model === choice.model.model) : undefined;
    if (entry && availabilityOf(entry).state === "unavailable") return;
    const nextModel = choice === null ? null : choice.kind === "chat" ? choice.model : model;
    const nextBackend = choice?.kind === "executor" ? choice.backend : backend;
    if (!allowedFor(nextModel, nextBackend)) { toast.warning(t("common.executionBackendSelectionInvalid")); return; }
    selectionRevision.current += 1;
    if (!conversationId || !nextBackend) { setModel(nextModel); setBackend(nextBackend); if (choice?.kind !== "executor") setMedia(null); return; }
    setBusy(true);
    try {
      const saved = await updateConversationSettings(conversationId, nextModel, nextBackend);
      setModel(conversationModelChoice(saved) ?? nextModel);
      setBackend(saved.executionBackend?.trim() || nextBackend);
      if (choice?.kind !== "executor") setMedia(null);
      toast.success(t("common.executionSettingsSwitched"));
    } catch (error) {
      toast.error(modelErrorMessage(error, t, t("common.executionSettingsSwitchFailed")));
    } finally {
      setBusy(false);
    }
  }

  // Image/video (fix-media-365): only the catalog's availability greys a model; available ones come first.
  const labeledGroups = groups.map((group) => group.kind === "chat" ? !strategy ? group : {
    ...group, options: group.options.map((option) => ({ ...option, hint: `${option.hint ?? ""} · ${measurementHint(strategy, (option.choice as { model: ModelChoice }).model)}` })),
  } : group.kind === "executor" ? group : { ...group, options: [...group.options].sort((a, b) => +!!a.unavailable - +!!b.unavailable) });
  // design-1123 C: an executor-incompatible chat model is not listed (was: toast on pick).
  return { groups: labeledGroups, model, media, backend, busy, pick, compatible: (choice: Choice) => choice.kind !== "chat" || allowedFor(choice.model, backend), allowed: allowedFor(model, backend), effortEvidence: effortEvidence(strategy, model, backend), direct, mediaReady: !!found, mediaPending, loadWired, enter, mediaNone: (kind: string) => noneReason(kind), params,
    setParam: (name: string, value: string) => setParams({ ...params, [name]: value }),
    imageGate: imageGate(model, models), modelHint: strategy && model ? measurementHint(strategy, model) : undefined };
}
