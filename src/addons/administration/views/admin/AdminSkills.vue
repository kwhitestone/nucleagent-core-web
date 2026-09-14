<script setup lang="ts">
/**
 * 技能管理 —— agentia Skills 的 Aurora 简化移植。
 *
 * 范围：全量列表（含停用）/ zip 上传（复用既有 /skill/upload）/ 启停 / 删除 /
 * 文件浏览（左树右文抽屉）/ 下载。不含 git 导入、知识库绑定、SKILL.md 在线编辑
 * （依赖 agentia 独有 service，nucleagent 侧无对应物）。
 */
import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, getPlatformRuntime } from "@/contracts/platform-runtime";
import {
  deleteSkill,
  fetchSkillDownloadURL,
  listAllSkills,
  listSkillFiles,
  readSkillFile,
  updateSkill,
  type SkillFileNode,
} from "../../api/admin";
import { toast } from "@/composables/useToast";
import type { Skill } from "../../api/types";
import SkillFileTreeNode from "./SkillFileTreeNode.vue";

const { t } = useI18n();

const loading = ref(false);
const skills = ref<Skill[]>([]);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// ---- 文件浏览抽屉 ----
const browsingSkill = ref<Skill | null>(null);
const fileTree = ref<SkillFileNode[]>([]);
const treeLoading = ref(false);
const selectedFile = ref("");
const fileContent = ref("");
const fileLoading = ref(false);
/** 展开的目录 path 集合。 */
const expandedDirs = ref<Set<string>>(new Set());

function skillDescription(s: Skill): string {
  const v = s.config?.description;
  return typeof v === "string" ? v : "";
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    skills.value = await listAllSkills();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("admin.skills.loadFailed"));
  } finally {
    loading.value = false;
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
    await updateSkill(s.id, { isActive: !s.isActive });
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  }
}

async function remove(s: Skill): Promise<void> {
  if (!window.confirm(t("admin.skills.confirmDelete", { name: s.name }))) return;
  try {
    await deleteSkill(s.id);
    toast.success(t("admin.skills.deleted"));
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  }
}

// ---- 文件浏览 ----

/** 深度优先找第一个 SKILL.md（默认选中）。 */
function firstSKILLMD(nodes: SkillFileNode[]): string {
  for (const n of nodes) {
    if (n.isDir) {
      const found = firstSKILLMD(n.children ?? []);
      if (found) return found;
    } else if (n.name === "SKILL.md") {
      return n.path;
    }
  }
  return "";
}

async function openBrowser(s: Skill): Promise<void> {
  browsingSkill.value = s;
  fileTree.value = [];
  selectedFile.value = "";
  fileContent.value = "";
  expandedDirs.value = new Set();
  treeLoading.value = true;
  try {
    fileTree.value = await listSkillFiles(s.id);
    const skillMD = firstSKILLMD(fileTree.value);
    if (skillMD) {
      // 展开到 SKILL.md 的父目录并选中。
      const parts = skillMD.split("/");
      parts.pop();
      let prefix = "";
      for (const part of parts) {
        prefix = prefix ? `${prefix}/${part}` : part;
        expandedDirs.value.add(prefix);
      }
      await selectFile(skillMD);
    }
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("admin.skills.browseFailed"));
  } finally {
    treeLoading.value = false;
  }
}

function closeBrowser(): void {
  browsingSkill.value = null;
}

function onMaskClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) closeBrowser();
}

async function selectFile(path: string): Promise<void> {
  if (!browsingSkill.value || fileLoading.value) return;
  selectedFile.value = path;
  fileContent.value = "";
  fileLoading.value = true;
  try {
    fileContent.value = await readSkillFile(browsingSkill.value.id, path);
  } catch (error) {
    fileContent.value = error instanceof ApiError ? error.message : t("admin.skills.readFileFailed");
  } finally {
    fileLoading.value = false;
  }
}

function toggleDir(path: string): void {
  const next = new Set(expandedDirs.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expandedDirs.value = next;
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
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="skills-view">
    <div class="list-header">
      <span class="count-hint">{{ t("admin.skills.count", { n: skills.length }) }}</span>
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
          <button class="btn-ghost" type="button" @click="toggleActive(s)">
            {{ s.isActive ? t("common.disable") : t("common.enable") }}
          </button>
          <button class="btn-ghost" type="button" @click="openBrowser(s)">{{ t("admin.skills.browse") }}</button>
          <button class="btn-ghost" type="button" @click="download(s)">{{ t("common.download") }}</button>
          <button class="btn-ghost danger" type="button" @click="remove(s)">{{ t("common.delete") }}</button>
        </div>
      </div>
    </div>

    <!-- 文件浏览抽屉 -->
    <div v-if="browsingSkill" class="drawer-mask" @click="onMaskClick">
      <div class="drawer">
        <div class="drawer-header">
          <div class="drawer-title">
            <span class="skill-name">{{ browsingSkill.name }}</span>
            <span class="skill-slug">{{ browsingSkill.slug }}</span>
          </div>
          <button class="icon-btn" type="button" @click="closeBrowser">✕</button>
        </div>
        <div class="drawer-body">
          <!-- 左：文件树 -->
          <div class="tree-pane">
            <p v-if="treeLoading" class="tree-hint">{{ t("common.loading") }}</p>
            <template v-else>
              <SkillFileTreeNode
                v-for="node in fileTree"
                :key="node.path"
                :node="node"
                :depth="0"
                :selected="selectedFile"
                :expanded="expandedDirs"
                @select="selectFile"
                @toggle="toggleDir"
              />
              <p v-if="!fileTree.length" class="tree-hint">{{ t("admin.skills.noFiles") }}</p>
            </template>
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

.list-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.count-hint { font-size: 12.5px; color: var(--text-tertiary); }

.hidden-file { display: none; }

.empty-hint { color: var(--text-tertiary); text-align: center; padding: 32px 0; font-size: 13px; }

.skill-list { display: flex; flex-direction: column; gap: 10px; }

.skill-card {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 14px 16px;
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--r-lg); box-shadow: var(--shadow-xs);
  transition: all 0.25s var(--ease);
}
.skill-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); }
.skill-card.inactive { opacity: 0.6; }

.skill-main { min-width: 0; flex: 1; }
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
</style>
