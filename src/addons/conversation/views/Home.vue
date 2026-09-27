<script setup lang="ts">
/**
 * 首页视图 —— 对齐 design/nucleagent-design.html 第 1760–1846 行。
 *
 * .home-hero（问候 + 标题 + 副标题）+ .home-composer（输入框 + 发送）+
 * .suggestion-grid（9 张建议卡，带 .delay-1..9 交错入场）。
 *
 * 替代旧 Workbench.vue：去掉自带的品牌头部与侧栏（chrome 已上移到壳），
 * 仅保留内容。创建对话的逻辑沿用 useConversationStore。
 */
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/contracts/platform-runtime";
import { BroadcastApiError } from "@/addons/conversation/api/broadcast";
import { useConversationStore } from "@/addons/conversation/store/conversation";
import { toast } from "@/composables/useToast";
import AttachmentPicker from "@/addons/conversation/components/AttachmentPicker.vue";
import AttachmentChips from "@/addons/conversation/components/AttachmentChips.vue";
import ModelPicker from "@/addons/conversation/components/ModelPicker.vue";
import ExecutionBackendPicker from "@/addons/conversation/components/ExecutionBackendPicker.vue";
import BroadcastOptions from "@/addons/conversation/components/BroadcastOptions.vue";
import { useNarrow } from "@/composables/useNarrow";
import { broadcastRoute } from "@/addons/conversation/composables/broadcastViewPolicy";
import { deskOrder, relativeTime } from "@/addons/conversation/composables/taskDesk";
import type { ConversationMode, MessageAttachment, ModelChoice } from "@/addons/conversation/api/types";

const router = useRouter();
const route = useRoute();
const store = useConversationStore();
const { t, locale } = useI18n();
const narrow = useNarrow();

const input = ref("");
const submitting = ref(false);
/** 待发送附件。选中即已上传到 storage，这里持有的只是引用（fileId 等）。 */
const attachments = ref<MessageAttachment[]>([]);
/** 选定的模型；null = 用服务端默认。 */
const modelChoice = ref<ModelChoice | null>(null);
const executionBackend = ref<string | null>(null);
const backendCompatible = ref(false);
const broadcast = ref(false);
const eligibleCount = ref(0);
const canSend = computed(() => broadcast.value ? eligibleCount.value > 0 : backendCompatible.value);

/** 9 张建议卡。点击后把标题填入输入框。 */
const suggestionKeys = [
  { key: "competitiveAnalysis", delay: 1, icon: "check", bg: "var(--teal-50)", color: "var(--teal-600)" },
  { key: "presentation", delay: 2, icon: "ppt", bg: "#fef3c7", color: "#d97706" },
  { key: "freeChat", delay: 3, icon: "chat", bg: "#e0e7ff", color: "var(--indigo-500)" },
  { key: "videoGen", delay: 4, icon: "video", bg: "#ffe4e6", color: "#e11d48" },
  { key: "musicCreation", delay: 5, icon: "music", bg: "#ede9fe", color: "#7c3aed" },
  { key: "dataAnalysis", delay: 6, icon: "chart", bg: "var(--teal-50)", color: "var(--teal-600)" },
  { key: "docWriting", delay: 7, icon: "doc", bg: "#e0e7ff", color: "var(--indigo-500)" },
  { key: "workflowAutomation", delay: 8, icon: "clock", bg: "#fef3c7", color: "#d97706" },
  { key: "knowledgeQA", delay: 9, icon: "layers", bg: "var(--teal-50)", color: "var(--teal-600)" },
] as const;

const suggestions = computed(() =>
  suggestionKeys.map((s) => ({
    ...s,
    title: t(`home.suggestions.${s.key}.title`),
    desc: t(`home.suggestions.${s.key}.desc`),
  })),
);

async function handleCreate(): Promise<void> {
  const text = input.value.trim();
  if (!text || submitting.value) return;
  if (!canSend.value) {
    toast.warning(t("common.executionBackendSelectionInvalid"));
    return;
  }
  submitting.value = true;
  try {
    const mode: ConversationMode = "a2a_agent";
    const payload = {
      mode,
      input: text,
      // 模型与 provider 成对下发；未选则都不带，由服务端用默认。
      model: modelChoice.value?.model ?? "",
      providerId: modelChoice.value?.providerId,
      // 只传引用，字节早在选中时就直传给 storage 了。
      attachments: attachments.value.map((a) => ({ fileId: a.fileId, name: a.name })),
    };
    const target = broadcast.value
      ? await store.createBroadcast(payload).then(result => ({
        path: `/b/${result.groupId}`, query: { conversationId: String(result.conversations[0].id) },
      }))
      : await store.create({ ...payload, executionBackend: executionBackend.value ?? undefined })
        .then(created => ({ path: `/c/${created.id}` }));
    input.value = "";
    attachments.value = [];
    await router.push(target);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    const message = error instanceof ApiError ? error.message : t("home.createFailed");
    const reasons = error instanceof BroadcastApiError
      ? error.details.skipped?.map(item => `${item.backend}: ${t(`broadcast.reasons.${item.reason}`)}`).join("; ")
      : "";
    toast.error(reasons ? `${message}: ${reasons}` : message);
  } finally {
    submitting.value = false;
  }
}

// ---- Task desk below 1024px (board §11 ①–③) ----
const runSheet = ref(false);
const modelLabel = ref("");
const backendLabel = ref("");
const recent = computed(() => deskOrder(store.sorted).slice(0, 30));
const now = ref(Date.now());
function openTask(conversation: (typeof store.sorted)[number]): void {
  void router.push(broadcastRoute(conversation) ?? `/c/${conversation.id}`);
}
/** 「更多设置」: upgrade the quick path to the full form without losing the text. */
function moreSettings(): void {
  runSheet.value = false;
  void router.push({ name: "tasks", query: input.value.trim() ? { input: input.value.trim() } : {} });
}

function fillSuggestion(title: string): void {
  input.value = `${title}：`;
}

onMounted(() => {
  // Creation 页点卡片会带 ?prefill=... 跳过来，预填进 composer。
  // 此前没有这段读取，即使修好路由名，卡片点击也只是跳转、看不出任何效果。
  const prefill = route.query.prefill;
  if (typeof prefill === "string" && prefill.trim() && !input.value) {
    input.value = prefill;
  }

  // 首页挂载时拉一次历史，用于推给壳侧栏（桥接在 store 变化时 dispatch）。
  now.value = Date.now();
  store.load().catch((e: unknown) => {
    toast.error(e instanceof ApiError ? e.message : t("home.loadHistoryFailed"));
  });
});
</script>

<template>
  <div class="view active" :class="{ 'view--scroll-hidden': narrow }">
    <!-- Below 1024px: the task desk (board §11). Recent tasks + a resident composer. -->
    <div v-if="narrow" class="desk" data-testid="task-desk">
      <div class="desk-scroll">
        <h1 class="desk-title">{{ t('home.deskTitle') }}</h1>
        <p class="desk-lede">{{ t('home.deskLede') }}</p>
        <p class="desk-glabel">{{ t('home.recent') }}</p>
        <div v-if="recent.length" class="desk-list">
          <button
            v-for="c in recent"
            :key="c.id"
            type="button"
            class="desk-row"
            :data-status="c.status"
            data-testid="desk-row"
            @click="openTask(c)"
          >
            <span class="desk-row-title">{{ c.title || t('common.untitled') }}</span>
            <span class="desk-row-meta">
              <i class="desk-dot" aria-hidden="true" />
              <span>{{ c.status === 'blocked' ? t('home.needsYou') : t(`broadcast.status.${c.status}`) }}</span>
              <time :datetime="c.createdAt">{{ relativeTime(c.createdAt, now, locale === 'en' ? 'en' : 'zh-CN') }}</time>
            </span>
          </button>
        </div>
        <p v-else-if="store.loaded" class="desk-empty">{{ t('common.empty') }}</p>
      </div>

      <div class="desk-composer">
        <AttachmentChips
          v-if="attachments.length"
          :attachments="attachments"
          removable
          @remove="(id: string) => (attachments = attachments.filter((a) => a.fileId !== id))"
        />
        <textarea
          v-model="input"
          class="desk-input"
          rows="1"
          enterkeyhint="enter"
          data-testid="desk-input"
          :placeholder="t('home.composerShort')"
          :disabled="submitting"
        />
        <div class="desk-actions">
          <AttachmentPicker v-model="attachments" :disabled="submitting" />
          <button type="button" class="desk-pill" data-testid="run-pill" :disabled="submitting" @click="runSheet = true">
            <span>{{ broadcast ? t('broadcast.toggle') : [modelLabel || t('common.modelDefault'), backendLabel].filter(Boolean).join(' · ') }}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <button
            class="desk-send"
            type="button"
            data-testid="desk-send"
            :aria-label="t('common.send')"
            :disabled="submitting || !input.trim() || !canSend"
            @click="handleCreate"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        </div>
      </div>

      <!-- 本次执行 sheet (board §11 ③). The pickers stay mounted so their
           validation keeps driving canSend while the sheet is closed. -->
      <div v-show="runSheet" class="osheet-scrim" data-testid="run-sheet" @click.self="runSheet = false" @keydown.esc="runSheet = false">
        <div class="osheet" role="dialog" aria-modal="true" :aria-label="t('home.runTitle')">
          <div class="osheet-grab" aria-hidden="true" />
          <div class="osheet-head"><b>{{ t('home.runTitle') }}</b></div>
          <div class="picker-group">
            <ModelPicker v-model="modelChoice" :disabled="submitting" row @label="modelLabel = $event" />
            <ExecutionBackendPicker
              v-if="!broadcast"
              v-model="executionBackend"
              :model-choice="modelChoice"
              :disabled="submitting"
              row
              @label="backendLabel = $event"
              @validation-change="(value) => (backendCompatible = value.allowed)"
            />
            <label class="picker-row desk-switch">
              <span class="picker-row-k">{{ t('broadcast.toggle') }}</span>
              <input v-model="broadcast" type="checkbox" role="switch" :disabled="submitting" />
            </label>
            <button type="button" class="picker-row" data-testid="run-more" @click="moreSettings">
              <span class="picker-row-k">{{ t('home.runMore') }}</span>
              <svg class="picker-row-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
          <BroadcastOptions v-if="broadcast" :model-choice="modelChoice" @eligible-change="eligibleCount = $event" />
        </div>
      </div>
    </div>

    <div v-else class="home-view">
      <div class="home-hero">
        <div class="home-greeting">{{ t('home.greeting') }}</div>
        <h1 class="home-title" v-html="t('home.title')"></h1>
        <p class="home-subtitle">{{ t('home.subtitle') }}</p>

        <div class="home-composer">
          <textarea
            v-model="input"
            :placeholder="t('home.inputPlaceholder')"
            :disabled="submitting"
            @keydown.enter.exact.prevent="handleCreate"
          />
          <div class="composer-actions">
            <AttachmentPicker v-model="attachments" :disabled="submitting" />
            <ModelPicker v-model="modelChoice" :disabled="submitting" compact />
            <ExecutionBackendPicker
              v-if="!broadcast"
              v-model="executionBackend"
              :model-choice="modelChoice"
              :disabled="submitting"
              compact
              @validation-change="(value) => (backendCompatible = value.allowed)"
            />
            <label class="broadcast-toggle">
              <input v-model="broadcast" type="checkbox" :disabled="submitting" />
              {{ t('broadcast.toggle') }}
            </label>
            <button class="composer-btn send" :title="t('common.send')" type="button" :disabled="submitting || !input.trim() || !canSend" @click="handleCreate">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </div>
          <BroadcastOptions v-if="broadcast" :model-choice="modelChoice" @eligible-change="eligibleCount = $event" />
        </div>

        <AttachmentChips
          :attachments="attachments"
          removable
          @remove="(id: string) => (attachments = attachments.filter((a) => a.fileId !== id))"
        />

        <div class="suggestion-grid">
          <div
            v-for="s in suggestions"
            :key="s.title"
            class="suggestion-chip"
            :class="`delay-${s.delay}`"
            @click="fillSuggestion(s.title)"
          >
            <div class="chip-icon" :style="{ background: s.bg, color: s.color }">
              <svg v-if="s.icon === 'check'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
              <svg v-else-if="s.icon === 'ppt'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
              <svg v-else-if="s.icon === 'chat'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
              <svg v-else-if="s.icon === 'video'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
              <svg v-else-if="s.icon === 'music'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
              <svg v-else-if="s.icon === 'chart'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18" /><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" /></svg>
              <svg v-else-if="s.icon === 'doc'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
              <svg v-else-if="s.icon === 'clock'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
            </div>
            <div class="chip-title">{{ s.title }}</div>
            <div class="chip-desc">{{ s.desc }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* 设计稿第 618–833 行。非 scoped：core 子应用以 micro-app disable-scopecss 加载，
   scoped 样式不生效；这些类名是 core 私有，不与壳冲突。 */
.home-view {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 100%; padding: 48px 24px; text-align: center; position: relative;
}

.home-view::before,
.home-view::after {
  content: ''; position: absolute; border-radius: 50%;
  filter: blur(60px); pointer-events: none; z-index: 0;
}

.home-view::before {
  width: 350px; height: 350px;
  background: radial-gradient(circle, rgba(20, 184, 166, 0.18), transparent 60%);
  top: 10%; left: 15%;
  animation: float 8s var(--ease) infinite;
}

.home-view::after {
  width: 300px; height: 300px;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.15), transparent 60%);
  bottom: 5%; right: 15%;
  animation: float 10s var(--ease) infinite reverse;
}

.home-hero { max-width: 640px; width: 100%; position: relative; z-index: 1; }

.home-greeting {
  font-size: 12px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
  background: var(--grad-teal-indigo);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  margin-bottom: 16px;
  animation: fade-in-up 0.5s var(--ease-out) both;
}

.home-title {
  font-family: var(--font-display);
  font-size: 52px; line-height: 1.1; letter-spacing: -0.5px;
  color: var(--text-primary); margin-bottom: 12px;
  animation: fade-in-up 0.5s var(--ease-out) 0.1s both;
}

.home-title em {
  font-style: italic;
  background: var(--grad-aurora); background-size: 200% 200%;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  animation: gradient-flow 4s var(--ease) infinite;
}

.home-subtitle {
  font-size: 15px; color: var(--text-secondary);
  margin-bottom: 36px; line-height: 1.6;
  animation: fade-in-up 0.5s var(--ease-out) 0.2s both;
}

.home-composer {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1.5px solid var(--border); border-radius: var(--r-xl);
  padding: 6px; box-shadow: var(--shadow-md);
  /* 两行式：textarea 独占整行（可输入空间最大化），操作行在下方。
     单行 flex 布局时两个下拉 + 附件 + 发送会吃掉 ~1/3 宽度，textarea 被
     挤成窄条——模型/后端选择放不下时体验更差。 */
  display: flex; flex-direction: column; gap: 0;
  margin-bottom: 32px;
  transition: all 0.3s var(--ease);
  animation: scale-in 0.5s var(--ease-spring) 0.3s both;
}

.home-composer:focus-within {
  border-color: var(--teal-300);
  box-shadow: var(--shadow-lg), 0 0 0 4px rgba(20, 184, 166, 0.08);
  transform: translateY(-2px);
}

.home-composer textarea {
  width: 100%; border: none; outline: none; resize: none; background: transparent;
  display: block;
  font-family: var(--font-body); font-size: 14.5px; color: var(--text-primary);
  padding: 12px 14px 6px; max-height: 200px; line-height: 1.5;
}

.home-composer textarea::placeholder { color: var(--text-tertiary); }
.home-composer textarea:disabled { opacity: 0.6; }

.composer-actions {
  display: flex; align-items: center; gap: 2px; padding: 2px 4px 4px;
}
/* 操作行里选择器排右侧：附件贴左（拇指位），其余推到右端。 */
.composer-actions .attachment-picker { margin-right: auto; }
.broadcast-toggle { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); font-size: 12px; white-space: nowrap; padding: 4px; cursor: pointer; }
.broadcast-toggle input { accent-color: var(--indigo-500); }
@media (max-width: 540px) { .composer-actions { flex-wrap: wrap; } }

/* .composer-btn 系列已移到 styles/global.css —— Conversation.vue 也在用它，
 * 放在这里只有先访问过 /chat 才生效（详见 global.css 里的说明）。 */

.suggestion-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  width: 100%; max-width: 640px;
}

.suggestion-chip {
  text-align: left; padding: 14px 16px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border); border-radius: var(--r-lg);
  cursor: pointer; transition: all 0.3s var(--ease);
  display: flex; flex-direction: column; gap: 4px;
  position: relative; overflow: hidden;
  animation: fade-in-up 0.4s var(--ease-out) both;
}

.suggestion-chip::before {
  content: ''; position: absolute; inset: 0;
  background: var(--grad-brand-soft);
  opacity: 0; transition: opacity 0.3s var(--ease); border-radius: inherit;
}

.suggestion-chip:hover { border-color: var(--teal-300); box-shadow: var(--shadow-md); transform: translateY(-3px) scale(1.02); }
.suggestion-chip:hover::before { opacity: 0.5; }
.suggestion-chip > * { position: relative; z-index: 1; }

.suggestion-chip .chip-icon {
  width: 30px; height: 30px; border-radius: var(--r-sm);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 4px; transition: transform 0.3s var(--ease-spring);
}

.suggestion-chip:hover .chip-icon { transform: scale(1.15) rotate(-5deg); }
.suggestion-chip .chip-icon svg { width: 16px; height: 16px; }
.suggestion-chip .chip-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.suggestion-chip .chip-desc { font-size: 11.5px; color: var(--text-tertiary); }

/* ---- Task desk below 1024px (board §11) ---- */
.desk { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); }
.desk-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 16px 12px; }
.desk-title { margin: 0; font-size: 24px; font-weight: 750; line-height: 1.25; color: var(--text-primary); }
.desk-lede { margin: 4px 0 16px; font-size: 15px; color: var(--text-secondary); }
.desk-glabel { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.desk-list { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; }
.desk-row {
  display: grid; gap: 4px; width: 100%; min-height: 64px; padding: 10px 16px;
  border: 0; background: transparent; color: var(--text-primary); font: inherit; text-align: left; cursor: pointer;
}
.desk-row + .desk-row { border-top: 1px solid var(--border); }
.desk-row-title { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.desk-row-meta { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); min-width: 0; }
.desk-row-meta time { margin-left: auto; color: var(--text-tertiary); flex: none; }
.desk-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--slate-400); flex: none; }
.desk-row[data-status="executing"] .desk-dot { background: var(--teal-500); }
.desk-row[data-status="blocked"] .desk-dot { background: var(--amber-500, #f59e0b); }
.desk-row[data-status="blocked"] .desk-row-meta span { color: color-mix(in srgb, var(--amber-600) 75%, var(--slate-900)); font-weight: 650; }
.desk-row[data-status="completed"] .desk-dot { background: var(--emerald-500); }
.desk-row[data-status="failed"] .desk-dot { background: var(--rose-500); }
.desk-row:focus-visible { outline: 2px solid var(--teal-500); outline-offset: -2px; }
.desk-empty { color: var(--text-tertiary); font-size: 14px; }
.desk-composer {
  flex: none; display: grid; gap: 4px; padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border); background: var(--bg-card);
}
.desk-input {
  width: 100%; min-height: 44px; max-height: calc(1.5em * 5 + 20px); padding: 10px 12px;
  border: 1.5px solid var(--border); border-radius: var(--r-lg); background: var(--bg);
  color: var(--text-primary); font: inherit; font-size: 16px; line-height: 1.5; resize: none; outline: none; field-sizing: content;
}
.desk-input:focus { border-color: var(--teal-400); }
.desk-actions { display: flex; align-items: center; gap: 8px; }
.desk-actions .attachment-btn { min-width: 44px; min-height: 44px; }
.desk-pill {
  flex: 1; min-width: 0; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  padding: 0 12px; border: 1px solid var(--border); border-radius: var(--r-full); background: var(--bg-subtle);
  color: var(--text-secondary); font: inherit; font-size: 13px; font-weight: 600;
}
.desk-pill span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.desk-pill svg, .desk-send svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.desk-send {
  width: 44px; height: 44px; flex: none; display: grid; place-items: center; border: 0; border-radius: var(--r-full);
  background: var(--teal-700) var(--grad-teal-indigo); color: #fff;
}
.desk-send svg { width: 18px; height: 18px; }
.desk-send:disabled { opacity: 0.4; }
.desk-switch input { margin-left: auto; width: 44px; height: 26px; accent-color: var(--teal-600); }
.desk .osheet .broadcast-options { margin-top: 4px; }
@media (prefers-color-scheme: dark) {
  .desk-row[data-status="blocked"] .desk-row-meta span { color: var(--amber-400); }
}
</style>
