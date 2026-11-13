import { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider, AuiIf, ComposerPrimitive, MessagePrimitive, ThreadPrimitive,
  useExternalStoreRuntime, type ExternalStoreAdapter, type ThreadMessageLike,
} from "@assistant-ui/react";
import { listProviders, listAllTypedModels, type Provider } from "@/contracts/model-catalog";
import { getConversation, listExecutionBackends, updateConversationSettings } from "@/addons/conversation/api/conversation";
import type { Conversation, CreateConversationRequest, ExecutionBackendOption, ModelChoice } from "@/addons/conversation/api/types";
import { conversationModelChoice } from "@/addons/conversation/composables/conversationModelRestore";
import { executionBackendCompatibility } from "@/addons/conversation/composables/executionBackendCompatibility";
import { modelErrorMessage } from "@/addons/conversation/composables/modelErrorMessage";
import { renderMarkdown } from "@/addons/conversation/task-conversation/markdown";
import { createConversationState } from "@/addons/conversation/task-conversation/core";
import { toast } from "@/composables/useToast";
import { externalStore } from "./externalStore";
import { choiceValue, modelGroups, type Choice, type Group } from "./modelGroups";
import { useCoreConversation } from "./useCoreConversation";
import "./chat.css";

export type Translate = (key: string, named?: Record<string, unknown>) => string;
export interface ChatProps {
  conversationId?: string;
  t: Translate;
  navigate(path: string): void;
  create(payload: CreateConversationRequest): Promise<Conversation>;
}

const EMPTY = createConversationState("new");

export function ChatApp(props: ChatProps) {
  const { t, conversationId } = props;
  const report = useMemo(() => (error: Error) => toast.error(error.name === "ZodError" ? "消息格式异常，已跳过一条更新" : modelErrorMessage(error, t)), [t]);
  const core = useCoreConversation(conversationId, report);
  const settings = useSettings(conversationId, t);

  const adapter: ExternalStoreAdapter<ThreadMessageLike> = conversationId
    ? externalStore(core?.state ?? EMPTY, {
      send: (text) => core ? core.controller.send(text) : Promise.reject(new Error(t("chatReact.loading"))),
      stop: () => core?.controller.stop() ?? Promise.resolve(),
    })
    : externalStore(EMPTY, {
      async send(input) {
        if (!settings.allowed) throw new Error(t("common.executionBackendSelectionInvalid"));
        try {
          const created = await props.create({
            mode: "a2a_agent", input,
            model: settings.model?.model ?? "", providerId: settings.model?.providerId,
            executionBackend: settings.backend ?? undefined,
          });
          props.navigate(`/c/${created.id}`);
        } catch (error) {
          toast.error(modelErrorMessage(error, t, t("home.createFailed")));
          throw error;
        }
      },
      stop: () => Promise.resolve(),
    });
  const runtime = useExternalStoreRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="mc-root" data-conversation-key={conversationId ?? ""}>
        <ThreadPrimitive.Viewport className="mc-viewport">
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <p className="mc-empty">{conversationId && !core ? t("chatReact.loading") : t("conversation.empty")}</p>
          </AuiIf>
          <ThreadPrimitive.Messages>{({ message }) => <Message role={message.role} />}</ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="mc-composer">
          <ComposerPrimitive.Input
            className="mc-input" rows={2} autoFocus
            placeholder={conversationId ? t("conversation.inputPlaceholder") : t("chatReact.newPlaceholder")}
          />
          <div className="mc-toolbar">
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

function Message({ role }: { role: string }) {
  return (
    <MessagePrimitive.Root className="mc-msg" data-message-role={role}>
      <MessagePrimitive.Parts>
        {({ part }) => part.type === "text"
          ? <div className="mc-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }} />
          : part.type === "reasoning"
            ? <details className="mc-reasoning"><summary>{part.text.split("\n")[0]}</summary><pre>{part.text.split("\n").slice(1).join("\n")}</pre></details>
            : null}
      </MessagePrimitive.Parts>
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
