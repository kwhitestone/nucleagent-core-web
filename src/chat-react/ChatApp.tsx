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
import { getSessionBindings, updateSessionBindings, type SessionBindings } from "@/addons/conversation/api/sessionBindings";
import { conversationModelChoice } from "@/addons/conversation/composables/conversationModelRestore";
import { executionBackendCompatibility } from "@/addons/conversation/composables/executionBackendCompatibility";
import { modelErrorMessage } from "@/addons/conversation/composables/modelErrorMessage";
import { createConversationState, MAX_ATTACHMENTS, type ConversationLocale } from "@/addons/conversation/task-conversation/core";
import { openSealedLinkOnClick } from "@/addons/conversation/task-conversation/sealedLink";
import { copyRawBody, formatMessageTime } from "@/addons/conversation/components/conversation/messageCopy";
import { toast } from "@/composables/useToast";
import { externalStore, sendAppend, type ChatController } from "./externalStore";
import { useSingleSlotQueue } from "./singleSlotQueue";
import { isRunning, type MediaPartData, type ProcessPartData, type ToolResult } from "./threadMessages";
import { choiceValue, modelGroups, type Choice, type Group, type Option } from "./modelGroups";
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
import { cap, effortView, sentEffort, serverEvidence, withRequestEffort, type EffortChoice, type EffortEvidence } from "./requestEffort";
import { ModelControls, useMenu } from "./ModelControls";
import { TurnUsage } from "./TurnUsage";
import { settlementRows, turnUsage, type SettlementEvidence, type SettlementReader } from "./turnUsage";
import { profileEffortView, profileRequest } from "./modelProfile";
import { useModelPreference } from "./useModelPreference";
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
  // exp101 (5) / exp104: the stored profile and the one in effect stay apart; with the switch off none takes effect and
  // an effort change writes the stored one back as is (D7A: effort has priority, the preset only adds the rest).
  const storedProfileId = preference.storedProfileId;
  const profile = PROFILE_UI_ENABLED ? preference.profile : null;
  const measured = useEffort(settings);
  // 406 §2.1: the levels on offer are the evidence view narrowed by the selected profile's server whitelist.
  const offered = profileEffortView(measured.view, profile, profileScope);
  const effort = { choice: preference.choice, view: { ...offered, profileOff: profile ? offered.off.filter((level) => !measured.view.off.includes(level)) : [] }, sent: sentEffort(preference.choice, offered), set: (value: EffortChoice) => { void preference.save(storedProfileId, value); } };
  // This turn's one field set: the selected profile (406's effort rides in modelParams) or the legacy effort alone.
  const turn = profileRequest(profile, profileScope, effort.sent);
  // D1A/D6A/S1–S8: the 「预设」 row exists only when this model has presets (or their load failed, S7).
  const pending = preference.pending;
  const shownId = pending ? pending.profileId : storedProfileId;
  const shown = preference.catalog.find((row) => row.id === shownId && shownId);
  const profilePanel = PROFILE_UI_ENABLED && (preference.catalog.length > 0 || preference.error) ? {
    summary: shown ? shown.displayName || shown.id : t("chatReact.effortDefault"), name: shown ? shown.displayName || shown.id : undefined,
    page: <ProfileControls t={t} rows={preference.catalog} selected={shownId} saving={!!pending} rolledBack={preference.rolledBack} error={preference.error && !pending}
      outside={!!profile && !!preference.choice && offered.off.includes(preference.choice)}
      onChange={(profileId) => { void preference.save(profileId, preference.choice); }} onRetry={preference.reload} />,
  } : undefined;
  const turnNow = useRef(turn);
  turnNow.current = turn;
  const defaultModelNow = useRef<ModelChoice | undefined>(undefined);
  defaultModelNow.current = !selectedSettings.model && preference.ready ? settings.model ?? undefined : undefined;
  const core = useCoreConversation(conversationId, report, () => turnNow.current, () => defaultModelNow.current);
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
  // New conversation with the current model and executor, then open it.
  // withTurn: this turn's effort or profile; never on a media/workflow job, which carries its own parameters.
  const start = async (request: Partial<CreateConversationRequest> & { input: string }, withTurn = false) => {
    if (withTurn && !preference.ready) throw new Error(t("chatReact.preferenceError"));
    const payload: CreateConversationRequest = {
      mode: "a2a_agent", model: settings.model?.model ?? "", providerId: settings.model?.providerId,
      executionBackend: settings.backend ?? undefined, ...request,
    };
    const created = await props.create(!withTurn ? payload : typeof turn === "string" ? withRequestEffort(payload, turn, settings.backend) : { ...payload, ...turn });
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
      const { toolInvocation, files: rest } = media(settings.direct, text, files);
      await core.controller.send(text, rest, toolInvocation).catch((error) => {
        throw new Error((error as { status?: number }).status ? (error as Error).message : t("chatReact.workflowUnknown"));
      });
    }),
    stop: () => core?.controller.stop() ?? Promise.resolve(),
    loadOlder: () => core?.controller.loadOlder() ?? Promise.resolve(),
  };
  // Only an existing conversation queues; the new-chat composer is never running.
  const slot = useSingleSlotQueue(conversationId, !!core && isRunning(core.state), (m) => sendAppend(controller, m));
  const adapter: ExternalStoreAdapter<ThreadMessageLike> = conversationId
    ? externalStore(core?.state ?? EMPTY, controller, view, attachments, slot)
    : { ...externalStore(EMPTY, {
      send: guard(async (input, files) => {
        if (settings.busy) throw new Error(t("chatReact.loading"));
        if (!settings.allowed) throw new Error(t("common.executionBackendSelectionInvalid"));
        const { files: rest = files, ...direct } = settings.direct ? media(settings.direct, input, files) : {};
        try {
          await start({
            input,
            ...(grants.ids.length ? { toolIds: grants.ids } : {}),
            ...direct,
            ...(rest?.length ? { attachments: rest.map((f) => ({ fileId: f.id, name: f.name })) } : {}),
          }, !settings.media);
        } catch (error) {
          toast.error(modelErrorMessage(error, t, t("home.createFailed")));
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
          <ThreadPrimitive.Messages>{({ message }) => <MessageRow role={message.role} t={t} locale={locale} conversationId={conversationId} evidence={evidence} actions={messageActions} />}</ThreadPrimitive.Messages>
        </ScrollViewport>
          <div className="mc-footer">
            <ScrollToLatest className="mc-to-bottom" aria-label={t("chatReact.toBottom")} title={t("chatReact.toBottom")}>↓</ScrollToLatest>
            <Composer t={t} settings={settings} effort={effort} grants={grants}
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
function MediaPill({ kind, t, settings, running }: { kind: "image" | "video"; t: Translate; settings: Settings; running: boolean }) {
  const options = settings.groups.find((group) => group.kind === kind)?.options ?? [];
  const none = settings.mediaNone?.(kind);
  const on = settings.media?.kind === kind;
  return (
    <button type="button" className="mc-pill" aria-disabled={!options.length || !!none || settings.busy || running} aria-pressed={on}
      aria-busy={on && settings.mediaPending || undefined} disabled={!options.length || settings.busy || running} data-testid={`mc-gen-${kind}`}
      aria-label={none ? `${t(`chatGen.kinds.${kind}`)} · ${none}` : undefined} title={none || undefined} onClick={() => settings.enter?.(kind)}>
      {kind === "image" ? <ImageMark /> : <VideoMark />}<span className="mc-pill-text">{t(`chatGen.kinds.${kind}`)}</span>
    </button>
  );
}

export type Settings = Pick<ReturnType<typeof useSettings>, "groups" | "model" | "backend" | "busy" | "pick"> & { media?: { kind: "image" | "video"; model: ModelChoice } | null; imageGate?: ImageGate; modelHint?: string; direct?: DirectMedia | null; mediaReady?: boolean; mediaPending?: boolean; loadWired?(fresh?: boolean): Promise<Wired>; enter?(kind: "image" | "video"): void; mediaNone?(kind: string): string | undefined; params?: Record<string, string>; setParam?(name: string, value: string): void };

/**
 * Composer on aui primitives: autosize Input (1–8 rows), AddAttachment, Send (aui disables it while
 * empty), Cancel as the stop square while running, and a queue button once there is text during a run.
 */
/** `controls` is the only way to add to the Controls menu: it renders inside the ModelControls panel, never as a second entry. */
export function Composer({ t, settings, placeholder, effort, controls, workflow, grants, profile }: { t: Translate; settings: Settings; placeholder: string; effort?: { choice: EffortChoice; sent: EffortChoice; set(value: EffortChoice): void; view: ComponentProps<typeof ModelControls>["view"] }; controls?: ReactNode; workflow?: ReactNode; grants?: ToolGrants; profile?: ComponentProps<typeof ModelControls>["profile"] }) {
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
  const blocked = settings.busy || visionBlocked || (!!settings.media && (running || !settings.direct
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
              <QueueItemPrimitive.Remove className="mc-chip-remove" aria-label={t("chatReact.queuedRemove")} title={t("chatReact.queuedRemove")}>×</QueueItemPrimitive.Remove>
            </div>
          )}
        </ComposerPrimitive.Queue>
        {settings.media && <div className="mc-media-panel" role="status" data-testid="mc-media-mode" aria-busy={settings.mediaPending || undefined}>
          <strong>{t(`model.types.${settings.media.kind}`)} · {settings.media.model.model}</strong>
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
          <MediaPill kind="image" t={t} settings={settings} running={running} />
          <MediaPill kind="video" t={t} settings={settings} running={running} />
          <ModelMenu t={t} groups={settings.groups} value={settings.media ? choiceValue(settings.media) : settings.model ? choiceValue({ kind: "chat", model: settings.model }) : ""}
            backend={settings.backend} disabled={settings.busy || running} onPick={settings.pick} hasImage={hasImage} />
          {effort && !settings.media && <ModelControls t={t} value={effort.sent} view={effort.view} onChange={effort.set} disabled={settings.busy} profile={profile}>{controls}</ModelControls>}
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
    </ComposerPrimitive.AttachmentDropzone>
  );
}

/**
 * The effort levels this model offers (evidence view). The choice itself is the server preference (MUYU-408,
 * /model-preferences); exp104 removed the old per-browser memory, which ChatApp always overrode.
 */
export function useEffort(settings: { model: ModelChoice | null; backend: string | null; effortEvidence?: ReturnType<typeof effortEvidence> }) {
  const key = settings.model ? `${settings.model.providerId}:${settings.model.model}` : "default";
  // MUYU-365 exp3: without measured strategy evidence, Core's per-model whitelist (/model-profiles `efforts`) decides.
  const [server, setServer] = useState<{ key: string; evidence?: EffortEvidence }>();
  const ask = settings.backend === "codex" && !!settings.model && !settings.effortEvidence;
  useEffect(() => {
    if (!ask) return;
    let live = true;
    getPlatformRuntime().http.get<{ data: { efforts?: string[] }[] }>("/api/v1/addons/conversation/model-profiles", {
      params: { executionBackend: "codex", providerId: settings.model!.providerId, model: settings.model!.model },
    }).then((response) => { if (live) setServer({ key, evidence: serverEvidence(response.data.data) }); }).catch(() => {});
    return () => { live = false; };
  }, [ask, key]);
  return { view: effortView(settings.backend, settings.effortEvidence ?? (ask && server?.key === key ? server.evidence : undefined)) };
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
export function MessageRow({ role, t, locale, conversationId = "", evidence, actions }: { role: string; t: Translate; locale?: string; conversationId?: string; evidence?: readonly SettlementEvidence[]; actions?: MessageActionsController }) {
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
      {!isUser && <TurnUsage t={t} locale={locale} usage={turnUsage({ conversationId, turnId }, evidence)} />}
    </MessagePrimitive.Root>
  );
}

/**
 * Model + executor menu over modelGroups.ts (chat / image / video / executor). A popover of
 * menuitemradio buttons: arrows/Home/End move, Enter/Space pick, Escape or an outside click closes.
 * Image/video models fold into one disabled 即将开放 row in the MVP (no paid calls).
 */
export function ModelMenu(props: { t: Translate; groups: Group[]; value: string; backend: string | null; disabled: boolean; onPick(choice: Choice | null): void; defaultOpen?: boolean; hasImage?: boolean; onOpen?(): void }) {
  const { t, groups } = props;
  const { open, setOpen, root, trigger, close: shut, rove } = useMenu(props.defaultOpen);
  const backendValue = props.backend ? choiceValue({ kind: "executor", backend: props.backend }) : "";
  const options = groups.flatMap((g) => g.options);
  const current = options.find((o) => o.value === props.value);
  const model = current?.label ?? t("common.modelDefault");
  const executor = options.find((o) => o.value === backendValue)?.label;
  const label = (g: Group) => (g.kind === "executor" ? t("chatReact.executor") : t(`model.types.${g.kind}`));
  const choose = (choice: Choice | null) => { shut(); props.onPick(choice); };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape" || e.key === "Tab") { if (e.key === "Escape") e.preventDefault(); shut(); return; }
    if (rove(e.key)) e.preventDefault();
  };
  const item = (key: string, text: string, checked: boolean, onSelect: () => void, hint?: string, upstream?: string, o?: Option) => {
    // MUYU-418: unavailable (reason shown) and, with an image attached, image-incapable models cannot be picked.
    const blocked = o?.unavailable ? t(`chatReact.unavailable_${o.unavailable}`) : props.hasImage && o?.vision === "unsupported" ? t("chatReact.visionBlocked") : undefined;
    return <button key={key} type="button" role="menuitemradio" tabIndex={-1} className="mc-menu-item" aria-checked={checked}
      aria-disabled={blocked ? true : undefined} title={blocked} onClick={blocked ? undefined : onSelect}>
      <span className="mc-menu-text">{text}{hint && <span className="mc-menu-hint">{hint}</span>}</span>
      {o?.unavailable && <span className="mc-menu-tag" data-testid="mc-unavailable">{blocked}</span>}
      {o?.unprobed && <span className="mc-menu-tag" data-testid="mc-unprobed">{t("chatReact.availabilityUnprobed")}</span>}
      {o?.vision && <span className="mc-menu-tag" data-testid="mc-vision" data-vision={o.vision}>{t(`chatReact.vision${cap(o.vision)}`)}</span>}
      {upstream && <span className="mc-menu-tag" data-testid="mc-upstream">{upstream}</span>}{checked && <CheckMark size={14} />}
    </button>;
  };
  const section = (kind: string, title: string, body: ReactNode, bare?: boolean) => (
    <div key={kind} role="group" aria-label={title} data-kind={kind} className="mc-menu-group">
      {!bare && <div className="mc-menu-label" aria-hidden="true">{title}</div>}{body}
    </div>
  );
  return (
    <div className="mc-model mc-model-picker" ref={root} onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" className="mc-pill mc-model-trigger" data-testid="mc-model" aria-haspopup="menu" aria-expanded={open}
        aria-label={[t("chatReact.pickerLabel"), model, current?.hint, current?.upstream, executor].filter(Boolean).join(" · ")}
        title={current?.upstream ? `${t("chatReact.pickerLabel")} · ${t("chatReact.upstream")}: ${current.upstream}` : t("chatReact.pickerLabel")} disabled={props.disabled} onClick={() => { props.onOpen?.(); setOpen((v) => !v); }}>
        <span className="mc-model-name">{model}</span><ChevronMark size={12} />
      </button>
      <div className="mc-menu" role="menu" aria-label={t("chatReact.pickerLabel")} data-testid="mc-model-menu" hidden={!open}>
        {/* 默认模型 is a real radio of the chat group (checked when no model is pinned). */}
        {section("chat", t("model.types.chat"), <>
          {item("default", t("common.modelDefault"), props.value === "", () => choose(null))}
          {groups.find((g) => g.kind === "chat")?.options.map((o) => item(o.value, o.label, o.value === props.value, () => choose(o.choice), o.hint, o.upstream, o))}
        </>)}
        {groups.filter((g) => g.kind !== "chat").map((g) => section(g.kind, label(g),
          g.options.map((o) => item(o.value, o.label, o.value === (g.kind === "executor" ? backendValue : props.value), () => choose(o.choice), o.hint, undefined, o)),
          // A lone executor named like its group shows once.
          g.kind === "executor" && g.options.length === 1 && g.options[0]!.label === label(g)))}
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
  const [evidence, setEvidence] = useState(NO_EVIDENCE);
  useEffect(() => {
    if (!conversationId || !read) { setEvidence(NO_EVIDENCE); return; }
    const abort = new AbortController();
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
    return () => { abort.abort(); clearTimeout(timer); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [conversationId, read, refresh, steps]);
  return evidence;
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
  // A job tool still to be bound to this conversation cannot send yet (Core checks the bound set).
  const entry = media && found?.[media.model.model];
  const direct = entry && !entry.bind ? entry : null;
  useEffect(() => { setParams(direct ? mediaDefaults(direct) : {}); }, [direct && direct.toolId, media?.model.model]);

  // Settles a media selection against the read: the preferred model if it can send (else, unless strict, the first
  // of its kind that can), binding its job tool to this conversation first when needed. Nothing = leave and say why.
  const settle = async (kind: "image" | "video", preferred: string, strict: boolean, run: number) => {
    const read = await loadWired();
    const live = () => run === mediaRun.current;
    if (!live()) return;
    const name = read[preferred] ? preferred : strict ? undefined : groups.find((group) => group.kind === kind)?.options.find((option) => read[option.label])?.label;
    let entry = name ? read[name] : undefined;
    if (entry && entry.bind) {
      const current = wiring.current!;
      try {
        const bound = await updateSessionBindings(conversationId!, { toolIds: [...current.bound!.toolIds, entry.toolId], revision: current.bound!.revision });
        window.dispatchEvent(new window.CustomEvent(BINDINGS_EVENT, { detail: bound }));
        current.bound = bound;
        const { bind: _, ...ready } = entry;
        const next = { ...await current.read, [name!]: ready };
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
    if (entry) setMedia({ kind, model: (groups.find((group) => group.kind === kind)!.options.find((option) => option.label === name)!.choice as { model: ModelChoice }).model });
    else if (!strict) { setMedia(null); toast.info(noneReason(kind, read) ?? t("chatReact.mediaNone")); }
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
  // Why a kind has nothing to send: this conversation has it off, an upstream outage (every option), or no connected model.
  const noneReason = (kind: string, read = found) => {
    const options = groups.find((group) => group.kind === kind)?.options.map((option) => read ? wiredOnly(option, read) : option) ?? [];
    if (!read || options.some((option) => !option.unavailable)) return;
    const why = options.map((option) => option.unavailable);
    return t(why.includes("not_enabled") ? "chatReact.mediaNotEnabled" : why.length && why.every((reason) => !["unwired", "no_prompt"].includes(reason!)) ? "chatReact.mediaUpstream" : "chatReact.mediaNone");
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

  // Image/video: models that can send come first; the rest are greyed with why (no job tool / no prompt field).
  const wiredOnly = (option: Option, read = found): Option => option.unavailable || !read || read[option.label] ? option
    : { ...option, unavailable: read[option.label] === null ? "no_prompt" : read[option.label] === false ? "not_enabled" : "unwired" };
  const labeledGroups = groups.map((group) => group.kind === "chat" ? !strategy ? group : {
    ...group, options: group.options.map((option) => ({ ...option, hint: `${option.hint ?? ""} · ${measurementHint(strategy, (option.choice as { model: ModelChoice }).model)}` })),
  } : group.kind === "executor" ? group : { ...group, options: group.options.map((option) => wiredOnly(option)).sort((a, b) => +!!a.unavailable - +!!b.unavailable) });
  return { groups: labeledGroups, model, media, backend, busy, pick, allowed: allowedFor(model, backend), effortEvidence: effortEvidence(strategy, model, backend), direct, mediaReady: !!found, mediaPending, loadWired, enter, mediaNone: (kind: string) => noneReason(kind), params,
    setParam: (name: string, value: string) => setParams({ ...params, [name]: value }),
    imageGate: imageGate(model, models), modelHint: strategy && model ? measurementHint(strategy, model) : undefined };
}
