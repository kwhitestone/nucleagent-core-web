<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { X } from "@lucide/vue";
import { getPlatformRuntime } from "@/contracts/platform-runtime";
import { useRemotePage } from "@/composables/useRemotePage";
import CollectionPager from "@/components/CollectionPager.vue";
import { toolPage } from "../../api/tool";
import type { Skill } from "../../api/types";
import { trapDialogFocus } from "../../agents/definition/focus";

const emit = defineEmits<{ close: []; created: [skill: Skill] }>();
const { locale } = useI18n();
const zh = computed(() => locale.value.startsWith("zh"));
const form = reactive({ name: "", slug: "", description: "", instructions: "", isActive: true });
const tools = useRemotePage(toolPage);
const { rows, query, page, total, hasMore, loading, failed } = tools;
const selected = ref<number[]>([]);
const saving = ref(false);
const error = ref("");
const created = ref<Skill>();
const dialog = ref<HTMLElement>();
const previousFocus = typeof document === "undefined" ? null : document.activeElement as HTMLElement | null;
let disposed = false;
onBeforeUnmount(() => { disposed = true; previousFocus?.focus?.(); });
function toggle(id: number, checked: boolean) {
  selected.value = checked ? [...selected.value, id] : selected.value.filter(value => value !== id);
}
async function submit() {
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    if (!created.value) {
      const response = await getPlatformRuntime().http.post<{ data: Skill }>("/api/v1/addons/skill", form);
      created.value = response.data.data;
    }
    if (disposed) return;
    if (selected.value.length) {
      await getPlatformRuntime().http.patch(`/api/v1/addons/admin/skill/${created.value.id}/tools`,
        { add: selected.value, remove: [] }, { headers: { "If-Match": `"skill-${created.value.id}-${created.value.revision}"` } });
    }
    if (!disposed) emit("created", created.value);
  } catch {
    error.value = created.value
      ? (zh.value ? "技能已创建，绑定失败。所选工具已保留。" : "Skill created; binding failed. Tool selection retained.")
      : (zh.value ? "创建失败，请检查字段或存储服务后重试。" : "Create failed. Check fields or storage and retry.");
  } finally { saving.value = false; }
}
onMounted(() => { void tools.load(); dialog.value?.querySelector<HTMLInputElement>("input")?.focus(); });
</script>

<template>
  <div class="create-mask" @keydown.esc="!saving && emit('close')">
    <form ref="dialog" class="create-dialog" role="dialog" aria-modal="true" :aria-label="zh ? '新建技能' : 'Create skill'" @submit.prevent="submit" @keydown="trapDialogFocus">
      <header><h2>{{ zh ? '新建技能' : 'Create skill' }}</h2><button type="button" :disabled="saving" :aria-label="zh ? '关闭' : 'Close'" @click="emit('close')"><X :size="18" /></button></header>
      <fieldset :disabled="saving || !!created">
        <label>{{ zh ? '名称' : 'Name' }}<input v-model="form.name" required maxlength="128"></label>
        <label>{{ zh ? '标识' : 'Slug' }}<input v-model="form.slug" required maxlength="128" pattern="[a-z][a-z0-9_\-]*"></label>
        <label>{{ zh ? '描述' : 'Description' }}<textarea v-model="form.description" required maxlength="500" rows="2" /></label>
        <label>{{ zh ? '技能指令' : 'Instructions' }}<textarea v-model="form.instructions" required maxlength="8000" rows="6" /></label>
        <label class="check"><input v-model="form.isActive" type="checkbox">{{ zh ? '启用' : 'Enabled' }}</label>
      </fieldset>
      <section>
        <h3>{{ zh ? '绑定工具' : 'Bind tools' }} ({{ selected.length }}/50)</h3>
        <input v-model="query" type="search" :aria-label="zh ? '搜索工具' : 'Search tools'" :placeholder="zh ? '搜索工具' : 'Search tools'">
        <p v-if="loading" role="status">{{ zh ? '加载中' : 'Loading' }}</p>
        <label v-for="tool in rows" :key="tool.id" class="check">
          <input type="checkbox" :checked="selected.includes(tool.id)" :disabled="saving || (selected.length >= 50 && !selected.includes(tool.id))" @change="toggle(tool.id, ($event.target as HTMLInputElement).checked)">
          <span>{{ tool.name }} <small v-if="!tool.isActive">{{ zh ? '已停用' : 'Disabled' }}</small></span>
        </label>
        <CollectionPager :page="page" :total="total" :has-more="hasMore" :loading="loading || saving" :failed="failed" @page="tools.go" @retry="tools.load" />
      </section>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer><button type="button" :disabled="saving" @click="emit('close')">{{ zh ? '取消' : 'Cancel' }}</button><button type="submit" class="primary" :disabled="saving">{{ zh ? '保存' : 'Save' }}</button></footer>
    </form>
  </div>
</template>

<style scoped>
.create-mask { position: fixed; inset: 0; z-index: 80; background: rgba(15,23,42,.35); display: grid; place-items: center; padding: 16px; }
.create-dialog { width: min(620px, 100%); max-height: 90dvh; overflow: auto; padding: 20px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--r-md); box-shadow: var(--shadow-lg); display: grid; gap: 16px; }
header, footer { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
h2 { font-size: 18px; margin: 0; } h3 { font-size: 14px; }
fieldset { display: grid; gap: 12px; border: 0; padding: 0; margin: 0; min-width: 0; }
label { display: grid; gap: 6px; font-size: 13px; }
input:not([type=checkbox]), textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; color: inherit; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-sm); font: inherit; }
.check { display: flex; gap: 8px; align-items: center; min-height: 40px; overflow-wrap: anywhere; }
.check input { width: 18px; height: 18px; accent-color: var(--accent); flex-shrink: 0; }
button { min-height: 36px; padding: 6px 12px; background: var(--bg-card); color: inherit; border: 1px solid var(--border); border-radius: var(--r-sm); cursor: pointer; }
.primary { background: var(--grad-teal-indigo); color: white; } button:disabled { opacity: .5; } small { color: var(--text-tertiary); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
