<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, getPlatformRuntime } from "@/contracts/platform-runtime";
import { BroadcastApiError, getBroadcast, broadcastCancel } from "../api/broadcast";
import { getConversation, listExecutionBackends } from "../api/conversation";
import type { BroadcastSiblingBrief, BroadcastFollowUpResult, BroadcastCancelResult, BroadcastCancelFailure, ExecutionBackendOption } from "../api/types";
import { useConversationStore } from "../store/conversation";
import { activeBroadcastMember } from "../composables/broadcastViewPolicy";
import { createBroadcastAdapter } from "../composables/useBroadcastAdapter";
import { TaskConversation } from "../task-conversation/vue";
import type { ConversationRendererRegistry } from "../task-conversation/vue";
import ErrorBubble from "../components/conversation/ErrorBubble.vue";
import MessageItem from "../components/conversation/MessageItem.vue";
import AttachmentChips from "../components/AttachmentChips.vue";
import { toMessageAttachment } from "../components/attachmentPresentation";
import { toast } from "@/composables/useToast";
import "../task-conversation/styles.css";
import "./conversation.css";

const props = defineProps<{ groupId: string }>();
const route = useRoute();
const router = useRouter();
const store = useConversationStore();
const { t, locale } = useI18n();
const siblings = ref<BroadcastSiblingBrief[]>([]);
const backends = ref<ExecutionBackendOption[]>([]);
const loading = ref(true);
const error = ref("");
const cancelling = ref(false);
const cancelFailures = ref<BroadcastCancelFailure[]>([]);
const activeId = computed(() => activeBroadcastMember(siblings.value, route.query.conversationId));
const notices = computed(() => store.broadcastNotices[props.groupId] ?? []);
const busyCount = computed(() => siblings.value.filter(item => ["executing", "blocked"].includes(item.status)).length);
const renderers: ConversationRendererRegistry = { error: ErrorBubble };
const backendLabel = (id: string) => backends.value.find(item => item.id === id)?.displayName ?? id;
let refreshCurrent: () => Promise<void> = async () => undefined;

function onResult(result: BroadcastFollowUpResult | BroadcastCancelResult): void {
  if (result.groupId !== props.groupId) return;
  if ("skipped" in result) store.setBroadcastNotices(result.groupId, result.skipped ?? []);
  if ("failed" in result) cancelFailures.value = result.failed;
  void refreshCurrent();
}
const adapter = computed(() => activeId.value === null ? null : createBroadcastAdapter({
  groupId: props.groupId, activeId: activeId.value, onResult,
}));

watch(() => props.groupId, (groupId, _previous, cleanup) => {
  const controller = new AbortController();
  const runtime = getPlatformRuntime();
  const token = runtime.getAccessToken();
  const version = runtime.getSessionVersion();
  const current = () => !controller.signal.aborted &&
    runtime.getAccessToken() === token && runtime.getSessionVersion() === version;
  let pending = false;
  siblings.value = [];
  error.value = "";
  loading.value = true;
  cancelling.value = false;
  cancelFailures.value = [];

  async function refresh(): Promise<void> {
    if (pending || !current()) return;
    pending = true;
    let groupLoaded = false;
    try {
      const group = await getBroadcast(groupId, controller.signal);
      groupLoaded = true;
      if (!current()) return;
      store.reconcileBroadcastMembers(groupId, group.siblings.map(item => item.id));
      // A group may extend beyond the sidebar's current pagination window.
      // Fetch missing rows once so navigation always identifies every member.
      const missing = group.siblings.filter(item => !store.conversations.some(row => row.id === item.id));
      const rows = await Promise.all(missing.map(item => getConversation(item.id)));
      if (!current()) return;
      rows.forEach(row => store.upsert(row));
      group.siblings.forEach(item => {
        const row = store.conversations.find(row => row.id === item.id);
        if (row) store.upsert({ ...row, ...item, state: { ...row.state, broadcastGroupId: groupId } });
      });
      siblings.value = group.siblings;
      error.value = "";
      const selected = activeBroadcastMember(group.siblings, route.query.conversationId);
      if (selected !== null && route.query.conversationId !== String(selected)) {
        await router.replace({ path: `/b/${groupId}`, query: { conversationId: String(selected) } });
      }
    } catch (cause) {
      if (current()) {
        if (!groupLoaded && cause instanceof ApiError && cause.status === 404) {
          store.reconcileBroadcastMembers(groupId, []);
          siblings.value = [];
        }
        error.value = cause instanceof ApiError ? cause.message : t("broadcast.loadFailed");
      }
    } finally {
      pending = false;
      if (current()) loading.value = false;
    }
  }
  refreshCurrent = refresh;
  void refresh();
  void listExecutionBackends().then(options => {
    if (current()) backends.value = options;
  }).catch(() => { /* Persisted backend IDs remain usable labels when the catalog is unavailable. */ });
  const timer = setInterval(() => { void refresh(); }, 3000);
  cleanup(() => { controller.abort(); clearInterval(timer); });
}, { immediate: true });

async function select(id: number): Promise<void> {
  await router.replace({ path: `/b/${props.groupId}`, query: { conversationId: String(id) } });
  void refreshCurrent();
}

function tabKey(event: KeyboardEvent, index: number): void {
  const count = siblings.value.length;
  const next = event.key === "ArrowRight" ? (index + 1) % count :
    event.key === "ArrowLeft" ? (index + count - 1) % count :
    event.key === "Home" ? 0 : event.key === "End" ? count - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  const tabs = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  tabs?.[next]?.focus();
  void select(siblings.value[next].id);
}

const lifetime = new AbortController();
onBeforeUnmount(() => lifetime.abort());
async function stopAll(): Promise<void> {
  if (cancelling.value) return;
  const runtime = getPlatformRuntime();
  const version = runtime.getSessionVersion();
  const token = runtime.getAccessToken();
  const groupId = props.groupId;
  const current = () => !lifetime.signal.aborted && version === runtime.getSessionVersion() &&
    token === runtime.getAccessToken() && props.groupId === groupId;
  cancelling.value = true;
  try {
    const result = await broadcastCancel(groupId, lifetime.signal);
    if (current()) onResult(result);
  } catch (cause) {
    if (current()) {
      if (cause instanceof BroadcastApiError && cause.details.failed) cancelFailures.value = cause.details.failed;
      toast.error(cause instanceof ApiError ? cause.message : t("common.operationFailed"));
    }
  } finally {
    if (current()) cancelling.value = false;
  }
}
</script>

<template>
  <div class="view active view--scroll-hidden">
    <div class="chat-view broadcast-view">
      <header class="broadcast-header">
        <div>
          <strong>{{ t('broadcast.title') }}</strong>
          <p>{{ t('broadcast.followUpHint') }}</p>
        </div>
        <button v-if="busyCount" class="broadcast-stop" type="button" :disabled="cancelling" @click="stopAll">
          {{ t('broadcast.stopAll', { count: busyCount }) }}
        </button>
      </header>
      <div v-if="notices.length" class="broadcast-notices" role="status">
        <strong>{{ t('broadcast.skipped') }}</strong>
        <ul>
          <li v-for="item in notices" :key="item.backend">{{ backendLabel(item.backend) }}: {{ t(`broadcast.reasons.${item.reason}`) }}</li>
        </ul>
      </div>
      <div v-if="cancelFailures.length" class="broadcast-notices" role="alert">
        <strong>{{ t('broadcast.cancelFailed') }}</strong>
        <ul>
          <li v-for="item in cancelFailures" :key="item.conversationId">{{ backendLabel(item.backend) }}: {{ t(`broadcast.reasons.${item.reason}`) }}</li>
        </ul>
      </div>
      <div v-if="error" class="broadcast-error" role="alert">
        {{ error }} <button type="button" @click="refreshCurrent">{{ t('common.retry') }}</button>
      </div>
      <p v-if="loading" class="broadcast-loading" role="status">{{ t('common.loading') }}</p>
      <p v-else-if="!siblings.length && !error">{{ t('common.empty') }}</p>
      <div v-if="siblings.length" class="broadcast-tabs" role="tablist" :aria-label="t('broadcast.backends')">
        <button
          v-for="(member, index) in siblings" :id="`backend-tab-${member.id}`" :key="member.id"
          type="button" role="tab" :aria-selected="member.id === activeId" aria-controls="broadcast-panel"
          :tabindex="member.id === activeId ? 0 : -1" :data-status="member.status"
          @click="select(member.id)" @keydown="tabKey($event, index)"
        >
          <span class="broadcast-status-dot" aria-hidden="true" />
          <span>{{ backendLabel(member.executionBackend) }}</span>
          <small>{{ t(`broadcast.status.${member.status}`) }}</small>
        </button>
      </div>
      <div v-if="adapter && activeId !== null" id="broadcast-panel" class="broadcast-panel" role="tabpanel" :aria-labelledby="`backend-tab-${activeId}`">
        <TaskConversation
          :conversation-key="String(activeId)" :adapter="adapter"
          :capabilities="{ send: !loading && !cancelling, stop: true, attachments: true }"
          :renderers="renderers" :show-process="true" :locale="locale === 'en' ? 'en-US' : 'zh-CN'"
          @error="cause => toast.error(cause.message)" @status-change="refreshCurrent"
        >
          <template #user-item="{ item }"><MessageItem :item="item" role="user" /></template>
          <template #assistant-item="{ item, respond }"><MessageItem :item="item" role="assistant" @respond="respond" /></template>
          <template #artifact="{ attachment }"><AttachmentChips :attachments="[toMessageAttachment(attachment)]" /></template>
          <template #composer-toolbar-leading><span class="broadcast-composer-hint">{{ t('broadcast.sendToAll') }}</span></template>
        </TaskConversation>
      </div>
    </div>
  </div>
</template>

<style scoped>
.broadcast-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 8px; }
.broadcast-header strong { font-size: 15px; color: var(--text-primary); }
.broadcast-header p { margin: 4px 0 0; color: var(--text-tertiary); font-size: 12px; }
.broadcast-stop { padding: 6px 10px; white-space: nowrap; border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--rose-500); background: var(--bg-card); cursor: pointer; }
.broadcast-stop:disabled { opacity: .5; cursor: wait; }
.broadcast-tabs { display: flex; overflow-x: auto; gap: 6px; padding: 8px 16px; flex-shrink: 0; border-bottom: 1px solid var(--border); }
.broadcast-tabs button { display: flex; align-items: center; gap: 6px; padding: 7px 10px; white-space: nowrap; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-secondary); cursor: pointer; }
.broadcast-tabs button[aria-selected="true"] { border-color: var(--indigo-500); color: var(--indigo-600); background: var(--bg-hover); }
.broadcast-tabs small { color: var(--text-tertiary); font-size: 11px; }
.broadcast-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); }
[data-status="executing"] .broadcast-status-dot { background: var(--indigo-500); animation: atc-pulse 1.2s ease-in-out infinite; }
[data-status="completed"] .broadcast-status-dot { background: var(--emerald-500); }
[data-status="failed"] .broadcast-status-dot { background: var(--rose-500); }
[data-status="blocked"] .broadcast-status-dot { background: var(--amber-500); }
.broadcast-panel { display: flex; flex: 1; min-height: 0; }
.broadcast-notices, .broadcast-error, .broadcast-loading { margin: 8px 16px; padding: 8px 12px; background: var(--bg-subtle); color: var(--text-secondary); border-radius: var(--r-sm); font-size: 12px; }
.broadcast-notices ul { margin: 4px 0 0; padding-left: 18px; }
.broadcast-error button { border: 0; background: transparent; color: var(--indigo-600); cursor: pointer; }
.broadcast-composer-hint { color: var(--text-tertiary); font-size: 12px; }
</style>
