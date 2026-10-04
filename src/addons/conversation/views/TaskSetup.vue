<script setup lang="ts">
/**
 * 任务视图 - 对齐 design/nucleagent-design.html 第 1981–2046 行。
 *
 * 3 张 .template-card + .task-form（名称/描述/执行模式/输出格式）。
 *
 * 数据来源：GET /api/v1/addons/agent/templates，映射为任务模板卡片。
 * 接口不可用时降级到 i18n 前端常量 + console.warn。
 *
 * 启动任务走 POST /conversation，执行模式/输出格式暂存 metadata 字段
 * （后端暂未持久化，预留给未来字段），不阻塞流程。
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/contracts/platform-runtime";
import { listAgentTemplates } from "@/addons/conversation/api/agent";
import { useConversationStore } from "@/addons/conversation/store/conversation";
import { toast } from "@/composables/useToast";
import AttachmentPicker from "@/addons/conversation/components/AttachmentPicker.vue";
import AttachmentChips from "@/addons/conversation/components/AttachmentChips.vue";
import ModelPicker from "@/addons/conversation/components/ModelPicker.vue";
import ExecutionBackendPicker from "@/addons/conversation/components/ExecutionBackendPicker.vue";
import DevicePicker from "@/addons/conversation/components/DevicePicker.vue";
import SkillPicker from "@/addons/conversation/components/SkillPicker.vue";
import OptionSheet from "@/addons/conversation/components/OptionSheet.vue";
import { useNarrow } from "@/composables/useNarrow";
import { clearDraft, readDraft, saveDraft, type TaskDraft } from "@/addons/conversation/composables/taskDraft";
import type {
  AgentTemplate,
  ConversationMode,
  MessageAttachment,
  ModelChoice,
} from "@/addons/conversation/api/types";

const router = useRouter();
const route = useRoute();
const store = useConversationStore();
const narrow = useNarrow();
const { t } = useI18n();

interface TaskTemplate {
  icon: string;
  name: string;
  desc: string;
  defaultName: string;
  defaultDesc: string;
}

/** 接口不可用时的 i18n 降级常量。 */
const templateKeys: { icon: string; key: string }[] = [
  { icon: "📊", key: "competitiveAnalysis" },
  { icon: "📝", key: "contentCreation" },
  { icon: "🔍", key: "dataResearch" },
];

const fallbackTemplates = computed<TaskTemplate[]>(() =>
  templateKeys.map(({ icon, key }) => ({
    icon,
    name: t(`task.templates.${key}.name`),
    desc: t(`task.templates.${key}.desc`),
    defaultName: t(`task.templates.${key}.defaultName`),
    defaultDesc: t(`task.templates.${key}.defaultDesc`),
  })),
);

const templates = ref<TaskTemplate[]>([...fallbackTemplates.value]);

const ICONS = ["📊", "📝", "🔍", "🤖", "📋", "🔬"];

/** 把后端 AgentTemplate 转成前端 TaskTemplate。 */
function templateToTask(tpl: AgentTemplate, index: number): TaskTemplate {
  const cfg = tpl.config ?? {};
  return {
    icon: ICONS[index % ICONS.length],
    name: tpl.name,
    desc: (cfg.role as string) || (cfg.personality as string) || "",
    defaultName: tpl.name,
    defaultDesc: (cfg.prompt as string) || `使用 ${tpl.name} 执行任务。`,
  };
}

/**
 * Q4: Creation hands over ?template=<name> (prefilled form); the Chat home's
 * 「更多设置」 hands over ?input=<text>. A saved draft (Q5, desktop) wins over
 * neither: an explicit hand-over is the newer intent.
 */
function applyEntry(): void {
  if (typeof route.query.device === "string") targetDeviceId.value = route.query.device.trim();
  if (typeof route.query.backend === "string") executionBackend.value = route.query.backend.trim();
  const name = typeof route.query.template === "string" ? route.query.template : "";
  const index = name ? templates.value.findIndex((tpl) => tpl.name === name) : -1;
  if (index >= 0) selectTemplate(index);
  const input = typeof route.query.input === "string" ? route.query.input : "";
  if (input) form.desc = input;
  if (route.query.skillIds !== undefined) {
    const values = [route.query.skillIds].flat().flatMap((value) => (value ?? "").split(","));
    skillIds.value = [...new Set(values.filter((value) => /^\d+$/.test(value)).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  }
}

watch(() => route.query, applyEntry);

onMounted(async () => {
  const entryQuery = route.query;
  const draft = !route.query.template && !route.query.input && route.query.skillIds === undefined && route.query.device === undefined && route.query.backend === undefined ? readDraft(localStorage) : null;
  applyEntry(); // before the template request too, so the handed-over text never flickers
  try {
    const tpls = await listAgentTemplates();
    if (tpls.length > 0) {
      templates.value = tpls.map((tpl, i) => templateToTask(tpl, i));
      // 选中第一个模板填充表单。
      selectTemplate(0);
    }
  } catch (e) {
    console.warn("[TaskSetup] agent/templates 接口不可用，降级到前端常量", e);
  }
  applyEntry();
  if (draft && route.query === entryQuery) restoreDraft(draft);
});

const selected = ref(0);
/** 任务附件（选中即已上传到 storage，这里持有引用）。 */
const attachments = ref<MessageAttachment[]>([]);
/** 选定的模型；null = 用服务端默认。 */
const modelChoice = ref<ModelChoice | null>(null);
const executionBackend = ref<string | null>(null);
const backendCompatible = ref(false);
const targetDeviceId = ref("");
watch(targetDeviceId, () => { backendCompatible.value = false; attachments.value = []; });
/**
 * 创建时预选的技能 ID。空数组 = 不下发 skillIds，后端走自动语义匹配兜底
 * （见 types.ts 的 CreateConversationRequest.skillIds 注释）。
 */
const skillIds = ref<number[]>([]);

const form = reactive({
  name: "",
  desc: "",
  execMode: "auto",
  outputFormat: "markdown",
});

// Sync form defaults when templates load or selection changes
function syncFormDefaults(): void {
  const tpl = templates.value[selected.value];
  form.name = tpl.defaultName;
  form.desc = tpl.defaultDesc;
}

// Initialize with first template
syncFormDefaults();

function selectTemplate(i: number): void {
  selected.value = i;
  syncFormDefaults();
}

const execModeOptions = computed(() => [
  { value: "auto", label: t("task.execModes.auto") },
  { value: "stepByStep", label: t("task.execModes.stepByStep") },
  { value: "planOnly", label: t("task.execModes.planOnly") },
]);

const outputFormatOptions = computed(() => [
  { value: "markdown", label: t("task.outputFormats.markdown") },
  { value: "pdf", label: t("task.outputFormats.pdf") },
  { value: "ppt", label: t("task.outputFormats.ppt") },
  { value: "excel", label: t("task.outputFormats.excel") },
]);

const submitting = ref(false);
/** Board §12 ⑤: the error sits right above the button (not a toast), input kept. */
const launchError = ref("");
const nameError = ref(false);
const nameInput = ref<HTMLInputElement | null>(null);
const descInput = ref<HTMLTextAreaElement | null>(null);
const backendPicker = ref<{ openSheet: () => void } | null>(null);
const sheet = ref<"" | "execMode" | "outputFormat">("");
const optionLabel = (options: { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

// --- Q5: 保存草稿 (desktop). Local, one draft per browser; launching clears it. ---
const draftSaved = ref(false);
function currentDraft(): TaskDraft {
  return { ...form, templateName: templates.value[selected.value]?.name ?? "", skillIds: [...skillIds.value], targetDeviceId: targetDeviceId.value || undefined, executionBackend: executionBackend.value || undefined };
}
function onSaveDraft(): void {
  saveDraft(localStorage, currentDraft());
  void nextTick(() => { draftSaved.value = true; });
  toast.success(t("task.draftSaved"));
}
function restoreDraft(draft: TaskDraft): void {
  const index = templates.value.findIndex((tpl) => tpl.name === draft.templateName);
  if (index >= 0) selected.value = index;
  Object.assign(form, { name: draft.name, desc: draft.desc, execMode: draft.execMode, outputFormat: draft.outputFormat });
  skillIds.value = draft.skillIds;
  targetDeviceId.value = draft.targetDeviceId || "";
  executionBackend.value = draft.executionBackend || null;
  void nextTick(() => { draftSaved.value = true; });
}
watch(form, () => { draftSaved.value = false; });

async function launch(): Promise<void> {
  if (submitting.value) return;
  if (targetDeviceId.value.length > 64) { toast.error("设备编号无效"); return; }
  launchError.value = "";
  if (!backendCompatible.value) {
    if (narrow.value) backendPicker.value?.openSheet();
    else toast.warning(t("common.executionBackendSelectionInvalid"));
    return;
  }
  const name = form.name.trim();
  if (!name) {
    if (narrow.value) {
      // Not greyed out: scroll to the field, focus it, error line above it (board §12 ③).
      nameError.value = true;
      await nextTick();
      nameInput.value?.scrollIntoView({ block: "center" });
      nameInput.value?.focus();
    } else {
      toast.warning(t("task.fillName"));
    }
    return;
  }
  nameError.value = false;
  submitting.value = true;
  try {
    // 执行模式/输出格式暂存 metadata（后端暂未持久化，预留给未来字段）。
    const input = form.desc.trim();
    const mode: ConversationMode = "a2a_agent";
    const created = await store.create({
      mode,
      input,
      metadata: {
        execMode: form.execMode,
        outputFormat: form.outputFormat,
        taskName: name,
      },
      attachments: attachments.value.map((a) => ({ fileId: a.fileId, name: a.name })),
      // 模型与 provider 成对下发；未选则都不带，由服务端用默认。
      model: modelChoice.value?.model ?? "",
      providerId: modelChoice.value?.providerId,
      executionBackend: executionBackend.value ?? undefined,
      targetDeviceId: targetDeviceId.value || undefined,
      // 没选技能时必须整个字段缺省，不能传空数组：后端据此决定是否走自动匹配。
      skillIds: skillIds.value.length > 0 ? skillIds.value : undefined,
    });
    clearDraft(localStorage);
    // replace: Back from the conversation returns to the task desk, not the form (board §12 ⑤).
    await (narrow.value ? router.replace(`/c/${created.id}`) : router.push(`/c/${created.id}`));
  } catch (error) {
    const message = error instanceof ApiError ? error.message : t("task.launchFailed");
    if (narrow.value) launchError.value = `${message} ${t("task.keptOnError")}`;
    else toast.error(message);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="view active">
    <!-- Below 1024px (board §12): one page, written fields as big inputs, chosen
         fields as list rows → option sheets, 启动任务 pinned at the bottom. -->
    <div v-if="narrow" class="task-m" data-testid="task-mobile" :class="{ busy: submitting }">
      <div class="task-m-scroll">
        <div class="task-m-chips" role="listbox" :aria-label="t('task.templateLabel')">
          <button
            v-for="(tpl, i) in templates"
            :key="i"
            type="button"
            role="option"
            class="task-m-chip"
            :aria-selected="selected === i"
            :disabled="submitting"
            @click="selectTemplate(i)"
          >{{ tpl.name }}</button>
        </div>

        <label class="task-m-field">
          <span class="task-m-label">{{ t('task.form.nameLabel') }}</span>
          <span v-if="nameError" class="task-m-err" role="alert">{{ t('task.fillName') }}</span>
          <input
            ref="nameInput"
            v-model="form.name"
            type="text"
            enterkeyhint="next"
            data-testid="task-name"
            :placeholder="t('task.form.namePlaceholder')"
            :readonly="submitting"
            @input="nameError = false"
            @keydown.enter.prevent="descInput?.focus()"
          />
        </label>
        <label class="task-m-field">
          <span class="task-m-label">{{ t('task.form.descLabel') }}</span>
          <textarea
            ref="descInput"
            v-model="form.desc"
            data-testid="task-desc"
            :placeholder="t('task.form.descPlaceholder')"
            :readonly="submitting"
          />
        </label>

        <p class="task-m-glabel">{{ t('task.runSettings') }}</p>
        <div class="picker-group">
          <DevicePicker v-model="targetDeviceId" :disabled="submitting" />
          <ModelPicker v-model="modelChoice" :disabled="submitting" row />
          <ExecutionBackendPicker
            ref="backendPicker"
            v-model="executionBackend"
            :model-choice="modelChoice"
            :device-id="targetDeviceId"
            :disabled="submitting"
            row
            @validation-change="(value) => (backendCompatible = value.allowed)"
          />
          <SkillPicker v-model="skillIds" :disabled="submitting" row />
          <button type="button" class="picker-row" data-testid="row-exec-mode" :disabled="submitting" @click="sheet = 'execMode'">
            <span class="picker-row-k">{{ t('task.form.execModeLabel') }}</span>
            <span class="picker-row-v">{{ optionLabel(execModeOptions, form.execMode) }}</span>
            <svg class="picker-row-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
          </button>
          <button type="button" class="picker-row" data-testid="row-output-format" :disabled="submitting" @click="sheet = 'outputFormat'">
            <span class="picker-row-k">{{ t('task.form.outputFormatLabel') }}</span>
            <span class="picker-row-v">{{ optionLabel(outputFormatOptions, form.outputFormat) }}</span>
            <svg class="picker-row-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>

        <p class="task-m-glabel">{{ t('common.attachment') }}</p>
        <div class="picker-group task-m-attach">
          <AttachmentChips
            v-if="attachments.length"
            :attachments="attachments"
            removable
            @remove="(id: string) => (attachments = attachments.filter((a) => a.fileId !== id))"
          />
          <AttachmentPicker v-model="attachments" :disabled="submitting || !!targetDeviceId" show-label />
        </div>
      </div>

      <div class="task-m-bar">
        <p v-if="launchError" class="task-m-err" role="alert">
          {{ launchError }}
          <button type="button" @click="launch">{{ t('common.retry') }}</button>
        </p>
        <button
          class="task-m-launch"
          type="button"
          data-testid="task-launch"
          :disabled="submitting || !backendCompatible"
          :aria-busy="submitting"
          @click="launch"
        >{{ submitting ? t('task.launching') : t('task.launch') }}</button>
        <button v-if="!backendCompatible && !submitting" type="button" class="task-m-why" @click="backendPicker?.openSheet()">
          {{ t('task.whyDisabled') }}
        </button>
      </div>

      <OptionSheet
        :open="sheet === 'execMode'"
        :title="t('task.form.execModeLabel')"
        :options="execModeOptions"
        :model-value="form.execMode"
        @update:model-value="(v) => (form.execMode = String(v))"
        @close="sheet = ''"
      />
      <OptionSheet
        :open="sheet === 'outputFormat'"
        :title="t('task.form.outputFormatLabel')"
        :options="outputFormatOptions"
        :model-value="form.outputFormat"
        @update:model-value="(v) => (form.outputFormat = String(v))"
        @close="sheet = ''"
      />
    </div>

    <div v-else class="task-setup-view">
      <div class="task-setup-header">
        <h2>{{ t('task.title') }}</h2>
        <p>{{ t('task.subtitle') }}</p>
      </div>

      <div class="task-templates">
        <div
          v-for="(tpl, i) in templates"
          :key="i"
          class="template-card"
          :class="{ selected: selected === i }"
          @click="selectTemplate(i)"
        >
          <div class="tpl-icon">{{ tpl.icon }}</div>
          <div class="tpl-name">{{ tpl.name }}</div>
          <div class="tpl-desc">{{ tpl.desc }}</div>
        </div>
      </div>

      <div class="task-form">
        <div class="form-group">
          <label>{{ t('task.form.nameLabel') }} <span class="label-hint">{{ t('task.form.nameHint') }}</span></label>
          <input v-model="form.name" type="text" class="form-input" :placeholder="t('task.form.namePlaceholder')" />
        </div>

        <div class="form-group">
          <label>{{ t('task.form.descLabel') }} <span class="label-hint">{{ t('task.form.descHint') }}</span></label>
          <textarea v-model="form.desc" class="form-textarea" :placeholder="t('task.form.descPlaceholder')" />
        </div>

        <DevicePicker v-model="targetDeviceId" :disabled="submitting" />
        <div class="form-group">
          <label>{{ t('common.model') }}</label>
          <ModelPicker v-model="modelChoice" :disabled="submitting" />
        </div>

        <div class="form-group">
          <label>{{ t('common.executionBackend') }}</label>
          <ExecutionBackendPicker
            v-model="executionBackend"
            :model-choice="modelChoice"
            :device-id="targetDeviceId"
            :disabled="submitting"
            @validation-change="(value) => (backendCompatible = value.allowed)"
          />
        </div>

        <div class="form-group">
          <label>{{ t('common.skill') }}</label>
          <SkillPicker v-model="skillIds" :disabled="submitting" />
        </div>

        <div class="form-group">
          <label>{{ t('common.attachment') }}</label>
          <div>
            <AttachmentPicker v-model="attachments" :disabled="submitting || !!targetDeviceId" show-label />
            <AttachmentChips
              :attachments="attachments"
              removable
              @remove="(id: string) => (attachments = attachments.filter((a) => a.fileId !== id))"
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>{{ t('task.form.execModeLabel') }}</label>
            <select v-model="form.execMode" class="form-select">
              <option v-for="opt in execModeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('task.form.outputFormatLabel') }}</label>
            <select v-model="form.outputFormat" class="form-select">
              <option v-for="opt in outputFormatOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
        </div>

        <div class="form-actions">
          <!-- Q5: the desktop button had no handler; it now saves a local draft. -->
          <button class="btn btn-secondary" type="button" data-testid="task-save-draft" :disabled="submitting" @click="onSaveDraft">
            {{ draftSaved ? t('task.draftSavedShort') : t('task.saveDraft') }}
          </button>
          <button class="btn btn-primary" type="button" :disabled="submitting || !backendCompatible" @click="launch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            <span>{{ submitting ? t('task.launching') : t('task.launch') }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* 设计稿第 1204–1366 行。 */
.task-setup-view { padding: 32px 24px; max-width: 680px; margin: 0 auto; width: 100%; }

.task-setup-header { margin-bottom: 28px; animation: fade-in-up 0.4s var(--ease-out) both; }

.task-setup-header h2 {
  font-family: var(--font-display);
  font-size: 36px;
  background: var(--grad-teal-indigo);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  margin-bottom: 6px;
}

.task-setup-header p { font-size: 14px; color: var(--text-secondary); }

.task-templates {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 24px;
}

.template-card {
  padding: 16px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border: 1.5px solid var(--border); border-radius: var(--r-lg);
  cursor: pointer; transition: all 0.3s var(--ease-spring);
  text-align: center;
  animation: fade-in-up 0.4s var(--ease-out) both;
}

.template-card:nth-child(1) { animation-delay: 0.1s; }
.template-card:nth-child(2) { animation-delay: 0.15s; }
.template-card:nth-child(3) { animation-delay: 0.2s; }

.template-card:hover { border-color: var(--teal-300); box-shadow: var(--shadow-sm); transform: translateY(-2px); }

.template-card.selected {
  border-color: var(--teal-500);
  background: var(--grad-brand-soft);
  box-shadow: var(--shadow-glow-teal);
}

.template-card .tpl-icon { font-size: 22px; margin-bottom: 8px; transition: transform 0.3s var(--ease-spring); }
.template-card:hover .tpl-icon { transform: scale(1.2); }
.template-card .tpl-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.template-card .tpl-desc { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }

.task-form {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border); border-radius: var(--r-lg);
  padding: 24px;
  display: flex; flex-direction: column; gap: 18px;
  animation: scale-in 0.4s var(--ease-spring) 0.25s both;
}

.form-group label {
  display: block; font-size: 13px; font-weight: 600;
  color: var(--text-primary); margin-bottom: 6px;
}

.form-group label .label-hint { font-weight: 400; color: var(--text-tertiary); font-size: 12px; }

.form-input, .form-select, .form-textarea {
  width: 100%; padding: 10px 14px;
  border: 1.5px solid var(--border); border-radius: var(--r-md);
  font-family: var(--font-body); font-size: 14px;
  color: var(--text-primary); background: rgba(255, 255, 255, 0.8);
  transition: all 0.2s var(--ease); outline: none;
}

.form-input:focus, .form-select:focus, .form-textarea:focus {
  border-color: var(--teal-400);
  box-shadow: 0 0 0 4px rgba(20, 184, 166, 0.08);
  background: white;
}

.form-textarea { resize: vertical; min-height: 80px; line-height: 1.5; }

.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

.form-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 4px; }

.btn {
  padding: 10px 20px; border-radius: var(--r-md);
  font-family: var(--font-body); font-size: 13.5px; font-weight: 600;
  cursor: pointer; transition: all 0.2s var(--ease);
  border: 1px solid transparent;
  display: inline-flex; align-items: center; gap: 6px;
}

.btn-secondary { background: var(--bg-card); border-color: var(--border); color: var(--text-primary); }
.btn-secondary:hover { background: var(--bg-hover); transform: translateY(-1px); }

.btn-primary {
  background: var(--grad-teal-indigo); background-size: 200% 200%;
  animation: gradient-flow 5s var(--ease) infinite;
  color: white; box-shadow: var(--shadow-glow-teal);
  position: relative; overflow: hidden;
}

.btn-primary::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.25), transparent);
  background-size: 200% 100%; animation: shimmer 3s linear infinite;
}

.btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: var(--shadow-glow-indigo); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.btn svg { width: 16px; height: 16px; position: relative; z-index: 1; }
.btn span { position: relative; z-index: 1; }

/* ---- below 1024px (board §12) ---- */
.task-m { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); }
.task-m-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.task-m-scroll > * { flex-shrink: 0; }
.task-m.busy .task-m-scroll { opacity: 0.55; }
.task-m-chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -16px; padding: 0 16px; }
.task-m-chip {
  flex: none; min-height: 44px; padding: 0 16px; border: 1px solid var(--border); border-radius: var(--r-full);
  background: var(--bg-card); color: var(--text-secondary); font: inherit; font-size: 14px; font-weight: 600; white-space: nowrap;
}
.task-m-chip[aria-selected="true"] { border-color: var(--teal-500); color: var(--teal-700); background: var(--teal-50); }
.task-m-field { display: grid; gap: 6px; }
.task-m-label, .task-m-glabel { font-size: 13px; color: var(--text-secondary); font-weight: 600; }
.task-m-glabel { margin: 8px 0 -4px; }
.task-m-field input, .task-m-field textarea {
  width: 100%; border: 1.5px solid var(--border); border-radius: var(--r-md); background: var(--bg-card);
  color: var(--text-primary); font: inherit; font-size: 16px; outline: none;
}
.task-m-field input { height: 52px; padding: 0 14px; }
.task-m-field textarea { min-height: 120px; max-height: 50vh; padding: 12px 14px; line-height: 1.5; resize: none; field-sizing: content; }
.task-m-field input:focus, .task-m-field textarea:focus { border-color: var(--teal-400); }
.task-m-err { margin: 0; font-size: 13.5px; color: #be123c; }
.task-m-err button { min-height: 44px; min-width: 44px; margin-left: 4px; border: 0; background: transparent; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; }
.task-m-attach { padding: 4px 8px; display: grid; gap: 4px; }
.task-m-attach .attachment-btn { min-height: 44px; min-width: 44px; font-size: 15px; }
.task-m-bar {
  flex: none; display: grid; gap: 6px; padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border); background: var(--bg-card);
}
.task-m-launch {
  width: 100%; height: 52px; border: 0; border-radius: var(--r-lg);
  background: var(--teal-700) var(--grad-teal-indigo); color: #fff; font: inherit; font-size: 16px; font-weight: 700;
}
.task-m-launch:disabled { opacity: 0.5; }
.task-m-why {
  min-height: 44px; border: 0; background: transparent; font: inherit; font-size: 13px;
  color: color-mix(in srgb, var(--amber-600) 75%, var(--slate-900)); text-decoration: underline; text-underline-offset: 3px;
}
@media (prefers-color-scheme: dark) {
  .task-m-chip[aria-selected="true"] { color: var(--teal-300); background: rgba(20, 184, 166, 0.14); }
  .task-m-err { color: var(--rose-400); }
  .task-m-why { color: var(--amber-400); }
}
</style>
