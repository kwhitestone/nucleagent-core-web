<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Save, RotateCw, X } from "@lucide/vue";
import { getPlatformRuntime } from "@/contracts/platform-runtime";
import { useRemotePage } from "@/composables/useRemotePage";
import CollectionPager from "@/components/CollectionPager.vue";
import { resourcePage } from "@/api/resourcePage";

const props = defineProps<{ kind: "skill" | "tool"; id: number; revision?: string }>();
const emit = defineEmits<{ changed: [] }>();
const { locale } = useI18n();
const zh = computed(() => locale.value.startsWith("zh"));
const mode = ref<"yes" | "no">("yes");
const draft = ref(new Map<number, boolean>());
const saving = ref(false);
const error = ref("");
const etag = ref("");
let writeController: AbortController | undefined;
let epoch = 0;
watch(() => [props.kind, props.id, props.revision], () => {
  etag.value = `"${props.kind}-${props.id}-${props.revision}"`;
}, { immediate: true });
const collection = useRemotePage<{ id: number; name: string; isActive: boolean }>((params, signal) =>
  resourcePage(props.kind === "skill" ? "/api/v1/addons/tool" : "/api/v1/addons/admin/skill",
    { ...params, [props.kind === "skill" ? "skillId" : "toolId"]: props.id, bound: mode.value }, signal));
const { rows, query, page, total, hasMore, loading, failed } = collection;
function checked(id: number) { return draft.value.get(id) ?? mode.value === "yes"; }
function toggle(id: number, value: boolean) {
  const next = new Map(draft.value);
  if (value === (mode.value === "yes")) next.delete(id);
  else next.set(id, value);
  draft.value = next;
}
function discard() { draft.value = new Map(); error.value = ""; }
watch(mode, () => { collection.reset(); void collection.load(); });
watch(() => [props.kind, props.id], () => {
  epoch++;
  writeController?.abort();
  saving.value = false;
  draft.value = new Map();
  error.value = "";
  mode.value = "yes";
  query.value = "";
  collection.reset();
  void collection.load();
});
async function save() {
  if (saving.value || !draft.value.size) return;
  const ticket = epoch;
  writeController = new AbortController();
  saving.value = true;
  error.value = "";
  try {
    const response = await getPlatformRuntime().http.patch(`/api/v1/addons/admin/${props.kind}/${props.id}/${props.kind === "skill" ? "tools" : "skills"}`, {
      add: [...draft.value].filter(([, add]) => add).map(([id]) => id),
      remove: [...draft.value].filter(([, add]) => !add).map(([id]) => id),
    }, { headers: { "If-Match": etag.value }, signal: writeController.signal });
    if (ticket !== epoch) return;
    if (typeof response.headers?.etag === "string") etag.value = response.headers.etag;
    draft.value = new Map();
    emit("changed");
    await collection.load();
  } catch {
    if (ticket === epoch) error.value = zh.value ? "保存失败，选择已保留。版本冲突请重新加载。" : "Save failed. Selections retained. Reload on version conflict.";
  } finally {
    if (ticket === epoch) saving.value = false;
  }
}
async function reload() {
  const ticket = epoch;
  writeController = new AbortController();
  saving.value = true;
  error.value = "";
  try {
    const result = await resourcePage<{ revision: string }>(
      props.kind === "skill" ? "/api/v1/addons/admin/skill" : "/api/v1/addons/tool",
      { page: 1, pageSize: 1, search: "", ids: [props.id] }, writeController.signal);
    if (ticket !== epoch) return;
    if (!result.data[0]?.revision) throw new Error("Resource unavailable");
    etag.value = `"${props.kind}-${props.id}-${result.data[0].revision}"`;
    emit("changed");
    await collection.load();
  } catch {
    if (ticket === epoch) error.value = zh.value ? "重新加载失败，选择已保留。" : "Reload failed. Selections retained.";
  } finally {
    if (ticket === epoch) saving.value = false;
  }
}
onMounted(collection.load);
onBeforeUnmount(() => { epoch++; writeController?.abort(); });
</script>

<template>
  <section class="relations" :aria-label="kind === 'skill' ? (zh ? '绑定工具' : 'Bound tools') : (zh ? '引用技能' : 'Referencing skills')">
    <div class="relation-toolbar">
      <div role="group">
        <button type="button" :aria-pressed="mode === 'yes'" :disabled="saving" @click="mode = 'yes'">{{ zh ? '已绑定' : 'Bound' }}</button>
        <button type="button" :aria-pressed="mode === 'no'" :disabled="saving" @click="mode = 'no'">{{ zh ? '可绑定' : 'Available' }}</button>
      </div>
      <input v-model="query" type="search" :aria-label="zh ? '搜索关系' : 'Search relationships'" :placeholder="zh ? '搜索' : 'Search'" :disabled="saving">
      <span role="status">{{ zh ? '待保存' : 'Pending' }} {{ draft.size }}</span>
      <button type="button" :disabled="saving || !draft.size || draft.size > 50" :title="zh ? '保存' : 'Save'" :aria-label="zh ? '保存' : 'Save'" @click="save"><Save :size="16" /></button>
      <button v-if="draft.size" type="button" :disabled="saving" :title="zh ? '取消更改' : 'Discard changes'" :aria-label="zh ? '取消更改' : 'Discard changes'" @click="discard"><X :size="16" /></button>
      <button type="button" :disabled="saving" :title="zh ? '重新加载' : 'Reload'" :aria-label="zh ? '重新加载' : 'Reload'" @click="reload"><RotateCw :size="16" /></button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="draft.size > 50" role="alert">{{ zh ? '单次最多修改 50 项' : 'Maximum 50 changes per save' }}</p>
    <p v-if="loading" role="status">{{ zh ? '加载中' : 'Loading' }}</p>
    <ul v-else>
      <li v-for="row in rows" :key="row.id">
        <label><input type="checkbox" :checked="checked(row.id)" :disabled="saving" @change="toggle(row.id, ($event.target as HTMLInputElement).checked)">
          <span>{{ row.name }} <small v-if="!row.isActive">{{ zh ? '已停用' : 'Disabled' }}</small></span>
        </label>
      </li>
    </ul>
    <p v-if="!loading && !failed && !rows.length">{{ zh ? '暂无结果' : 'No results' }}</p>
    <CollectionPager :page="page" :total="total" :has-more="hasMore" :loading="loading || saving" :failed="failed" @page="collection.go" @retry="collection.load" />
  </section>
</template>

<style scoped>
.relations { width: 100%; border-top: 1px solid var(--border); padding-top: 12px; color: var(--text-primary); font-size: 13px; }
.relation-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.relation-toolbar > input { min-width: 120px; flex: 1; }
button, input[type=search] { min-height: 36px; padding: 6px 10px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-sm); color: inherit; }
button { cursor: pointer; } button[aria-pressed=true] { border-color: var(--accent); color: var(--accent); }
button:disabled { opacity: .5; }
ul { list-style: none; padding: 0; margin: 8px 0; }
label { display: flex; gap: 10px; align-items: center; min-height: 44px; }
label span { overflow-wrap: anywhere; min-width: 0; } small { color: var(--text-tertiary); }
input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--accent); flex-shrink: 0; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
