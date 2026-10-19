<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useResourceOptions } from "@/composables/useResourceOptions";
import { coveredBySkills, toolLabel, type ToolCatalogItem } from "@/addons/conversation/api/toolCatalog";
import CollectionPager from "@/components/CollectionPager.vue";
const props = withDefaults(defineProps<{
  rows: { id: number; name: string; missing: boolean; covered: boolean }[];
  selected: number[];
  editable: boolean;
  coveredLabel: string;
  unavailableLabel: string;
  omitCovered?: boolean;
  skillIds?: number[];
}>(), { omitCovered: false, skillIds: () => [] });
const emit = defineEmits<{ toggle: [id: number, checked: boolean]; metadata: [rows: ToolCatalogItem[]]; ready: [value: boolean] }>();
const { t, locale } = useI18n();
const { rows: candidates, known, hydratedLoaded, query, page, total, hasMore, loading, failed, go, load, filter } =
  useResourceOptions<ToolCatalogItem>("/api/v1/addons/tool/catalog", () => props.selected);
const selectedOnly = ref(false);
const visible = computed(() => candidates.value.map(row => ({ id: row.id, name: toolLabel(row, locale.value),
  missing: false, covered: coveredBySkills(row, props.skillIds) })));
const unavailable = computed(() => hydratedLoaded.value ? props.selected.filter(id => !known.value.some(row => row.id === id)) : []);
watch(known, rows => emit("metadata", rows), { immediate: true });
watch(hydratedLoaded, ready => emit("ready", ready), { immediate: true });
const checked = (id: number, covered: boolean) => props.selected.includes(id) && !(props.omitCovered && covered);
const disabled = (row: typeof props.rows[number]) => !props.editable
  || (props.omitCovered && row.covered) || ((row.covered || row.missing || props.selected.length >= 50) && !props.selected.includes(row.id));
function toggle(row: typeof props.rows[number], event: Event) {
  if (!disabled(row)) { emit("metadata", known.value); emit("toggle", row.id, (event.target as HTMLInputElement).checked); }
}
</script>

<template>
  <label class="tool-search"><input v-model="query" type="search" :aria-label="t('common.toolSearch')" :placeholder="t('common.toolSearch')" /></label>
  <label><input v-model="selectedOnly" type="checkbox" @change="filter({ search: query, group: selectedOnly ? '__selected' : '' })" />{{ t('common.skillGroupSelected') }}</label>
  <ul class="tool-bindings">
    <li v-for="row in visible" :key="row.id">
      <label>
        <input type="checkbox" :checked="checked(row.id, row.covered)" :disabled="disabled(row)" @change="toggle(row, $event)">
        <span>{{ row.name }} <small v-if="row.missing">{{ unavailableLabel }}</small><small v-else-if="row.covered">{{ coveredLabel }}</small></span>
      </label>
    </li>
  </ul>
  <div v-if="unavailable.length" class="tool-missing">
    <label v-for="id in unavailable" :key="id"><input type="checkbox" checked :disabled="!editable" @change="editable && emit('toggle', id, false)" />#{{ id }}</label>
  </div>
  <CollectionPager :page="page" :total="total" :has-more="hasMore" :loading="loading" :failed="failed" @page="go" @retry="load" />
</template>

<style scoped>
.tool-bindings { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
label { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 13px; cursor: pointer; }
input { width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--accent); }
.tool-search input { width: 100%; height: 40px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); color: var(--text-primary); }
.tool-missing { display: flex; flex-wrap: wrap; gap: 12px; }
span { min-width: 0; overflow-wrap: anywhere; }
small { color: var(--text-secondary); font-size: 12px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
