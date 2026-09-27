<script setup lang="ts">
import type { Component } from "vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import type {
  ConnectionStatus,
  ConversationAdapter,
  ConversationAttachment,
  ConversationCapabilities,
  ConversationItem,
  ConversationLocale,
  ConversationMessages,
  ConversationStatus,
  ConversationSurface,
  ConversationTheme,
  ConversationTurn,
} from "../core";
import {
  MAX_ATTACHMENTS,
  MAX_ID_LENGTH,
  MAX_MESSAGE_CONTENT_LENGTH,
} from "../core";
import ConversationContent from "./ConversationContent.vue";
import AttachmentChips from "@/addons/conversation/components/AttachmentChips.vue";
import type { MessageAttachment } from "@/addons/conversation/api/types";
import { resolveMessages } from "./messages";
import {
  ensureDirectReplyProcessItems,
  ensureExecutionProcessItems,
  formatProcessDuration,
  groupContiguousProcessItems,
  hasProcessItemDetails,
  indexProcessGroupLeaders,
  indexProcessGroupUsers,
  isProcessExpanded as resolveProcessExpanded,
  isThinkingProcessItem,
  orderTurnItemsForDisplay,
  planProgressSummary,
  preferredActiveProcessItemId,
  processPlan as resolveProcessPlan,
  processItemForDisplay,
  processStepEndedAt,
  processPreview as resolveProcessPreview,
  processToolDetails as resolveProcessToolDetails,
  resolveProcessStepDurationMs,
} from "./processPresentation";
import { executionTimingLabel, executionTimings } from "./executionTiming";
import { executionPhaseLabel, isExecutionPhaseData } from "./executionPhasePresentation";
import { useConversation } from "./useConversation";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { useNarrow } from "@/composables/useNarrow";

defineOptions({ name: "TaskConversation" });

export type ConversationRendererRegistry = Readonly<Record<string, Component>>;

const props = withDefaults(
  defineProps<{
    conversationKey: string;
    adapter: ConversationAdapter;
    capabilities?: ConversationCapabilities;
    locale?: ConversationLocale;
    messages?: Partial<ConversationMessages>;
    theme?: ConversationTheme;
    surface?: ConversationSurface;
    renderers?: ConversationRendererRegistry;
    initialAnchor?: "latest" | string;
    showProcess?: boolean;
  }>(),
  {
    capabilities: () => ({ send: true }),
    locale: "zh-CN",
    messages: () => ({}),
    theme: "auto",
    surface: "auto",
    renderers: () => ({}),
    initialAnchor: "latest",
    showProcess: true,
  },
);

const emit = defineEmits<{
  "open-artifact": [payload: unknown];
  "open-diagnostics": [payload?: unknown];
  share: [payload: unknown];
  feedback: [payload: unknown];
  navigate: [payload: unknown];
  "connection-change": [status: ConnectionStatus];
  "status-change": [status: ConversationStatus];
  error: [error: Error];
  "fallback-legacy": [];
}>();

defineSlots<{
  "conversation-leading"(): unknown;
  "conversation-trailing"(): unknown;
  "turn-leading"(props: {
    turn: ConversationTurn;
    previousTurn?: ConversationTurn;
    turns: readonly ConversationTurn[];
    index: number;
  }): unknown;
  "user-item"(props: { item: ConversationItem }): unknown;
  "process-item"(props: { item: ConversationItem }): unknown;
  "assistant-item"(props: {
    item: ConversationItem;
    respond: (value: unknown) => void;
  }): unknown;
  artifact(props: {
    attachment: ConversationAttachment;
    item: ConversationItem;
    open: () => void;
  }): unknown;
  "assistant-actions"(props: {
    item: ConversationItem;
    capabilities: ConversationCapabilities;
  }): unknown;
  "composer-toolbar-leading"(props: { status: ConversationStatus }): unknown;
  toolbar(): unknown;
  "composer-toolbar-trailing"(): unknown;
  "composer-actions-leading"(): unknown;
  "composer-actions-trailing"(): unknown;
}>();

const text = computed(() => resolveMessages(props.locale, props.messages));
const composer = ref("");
/** Phone layout below 1024px (board §13). */
const narrow = useNarrow();
const attachments = ref<ConversationAttachment[]>([]);
const composerAttachmentChips = computed<MessageAttachment[]>(() =>
  attachments.value.map((attachment) => {
    const rawKind = attachment.metadata?.kind;
    const kind = rawKind === "image" || rawKind === "pdf" || rawKind === "file"
      ? rawKind
      : undefined;
    return {
      fileId: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      kind,
    };
  }),
);
const sending = ref(false);
const uploading = ref(false);
const scrollRegion = ref<HTMLElement>();
const bottomSentinel = ref<HTMLElement>();
const scrollMode = ref<"following" | "detached">("following");
const loadingOlder = ref(false);
const submittingInteractionIds = ref<ReadonlySet<string>>(new Set());
const expandedProcessIds = ref<ReadonlySet<string>>(new Set());
const collapsedProcessIds = ref<ReadonlySet<string>>(new Set());
const collapsedProcessStepIds = ref<ReadonlySet<string>>(new Set());
let scrollFrame: number | undefined;
let bottomObserver: IntersectionObserver | undefined;
const processClock = ref(Date.now());
let processClockTimer: ReturnType<typeof setInterval> | undefined;

const controller = useConversation({
  conversationKey: () => props.conversationKey,
  adapter: () => props.adapter,
  onConnectionChange: (status) => emit("connection-change", status),
  onStatusChange: (status) => emit("status-change", status),
  onError: (error) => emit("error", error),
});
const canExecute = computed(() => controller.authoritativeReady.value);

const runTimings = computed(() => executionTimings(
  controller.state.value.loadedOrder.map((id) => controller.state.value.items[id]!).filter(Boolean),
  { nowMs: processClock.value, status: controller.state.value.status },
));

const rootClasses = computed(() => [
  `atc-surface-${props.surface}`,
  { "atc-narrow": narrow.value },
  `atc-theme-${props.theme}`,
  { "atc-is-detached": scrollMode.value === "detached" },
]);

const connectionMessage = computed(() => {
  if (controller.state.value.connection.status === "reconnecting")
    return text.value.reconnecting;
  if (
    ["disconnected", "error"].includes(controller.state.value.connection.status)
  )
    return text.value.disconnected;
  return "";
});
const hasFailedItem = computed(() =>
  controller.turns.value.some((turn) =>
    turn.items.some((item) => item.status === "failed"),
  ),
);
const hasActiveItem = computed(() =>
  controller.turns.value.some((turn) =>
    turn.items.some(
      (item) => item.status === "pending" || item.status === "streaming",
    ),
  ),
);
const displayTurns = computed(() =>
  controller.turns.value.map((turn) => ({
    ...turn,
    items: ensureExecutionProcessItems(
      ensureDirectReplyProcessItems(orderTurnItemsForDisplay(
        turn.items.map((item) => processItemForDisplay(item, props.locale)),
      ), {
        title: text.value.thinkingProcessTitle,
        responseTitle: props.locale === "zh-CN" ? "模型响应" : "Model response",
        content: text.value.directReplyProcess,
      }),
      runTimings.value,
      {
        title: text.value.thinkingProcessTitle,
        waiting: props.locale === "zh-CN" ? "等待响应…" : "Waiting for a response…",
        settled: props.locale === "zh-CN" ? "本次执行未记录过程详情。" : "No process details were recorded for this run.",
      },
      { userId: [...runTimings.value.keys()].at(-1), status: controller.state.value.status },
    ),
  })),
);
const activeProcessItemId = computed(() => {
  const latestTurn = displayTurns.value.at(-1);
  return latestTurn ? preferredActiveProcessItemId(latestTurn.items) : undefined;
});
type ProcessGroupItems = readonly ConversationItem[];
const processGroupsByLeaderId = computed(() => {
  const groups = new Map<string, ProcessGroupItems>();
  for (const turn of displayTurns.value) {
    for (const group of groupContiguousProcessItems(turn.items)) {
      const leader = group[0];
      if (leader) groups.set(leader.id, group);
    }
  }
  return groups;
});
const processGroupLeaderByItemId = computed(() => {
  const leaders = new Map<string, string>();
  for (const turn of displayTurns.value) {
    for (const [itemId, leaderId] of indexProcessGroupLeaders(turn.items)) {
      leaders.set(itemId, leaderId);
    }
  }
  return leaders;
});
const processGroupUserByLeaderId = computed(() => new Map(
  displayTurns.value.flatMap((turn) => [...indexProcessGroupUsers(turn.items)]),
));
const processGroupTiming = (leaderId: string) => {
  const userId = processGroupUserByLeaderId.value.get(leaderId);
  return userId ? runTimings.value.get(userId) : undefined;
};
const processGroupTimingText = (leaderId: string): string =>
  executionTimingLabel(processGroupTiming(leaderId), props.locale);
// Initialization can arrive after thinking and become the first child. Keep
// the user's disclosure choice attached to the submission, not that child.
const processGroupDisclosureId = (leaderId: string): string => {
  const userId = processGroupUserByLeaderId.value.get(leaderId);
  if (!userId) return leaderId;
  const groups = [...processGroupUserByLeaderId.value].filter(([, owner]) => owner === userId);
  return `${userId}-process-${groups.findIndex(([id]) => id === leaderId)}`;
};
const activeProcessGroupId = computed(() => {
  const activeId = activeProcessItemId.value;
  if (!activeId) return undefined;
  for (const [leaderId, group] of processGroupsByLeaderId.value) {
    if (group.some((item) => item.id === activeId)) return leaderId;
  }
  return undefined;
});
const processGroupEndedAtByLeaderId = computed(() => {
  const endedAt = new Map<string, string>();
  for (const turn of displayTurns.value) {
    const itemIndexes = new Map(turn.items.map((item, index) => [item.id, index]));
    for (const group of groupContiguousProcessItems(turn.items)) {
      const leaderId = group[0]?.id;
      const lastId = group.at(-1)?.id;
      const lastIndex = lastId ? itemIndexes.get(lastId) : undefined;
      const nextItem = lastIndex === undefined ? undefined : turn.items[lastIndex + 1];
      if (leaderId && nextItem?.timestamp) endedAt.set(leaderId, nextItem.timestamp);
    }
  }
  return endedAt;
});

const anchorElementForItemId = (itemId: string): HTMLElement | null => {
  const leaderId = processGroupLeaderByItemId.value.get(itemId);
  return document.getElementById(
    leaderId ? `atc-process-group-${leaderId}` : `atc-item-${itemId}`,
  );
};

const scheduleScrollToLatest = (behavior: ScrollBehavior = "auto") => {
  if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    if (scrollMode.value === "following")
      bottomSentinel.value?.scrollIntoView({ block: "end", behavior });
    scrollFrame = undefined;
  });
};

const jumpToLatest = () => {
  scrollMode.value = "following";
  controller.executeWindowLatest();
  scheduleScrollToLatest("smooth");
};

const loadOlder = async () => {
  const region = scrollRegion.value;
  if (!region || loadingOlder.value || !controller.state.value.hasOlder) return;
  const previousHeight = region.scrollHeight;
  const previousTop = region.scrollTop;
  const anchorId = controller.state.value.order[0];
  const previousAnchorTop = anchorId
    ? anchorElementForItemId(anchorId)?.getBoundingClientRect().top
    : undefined;
  loadingOlder.value = true;
  await controller.loadOlder();
  await nextTick();
  const nextAnchorTop = anchorId
    ? anchorElementForItemId(anchorId)?.getBoundingClientRect().top
    : undefined;
  region.scrollTop =
    previousAnchorTop !== undefined && nextAnchorTop !== undefined
      ? previousTop + nextAnchorTop - previousAnchorTop
      : previousTop + (region.scrollHeight - previousHeight);
  loadingOlder.value = false;
};

const onScroll = () => {
  const region = scrollRegion.value;
  if (!region) return;
  const distanceFromBottom =
    region.scrollHeight - region.clientHeight - region.scrollTop;
  scrollMode.value = distanceFromBottom <= 48 ? "following" : "detached";
  if (scrollMode.value === "detached" && scrollFrame !== undefined) {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
  }
  if (region.scrollTop <= 24) void loadOlder();
};

const submit = async () => {
  const content = composer.value.trim();
  if (!content || sending.value || !canExecute.value) return;
  composer.value = "";
  const currentAttachments = attachments.value;
  attachments.value = [];
  sending.value = true;
  try {
    await controller.send(content, currentAttachments);
    scrollMode.value = "following";
    scheduleScrollToLatest();
  } catch {
    // The controller already emitted the normalized error to the host.
    composer.value = content;
    attachments.value = currentAttachments;
  } finally {
    sending.value = false;
  }
};

const onComposerKeydown = (event: KeyboardEvent) => {
  // Phones: Return is a newline, sending is the button (board §11 ②).
  if (narrow.value) return;
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void submit();
};

const onAttachment = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !props.capabilities.send) return;
  if (attachments.value.length >= MAX_ATTACHMENTS) {
    emit(
      "error",
      new Error(`At most ${MAX_ATTACHMENTS} attachments are allowed`),
    );
    return;
  }
  uploading.value = true;
  try {
    attachments.value = [
      ...attachments.value,
      await controller.uploadAttachment(file),
    ];
  } catch {
    // The controller already emitted the normalized error to the host.
  } finally {
    uploading.value = false;
  }
};

const removeAttachment = (id: string) => {
  attachments.value = attachments.value.filter(
    (attachment) => attachment.id !== id,
  );
};

const rendererFor = (item: ConversationItem): Component | undefined => {
  return props.renderers[item.kind];
};

const processPreview = (item: ConversationItem): string =>
  resolveProcessPreview(item.content, item.data);

const processItemLabel = (item: ConversationItem): string =>
  executionPhaseLabel(item.data, props.locale) ?? (item.title || text.value.process);

const hasProcessDetails = (item: ConversationItem): boolean =>
  hasProcessItemDetails(item.content, item.data);

const isThinkingProcessStep = (item: ConversationItem): boolean =>
  isThinkingProcessItem(item.data);

const isExecutionPhaseProcessItem = (item: ConversationItem): boolean =>
  isExecutionPhaseData(item.data);

const canToggleProcessStep = (item: ConversationItem): boolean =>
  isThinkingProcessStep(item) || hasProcessDetails(item);

const processToolDetails = (item: ConversationItem) =>
  resolveProcessToolDetails(item.data);

const processPlan = (item: ConversationItem) => resolveProcessPlan(item.data);

const planSummary = (item: ConversationItem): string => {
  const plan = processPlan(item);
  return plan ? planProgressSummary(plan) : "";
};

const processGroupFor = (
  item: ConversationItem,
): ProcessGroupItems | undefined => processGroupsByLeaderId.value.get(item.id);

const processGroupItems = (leaderId: string): ProcessGroupItems =>
  processGroupsByLeaderId.value.get(leaderId) ?? [];

// Below 1024px the process stays one 52px line and opens as a sheet on tap
// (board §13 ②), so the running group does not auto-expand inline there.
const isProcessGroupExpanded = (leaderId: string): boolean =>
  resolveProcessExpanded(
    expandedProcessIds.value,
    processGroupDisclosureId(leaderId),
    activeProcessGroupId.value && !narrow.value ? processGroupDisclosureId(activeProcessGroupId.value) : undefined,
    collapsedProcessIds.value,
  );

const processGroupStatus = (
  leaderId: string,
): ConversationItem["status"] => {
  const group = processGroupItems(leaderId);
  if (
    group.some(
      (item) => item.status === "pending" || item.status === "streaming",
    )
  )
    return "streaming";
  if (group.some((item) => item.status === "failed")) return "failed";
  if (group.some((item) => item.status === "cancelled")) return "cancelled";
  return "complete";
};

const processGroupSummary = (leaderId: string): string => {
  const group = processGroupItems(leaderId);
  const count = group.length;
  const status = processGroupStatus(leaderId);
  const parts =
    props.locale === "zh-CN"
      ? [
          `${count} 个步骤`,
          status === "streaming"
            ? "进行中"
            : status === "failed"
              ? "存在失败"
              : status === "cancelled"
                ? "已停止"
                : "已完成",
        ]
      : [
          `${count} ${count === 1 ? "step" : "steps"}`,
          status === "streaming"
            ? "In progress"
            : status === "failed"
              ? "Failed"
              : status === "cancelled"
                ? "Stopped"
                : "Completed",
        ];
  return parts.join(" · ");
};

const isProcessStepExpanded = (item: ConversationItem): boolean =>
  canToggleProcessStep(item) && !collapsedProcessStepIds.value.has(item.id);

const toggleProcessStep = (item: ConversationItem) => {
  if (!canToggleProcessStep(item)) return;
  const next = new Set(collapsedProcessStepIds.value);
  if (next.has(item.id)) next.delete(item.id);
  else next.add(item.id);
  collapsedProcessStepIds.value = next;
};

const processStepDurationMs = (
  item: ConversationItem,
  leaderId: string,
): number | undefined => {
  if (item.data?.durationUnavailable === true) return undefined;
  if (isExecutionPhaseData(item.data) &&
      item.data?.phaseStatus === "unavailable") return undefined;
  const group = processGroupItems(leaderId);
  const itemIndex = group.findIndex((candidate) => candidate.id === item.id);
  const nextStepAt = itemIndex >= 0 ? group[itemIndex + 1]?.timestamp : undefined;
  const settledGroupEnd = processGroupEndedAtByLeaderId.value.get(leaderId);
  const endedAt = processStepEndedAt({
    status: item.status,
    nextStepAt,
    settledGroupEnd,
  });
  return resolveProcessStepDurationMs({
    startedAt: item.timestamp,
    endedAt,
    nowMs: processClock.value,
    status: item.status,
    explicitDurationMs: item.data?.phaseDurationMs ?? item.data?.durationMs,
  });
};

const processStepElapsed = (
  item: ConversationItem,
  leaderId: string,
): string => {
  const duration = processStepDurationMs(item, leaderId);
  if (duration === undefined) return "";
  const formatted = formatProcessDuration(duration);
  return item.data?.phaseDurationEstimated === true || item.data?.durationEstimated === true
    ? `≈${formatted}` : formatted;
};

const shouldDisplayProcessGroup = (leaderId: string): boolean =>
  props.showProcess || leaderId === activeProcessGroupId.value;

const toggleProcessGroup = (leaderId: string) => {
  const disclosureId = processGroupDisclosureId(leaderId);
  const nextExpanded = new Set(expandedProcessIds.value);
  const nextCollapsed = new Set(collapsedProcessIds.value);
  if (isProcessGroupExpanded(leaderId)) {
    nextExpanded.delete(disclosureId);
    nextCollapsed.add(disclosureId);
  } else {
    nextCollapsed.delete(disclosureId);
    nextExpanded.add(disclosureId);
  }
  expandedProcessIds.value = nextExpanded;
  collapsedProcessIds.value = nextCollapsed;
};

const rendererAttachmentProps = computed(() =>
  props.capabilities.attachments && props.adapter.uploadAttachment
    ? {
        attachmentUploadEnabled: true,
        uploadAttachment: controller.uploadAttachment,
      }
    : {},
);

const setInteractionSubmitting = (interactionId: string, value: boolean) => {
  const next = new Set(submittingInteractionIds.value);
  if (value) next.add(interactionId);
  else next.delete(interactionId);
  submittingInteractionIds.value = next;
};

const isInteractionSubmitting = (item: ConversationItem) => {
  const interactionId = item.data?.interactionId;
  return (
    typeof interactionId === "string" &&
    submittingInteractionIds.value.has(interactionId)
  );
};

const isPendingInteraction = (item: ConversationItem) =>
  item.data?.interactionStatus === "pending" ||
  item.data?.planStatus === "pending";

const clearSettledInteractions = () => {
  if (submittingInteractionIds.value.size === 0) return;
  const pending = new Set<string>();
  for (const item of Object.values(controller.state.value.items)) {
    const interactionId = item.data?.interactionId;
    if (
      typeof interactionId === "string" &&
      submittingInteractionIds.value.has(interactionId) &&
      isPendingInteraction(item)
    ) {
      pending.add(interactionId);
    }
  }
  submittingInteractionIds.value = pending;
};

const forwardInteraction = async (item: ConversationItem, value: unknown) => {
  if (!canExecute.value) return;
  const interactionId = item.data?.interactionId;
  if (
    typeof interactionId !== "string" ||
    interactionId.length === 0 ||
    interactionId.length > MAX_ID_LENGTH
  )
    return;
  if (submittingInteractionIds.value.has(interactionId)) return;
  setInteractionSubmitting(interactionId, true);
  try {
    await controller.respond(interactionId, value);
    const current = controller.state.value.items[item.id];
    if (!current || !isPendingInteraction(current)) {
      setInteractionSubmitting(interactionId, false);
    }
  } catch {
    setInteractionSubmitting(interactionId, false);
  }
};
const fallbackLegacy = () => {
  controller.dispose();
  emit("fallback-legacy");
};
const openArtifact = (attachment: ConversationAttachment) => {
  emit("open-artifact", attachment);
};

const onSessionChange = (event: Event) => {
  const authenticated = (event as CustomEvent<{ authenticated?: unknown }>).detail
    ?.authenticated === true;
  if (authenticated) void controller.initialize();
  else controller.dispose();
};

watch(
  () => props.conversationKey,
  () => {
    expandedProcessIds.value = new Set();
    collapsedProcessIds.value = new Set();
    collapsedProcessStepIds.value = new Set();
    void controller.initialize();
  },
);

watch(
  () => controller.state.value,
  () => {
    clearSettledInteractions();
    if (scrollMode.value === "following") scheduleScrollToLatest();
  },
);

onMounted(async () => {
  window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange);
  processClockTimer = setInterval(() => {
    processClock.value = Date.now();
  }, 1_000);
  await controller.initialize();
  await nextTick();
  if (typeof IntersectionObserver !== "undefined" && bottomSentinel.value) {
    bottomObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) scrollMode.value = "following";
      },
      { root: scrollRegion.value, threshold: 1 },
    );
    bottomObserver.observe(bottomSentinel.value);
  }
  if (props.initialAnchor === "latest") scheduleScrollToLatest();
  else
    anchorElementForItemId(props.initialAnchor)?.scrollIntoView({
      block: "center",
    });
});

onBeforeUnmount(() => {
  window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
  if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
  if (processClockTimer !== undefined) clearInterval(processClockTimer);
  bottomObserver?.disconnect();
});
</script>

<template>
  <section
    class="atc-root"
    :class="rootClasses"
    :data-conversation-key="conversationKey"
  >
    <div v-if="connectionMessage" class="atc-connection-banner" role="status">
      <span class="atc-connection-dot" aria-hidden="true" />
      {{ connectionMessage }}
    </div>

    <div
      ref="scrollRegion"
      class="atc-scroll-region"
      @scroll.passive="onScroll"
    >
      <slot name="conversation-leading" />

      <button
        v-if="controller.state.value.hasOlder"
        class="atc-load-older"
        type="button"
        :disabled="loadingOlder || !canExecute"
        @click="loadOlder"
      >
        {{ loadingOlder ? text.loading : text.loadOlder }}
      </button>

      <div
        v-if="displayTurns.length === 0 && controller.snapshotStatus.value !== 'ready'"
        class="atc-snapshot-status"
        :role="controller.snapshotStatus.value === 'error' ? 'alert' : 'status'"
        :aria-busy="controller.snapshotStatus.value === 'loading'"
      >
        {{ controller.snapshotStatus.value === 'error' ? text.error : text.loading }}
        <button
          v-if="controller.snapshotStatus.value === 'error'"
          type="button"
          class="atc-load-older"
          @click="controller.initialize()"
        >{{ text.retry }}</button>
      </div>
      <div v-else-if="displayTurns.length === 0" class="atc-empty">
        {{ text.empty }}
      </div>

      <article
        v-for="(turn, turnIndex) in displayTurns"
        :key="turn.id"
        class="atc-turn"
      >
        <slot
          name="turn-leading"
          :turn="turn"
          :previous-turn="displayTurns[turnIndex - 1]"
          :turns="displayTurns"
          :index="turnIndex"
        />
        <template v-for="item in turn.items" :key="item.id">
          <template v-if="item.role === 'user'">
            <div
              :id="`atc-item-${item.id}`"
              class="atc-item atc-user-item"
              :data-status="item.status"
            >
              <slot name="user-item" :item="item">
                <ConversationContent :item="item" />
                <ul v-if="item.attachments?.length" class="atc-attachment-list">
                  <li
                    v-for="attachment in item.attachments"
                    :key="attachment.id"
                    class="atc-attachment"
                  >
                    {{ attachment.name }}
                  </li>
                </ul>
              </slot>
            </div>
          </template>

          <template v-else-if="item.lane === 'process'">
            <details
              v-if="
                processGroupFor(item) && shouldDisplayProcessGroup(item.id)
              "
              :id="`atc-process-group-${item.id}`"
              class="atc-process atc-process-group"
              :data-status="processGroupStatus(item.id)"
              :open="isProcessGroupExpanded(item.id)"
            >
              <summary
                class="atc-process-summary"
                :aria-expanded="isProcessGroupExpanded(item.id)"
                :aria-label="`${text.process} · ${processGroupSummary(item.id)}`"
                @click.prevent="toggleProcessGroup(item.id)"
              >
                <span class="atc-process-chevron" aria-hidden="true" />
                <span class="atc-process-marker" aria-hidden="true" />
                <span class="atc-process-label">{{ text.process }}</span>
                <span class="atc-process-preview">{{
                  processGroupSummary(item.id)
                }}</span>
                <span
                  v-if="processGroupTimingText(item.id)"
                  class="atc-process-elapsed atc-execution-timing"
                  :data-user-id="processGroupUserByLeaderId.get(item.id)"
                  :data-active="processGroupTiming(item.id)?.active"
                  :data-duration-ms="processGroupTiming(item.id)?.totalMs"
                  :data-agent-init-ms="processGroupTiming(item.id)?.agentInitializationMs"
                  :data-queue-ms="processGroupTiming(item.id)?.queueMs"
                  :data-agent-init-boundary="processGroupTiming(item.id)?.agentInitializationBoundary"
                >{{ processGroupTimingText(item.id) }}</span>
              </summary>
              <div v-if="narrow" class="atc-process-scrim" aria-hidden="true" @click="toggleProcessGroup(item.id)" />
              <div class="atc-process-content atc-process-group-content" :role="narrow ? 'dialog' : undefined" :aria-label="narrow ? text.process : undefined">
                <div v-if="narrow" class="atc-process-sheet-head">
                  <span class="atc-process-sheet-grab" aria-hidden="true" />
                  <b>{{ text.process }}</b>
                  <button type="button" class="atc-process-sheet-close" :aria-label="text.close" @click="toggleProcessGroup(item.id)">×</button>
                </div>
                <component
                  v-for="processItem in processGroupItems(item.id)"
                  :id="`atc-item-${processItem.id}`"
                  :key="processItem.id"
                  :is="
                    canToggleProcessStep(processItem) ? 'details' : 'div'
                  "
                  class="atc-process-step"
                  :class="{ 'atc-process-phase': isExecutionPhaseProcessItem(processItem) }"
                  :data-status="processItem.status"
                  :data-execution-phase="processItem.data?.executionPhase"
                  :data-expandable="canToggleProcessStep(processItem)"
                  :open="
                    canToggleProcessStep(processItem)
                      ? isProcessStepExpanded(processItem)
                      : undefined
                  "
                >
                  <component
                    :is="
                      canToggleProcessStep(processItem) ? 'summary' : 'div'
                    "
                    class="atc-process-step-summary"
                    :aria-expanded="
                      canToggleProcessStep(processItem)
                        ? isProcessStepExpanded(processItem)
                        : undefined
                    "
                    @click.prevent="toggleProcessStep(processItem)"
                  >
                    <span
                      v-if="canToggleProcessStep(processItem)"
                      class="atc-process-step-chevron"
                      aria-hidden="true"
                    />
                    <span class="atc-process-marker" aria-hidden="true" />
                    <span class="atc-process-label">{{
                      processItemLabel(processItem)
                    }}</span>
                    <span
                      v-if="processPlan(processItem)"
                      class="atc-process-preview atc-plan-progress"
                      >{{ planSummary(processItem) }}</span
                    >
                    <span
                      v-else-if="processPreview(processItem)"
                      class="atc-process-preview"
                      >{{ processPreview(processItem) }}</span
                    >
                    <span
                      v-if="processStepElapsed(processItem, item.id)"
                      class="atc-process-step-elapsed"
                      aria-hidden="true"
                      >{{ processStepElapsed(processItem, item.id) }}</span
                    >
                  </component>
                  <div
                    v-if="canToggleProcessStep(processItem)"
                    class="atc-process-step-content"
                  >
                    <slot name="process-item" :item="processItem">
                      <ol
                        v-if="processPlan(processItem)"
                        class="atc-plan-steps"
                      >
                        <li
                          v-for="(step, stepIndex) in processPlan(processItem)
                            ?.steps"
                          :key="stepIndex"
                          class="atc-plan-step"
                          :data-status="step.status"
                        >
                          <span
                            class="atc-plan-check"
                            :aria-hidden="true"
                            >{{
                              step.status === "completed" ? "☑" : "☐"
                            }}</span
                          >
                          <span
                            class="atc-plan-step-text"
                            :class="{
                              'atc-plan-step-active':
                                step.status === 'inProgress',
                            }"
                            >{{ step.step }}</span
                          >
                        </li>
                      </ol>
                      <p
                        v-if="processPlan(processItem)?.explanation"
                        class="atc-plan-explanation"
                      >
                        {{ processPlan(processItem)?.explanation }}
                      </p>
                      <div
                        v-if="processToolDetails(processItem)"
                        class="atc-process-tool-details"
                      >
                        <div v-if="processToolDetails(processItem)?.query">
                          {{ text.toolSearchQuery }}{{
                            processToolDetails(processItem)?.query
                          }}
                        </div>
                        <div
                          v-if="
                            processToolDetails(processItem)?.resultCount !==
                            undefined
                          "
                        >
                          {{
                            text.toolSearchResults(
                              processToolDetails(processItem)?.resultCount ?? 0,
                            )
                          }}
                        </div>
                        <template
                          v-if="processToolDetails(processItem)?.sources?.length"
                        >
                          <div class="atc-process-source-heading">
                            {{ text.toolSources }}
                          </div>
                          <ul class="atc-process-sources">
                            <li
                              v-for="(source, sourceIndex) in processToolDetails(
                                processItem,
                              )?.sources"
                              :key="`${source.url || source.domain || source.title}-${sourceIndex}`"
                            >
                              <a
                                v-if="source.url"
                                :href="source.url"
                                target="_blank"
                                rel="noopener noreferrer"
                                >{{
                                  source.title || source.domain || source.url
                                }}</a
                              >
                              <span v-else>{{
                                source.title || source.domain
                              }}</span>
                              <span
                                v-if="source.title && source.domain"
                                class="atc-process-source-domain"
                                >{{ source.domain }}</span
                              >
                            </li>
                          </ul>
                        </template>
                        <div
                          v-if="processToolDetails(processItem)?.truncated"
                          class="atc-process-tool-truncated"
                        >
                          {{ text.toolDetailsTruncated }}
                        </div>
                      </div>
                      <ConversationContent v-else :item="processItem" />
                    </slot>
                  </div>
                </component>
              </div>
            </details>
          </template>

          <component
            :is="rendererFor(item)"
            v-else-if="rendererFor(item)"
            :id="`atc-item-${item.id}`"
            class="atc-item atc-custom-item"
            :item="item"
            :locale="locale"
            :conversation-status="controller.state.value.status"
            :interaction-submitting="!canExecute || isInteractionSubmitting(item)"
            v-bind="rendererAttachmentProps"
            @respond="forwardInteraction(item, $event)"
            @open-artifact="emit('open-artifact', $event)"
            @open-diagnostics="emit('open-diagnostics', $event)"
            @share="emit('share', $event)"
            @feedback="emit('feedback', $event)"
            @navigate="emit('navigate', $event)"
            @fallback-legacy="fallbackLegacy"
          />

          <div
            v-else
            :id="`atc-item-${item.id}`"
            class="atc-item atc-assistant-item"
            :data-lane="item.lane"
            :data-status="item.status"
          >
            <slot
              name="assistant-item"
              :item="item"
              :respond="(value: unknown) => forwardInteraction(item, value)"
            >
              <ConversationContent :item="item" />
            </slot>
            <ul v-if="item.attachments?.length" class="atc-artifact-list">
              <li v-for="attachment in item.attachments" :key="attachment.id">
                <slot
                  name="artifact"
                  :attachment="attachment"
                  :item="item"
                  :open="() => openArtifact(attachment)"
                >
                  <button
                    type="button"
                    class="atc-artifact-card"
                    @click="openArtifact(attachment)"
                  >
                    <span class="atc-artifact-mark" aria-hidden="true">↗</span>
                    <span class="atc-artifact-copy">
                      <strong>{{ attachment.name }}</strong>
                      <small v-if="attachment.mimeType">{{
                        attachment.mimeType
                      }}</small>
                    </span>
                  </button>
                </slot>
              </li>
            </ul>
            <slot
              name="assistant-actions"
              :item="item"
              :capabilities="capabilities"
            >
              <div
                v-if="
                  item.status === 'complete' &&
                  item.role === 'assistant' &&
                  item.lane === 'answer' &&
                  (capabilities.feedback ||
                    capabilities.share ||
                    capabilities.diagnostics)
                "
                class="atc-item-actions"
              >
                <button
                  v-if="capabilities.feedback"
                  class="atc-icon-action"
                  type="button"
                  :aria-label="text.helpful"
                  @click="emit('feedback', { itemId: item.id, value: 'up' })"
                >
                  ↑
                </button>
                <button
                  v-if="capabilities.feedback"
                  class="atc-icon-action"
                  type="button"
                  :aria-label="text.notHelpful"
                  @click="emit('feedback', { itemId: item.id, value: 'down' })"
                >
                  ↓
                </button>
                <button
                  v-if="capabilities.share"
                  class="atc-icon-action atc-text-action"
                  type="button"
                  @click="
                    emit('share', { itemId: item.id, turnId: item.turnId })
                  "
                >
                  {{ text.share }}
                </button>
                <button
                  v-if="capabilities.diagnostics"
                  class="atc-icon-action atc-text-action"
                  type="button"
                  @click="
                    emit('open-diagnostics', {
                      itemId: item.id,
                      turnId: item.turnId,
                    })
                  "
                >
                  {{ text.diagnostics }}
                </button>
              </div>
            </slot>
            <div v-if="item.status === 'failed'" class="atc-item-actions">
              <button
                v-if="capabilities.retry"
                class="atc-action-button"
                type="button"
                :disabled="!canExecute"
                @click="controller.retry(item.id, item.turnId)"
              >
                {{ text.retry }}
              </button>
            </div>
          </div>
        </template>
      </article>
      <slot name="conversation-trailing" />
      <div
        ref="bottomSentinel"
        class="atc-bottom-sentinel"
        aria-hidden="true"
      />
    </div>

    <button
      v-if="scrollMode === 'detached'"
      class="atc-jump-latest"
      type="button"
      @click="jumpToLatest"
    >
      <span aria-hidden="true">↓</span> {{ text.jumpLatest }}
    </button>

    <footer class="atc-composer-shell">
      <AttachmentChips
        v-if="attachments.length"
        class="atc-composer-attachments"
        :attachments="composerAttachmentChips"
        removable
        @remove="removeAttachment"
      />
      <div class="atc-composer">
        <textarea
          v-model="composer"
          class="atc-composer-input"
          rows="1"
          :maxlength="MAX_MESSAGE_CONTENT_LENGTH * 2"
          :placeholder="narrow ? text.composerPlaceholderShort : text.composerPlaceholder"
          :disabled="!capabilities.send || sending"
          @keydown="onComposerKeydown"
        />
        <div class="atc-composer-toolbar">
          <div class="atc-composer-tools">
            <slot name="composer-toolbar-leading" :status="controller.state.value.status" />
            <label
              v-if="capabilities.attachments && adapter.uploadAttachment"
              class="atc-attach-button"
              :aria-disabled="!capabilities.send || uploading || !canExecute"
            >
              <span aria-hidden="true">＋</span>
              <span class="atc-visually-hidden">{{ text.attach }}</span>
              <input
                type="file"
                :disabled="uploading || !capabilities.send || !canExecute"
                @change="onAttachment"
              />
            </label>
            <slot name="toolbar" />
            <slot name="composer-toolbar-trailing" />
          </div>
          <div class="atc-composer-actions">
            <slot name="composer-actions-leading" />
            <button
              v-if="
                capabilities.retry &&
                controller.state.value.status === 'failed' &&
                !hasFailedItem
              "
              class="atc-action-button atc-task-retry-button"
              type="button"
              @click="controller.retry()"
              :disabled="!canExecute"
            >
              {{ text.retry }}
            </button>
            <button
              v-if="capabilities.rerun"
              class="atc-secondary-button"
              type="button"
              @click="controller.rerun()"
              :disabled="!canExecute"
            >
              {{ text.rerun }}
            </button>
            <button
              v-if="capabilities.stop && (controller.state.value.status === 'running' || hasActiveItem) && !(narrow && composer.trim())"
              class="atc-stop-button"
              type="button"
              @click="controller.stop()"
              :disabled="!canExecute"
            >
              <span class="atc-stop-icon" aria-hidden="true" />
              {{ text.stop }}
            </button>
            <button
              v-if="!(narrow && capabilities.stop && (controller.state.value.status === 'running' || hasActiveItem) && !composer.trim())"
              class="atc-send-button"
              type="button"
              :disabled="!composer.trim() || sending || !capabilities.send || !canExecute"
              @click="submit"
            >
              {{ text.send }}
            </button>
            <slot name="composer-actions-trailing" />
          </div>
        </div>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.atc-snapshot-status {
  display: flex;
  min-height: 38vh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--atc-text-muted);
  font-size: 14px;
}
</style>
