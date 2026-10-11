<script setup lang="ts">
/**
 * MT3-coreweb: /generate/:kind — image/video generation form + 「我的生成」.
 * Core: app/src/server/addons/media (core 9c0c74a). Params are fixed server-side;
 * the spec line is read-only. Pure logic lives in composables/generation.ts.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ModelPicker from "@/addons/conversation/components/ModelPicker.vue";
import type { ModelChoice } from "@/addons/conversation/api/types";
import { createGeneration, freshDownloadUrl, getGeneration, listGenerations, listMediaModels } from "@/addons/conversation/api/media";
import {
  PROMPT_MAX, createPoller, createSubmitter, defaultMediaModel, inFlightCount, isPending, mediaChoiceKeys, mediaNotes,
  mergeTasks, promptValid, statusView, submitErrorText, type GenerationKind, type GenerationTask, type MediaModel,
} from "@/addons/conversation/composables/generation";
import { deliverablesShellPath } from "@/addons/platform-api/shellLogin";
import { configValue } from "@/runtimeConfig";
import { toast } from "@/composables/useToast";

const props = defineProps<{ kind: string }>();
const kind = computed(() => (props.kind === "video" ? "video" : "image") as GenerationKind);
const { t, locale } = useI18n();

const models = ref<MediaModel[]>([]);
const modelsLoaded = ref(false);
const choiceKeys = computed(() => mediaChoiceKeys(models.value, kind.value));
const notes = computed(() => mediaNotes(models.value, kind.value, t("generate.unverified")));
const choice = ref<ModelChoice | null>(null);
const prompt = ref("");
const promptLength = computed(() => [...prompt.value].length);
const formError = ref("");
const submitter = createSubmitter(createGeneration, reactive({ busy: false }));
const canSubmit = computed(() => !!choice.value && promptValid(prompt.value) && !submitter.state.busy);

const tasks = ref<GenerationTask[]>([]);
const listError = ref(false);
/** Preview links per task (Core signs one per GET); downloads always fetch a fresh one. */
const previews = reactive<Record<number, string>>({});
const openId = ref<number | null>(null);
const openTask = computed(() => tasks.value.find((task) => task.id === openId.value) ?? null);
const libraryHref = configValue("VITE_SHELL_URL") + deliverablesShellPath("/deliverables");
const view = (task: GenerationTask) => statusView(task, t);
const isVideo = (task: GenerationTask) => task.kind === "video" || !!task.file?.mime.startsWith("video/");

function rememberPreview(task: GenerationTask): void {
  if (task.status === "succeeded" && task.downloadUrl) previews[task.id] = task.downloadUrl;
}

const poller = createPoller({
  now: () => Date.now(),
  hidden: () => typeof document !== "undefined" && document.hidden,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  tick: async () => {
    const fresh = await Promise.all(tasks.value.filter((task) => isPending(task.status)).map((task) => getGeneration(task.id)));
    fresh.forEach(rememberPreview);
    tasks.value = mergeTasks(tasks.value, fresh);
    return tasks.value.some((task) => isPending(task.status));
  },
});

async function loadTasks(): Promise<void> {
  const forKind = kind.value;
  try {
    const list = await listGenerations(forKind);
    if (forKind !== kind.value) return;
    tasks.value = list;
    listError.value = false;
    // ponytail: inline previews for the 12 newest finished tasks; older rows load theirs in the drawer.
    const finished = list.filter((task) => task.status === "succeeded" && task.file && !previews[task.id]).slice(0, 12);
    void Promise.all(finished.map((task) => getGeneration(task.id).then(rememberPreview).catch(() => {})));
    if (list.some((task) => isPending(task.status))) poller.start();
  } catch {
    if (forKind === kind.value) listError.value = true;
  }
}

async function loadModels(): Promise<void> {
  const forKind = kind.value;
  modelsLoaded.value = false;
  try {
    const list = await listMediaModels(forKind);
    if (forKind !== kind.value) return;
    models.value = list;
    choice.value = defaultMediaModel(list, forKind);
  } catch {
    models.value = [];
    choice.value = null;
  } finally {
    if (forKind === kind.value) modelsLoaded.value = true;
  }
}

watch(kind, () => {
  poller.stop();
  tasks.value = [];
  openId.value = null;
  formError.value = "";
  void loadModels();
  void loadTasks();
}, { immediate: true });

async function submit(): Promise<void> {
  if (!canSubmit.value || !choice.value) return;
  formError.value = "";
  try {
    const created = await submitter.submit({ kind: kind.value, providerId: choice.value.providerId, model: choice.value.model, prompt: prompt.value.trim() });
    if (!created) return;
    toast.success(t("generate.submitted"));
    await loadTasks();
  } catch (error) {
    formError.value = submitErrorText(error, t, inFlightCount(tasks.value, Date.now()), kind.value);
  }
}

async function download(task: GenerationTask): Promise<void> {
  try {
    window.open(await freshDownloadUrl(task.id), "_blank", "noopener,noreferrer");
  } catch {
    toast.error(t("generate.loadFailed"));
  }
}

function regenerate(task: GenerationTask): void {
  const known = models.value.find((m) => m.kind === kind.value && m.model === task.model);
  if (known) choice.value = { providerId: known.providerId, model: known.model };
  prompt.value = task.prompt;
  openId.value = null;
  formError.value = "";
  document.querySelector(".gen-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showTask(task: GenerationTask): void {
  openId.value = task.id;
  if (task.status === "succeeded" && task.file && !previews[task.id]) void getGeneration(task.id).then(rememberPreview).catch(() => {});
}

const onVisibility = () => poller.visibility();
onMounted(() => document.addEventListener("visibilitychange", onVisibility));
onBeforeUnmount(() => {
  poller.stop();
  document.removeEventListener("visibilitychange", onVisibility);
});

const when = (iso: string) => new Date(iso).toLocaleString(locale.value === "en" ? "en" : "zh-CN", { hour12: false });
</script>

<template>
  <div class="view active gen-view" data-testid="generate-page" :data-kind="kind">
    <section class="gen-form" data-testid="gen-form">
      <h1 class="gen-title">{{ kind === 'video' ? t('generate.titleVideo') : t('generate.titleImage') }}</h1>
      <p class="gen-intro">{{ t('generate.intro') }}</p>
      <div class="gen-field" data-testid="gen-model">
        <ModelPicker
          v-if="choiceKeys.length"
          :model-value="choice"
          :type="kind"
          :only="choiceKeys"
          :notes="notes"
          :allow-default="false"
          :disabled="submitter.state.busy"
          @update:model-value="(value) => (choice = value)"
        />
        <p v-else-if="modelsLoaded" class="gen-error" data-testid="gen-no-models">{{ t('generate.noModels') }}</p>
      </div>
      <label class="gen-field">
        <span class="gen-label">{{ t('generate.prompt') }}</span>
        <textarea
          v-model="prompt"
          class="gen-prompt"
          data-testid="gen-prompt"
          rows="4"
          :maxlength="PROMPT_MAX"
          :placeholder="t('generate.promptPlaceholder')"
          :disabled="submitter.state.busy"
        />
        <span class="gen-count" data-testid="gen-count" :data-over="promptLength > PROMPT_MAX">{{ promptLength }} / {{ PROMPT_MAX }}</span>
      </label>
      <p class="gen-spec" data-testid="gen-spec">
        <span class="gen-label">{{ t('generate.specLabel') }}</span>
        {{ kind === 'video' ? t('generate.specVideo') : t('generate.specImage') }}
      </p>
      <p v-if="formError" class="gen-error" role="alert" data-testid="gen-error">{{ formError }}</p>
      <button type="button" class="gen-btn gen-btn--primary" data-testid="gen-submit" :disabled="!canSubmit || submitter.state.busy" @click="submit">
        {{ submitter.state.busy ? t('generate.submitting') : t('generate.submit') }}
      </button>
    </section>

    <section class="gen-list" data-testid="gen-list">
      <h2 class="gen-subtitle">{{ t('generate.mine') }}</h2>
      <p v-if="listError" class="gen-error">{{ t('generate.loadFailed') }}</p>
      <p v-else-if="!tasks.length" class="gen-empty">{{ t('generate.empty') }}</p>
      <ul v-else class="gen-items">
        <li v-for="task in tasks" :key="task.id" class="gen-item" data-testid="gen-item" :data-status="task.status" :data-id="task.id">
          <button type="button" class="gen-item-head" @click="showTask(task)">
            <span class="gen-item-prompt">{{ task.prompt }}</span>
            <span class="gen-item-status" data-testid="gen-status" :data-pending="view(task).pending">{{ view(task).label }}</span>
            <span class="gen-item-meta">{{ task.model }} · <time :datetime="task.createdAt">{{ when(task.createdAt) }}</time></span>
          </button>
          <template v-if="view(task).preview && previews[task.id]">
            <video v-if="isVideo(task)" class="gen-preview" data-testid="gen-preview" :src="previews[task.id]" controls preload="metadata" />
            <img v-else class="gen-preview" data-testid="gen-preview" :src="previews[task.id]" :alt="task.prompt" loading="lazy">
          </template>
          <div class="gen-actions">
            <button v-if="view(task).download" type="button" class="gen-btn" data-testid="gen-download" @click="download(task)">{{ t('generate.download') }}</button>
            <a v-if="view(task).download" class="gen-btn" data-testid="gen-library" :href="libraryHref" target="_top">{{ t('generate.openLibrary') }}</a>
            <button v-if="view(task).regenerate" type="button" class="gen-btn" data-testid="gen-regenerate" @click="regenerate(task)">{{ t('generate.regenerate') }}</button>
          </div>
        </li>
      </ul>
    </section>

    <div v-if="openTask" class="gen-drawer-scrim" data-testid="gen-drawer" @click.self="openId = null" @keydown.esc="openId = null">
      <aside class="gen-drawer" role="dialog" aria-modal="true" :aria-label="t('generate.details')">
        <header class="gen-drawer-head">
          <b>{{ t('generate.details') }}</b>
          <button type="button" class="gen-btn" data-testid="gen-drawer-close" @click="openId = null">{{ t('generate.close') }}</button>
        </header>
        <p class="gen-item-status" data-testid="gen-drawer-status">{{ view(openTask).label }}</p>
        <p class="gen-item-meta">{{ openTask.model }} · {{ when(openTask.createdAt) }}</p>
        <p class="gen-drawer-prompt">{{ openTask.prompt }}</p>
        <template v-if="view(openTask).preview && previews[openTask.id]">
          <video v-if="isVideo(openTask)" class="gen-preview" :src="previews[openTask.id]" controls preload="metadata" />
          <img v-else class="gen-preview" :src="previews[openTask.id]" :alt="openTask.prompt">
        </template>
        <div class="gen-actions">
          <button v-if="view(openTask).download" type="button" class="gen-btn" @click="download(openTask)">{{ t('generate.download') }}</button>
          <a v-if="view(openTask).download" class="gen-btn" :href="libraryHref" target="_top">{{ t('generate.openLibrary') }}</a>
          <button v-if="view(openTask).regenerate" type="button" class="gen-btn" @click="regenerate(openTask)">{{ t('generate.regenerate') }}</button>
        </div>
      </aside>
    </div>
  </div>
</template>

<style>
/* Non-scoped like the other core views (micro-app disable-scopecss); gen-* is core-private. */
.gen-view { display: grid; grid-template-columns: minmax(0, 420px) minmax(0, 1fr); gap: 24px; align-items: start; padding: 32px 24px; box-sizing: border-box; }
.gen-form, .gen-list { min-width: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 20px; box-sizing: border-box; }
.gen-form { display: flex; flex-direction: column; gap: 14px; position: sticky; top: 0; }
.gen-title { font-family: var(--font-display); font-size: 22px; margin: 0; color: var(--text-primary); }
.gen-subtitle { font-size: 16px; margin: 0 0 12px; color: var(--text-primary); }
.gen-intro, .gen-empty, .gen-item-meta { color: var(--text-secondary); font-size: 13px; margin: 0; }
.gen-field { display: flex; flex-direction: column; gap: 6px; position: relative; }
.gen-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-right: 8px; }
.gen-prompt { width: 100%; box-sizing: border-box; resize: vertical; min-height: 96px; padding: 10px 12px; font: inherit; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg); color: var(--text-primary); }
.gen-count { align-self: flex-end; font-size: 12px; color: var(--text-tertiary); }
.gen-spec { margin: 0; font-size: 13px; color: var(--text-primary); }
.gen-error { margin: 0; color: var(--rose-500); font-size: 13px; overflow-wrap: anywhere; }
.gen-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 44px; padding: 0 16px; box-sizing: border-box; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-primary); font: inherit; font-size: 14px; cursor: pointer; text-decoration: none; }
.gen-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.gen-btn--primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.gen-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.gen-item { border: 1px solid var(--border); border-radius: var(--r-md); padding: 12px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.gen-item-head { all: unset; display: flex; flex-direction: column; gap: 4px; cursor: pointer; min-height: 44px; min-width: 0; }
.gen-item-prompt { color: var(--text-primary); font-size: 14px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.gen-item-status { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; margin: 0; }
.gen-item[data-status="failed"] .gen-item-status, .gen-item[data-status="unknown"] .gen-item-status { color: var(--rose-500); }
.gen-item[data-status="succeeded"] .gen-item-status { color: var(--teal-600); }
.gen-preview { display: block; width: 100%; max-width: 360px; border-radius: var(--r-md); background: var(--bg-subtle); }
.gen-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.gen-drawer-scrim { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35); z-index: 50; display: flex; justify-content: flex-end; }
.gen-drawer { width: min(440px, 100%); height: 100%; overflow-y: auto; background: var(--bg-card); padding: 20px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
.gen-drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.gen-drawer-prompt { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; color: var(--text-primary); }
.gen-drawer .gen-preview { max-width: 100%; }
/* Below 1024px core-web is in its task-desk layout: one column, full-width previews, full-screen drawer. */
@media (max-width: 1023px) {
  .gen-view { grid-template-columns: minmax(0, 1fr); padding: 16px 12px; gap: 16px; }
  .gen-form { position: static; }
  .gen-preview { max-width: 100%; }
  .gen-drawer { width: 100%; }
  .gen-actions .gen-btn { flex: 1 1 auto; }
}
</style>
