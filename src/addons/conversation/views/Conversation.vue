<script setup lang="ts">
/**
 * 对话视图 —— 基于 src/task-conversation 组件（自 agentia 拷贝自维护）。
 *
 * 组件负责：消息列表渲染（含 process 折叠/展开）、流式 upsert、乐观发送、
 * 滚动跟随、Composer（发送/停止/附件）。宿主职责见 adapter（映射规则在
 * composables/useConversationAdapter.ts 头注释）。
 *
 * 宿主补充：
 *   - ModelPicker 经 composer-toolbar-leading 插槽注入（仍走 PATCH 落库）。
 *   - error 消息用自定义 renderer（红底错误气泡，不渲染 markdown）。
 *   - tool_call / thinking 走 process lane，组件渲染为可折叠过程条目
 *     （标题取 senderName），不需要自定义 renderer。
 *   - 附件上传复用组件的 uploadAttachment 边界 → api/storage.uploadFile。
 */
import { computed, onBeforeUnmount, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/contracts/platform-runtime";
import { modelErrorMessage } from "@/addons/conversation/composables/modelErrorMessage";
import { getConversation, updateConversationSettings } from "@/addons/conversation/api/conversation";
import { getInstanceTemplateId, getMyAgent } from "@/addons/conversation/api/agent";
import type { ModelChoice } from "@/addons/conversation/api/types";
import type { ConversationAdapter } from "@/addons/conversation/task-conversation/core";
import type { ConversationRendererRegistry } from "@/addons/conversation/task-conversation/vue";
import { TaskConversation } from "@/addons/conversation/task-conversation/vue";
import "@/addons/conversation/task-conversation/styles.css";
import { createConversationAdapter } from "@/addons/conversation/composables/useConversationAdapter";
import {
  conversationModelChoice,
  createLatestConversationModelLoader,
} from "@/addons/conversation/composables/conversationModelRestore";
import { toast } from "@/composables/useToast";
import ModelPicker from "@/addons/conversation/components/ModelPicker.vue";
import ExecutionBackendPicker from "@/addons/conversation/components/ExecutionBackendPicker.vue";
import { createLatestConversationBackendLoader } from "@/addons/conversation/composables/conversationBackendRestore";
import ErrorBubble from "@/addons/conversation/components/conversation/ErrorBubble.vue";
import MessageItem from "@/addons/conversation/components/conversation/MessageItem.vue";
import AttachmentChips from "@/addons/conversation/components/AttachmentChips.vue";
import { toMessageAttachment } from "@/addons/conversation/components/attachmentPresentation";
import { broadcastRoute } from "../composables/broadcastViewPolicy";
import { useNarrow } from "@/composables/useNarrow";
import type { ConversationStatus } from "@/addons/conversation/api/types";
import { errorText, isPending, type GenerationTask, type MediaModel } from "@/addons/conversation/composables/generation";
import { cancelGeneration, createGeneration, getGeneration, listGenerations } from "@/addons/conversation/api/media";
import { followUp, getMessages } from "@/addons/conversation/api/conversation";
import { DEFAULT_PARAMS, cancelNoteKey, forcedImageMode, unsignedDone, type Aspect } from "@/addons/conversation/composables/chatGeneration";
import ChatGenBar from "@/addons/conversation/components/media/ChatGenBar.vue";
import GenMessage, { type ChatGenHost } from "@/addons/conversation/components/media/GenMessage.vue";

const props = defineProps<{ id: string }>();
const narrow = useNarrow();
/** Q7: below 1024px the model/backend switch lives behind the header's 「⋯」. */
const moreOpen = ref(false);
const title = ref("");
// AG1: the agent behind this conversation was deleted: history stays, sending is refused (server 409).
const agentDeleted = ref(false);
const status = ref<ConversationStatus | "">("");
/** UI-IMPL-3 (6B): a legacy mode=media carrier takes input, image mode only. */
const carrier = ref(false);
/** The live controller speaks idle/running/…; the header shows the API vocabulary. */
function onLiveStatus(next: "idle" | "running" | "completed" | "failed" | "cancelled"): void {
  if (next === "running") status.value = "executing";
  else if (next !== "idle") status.value = next;
}
const { t, locale } = useI18n();
const router = useRouter();
const route = useRoute();

// ── UI-IMPL-3: in-chat image generation ────────────────────────────────
const genOn = ref(route.query.gen === "image");
const genAspect = ref<Aspect>(DEFAULT_PARAMS.aspect);
const genCount = ref(DEFAULT_PARAMS.count);
const genModel = ref<MediaModel | null>(null);
const genTasks = ref(new Map<number, GenerationTask>());
const genGroups = ref(new Map<number, number[]>());
/** Media messages do not stream over SSE: a finished task remounts the list. */
const remount = ref(0);
const conversationView = ref<{ setDraft(text: string): void } | null>(null);
let pollTimer: ReturnType<typeof setTimeout> | undefined;

async function refreshGen(id: string): Promise<void> {
  clearTimeout(pollTimer);
  const [tasks, messages] = await Promise.all([listGenerations("image"), getMessages(id)]).catch(() => [null, null] as const);
  if (id !== props.id) return;
  if (tasks && messages) {
    const mine = new Map(tasks.filter((x) => String(x.conversationId) === id).map((x) => [x.id, x]));
    // The list never carries downloadUrl; reuse a link we already signed, else fetch the one task.
    for (const tid of unsignedDone([...mine.values()])) {
      const known = genTasks.value.get(tid)?.downloadUrl;
      const full = known ? { ...mine.get(tid)!, downloadUrl: known } : await getGeneration(tid).catch(() => null);
      if (full) mine.set(tid, full);
    }
    if (id !== props.id) return;
    const settled = [...genTasks.value.values()].some((x) => isPending(x.status) && !isPending(mine.get(x.id)?.status ?? "succeeded"));
    const groups = new Map<number, number[]>();
    for (const m of messages) {
      const ids = (m.metadata?.media as { taskIds?: number[] } | undefined)?.taskIds;
      ids?.forEach((tid) => groups.set(tid, ids));
    }
    genTasks.value = mine;
    genGroups.value = groups;
    if (settled) remount.value += 1;
  }
  if ([...genTasks.value.values()].some((x) => isPending(x.status))) pollTimer = setTimeout(() => void refreshGen(id), 3000);
}
onBeforeUnmount(() => clearTimeout(pollTimer));

async function generate(prompt: string, aspect: string, count: number): Promise<void> {
  if (!genModel.value) throw new Error(t("chatGen.noModels"));
  try {
    await createGeneration({ kind: "image", providerId: genModel.value.providerId, model: genModel.value.model, prompt,
      conversationId: Number(props.id), aspect, count });
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "";
    const busy = [...genTasks.value.values()].filter((x) => isPending(x.status)).length;
    const msg = code === "media_busy" ? t("chatGen.busy", { n: busy })
      : code === "conversation_busy" ? t("chatGen.convBusy")
      : errorText(code, t, error instanceof Error ? error.message : "");
    throw new Error(msg);
  }
  remount.value += 1;
  await refreshGen(props.id);
}

const genHost: ChatGenHost = {
  get tasks() { return genTasks.value; },
  get groups() { return genGroups.value; },
  cancel(ids) {
    void Promise.all(ids.map((id) => cancelGeneration(id))).then((res) => {
      toast.info(`${t("chatGen.cancelledTitle")}：${t(cancelNoteKey(res.some((r) => r.submitted)))}`);
    }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => void refreshGen(props.id));
  },
  regenerate(prompt, aspect, count) {
    void generate(prompt, aspect, count).catch((error: Error) => toast.error(error.message));
  },
  refine(_item, prompt) {
    // ponytail: front-end-only reference — prefill the prompt; image-to-image is not in this phase.
    genOn.value = true;
    conversationView.value?.setDraft(prompt);
  },
};
provide("chatGen", genHost);

/** conversationKey 变化时组件 controller 会自动重新 initialize。 */
// A remount gets a fresh adapter (its cursor cache would skip the reload).
const adapter = computed<ConversationAdapter>(() => (void remount.value, createConversationAdapter(() => props.id, {
  send: async (input, _atts, _options) => {
    if (!genOn.value) {
      await followUp(props.id, input, _atts);
      return { accepted: true };
    }
    await generate(input, genAspect.value, genCount.value);
    return { accepted: true };
  },
})));

const modelChoice = ref<ModelChoice | null>(null);
const executionBackend = ref<string | null>(null);
const persistedModelChoice = ref<ModelChoice | null>(null);
const persistedExecutionBackend = ref<string | null>(null);
const modelLoading = ref(true);
const backendLoading = ref(true);
const backendCompatible = ref(false);
const settingsSaving = ref(false);
const modelLoader = createLatestConversationModelLoader(getConversation);
const backendLoader = createLatestConversationBackendLoader(getConversation);
let settingsMutationGeneration = 0;

function sameModel(left: ModelChoice | null, right: ModelChoice | null): boolean {
  return left?.providerId === right?.providerId && left?.model === right?.model;
}

const settingsDirty = computed(() =>
  !sameModel(modelChoice.value, persistedModelChoice.value) ||
  executionBackend.value !== persistedExecutionBackend.value,
);

watch(
  () => props.id,
  async (conversationId, _previousId, onCleanup) => {
    let active = true;
    onCleanup(() => { active = false; });
    settingsMutationGeneration += 1;
    settingsSaving.value = false;
    modelLoading.value = true;
    backendLoading.value = true;
    backendCompatible.value = false;
    modelChoice.value = null;
    executionBackend.value = null;
    persistedModelChoice.value = null;
    persistedExecutionBackend.value = null;
    try {
      const [restoredModel, restoredBackend, conversation] = await Promise.all([
        modelLoader.load(conversationId),
        backendLoader.load(conversationId),
        getConversation(conversationId),
      ]);
      if (!active) return;
      title.value = conversation.title ?? "";
      carrier.value = forcedImageMode(conversation);
      if (carrier.value) genOn.value = true;
      void refreshGen(conversationId);
      agentDeleted.value = false;
      if (conversation.agentId) {
        void (async () => {
          const templateId = await getInstanceTemplateId(conversation.agentId!);
          const agent = templateId ? await getMyAgent(templateId) : null;
          if (active) agentDeleted.value = agent?.deleted === true;
        })().catch(() => {});
      }
      status.value = conversation.status ?? "";
      const groupRoute = broadcastRoute(conversation);
      if (groupRoute) {
        await router.replace(groupRoute);
        return;
      }
      if (restoredModel !== undefined) {
        modelChoice.value = restoredModel;
        persistedModelChoice.value = restoredModel;
      }
      if (restoredBackend !== undefined) {
        executionBackend.value = restoredBackend;
        persistedExecutionBackend.value = restoredBackend;
      }
    } catch (error) {
      if (!active) return;
      toast.error(error instanceof ApiError ? error.message : t("common.modelRestoreFailed"));
    } finally {
      if (active) {
        modelLoading.value = false;
        backendLoading.value = false;
      }
    }
  },
  { immediate: true },
);

function discardSettings(): void {
  modelChoice.value = persistedModelChoice.value;
  executionBackend.value = persistedExecutionBackend.value;
}

async function applySettings(): Promise<void> {
  const nextModel = modelChoice.value;
  const nextBackend = executionBackend.value;
  if (!nextBackend || !backendCompatible.value || settingsSaving.value || !settingsDirty.value) return;
  modelLoader.invalidate();
  backendLoader.invalidate();
  modelLoading.value = false;
  backendLoading.value = false;
  settingsSaving.value = true;
  const mutationGeneration = ++settingsMutationGeneration;
  const conversationId = props.id;
  try {
    const conversation = await updateConversationSettings(conversationId, nextModel, nextBackend);
    if (props.id !== conversationId || mutationGeneration !== settingsMutationGeneration) return;
    const savedModel = conversationModelChoice(conversation) ?? nextModel;
    const savedBackend = conversation.executionBackend?.trim() || nextBackend;
    persistedModelChoice.value = savedModel;
    persistedExecutionBackend.value = savedBackend;
    modelChoice.value = savedModel;
    executionBackend.value = savedBackend;
    toast.success(t("common.executionSettingsSwitched"));
  } catch (error) {
    if (props.id !== conversationId || mutationGeneration !== settingsMutationGeneration) return;
    toast.error(modelErrorMessage(error, t, t("common.executionSettingsSwitchFailed")));
  } finally {
    if (mutationGeneration === settingsMutationGeneration) settingsSaving.value = false;
  }
}

/** 自定义 renderer：error → 红底气泡（system lane）。 */
const renderers: ConversationRendererRegistry = {
  error: ErrorBubble,
};

function onError(error: Error): void {
  // ZodError.message 是原始 JSON issue 数组（用户不可读）；转成一句人话。
  if (error.name === "ZodError") {
    toast.error("消息格式异常，已跳过一条更新");
    return;
  }
  toast.error(modelErrorMessage(error, t));
}
</script>

<template>
  <div class="view active view--scroll-hidden">
    <div class="chat-view" :class="{ 'chat-view--narrow': narrow }">
      <!-- Below 1024px (board §13): task name + status, and 「⋯」 for the run settings (Q7). -->
      <header v-if="narrow" class="conv-head" data-testid="conv-head">
        <div class="conv-head-text">
          <strong>{{ title || t('common.untitled') }}</strong>
          <span v-if="status" class="conv-status" :data-status="status">
            {{ status === 'blocked' ? t('home.needsYou') : t(`broadcast.status.${status}`) }}
          </span>
        </div>
        <button type="button" class="conv-more" data-testid="conv-more" :aria-label="t('conversation.more')" :aria-expanded="moreOpen" @click="moreOpen = true">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
      </header>
      <div v-if="narrow" v-show="moreOpen" class="osheet-scrim" data-testid="conv-more-sheet" @click.self="moreOpen = false" @keydown.esc="moreOpen = false">
        <div class="osheet" role="dialog" aria-modal="true" :aria-label="t('home.runTitle')">
          <div class="osheet-grab" aria-hidden="true" />
          <div class="osheet-head">
            <b>{{ t('home.runTitle') }}</b>
            <button type="button" class="osheet-done" @click="moreOpen = false">{{ t('common.done') }}</button>
          </div>
          <div class="picker-group">
            <ModelPicker
              :model-value="modelChoice"
              :disabled="modelLoading || settingsSaving || status === 'executing'"
              :allow-default="true"
              row
              @update:model-value="(value) => (modelChoice = value)"
            />
            <ExecutionBackendPicker
              :model-value="executionBackend"
              :model-choice="modelChoice"
              :disabled="backendLoading || settingsSaving || status === 'executing'"
              :auto-select="false"
              row
              @update:model-value="(value) => (executionBackend = value)"
              @validation-change="(value) => (backendCompatible = value.allowed)"
            />
          </div>
          <div v-if="settingsDirty" class="conversation-settings-actions conv-more-actions">
            <button type="button" :disabled="settingsSaving || status === 'executing' || !executionBackend || !backendCompatible" @click="applySettings">
              {{ settingsSaving ? t('common.applying') : t('common.applySettings') }}
            </button>
            <button type="button" :disabled="settingsSaving" @click="discardSettings">
              {{ t('common.discardSettings') }}
            </button>
          </div>
        </div>
      </div>
      <p v-if="carrier" class="conv-media-banner" role="status" data-testid="conv-media-banner">{{ t("generate.mediaConversation") }}</p>
      <p v-if="agentDeleted" class="conv-agent-deleted" role="status" data-testid="conv-agent-deleted">{{ t("agents.deletedHint") }}</p>
      <TaskConversation
        ref="conversationView"
        :key="`${id}#${remount}`"
        :conversation-key="id"
        :adapter="adapter"
        :capabilities="{ send: genOn ? !!genModel && !agentDeleted : !modelLoading && !backendLoading && !settingsSaving && !settingsDirty && backendCompatible && !agentDeleted, stop: true, attachments: !genOn }"
        :renderers="renderers"
        :show-process="true"
        :locale="locale === 'en' ? 'en-US' : 'zh-CN'"
        @error="onError"
        @status-change="onLiveStatus"
      >
        <template #user-item="{ item }">
          <GenMessage v-if="item.data?.media" :item="item"><MessageItem :item="item" role="user" /></GenMessage>
          <MessageItem v-else :item="item" role="user" />
        </template>
        <template #assistant-item="{ item, respond }">
          <GenMessage v-if="item.data?.media" :item="item" />
          <MessageItem v-else :item="item" role="assistant" @respond="respond" />
        </template>
        <template #artifact="{ attachment, item }">
          <AttachmentChips v-if="!item.data?.media" :attachments="[toMessageAttachment(attachment)]" />
        </template>
        <template #composer-toolbar-trailing>
          <ChatGenBar v-model:on="genOn" v-model:aspect="genAspect" v-model:count="genCount" v-model:model="genModel" :locked="carrier" />
        </template>
        <template v-if="!narrow" #composer-toolbar-leading="{ status }">
          <ModelPicker
            :model-value="modelChoice"
            :disabled="modelLoading || settingsSaving || status === 'running'"
            :allow-default="true"
            compact
            @update:model-value="(value) => (modelChoice = value)"
          />
          <ExecutionBackendPicker
            :model-value="executionBackend"
            :model-choice="modelChoice"
            :disabled="backendLoading || settingsSaving || status === 'running'"
            :auto-select="false"
            compact
            @update:model-value="(value) => (executionBackend = value)"
            @validation-change="(value) => (backendCompatible = value.allowed)"
          />
          <div v-if="settingsDirty" class="conversation-settings-actions">
            <button type="button" :disabled="settingsSaving || status === 'running' || !executionBackend || !backendCompatible" @click="applySettings">
              {{ settingsSaving ? t('common.applying') : t('common.applySettings') }}
            </button>
            <button type="button" :disabled="settingsSaving" @click="discardSettings">
              {{ t('common.discardSettings') }}
            </button>
          </div>
        </template>
      </TaskConversation>
    </div>
  </div>
</template>

<style src="./conversation.css"></style>
