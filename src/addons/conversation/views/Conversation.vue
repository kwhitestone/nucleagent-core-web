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
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/contracts/platform-runtime";
import { getConversation, updateConversationSettings } from "@/addons/conversation/api/conversation";
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

const props = defineProps<{ id: string }>();
const { t, locale } = useI18n();
const router = useRouter();

/** conversationKey 变化时组件 controller 会自动重新 initialize。 */
const adapter = computed<ConversationAdapter>(() => createConversationAdapter(() => props.id));

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
    toast.error(error instanceof ApiError ? error.message : t("common.executionSettingsSwitchFailed"));
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
  toast.error(error.message);
}
</script>

<template>
  <div class="view active view--scroll-hidden">
    <div class="chat-view">
      <TaskConversation
        :conversation-key="id"
        :adapter="adapter"
        :capabilities="{ send: !modelLoading && !backendLoading && !settingsSaving && !settingsDirty && backendCompatible, stop: true, attachments: true }"
        :renderers="renderers"
        :show-process="true"
        :locale="locale === 'en' ? 'en-US' : 'zh-CN'"
        @error="onError"
      >
        <template #user-item="{ item }">
          <MessageItem :item="item" role="user" />
        </template>
        <template #assistant-item="{ item, respond }">
          <MessageItem :item="item" role="assistant" @respond="respond" />
        </template>
        <template #artifact="{ attachment }">
          <AttachmentChips :attachments="[toMessageAttachment(attachment)]" />
        </template>
        <template #composer-toolbar-leading="{ status }">
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
