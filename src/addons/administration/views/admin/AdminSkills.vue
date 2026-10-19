<script setup lang="ts">
/**
 * 技能管理 —— agentia Skills 的 Aurora 简化移植。
 *
 * 范围：全量列表（含停用）/ zip 上传（复用既有 /skill/upload）/ 启停 / 删除 /
 * 文件浏览（左树右文抽屉）/ 下载。不含 git 导入、知识库绑定、SKILL.md 在线编辑
 * （依赖 agentia 独有 service，nucleagent 侧无对应物）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, getPlatformRuntime } from "@/contracts/platform-runtime";
import {
  deleteSkill,
  fetchSkillDownloadURL,
  adminSkillPage,
  skillFilePage,
  readSkillFile,
  updateSkill,
} from "../../api/admin";
import { toast } from "@/composables/useToast";
import type { Skill } from "../../api/types";
import { ArrowLeft, File, Folder, X } from "@lucide/vue";
import CollectionPager from "@/components/CollectionPager.vue";
import ResourceRelations from "./ResourceRelations.vue";
import CreateSkill from "./CreateSkill.vue";
import { useRemotePage } from "@/composables/useRemotePage";
import { resourcePage } from "@/api/resourcePage";
import { trapDialogFocus } from "../../agents/definition/focus";

const { t, locale } = useI18n();
const zh = computed(() => locale.value.startsWith("zh"));
const drawer = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;

const collection = useRemotePage(adminSkillPage);
const { rows: skills, loading, query, page, total, hasMore, failed } = collection;
const uploading = ref(false);
const relationId = ref<number>();
const creating = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// ---- 文件浏览抽屉 ----
const browsingSkill = ref<Skill | null>(null);
const directory = ref("");
const files = useRemotePage((params, signal) =>
  skillFilePage(browsingSkill.value!.id, { ...params, directory: directory.value }, signal));
const { rows: fileTree, loading: treeLoading, query: fileQuery } = files;
const selectedFile = ref("");
const fileContent = ref("");
const fileLoading = ref(false);
let fileSequence = 0;
let fileController: AbortController | undefined;

function skillDescription(s: Skill): string {
  const v = s.config?.description;
  return typeof v === "string" ? v : "";
}

async function load(): Promise<void> {
  await collection.load();
}

async function refreshRelation(id: number): Promise<void> {
  try {
    const result = await resourcePage<Skill>("/api/v1/addons/admin/skill", { page: 1, pageSize: 1, ids: [id] });
    const updated = result.data[0];
    if (updated) skills.value = skills.value.map(row => row.id === id ? updated : row);
  } catch {
    toast.error(t("common.operationFailed"));
  }
}

onMounted(load);

// ---- 上传 ----

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || uploading.value) return;
  uploading.value = true;
  try {
    const form = new FormData();
    form.append("file", file);
    // 上传走既有 /skill/upload；Content-Type 让浏览器带 boundary 自己设。
    await getPlatformRuntime().http.post("/api/v1/addons/skill/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    toast.success(t("admin.skills.uploaded", { name: file.name }));
    await load();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : String(error);
    toast.error(t("admin.skills.uploadFailed", { message }));
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

// ---- 启停/删除 ----

async function toggleActive(s: Skill): Promise<void> {
  try {
    await updateSkill(s.id, { isActive: !s.isActive }, s.revision);
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  }
}

async function remove(s: Skill): Promise<void> {
  if (!window.confirm(t("admin.skills.confirmDelete", { name: s.name }))) return;
  try {
    await deleteSkill(s.id, s.revision);
    toast.success(t("admin.skills.deleted"));
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  }
}

// ---- 文件浏览 ----

async function openBrowser(s: Skill): Promise<void> {
  closeBrowser();
  previousFocus = document.activeElement as HTMLElement | null;
  browsingSkill.value = s;
  selectedFile.value = "";
  fileContent.value = "";
  void enterDirectory("");
  await nextTick();
  drawer.value?.querySelector<HTMLInputElement>("input")?.focus();
}

function closeBrowser(): void {
  files.reset();
  fileSequence++;
  fileController?.abort();
  fileLoading.value = false;
  browsingSkill.value = null;
  previousFocus?.focus?.();
  previousFocus = null;
}

function onCreated(skill: Skill) {
  creating.value = false;
  relationId.value = skill.id;
  query.value = skill.slug;
  void load();
}

function onMaskClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) closeBrowser();
}

async function selectFile(path: string): Promise<void> {
  if (!browsingSkill.value) return;
  const sequence = ++fileSequence;
  fileController?.abort();
  fileController = new AbortController();
  selectedFile.value = path;
  fileContent.value = "";
  fileLoading.value = true;
  try {
    const content = await readSkillFile(browsingSkill.value.id, path, fileController.signal);
    if (sequence === fileSequence) fileContent.value = content;
  } catch (error) {
    if (sequence === fileSequence) fileContent.value = error instanceof ApiError ? error.message : t("admin.skills.readFileFailed");
  } finally {
    if (sequence === fileSequence) fileLoading.value = false;
  }
}

async function enterDirectory(path: string): Promise<void> {
  directory.value = path;
  fileQuery.value = "";
  files.reset();
  await files.load();
}

async function download(s: Skill): Promise<void> {
  try {
    const url = await fetchSkillDownloadURL(s.id);
    if (url) window.open(url, "_blank", "noopener");
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && browsingSkill.value) closeBrowser();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  fileSequence++;
  fileController?.abort();
});
</script>

<template>
  <div class="skills-view">
    <div class="list-header">
      <span class="count-hint">{{ t("admin.skills.count", { n: total }) }}</span>
      <button class="btn-primary" type="button" @click="creating = true">{{ zh ? '新建技能' : 'Create skill' }}</button>
      <input v-model="query" type="search" class="list-search" :aria-label="t('common.search')" :placeholder="t('common.search')" />
      <input
        ref="fileInput"
        type="file"
        accept=".zip"
        class="hidden-file"
        @change="onFileChange"
      />
      <button class="btn-primary" type="button" :disabled="uploading" @click="fileInput?.click()">
        {{ uploading ? t("common.loading") : t("admin.skills.upload") }}
      </button>
    </div>

    <p v-if="loading" class="empty-hint">{{ t("common.loading") }}</p>
    <p v-else-if="!skills.length" class="empty-hint">{{ t("admin.skills.empty") }}</p>

    <div v-else class="skill-list">
      <div v-for="s in skills" :key="s.id" class="skill-card" :class="{ inactive: !s.isActive }">
        <div class="skill-main">
          <div class="skill-title-row">
            <span class="skill-name">{{ s.name }}</span>
            <span class="skill-slug">{{ s.slug }}</span>
            <span class="badge" :class="s.isActive ? 'on' : 'off'">
              {{ s.isActive ? t("common.enabled") : t("common.disabled") }}
            </span>
            <span v-if="s.version" class="version-chip">v{{ s.version }}</span>
          </div>
          <div v-if="skillDescription(s)" class="skill-desc">{{ skillDescription(s) }}</div>
        </div>
        <div class="skill-actions">
          <button class="btn-ghost" type="button" :aria-expanded="relationId === s.id" @click="relationId = relationId === s.id ? undefined : s.id">{{ zh ? '绑定工具' : 'Bound tools' }}</button>
          <button class="btn-ghost" type="button" @click="toggleActive(s)">
            {{ s.isActive ? t("common.disable") : t("common.enable") }}
          </button>
          <button class="btn-ghost" type="button" @click="openBrowser(s)">{{ t("admin.skills.browse") }}</button>
          <button class="btn-ghost" type="button" @click="download(s)">{{ t("common.download") }}</button>
          <button class="btn-ghost danger" type="button" @click="remove(s)">{{ t("common.delete") }}</button>
        </div>
        <ResourceRelations v-if="relationId === s.id" kind="skill" :id="s.id" :revision="s.revision" @changed="refreshRelation(s.id)" />
      </div>
    </div>

    <CollectionPager :page="page" :total="total" :has-more="hasMore" :loading="loading" :failed="failed" @page="collection.go" @retry="load" />
    <CreateSkill v-if="creating" @close="creating = false; load()" @created="onCreated" />
    <!-- 文件浏览抽屉 -->
    <div v-if="browsingSkill" class="drawer-mask" @click="onMaskClick">
      <div ref="drawer" class="drawer" role="dialog" aria-modal="true" :aria-label="browsingSkill.name" @keydown="trapDialogFocus">
        <div class="drawer-header">
          <div class="drawer-title">
            <span class="skill-name">{{ browsingSkill.name }}</span>
            <span class="skill-slug">{{ browsingSkill.slug }}</span>
          </div>
          <button class="icon-btn" type="button" :aria-label="t('common.close')" @click="closeBrowser"><X :size="16" /></button>
        </div>
        <div class="drawer-body">
          <!-- 左：文件树 -->
          <div class="tree-pane">
            <input v-model="fileQuery" type="search" class="file-search" :aria-label="t('common.search')" :placeholder="t('common.search')" />
            <button v-if="directory" type="button" class="file-entry" :title="directory" @click="enterDirectory(directory.split('/').slice(0, -1).join('/'))"><ArrowLeft :size="16" />{{ directory }}</button>
            <p v-if="treeLoading" class="tree-hint">{{ t("common.loading") }}</p>
            <template v-else>
              <button
                v-for="node in fileTree"
                :key="node.path"
                type="button"
                class="file-entry"
                :aria-pressed="!node.isDir && selectedFile === node.path"
                :title="node.path"
                @click="node.isDir ? enterDirectory(node.path) : selectFile(node.path)"
              ><component :is="node.isDir ? Folder : File" :size="16" /><span>{{ fileQuery ? node.path : node.name }}</span></button>
              <p v-if="!fileTree.length" class="tree-hint">{{ t("admin.skills.noFiles") }}</p>
            </template>
            <CollectionPager :page="files.page.value" :total="files.total.value" :has-more="files.hasMore.value" :loading="treeLoading" :failed="files.failed.value" @page="files.go" @retry="files.load" />
          </div>
          <!-- 右：文件内容 -->
          <div class="content-pane">
            <div v-if="selectedFile" class="content-head">{{ selectedFile }}</div>
            <pre v-if="selectedFile && !fileLoading" class="content-pre">{{ fileContent }}</pre>
            <p v-else-if="fileLoading" class="tree-hint">{{ t("common.loading") }}</p>
            <p v-else class="tree-hint">{{ t("admin.skills.pickFile") }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skills-view { display: flex; flex-direction: column; gap: 14px; }

.list-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.list-search { flex: 1; min-width: 140px; max-width: 360px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); color: var(--text-primary); }
@media (max-width: 600px) { .skill-card { flex-direction: column; align-items: flex-start; } .tree-pane { width: 140px; } }
.count-hint { font-size: 12.5px; color: var(--text-tertiary); }

.hidden-file { display: none; }

.empty-hint { color: var(--text-tertiary); text-align: center; padding: 32px 0; font-size: 13px; }

.skill-list { display: flex; flex-direction: column; gap: 10px; }

.skill-card {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px;
  padding: 14px 16px;
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--r-lg); box-shadow: var(--shadow-xs);
  transition: all 0.25s var(--ease);
}
.skill-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); }
.skill-card.inactive { opacity: 0.6; }

.skill-main { min-width: 0; flex: 1; }
.skill-name, .skill-slug { overflow-wrap: anywhere; }
.skill-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.skill-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.skill-slug { font-size: 11.5px; color: var(--text-tertiary); font-family: var(--font-mono); }

.badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
.badge.on { background: #d1fae5; color: #047857; }
.badge.off { background: var(--slate-100); color: var(--text-tertiary); }

.version-chip {
  font-size: 11px; padding: 2px 8px; border-radius: var(--r-sm);
  background: var(--grad-brand-soft); color: var(--indigo-600);
  font-family: var(--font-mono);
}

.skill-desc {
  font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.skill-actions { display: flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; }

/* 抽屉 */
.drawer-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(3px); z-index: 60;
  display: flex; justify-content: flex-end;
  animation: fade-in 0.2s var(--ease-out) both;
}
.drawer {
  width: min(860px, 92vw); height: 100%;
  background: var(--bg-card); border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-lg);
  animation: slide-in-right 0.25s var(--ease-out) both;
}
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.drawer-title { display: flex; align-items: baseline; gap: 8px; }
.drawer-body { flex: 1; min-height: 0; display: flex; }

.tree-pane {
  width: 280px; flex-shrink: 0; border-right: 1px solid var(--border);
  overflow-y: auto; padding: 8px 4px;
}
.tree-hint { color: var(--text-tertiary); font-size: 12px; padding: 12px; }
.file-search { width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-primary); }
.file-entry { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px; text-align: left; background: transparent; color: var(--text-primary); border: 0; cursor: pointer; overflow-wrap: anywhere; }
.file-entry svg { flex-shrink: 0; }
.file-entry:hover, .file-entry[aria-pressed=true] { background: var(--bg-hover); }

.content-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.content-head {
  padding: 10px 14px; border-bottom: 1px solid var(--border);
  font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary);
  flex-shrink: 0;
}
.content-pre {
  flex: 1; overflow: auto; margin: 0; padding: 14px;
  font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6;
  color: var(--text-primary); white-space: pre-wrap; word-break: break-word;
}

.icon-btn {
  width: 30px; height: 30px; border: none; border-radius: var(--r-md); background: transparent;
  color: var(--text-tertiary); cursor: pointer; font-size: 14px; transition: all 0.15s var(--ease);
}
.icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

.btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border: none; border-radius: var(--r-md);
  background: var(--grad-teal-indigo); background-size: 200% 200%;
  color: white; font-size: 13px; font-weight: 600; cursor: pointer;
  box-shadow: var(--shadow-sm); transition: all 0.25s var(--ease); white-space: nowrap;
}
.btn-primary:hover:not(:disabled) { background-position: 100% 0; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-ghost {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--bg-card); color: var(--text-secondary); font-size: 12.5px; cursor: pointer;
  transition: all 0.2s var(--ease); white-space: nowrap;
}
.btn-ghost:hover { border-color: var(--border-strong); color: var(--text-primary); }
.btn-ghost.danger:hover { border-color: var(--rose-400); color: var(--rose-500); }
@media (max-width: 600px) {
  .drawer { width: 100%; }
  .drawer-body { flex-direction: column; }
  .tree-pane { width: 100%; max-height: 45%; border-right: 0; border-bottom: 1px solid var(--border); }
  .content-head, .drawer-title { overflow-wrap: anywhere; min-width: 0; }
}
</style>
