<script setup lang="ts">
/**
 * MUYU-181: tool-call log + type coverage. Records come only from the signed-in user's
 * own conversations (same API the chat page uses), so no other user's content is shown.
 * Read-only; result text is truncated and credential-shaped values are masked.
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getMessages, listConversations } from "../../../conversation/api/conversation";
import { toolPage, type Tool } from "../../api/tool";
import { extractToolCalls, slugOf, toolType, typeCoverage, type ToolCallRow } from "./toolCallLog";

const BATCH = 20;
const { t } = useI18n();
const rows = ref<ToolCallRow[]>([]);
const tools = ref<Tool[]>([]);
const state = ref<"loading" | "ready" | "error">("loading");
const loadingMore = ref(false);
const hasMore = ref(false);
let beforeId: number | undefined;

const nameBySlug = computed(() => new Map(tools.value.map((tool) => [tool.slug, tool])));
const coverage = computed(() => typeCoverage(tools.value, rows.value));

function label(row: ToolCallRow): string {
  const tool = nameBySlug.value.get(slugOf(row.tool));
  return tool ? tool.name : row.tool;
}
function typeLabel(row: ToolCallRow): string {
  const tool = nameBySlug.value.get(slugOf(row.tool));
  return tool ? t(`toolCalls.types.${toolType(tool)}`) : t("toolCalls.types.other");
}
const fmtTime = (v: string) => new Date(v).toLocaleString();
const fmtDur = (ms?: number) => (ms === undefined ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

async function loadTools(): Promise<void> {
  const all: Tool[] = [];
  for (let page = 1; ; page++) {
    const res = await toolPage({ page, pageSize: 100 });
    all.push(...res.data);
    if (!res.hasMore) break;
  }
  tools.value = all;
}

async function loadBatch(): Promise<void> {
  const res = await listConversations({ beforeId, limit: BATCH });
  hasMore.value = res.hasMore;
  if (res.data.length) beforeId = Math.min(...res.data.map((c) => c.id));
  const found = await Promise.all(res.data.map(async (c) =>
    extractToolCalls(c.id, c.title, await getMessages(c.id))));
  rows.value = [...rows.value, ...found.flat()].sort((a, b) => b.at.localeCompare(a.at));
}

async function load(): Promise<void> {
  state.value = "loading";
  rows.value = [];
  beforeId = undefined;
  try {
    await Promise.all([loadTools(), loadBatch()]);
    state.value = "ready";
  } catch {
    state.value = "error";
  }
}

async function more(): Promise<void> {
  if (loadingMore.value) return;
  loadingMore.value = true;
  try {
    await loadBatch();
  } catch {
    state.value = "error";
  } finally {
    loadingMore.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="tc-view" data-testid="admin-tool-calls">
    <p class="section-hint">{{ t("toolCalls.hint") }}</p>
    <p v-if="state === 'loading'" class="empty-hint">{{ t("common.loading") }}</p>
    <p v-else-if="state === 'error'" class="empty-hint error" role="alert">
      {{ t("toolCalls.loadFailed") }} <button type="button" class="btn-ghost" @click="load">{{ t("common.retry") }}</button>
    </p>
    <template v-else>
      <section class="coverage" data-testid="tool-type-coverage">
        <h3>{{ t("toolCalls.coverageTitle") }}</h3>
        <p class="muted">{{ t("toolCalls.coverageNote") }}</p>
        <table>
          <thead><tr>
            <th>{{ t("toolCalls.col.type") }}</th><th>{{ t("toolCalls.col.total") }}</th>
            <th>{{ t("toolCalls.col.represented") }}</th><th>{{ t("toolCalls.col.calledOk") }}</th>
            <th>{{ t("toolCalls.col.representative") }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="c in coverage" :key="c.type" data-testid="coverage-row">
              <td>{{ t(`toolCalls.types.${c.type}`) }}</td>
              <td>{{ c.total }}</td>
              <td><span class="badge" :class="c.represented ? 'ok' : 'off'">{{ c.represented ? t("toolCalls.representedYes", { n: c.total }) : t("toolCalls.representedNo") }}</span></td>
              <td>{{ c.calledOk }} / {{ c.total }}</td>
              <td>
                <router-link v-if="c.representative" :to="`/c/${c.representative.conversationId}`">
                  {{ label(c.representative) }} · #{{ c.representative.conversationId }}
                </router-link>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="calls">
        <h3>{{ t("toolCalls.listTitle") }}</h3>
        <p v-if="!rows.length" class="empty-hint">{{ t("toolCalls.empty") }}</p>
        <article v-for="row in rows" :key="row.messageId" class="call" :class="row.status" data-testid="tool-call-row">
          <header>
            <span class="badge">{{ typeLabel(row) }}</span>
            <strong>{{ label(row) }}</strong>
            <span class="badge" :class="row.status === 'completed' ? 'ok' : row.status === 'failed' ? 'bad' : ''">{{ t(`toolCalls.status.${row.status}`) }}</span>
            <span class="muted">{{ fmtDur(row.durationMs) }}</span>
            <time>{{ fmtTime(row.at) }}</time>
          </header>
          <dl>
            <dt>{{ t("toolCalls.col.ids") }}</dt>
            <dd class="mono">{{ row.callId }}<span v-if="row.stepId"> · step {{ row.stepId }}</span></dd>
            <dt>{{ t("toolCalls.col.conversation") }}</dt>
            <dd><router-link :to="`/c/${row.conversationId}`">#{{ row.conversationId }} {{ row.conversationTitle }}</router-link></dd>
            <template v-if="row.error"><dt>{{ t("toolCalls.col.error") }}</dt><dd class="err">{{ row.error }}</dd></template>
            <template v-if="row.summary"><dt>{{ t("toolCalls.col.summary") }}</dt><dd>{{ row.summary }}</dd></template>
            <dt>{{ t("toolCalls.col.fee") }}</dt><dd class="muted">{{ t("toolCalls.feePending") }}</dd>
          </dl>
        </article>
        <button v-if="hasMore" type="button" class="btn-ghost more" :disabled="loadingMore" @click="more">{{ t("toolCalls.more") }}</button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.tc-view { display: flex; flex-direction: column; gap: 14px; }
.section-hint { color: var(--text-secondary); font-size: 12px; }
.empty-hint { color: var(--text-tertiary); text-align: center; padding: 32px 0; font-size: 12px; }
.empty-hint.error { color: var(--rose-500); }
h3 { font-size: 14px; font-weight: 700; margin: 0 0 6px; color: var(--text-primary); }
.coverage, .call { padding: 12px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md); }
table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
th { color: var(--text-tertiary); font-weight: 500; }
.calls { display: flex; flex-direction: column; gap: 8px; }
.call.failed { border-left: 3px solid var(--rose-500); }
.call header { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.call header time { margin-left: auto; font-family: var(--font-mono); color: var(--text-tertiary); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font-size: 12px; margin: 8px 0 0; }
dt { color: var(--text-tertiary); }
dd { margin: 0; color: var(--text-primary); word-break: break-word; }
.mono { font-family: var(--font-mono); }
.err { color: var(--rose-500); }
.muted { color: var(--text-tertiary); font-size: 12px; }
.badge { font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--bg-hover); color: var(--text-secondary); }
.badge.ok { background: var(--bg-success, #e6f6ee); color: var(--fg-success, #137a4b); }
.badge.bad { background: var(--bg-danger, #fdecec); color: var(--rose-500); }
.badge.off { background: var(--slate-100); color: var(--text-tertiary); }
.btn-ghost { padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-secondary); cursor: pointer; }
.more { align-self: center; }
</style>
