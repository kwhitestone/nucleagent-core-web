<script setup lang="ts">
/**
 * 工具管理（MCP）—— agentia Tools 的 Aurora 移植。
 *
 * Tool 表 + config.mcp_config 约定（后端 addons/mcp/tools.go）：
 *   { type: "http", url, server_name: 远端工具名, description, input_schema }
 * 网关运行时按 slug 投影转发 tools/call（本地 slug = 远端工具名）。
 *
 * 探测导入：POST /admin/mcp-probe 发现远端工具 → 勾选 → 批量建 Tool
 * （slug=工具名、mcp_config.type=http、url=server url）。
 */
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/contracts/platform-runtime";
import { probeMCPServer, type MCPProbeTool, type MCPTransport } from "../../api/admin";
import { createTool, deleteTool, listTools, updateTool, type Tool, type ToolConfig } from "../../api/tool";
import { toast } from "@/composables/useToast";

const { t } = useI18n();

const loading = ref(false);
const tools = ref<Tool[]>([]);
const saving = ref(false);

// ---- 表单 ----
const editingId = ref<number | null | undefined>(undefined); // null=新建 undefined=关
const formOpen = computed(() => editingId.value !== undefined);
const isCreate = computed(() => editingId.value === null);
const form = reactive({
  name: "",
  slug: "",
  type: "http" as "http" | "builtin",
  url: "",
  description: "",
  schemaText: "",
  isActive: true,
});

// ---- MCP 探测 ----
const probeUrl = ref("");
const probeTransport = ref<MCPTransport>("streamable-http");
const probing = ref(false);
const probeResults = ref<MCPProbeTool[]>([]);
const probeChecked = ref<Set<string>>(new Set());
const importing = ref(false);

function mcpConfigOf(tool: Tool): ToolConfig["mcp_config"] {
  return tool.config?.mcp_config;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    tools.value = await listTools();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("admin.tools.loadFailed"));
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openCreate(): void {
  form.name = "";
  form.slug = "";
  form.type = "http";
  form.url = "";
  form.description = "";
  form.schemaText = "";
  form.isActive = true;
  editingId.value = null;
}

function openEdit(tool: Tool): void {
  const cfg = mcpConfigOf(tool);
  form.name = tool.name;
  form.slug = tool.slug;
  form.type = (cfg?.type === "builtin" ? "builtin" : "http") as "http" | "builtin";
  form.url = cfg?.url ?? "";
  form.description = cfg?.description ?? "";
  form.schemaText = cfg?.input_schema ? JSON.stringify(cfg.input_schema, null, 2) : "";
  form.isActive = tool.isActive;
  editingId.value = tool.id;
}

function closeForm(): void {
  editingId.value = undefined;
}

function buildConfig(): ToolConfig {
  const mcp: NonNullable<ToolConfig["mcp_config"]> = {
    type: form.type,
    description: form.description,
    server_name: form.slug,
  };
  if (form.type === "http") mcp.url = form.url.trim();
  if (form.schemaText.trim()) {
    mcp.input_schema = JSON.parse(form.schemaText) as Record<string, unknown>;
  }
  return { mcp_config: mcp };
}

async function submit(): Promise<void> {
  if (saving.value) return;
  if (!form.name.trim() || !form.slug.trim()) {
    toast.error(t("admin.tools.errNameSlug"));
    return;
  }
  if (form.schemaText.trim()) {
    try {
      JSON.parse(form.schemaText);
    } catch {
      toast.error(t("admin.tools.invalidSchemaJson"));
      return;
    }
  }
  saving.value = true;
  try {
    if (isCreate.value) {
      await createTool({
        name: form.name.trim(),
        slug: form.slug.trim(),
        config: buildConfig(),
        isActive: form.isActive,
      });
      toast.success(t("admin.tools.created"));
    } else {
      await updateTool(editingId.value as number, {
        name: form.name.trim(),
        slug: form.slug.trim(),
        config: buildConfig(),
        isActive: form.isActive,
      });
      toast.success(t("admin.tools.updated"));
    }
    closeForm();
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  } finally {
    saving.value = false;
  }
}

async function toggleActive(tool: Tool): Promise<void> {
  try {
    await updateTool(tool.id, { isActive: !tool.isActive });
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  }
}

async function remove(tool: Tool): Promise<void> {
  if (!window.confirm(t("admin.tools.confirmDelete", { name: tool.name }))) return;
  try {
    await deleteTool(tool.id);
    toast.success(t("admin.tools.deleted"));
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("common.operationFailed"));
  }
}

// ---- 探测 ----

async function probe(): Promise<void> {
  const url = probeUrl.value.trim();
  if (!url) {
    toast.warning(t("admin.tools.probeUrlRequired"));
    return;
  }
  probing.value = true;
  probeResults.value = [];
  probeChecked.value = new Set();
  try {
    const found = await probeMCPServer(url, probeTransport.value);
    if (!found.length) {
      toast.warning(t("admin.tools.probeNoTools"));
      return;
    }
    probeResults.value = found;
    toast.success(t("admin.tools.probeFound", { n: found.length }));
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : t("admin.tools.probeFailed"));
  } finally {
    probing.value = false;
  }
}

function toggleChecked(name: string): void {
  const next = new Set(probeChecked.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  probeChecked.value = next;
}

/** 批量导入勾选的工具：每个工具一条 Tool，slug=工具名（网关同名投影约定）。 */
async function importChecked(): Promise<void> {
  const url = probeUrl.value.trim();
  if (!url || !probeChecked.value.size || importing.value) return;
  // 已存在的 slug 跳过（探测结果里同名工具会被唯一索引拒掉）。
  const existing = new Set(tools.value.map((tool) => tool.slug));
  const picked = probeResults.value.filter(
    (tool) => probeChecked.value.has(tool.name) && !existing.has(tool.name),
  );
  if (!picked.length) {
    toast.warning(t("admin.tools.importAllExist"));
    return;
  }
  importing.value = true;
  let ok = 0;
  let failed = 0;
  for (const tool of picked) {
    try {
      await createTool({
        name: tool.name,
        slug: tool.name,
        config: {
          mcp_config: {
            type: "http",
            url,
            server_name: tool.name,
            description: tool.description ?? "",
            ...(tool.inputSchema && Object.keys(tool.inputSchema).length
              ? { input_schema: tool.inputSchema }
              : {}),
          },
        },
        isActive: true,
      });
      ok++;
    } catch {
      failed++;
    }
  }
  importing.value = false;
  toast.success(t("admin.tools.imported", { ok, failed }));
  await load();
}
</script>

<template>
  <div class="tools-view">
    <!-- MCP 探测区 -->
    <section class="probe-card">
      <div class="probe-head">
        <div>
          <h2 class="section-title">{{ t("admin.tools.probeTitle") }}</h2>
          <p class="section-hint">{{ t("admin.tools.probeHint") }}</p>
        </div>
      </div>
      <div class="probe-form">
        <input
          v-model="probeUrl"
          type="text"
          class="probe-url"
          :placeholder="t('admin.tools.probeUrlPlaceholder')"
        />
        <select v-model="probeTransport" class="probe-transport">
          <option value="streamable-http">Streamable HTTP</option>
          <option value="sse">SSE</option>
        </select>
        <button class="btn-primary" type="button" :disabled="probing" @click="probe">
          {{ probing ? t("common.loading") : t("admin.tools.probe") }}
        </button>
      </div>

      <div v-if="probeResults.length" class="probe-results">
        <div class="probe-results-head">
          <span class="count-hint">{{ t("admin.tools.probeCount", { n: probeResults.length }) }}</span>
          <button
            class="btn-primary"
            type="button"
            :disabled="!probeChecked.size || importing"
            @click="importChecked"
          >
            {{ importing ? t("common.loading") : t("admin.tools.importSelected", { n: probeChecked.size }) }}
          </button>
        </div>
        <div v-for="tool in probeResults" :key="tool.name" class="probe-row">
          <label class="check-row">
            <input
              type="checkbox"
              class="switch"
              :checked="probeChecked.has(tool.name)"
              @change="toggleChecked(tool.name)"
            />
            <span class="probe-name">{{ tool.name }}</span>
          </label>
          <span class="probe-desc">{{ tool.description || "—" }}</span>
        </div>
      </div>
    </section>

    <!-- 工具列表 -->
    <div class="list-header">
      <span class="count-hint">{{ t("admin.tools.count", { n: tools.length }) }}</span>
      <button class="btn-primary" type="button" @click="openCreate">{{ t("admin.tools.create") }}</button>
    </div>

    <p v-if="loading" class="empty-hint">{{ t("common.loading") }}</p>
    <p v-else-if="!tools.length" class="empty-hint">{{ t("admin.tools.empty") }}</p>

    <div v-else class="tool-list">
      <div v-for="tool in tools" :key="tool.id" class="tool-card" :class="{ inactive: !tool.isActive }">
        <div class="tool-main">
          <div class="tool-title-row">
            <span class="tool-name">{{ tool.name }}</span>
            <span class="tool-slug">{{ tool.slug }}</span>
            <span class="type-chip" :class="mcpConfigOf(tool)?.type">
              {{ mcpConfigOf(tool)?.type === "builtin" ? "builtin" : "http" }}
            </span>
            <span class="badge" :class="tool.isActive ? 'on' : 'off'">
              {{ tool.isActive ? t("common.enabled") : t("common.disabled") }}
            </span>
          </div>
          <div v-if="mcpConfigOf(tool)?.url" class="tool-url">{{ mcpConfigOf(tool)?.url }}</div>
          <div v-if="mcpConfigOf(tool)?.description" class="tool-desc">{{ mcpConfigOf(tool)?.description }}</div>
        </div>
        <div class="tool-actions">
          <button class="btn-ghost" type="button" @click="toggleActive(tool)">
            {{ tool.isActive ? t("common.disable") : t("common.enable") }}
          </button>
          <button class="btn-ghost" type="button" @click="openEdit(tool)">{{ t("common.edit") }}</button>
          <button class="btn-ghost danger" type="button" @click="remove(tool)">{{ t("common.delete") }}</button>
        </div>
      </div>
    </div>

    <!-- 新建/编辑弹层 -->
    <div v-if="formOpen" class="modal-mask" @click.self="closeForm">
      <div class="modal-card">
        <div class="modal-header">
          <h2>{{ isCreate ? t("admin.tools.createTitle") : t("admin.tools.editTitle") }}</h2>
          <button class="modal-close" type="button" @click="closeForm">×</button>
        </div>
        <div class="modal-body">
          <label class="field">
            <span class="field-label">{{ t("admin.tools.fieldName") }} *</span>
            <input v-model="form.name" type="text" :placeholder="t('admin.tools.phName')" />
          </label>
          <label class="field">
            <span class="field-label">{{ t("admin.tools.fieldSlug") }} *</span>
            <input v-model="form.slug" type="text" :disabled="!isCreate" :placeholder="t('admin.tools.phSlug')" />
          </label>
          <div class="field">
            <span class="field-label">{{ t("admin.tools.fieldType") }}</span>
            <div class="type-row">
              <button
                class="type-btn"
                :class="{ active: form.type === 'http' }"
                type="button"
                @click="form.type = 'http'"
              >HTTP MCP</button>
              <button
                class="type-btn"
                :class="{ active: form.type === 'builtin' }"
                type="button"
                @click="form.type = 'builtin'"
              >Builtin</button>
            </div>
          </div>
          <label v-if="form.type === 'http'" class="field">
            <span class="field-label">{{ t("admin.tools.fieldUrl") }}</span>
            <input v-model="form.url" type="text" placeholder="https://mcp.example.com/mcp" />
          </label>
          <label class="field">
            <span class="field-label">{{ t("admin.tools.fieldDescription") }}</span>
            <input v-model="form.description" type="text" :placeholder="t('admin.tools.phDescription')" />
          </label>
          <label class="field">
            <span class="field-label">{{ t("admin.tools.fieldSchema") }}</span>
            <textarea v-model="form.schemaText" rows="6" class="mono" placeholder='{ "type": "object", "properties": {} }' />
          </label>
          <label class="switch-row">
            <input v-model="form.isActive" type="checkbox" class="switch" />
            {{ t("common.enabled") }}
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" type="button" @click="closeForm">{{ t("common.cancel") }}</button>
          <button class="btn-primary" type="button" :disabled="saving" @click="submit">
            {{ isCreate ? t("admin.tools.create") : t("common.save") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tools-view { display: flex; flex-direction: column; gap: 14px; }

/* 探测区 */
.probe-card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--r-lg); padding: 16px 18px; box-shadow: var(--shadow-xs);
  display: flex; flex-direction: column; gap: 12px;
}
.section-title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 2px; }
.section-hint { font-size: 12px; color: var(--text-tertiary); }

.probe-form { display: flex; gap: 8px; flex-wrap: wrap; }
.probe-url {
  flex: 1; min-width: 260px; padding: 8px 10px; border: 1px solid var(--border);
  border-radius: var(--r-md); background: var(--bg-card); font-size: 12.5px;
  font-family: var(--font-mono); color: var(--text-primary);
}
.probe-url:focus { outline: none; border-color: var(--teal-500); }
.probe-transport {
  padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--bg-card); font-size: 12.5px; color: var(--text-primary);
}

.probe-results { border-top: 1px solid var(--border); padding-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.probe-results-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.probe-row {
  display: flex; align-items: center; gap: 10px; padding: 7px 10px;
  background: var(--bg-subtle); border-radius: var(--r-md); font-size: 12.5px;
}
.check-row { display: flex; align-items: center; gap: 7px; cursor: pointer; min-width: 200px; }
.probe-name { font-family: var(--font-mono); font-weight: 600; color: var(--text-primary); }
.probe-desc { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

.count-hint { font-size: 12.5px; color: var(--text-tertiary); }
.list-header { display: flex; align-items: center; justify-content: space-between; }
.empty-hint { color: var(--text-tertiary); text-align: center; padding: 32px 0; font-size: 13px; }

.tool-list { display: flex; flex-direction: column; gap: 10px; }
.tool-card {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 14px 16px;
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--r-lg); box-shadow: var(--shadow-xs);
  transition: all 0.25s var(--ease);
}
.tool-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); }
.tool-card.inactive { opacity: 0.6; }

.tool-main { min-width: 0; flex: 1; }
.tool-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tool-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.tool-slug { font-size: 11.5px; color: var(--text-tertiary); font-family: var(--font-mono); }

.type-chip {
  font-size: 10.5px; padding: 2px 8px; border-radius: 999px;
  background: var(--bg-hover); color: var(--text-secondary); font-family: var(--font-mono);
}
.type-chip.builtin { background: #ede9fe; color: var(--violet-600); }

.badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
.badge.on { background: #d1fae5; color: #047857; }
.badge.off { background: var(--slate-100); color: var(--text-tertiary); }

.tool-url {
  font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary); margin-top: 3px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tool-desc { font-size: 12.5px; color: var(--text-secondary); margin-top: 3px; }

.tool-actions { display: flex; gap: 4px; flex-shrink: 0; }

/* 弹层（对齐 Providers.vue 的 modal 体系） */
.modal-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(3px); z-index: 50;
  display: flex; align-items: center; justify-content: center; padding: 24px;
  animation: fade-in 0.2s var(--ease-out) both;
}
.modal-card {
  width: min(620px, 94vw); max-height: 86vh; overflow-y: auto;
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--r-lg); box-shadow: var(--shadow-lg);
  animation: fade-in-up 0.25s var(--ease-out) both;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border);
}
.modal-header h2 { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.modal-close {
  width: 30px; height: 30px; border: none; border-radius: var(--r-md);
  background: transparent; font-size: 18px; color: var(--text-tertiary); cursor: pointer;
}
.modal-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
.modal-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px; border-top: 1px solid var(--border);
}

.field-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 5px; }
.field input, .field textarea {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--bg-card); color: var(--text-primary); font-size: 13px;
}
.field input:focus, .field textarea:focus { outline: none; border-color: var(--teal-500); }
.field input:disabled { background: var(--bg-subtle); color: var(--text-tertiary); }
.field .mono { font-family: var(--font-mono); font-size: 12px; }

.type-row { display: flex; gap: 6px; }
.type-btn {
  padding: 7px 14px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--bg-card); color: var(--text-secondary); font-size: 12.5px; cursor: pointer;
  transition: all 0.2s var(--ease);
}
.type-btn.active {
  border-color: var(--teal-500); color: var(--teal-600);
  background: var(--grad-brand-soft); font-weight: 600;
}

.switch-row { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
.switch { accent-color: var(--teal-500); }

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
