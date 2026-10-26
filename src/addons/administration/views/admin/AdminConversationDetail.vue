<script setup lang="ts">
/**
 * 单个会话的只读视图：归属用户、处理中状态、IM↔Core 关联与完整消息历史（按页加载）。
 * 内容按纯文本渲染（不解释 HTML），附件只显示元数据，不提供下载；没有任何写操作。
 */
import { computed, onServerPrefetch, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/contracts/platform-runtime";
import {
  formatSize,
  getConversation,
  listConversationMessages,
  userLabel,
  type ConversationDetail,
  type ConversationMessage,
  type ConversationType,
} from "../../api/conversations";
import { linkTargets, messageSender, messageState } from "./conversationPresentation";

const PAGE = 50;
const route = useRoute();
const { t } = useI18n();
const detail = ref<ConversationDetail | null>(null);
const messages = ref<ConversationMessage[]>([]);
const nextCursor = ref("");
const error = ref("");
const loading = ref(false);
const loadingMore = ref(false);
let generation = 0;

const type = computed(() => String(route.params.type) as ConversationType);
const id = computed(() => String(route.params.id));
const links = computed(() => (detail.value ? linkTargets(detail.value) : []));

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : t("common.operationFailed");
}

let pending: Promise<void> = Promise.resolve();

function load(): Promise<void> {
  pending = runLoad();
  return pending;
}

async function runLoad(): Promise<void> {
  const current = ++generation;
  detail.value = null;
  messages.value = [];
  nextCursor.value = "";
  error.value = "";
  loading.value = true;
  try {
    const [d, page] = await Promise.all([getConversation(type.value, id.value), listConversationMessages(type.value, id.value, "", PAGE)]);
    if (current !== generation) return;
    detail.value = d;
    messages.value = page.items;
    nextCursor.value = page.nextCursor;
  } catch (err) {
    if (current === generation) error.value = errorText(err);
  } finally {
    if (current === generation) loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (!nextCursor.value || loadingMore.value) return;
  const current = generation;
  loadingMore.value = true;
  try {
    const page = await listConversationMessages(type.value, id.value, nextCursor.value, PAGE);
    if (current !== generation) return;
    messages.value = [...messages.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } catch (err) {
    if (current === generation) error.value = errorText(err);
  } finally {
    loadingMore.value = false;
  }
}

function formatTime(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

watch(() => [route.params.type, route.params.id], load, { immediate: true });
// Server rendering (tests) waits for the first load like the browser does after mount.
onServerPrefetch(() => pending);
</script>

<template>
  <div class="detail-view" data-testid="admin-conversation-detail">
    <router-link class="back" :to="{ path: '/admin/conversations' }">‹ {{ t("conversationsAdmin.back") }}</router-link>
    <p v-if="loading" class="empty-hint">{{ t("common.loading") }}</p>
    <p v-else-if="error" class="empty-hint error" role="alert">{{ error }}</p>
    <template v-else-if="detail">
      <section class="summary">
        <h2>{{ detail.type === "chat" ? (detail.title || t("conversationsAdmin.untitled")) :
          (detail.channelType === 2 ? `${t("conversationsAdmin.group")} · ${detail.groupTitle || detail.channelKey}` :
            `${t("conversationsAdmin.dm")} · ${userLabel(detail.peer, detail.peerUserId)}`) }}</h2>
        <dl>
          <dt>{{ t("conversationsAdmin.typeLabel") }}</dt><dd>{{ t(`conversationsAdmin.type.${detail.type}`) }} #{{ detail.id }}</dd>
          <dt>{{ t("conversationsAdmin.owner") }}</dt><dd>{{ userLabel(detail.user, detail.userId) }} · UID {{ detail.userId }}</dd>
          <dt v-if="detail.status">{{ t("conversationsAdmin.status") }}</dt><dd v-if="detail.status">{{ detail.status }}</dd>
          <dt>{{ t("conversationsAdmin.processingLabel") }}</dt>
          <dd data-testid="conv-processing">{{ detail.processing ? t("conversationsAdmin.processing") : t("conversationsAdmin.idle") }}
            <span v-if="detail.streamingCount"> · {{ t("conversationsAdmin.streamingCount", { n: detail.streamingCount }) }}</span>
            <span v-if="detail.inFlightCount"> · {{ t("conversationsAdmin.inFlightCount", { n: detail.inFlightCount }) }}</span>
          </dd>
          <dt>{{ t("conversationsAdmin.messageCount") }}</dt><dd>{{ detail.messageCount }}</dd>
          <dt v-if="detail.createdAt">{{ t("conversationsAdmin.createdAt") }}</dt><dd v-if="detail.createdAt">{{ formatTime(detail.createdAt) }}</dd>
          <dt v-if="detail.deletedAt">{{ t("conversationsAdmin.deleted") }}</dt><dd v-if="detail.deletedAt">{{ formatTime(detail.deletedAt) }}</dd>
        </dl>
        <div class="links" data-testid="conv-links">
          <span class="links-title">{{ t("conversationsAdmin.links") }}</span>
          <span v-if="detail.linkStatus === 'unavailable'" class="badge off">{{ t("conversationsAdmin.linkUnavailable") }}</span>
          <span v-else-if="!links.length" class="muted">{{ t("conversationsAdmin.noLinks") }}</span>
          <router-link v-for="link in links" :key="link.to" :to="link.to" class="link-chip" data-testid="conv-link">
            {{ t(`conversationsAdmin.linkTo.${link.kind}`, { id: link.id }) }}<span v-if="link.status"> · {{ link.status }}</span>
          </router-link>
        </div>
      </section>

      <section class="messages" data-testid="conv-messages">
        <p v-if="!messages.length" class="empty-hint">{{ t("conversationsAdmin.noMessages") }}</p>
        <article v-for="message in messages" :key="message.id" class="message" :class="messageState(message)" data-testid="conv-message">
          <header>
            <span class="sender">{{ messageSender(message, t) }}</span>
            <span v-if="message.msgType && message.msgType !== 'text'" class="badge">{{ message.msgType }}</span>
            <span v-if="message.streaming" class="badge busy">{{ t("conversationsAdmin.streaming") }}</span>
            <time>{{ formatTime(message.createdAt) }}</time>
          </header>
          <p v-if="message.contentHidden" class="muted">{{ message.thinking ? t("conversationsAdmin.thinkingHidden") : t("conversationsAdmin.unsupportedPayload") }}</p>
          <p v-else-if="message.content" class="content">{{ message.content }}</p>
          <ul v-if="message.attachments?.length" class="attachments">
            <li v-for="(file, index) in message.attachments" :key="index" data-testid="conv-attachment">
              📎 {{ file.name || file.fileId }} <span class="muted">{{ [file.mimeType || file.kind, formatSize(file.size)].filter(Boolean).join(" · ") }}</span>
            </li>
          </ul>
        </article>
        <button v-if="nextCursor" class="btn-ghost more" type="button" :disabled="loadingMore" data-testid="conv-more" @click="loadMore">
          {{ loadingMore ? t("common.loading") : t("conversationsAdmin.loadMore") }}
        </button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail-view { display: flex; flex-direction: column; gap: 14px; }
.back { font-size: 13px; color: var(--text-secondary); text-decoration: none; align-self: flex-start; }
.empty-hint { color: var(--text-tertiary); text-align: center; padding: 32px 0; font-size: 13px; }
.empty-hint.error { color: var(--rose-500); }
.summary { padding: 16px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); }
.summary h2 { font-size: 16px; font-weight: 700; margin-bottom: 10px; color: var(--text-primary); word-break: break-word; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; font-size: 13px; }
dt { color: var(--text-tertiary); }
dd { color: var(--text-primary); margin: 0; }
.links { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; font-size: 12.5px; }
.links-title { color: var(--text-tertiary); }
.link-chip { padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; text-decoration: none; color: var(--indigo-600); }
.messages { display: flex; flex-direction: column; gap: 8px; }
.message { padding: 10px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md); }
.message.user { border-left: 3px solid var(--teal-500); }
.message.streaming { border-style: dashed; }
.message header { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-tertiary); margin-bottom: 6px; flex-wrap: wrap; }
.message header time { margin-left: auto; font-family: var(--font-mono); }
.sender { font-weight: 600; color: var(--text-secondary); }
.content { white-space: pre-wrap; word-break: break-word; font-size: 13.5px; color: var(--text-primary); }
.attachments { margin-top: 6px; padding-left: 0; list-style: none; font-size: 12.5px; }
.muted { color: var(--text-tertiary); font-size: 12.5px; }
.badge { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: var(--bg-hover); color: var(--text-secondary); }
.badge.busy { background: #fef3c7; color: #b45309; }
.badge.off { background: var(--slate-100); color: var(--text-tertiary); }
.btn-ghost { padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-secondary); cursor: pointer; }
.more { align-self: center; }
</style>
