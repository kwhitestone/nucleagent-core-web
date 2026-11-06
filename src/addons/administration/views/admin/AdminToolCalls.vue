<script setup lang="ts">
/**
 * MUYU-181: tool-call log + type coverage. Core filters by owner and task (= conversation id)
 * and pages by id cursor in SQL; rows arrive already redacted. One request per page.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { listToolCalls } from "../../../conversation/api/conversation";
import { toolPage, type Tool } from "../../api/tool";
import { parseTaskId, slugOf, toolType, typeCoverage, type ToolCallRow } from "./toolCallLog";

const PAGE = 30;
const REFRESH_MS = 5000;
const REFRESH_LIMIT = 12; // running calls: refresh for about a minute, then leave it to the user
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const rows = ref<ToolCallRow[]>([]);
const tools = ref<Tool[]>([]);
const state = ref<"loading" | "ready" | "error" | "notFound" | "invalid">("loading");
const loadingMore = ref(false);
const hasMore = ref(false);
const updatedAt = ref<Date>();
const taskInput = ref("");
const taskId = computed(() => parseTaskId(route.query.taskId));
let controller: AbortController | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const refreshes = ref(0);

const nameBySlug = computed(() => new Map(tools.value.map((tool) => [tool.slug, tool])));
const coverage = computed(() => typeCoverage(tools.value, rows.value));
const hasRunning = computed(() => rows.value.some((row) => row.status === "running"));

function label(row: ToolCallRow): string {
  const tool = nameBySlug.value.get(slugOf(row.tool));
  return tool ? tool.name : row.tool;
}
function typeLabel(row: ToolCallRow): string {
  const tool = nameBySlug.value.get(slugOf(row.tool));
  return tool ? t(`toolCalls.types.${toolType(tool)}`) : t("toolCalls.types.other");
}
const fmtTime = (v: string | Date) => new Date(v).toLocaleString();
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

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number }; status?: number })?.response?.status ?? (error as { status?: number })?.status;
}

/** First page for the current filter. A newer call aborts the older one, so stale pages never land. */
async function load(): Promise<void> {
  clearTimeout(refreshTimer);
  controller?.abort();
  const id = taskId.value;
  taskInput.value = id ?? String(route.query.taskId ?? "");
  if (id === null) {
    rows.value = [];
    hasMore.value = false;
    state.value = "invalid";
    return;
  }
  const own = (controller = new AbortController());
  if (!rows.value.length) state.value = "loading";
  try {
    const res = await listToolCalls({ taskId: id, limit: PAGE }, own.signal);
    if (own.signal.aborted) return;
    rows.value = res.data;
    hasMore.value = res.hasMore;
    updatedAt.value = new Date();
    state.value = "ready";
    scheduleRefresh();
  } catch (error) {
    if (own.signal.aborted) return;
    rows.value = [];
    state.value = statusOf(error) === 404 ? "notFound" : statusOf(error) === 400 ? "invalid" : "error";
  }
}

function scheduleRefresh(): void {
  // Only the first page refreshes, and only while it shows running calls; later pages are history.
  if (!hasRunning.value || refreshes.value >= REFRESH_LIMIT) return;
  refreshTimer = setTimeout(() => {
    refreshes.value++;
    void load();
  }, REFRESH_MS);
}

async function more(): Promise<void> {
  if (loadingMore.value || !rows.value.length) return;
  loadingMore.value = true;
  clearTimeout(refreshTimer); // a refresh would drop the pages loaded below
  const own = controller;
  try {
    const res = await listToolCalls({ taskId: taskId.value ?? "", beforeId: rows.value[rows.value.length - 1].id, limit: PAGE }, own?.signal);
    if (own?.signal.aborted) return;
    rows.value = [...rows.value, ...res.data];
    hasMore.value = res.hasMore;
  } catch {
    if (!own?.signal.aborted) state.value = "error";
  } finally {
    loadingMore.value = false;
  }
}

function applyFilter(): void {
  const value = taskInput.value.trim();
  void router.replace({ query: { ...route.query, taskId: value || undefined } });
}
function clearFilter(): void {
  taskInput.value = "";
  void router.replace({ query: { ...route.query, taskId: undefined } });
}
function manualRefresh(): void {
  refreshes.value = 0;
  void load();
}

watch(() => route.query.taskId, () => {
  refreshes.value = 0;
  rows.value = [];
  void load();
});
onMounted(() => {
  void loadTools().catch(() => undefined); // coverage labels only; the log works without them
  void load();
});
onBeforeUnmount(() => {
  clearTimeout(refreshTimer);
  controller?.abort();
});
</script>

<template>
  <div class="tc-view" data-testid="admin-tool-calls">
    <p class="section-hint">{{ t("toolCalls.hint") }}</p>
    <form class="filter" data-testid="tool-call-filter" @submit.prevent="applyFilter">
      <label for="tc-task">{{ t("toolCalls.taskLabel") }}</label>
      <input id="tc-task" v-model="taskInput" inputmode="numeric" :placeholder="t('toolCalls.taskPlaceholder')" data-testid="tool-call-task-input" />
      <button type="submit" class="btn-ghost">{{ t("toolCalls.filter") }}</button>
      <button v-if="route.query.taskId" type="button" class="btn-ghost" data-testid="tool-call-clear" @click="clearFilter">{{ t("toolCalls.clear") }}</button>
      <span class="muted">{{ t("toolCalls.taskNote") }}</span>
    </form>
    <p v-if="state === 'loading'" class="empty-hint">{{ t("common.loading") }}</p>
    <p v-else-if="state === 'invalid'" class="empty-hint error" role="alert" data-testid="tool-call-invalid">{{ t("toolCalls.invalidTask") }}</p>
    <p v-else-if="state === 'notFound'" class="empty-hint error" role="alert" data-testid="tool-call-not-found">{{ t("toolCalls.taskNotFound", { id: taskId }) }}</p>
    <p v-else-if="state === 'error'" class="empty-hint error" role="alert">
      {{ t("toolCalls.loadFailed") }} <button type="button" class="btn-ghost" @click="manualRefresh">{{ t("common.retry") }}</button>
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
                <router-link v-if="c.representative" :to="`/c/${c.representative.taskId}`">
                  {{ label(c.representative) }} · #{{ c.representative.taskId }}
                </router-link>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="calls">
        <h3>{{ t("toolCalls.listTitle") }}</h3>
        <p class="muted" data-testid="tool-call-updated">
          {{ t("toolCalls.updatedAt", { time: updatedAt ? fmtTime(updatedAt) : "—" }) }}
          <span v-if="hasRunning">· {{ refreshes < REFRESH_LIMIT ? t("toolCalls.autoRefresh") : t("toolCalls.autoRefreshStopped") }}</span>
          <button type="button" class="btn-ghost" @click="manualRefresh">{{ t("toolCalls.refresh") }}</button>
        </p>
        <p v-if="!rows.length" class="empty-hint" data-testid="tool-call-empty">{{ taskId ? t("toolCalls.emptyTask") : t("toolCalls.empty") }}</p>
        <article v-for="row in rows" :key="row.id" class="call" :class="row.status" data-testid="tool-call-row">
          <header>
            <span class="badge">{{ typeLabel(row) }}</span>
            <strong>{{ label(row) }}</strong>
            <span class="badge" :class="row.status === 'completed' ? 'ok' : row.status === 'failed' ? 'bad' : ''">{{ t(`toolCalls.status.${row.status}`) }}</span>
            <span class="muted">{{ fmtDur(row.durationMs) }}</span>
            <time>{{ fmtTime(row.createdAt) }}</time>
          </header>
          <dl>
            <dt>{{ t("toolCalls.col.ids") }}</dt>
            <dd class="mono">{{ row.callId }}<span v-if="row.stepId"> · step {{ row.stepId }}</span></dd>
            <dt>{{ t("toolCalls.col.conversation") }}</dt>
            <dd><router-link :to="`/c/${row.taskId}`">#{{ row.taskId }} {{ row.taskTitle }}</router-link></dd>
            <template v-if="row.input"><dt>{{ t("toolCalls.col.input") }}</dt><dd>{{ row.input }}</dd></template>
            <template v-if="row.error"><dt>{{ t("toolCalls.col.error") }}</dt><dd class="err">{{ row.error }}</dd></template>
            <template v-if="row.summary"><dt>{{ t("toolCalls.col.summary") }}</dt><dd>{{ row.summary }}</dd></template>
            <dt>{{ t("toolCalls.col.fee") }}</dt><dd class="muted">{{ t("toolCalls.feePending") }}</dd>
          </dl>
        </article>
        <button v-if="hasMore" type="button" class="btn-ghost more" :disabled="loadingMore" @click="more">{{ t("toolCalls.moreCalls") }}</button>
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
.filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.filter input { width: 160px; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--r-md); font-family: var(--font-mono); }
</style>
