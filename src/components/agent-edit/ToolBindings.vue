<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Pencil } from "@lucide/vue";
import { ToolBindings as BindingList } from "@prism-fusion/editor-ui";
import { useResourceOptions } from "@/composables/useResourceOptions";
import { coveredBySkills, toolLabel, toolUnavailable, type ToolCatalogItem } from "@/addons/conversation/api/toolCatalog";
import CollectionPager from "@/components/CollectionPager.vue";
const props = withDefaults(defineProps<{
  rows: { id: number; name: string; missing: boolean; covered: boolean }[];
  selected: number[];
  editable: boolean;
  coveredLabel: string;
  unavailableLabel: string;
  omitCovered?: boolean;
  skillIds?: number[];
  manageable?: boolean;
  editLabel?: string;
}>(), { omitCovered: false, skillIds: () => [] });
const emit = defineEmits<{ toggle: [id: number, checked: boolean]; edit: [id: number]; metadata: [rows: ToolCatalogItem[]]; ready: [value: boolean] }>();
const { t, te, locale } = useI18n();
const reasonText = (reason: string) => (te(`common.toolReason.${reason}`) ? t(`common.toolReason.${reason}`) : reason);
const { rows: candidates, known, hydratedLoaded, query, page, total, hasMore, loading, failed, go, load, filter } =
  useResourceOptions<ToolCatalogItem>("/api/v1/addons/tool/catalog", () => props.selected);
const selectedOnly = ref(false);
// Unavailable rows (held/conflict/...) render as `missing`: unavailable label, not tickable (an existing pick can still be unticked).
const visible = computed(() => candidates.value.map(row => {
  const off = toolUnavailable(row);
  return { id: row.id, name: off && row.reason ? `${toolLabel(row, locale.value)} · ${reasonText(row.reason)}` : toolLabel(row, locale.value),
    missing: off, covered: coveredBySkills(row, props.skillIds) };
}));
const unavailable = computed(() => hydratedLoaded.value ? props.selected.filter(id => !known.value.some(row => row.id === id)) : []);
watch(known, rows => emit("metadata", rows), { immediate: true });
watch(hydratedLoaded, ready => emit("ready", ready), { immediate: true });
function toggle(id: number, checked: boolean) {
  emit("metadata", known.value); emit("toggle", id, checked);
}
function selectOnly(value: boolean) {
  selectedOnly.value = value;
  filter({ search: query.value, group: value ? "__selected" : "" });
}
defineExpose({ refresh: load });
</script>

<template>
  <BindingList @focusin.stop @pointerdown.stop @pointercancel.stop @mousedown.stop @touchstart.stop @touchcancel.stop @click.stop :rows="visible" :selected="selected" :unavailable="unavailable" :editable="editable"
    :manageable="manageable" :omit-covered="omitCovered" v-model:query="query" :selected-only="selectedOnly"
    :search-label="t('common.toolSearch')" :selected-label="t('common.skillGroupSelected')" :edit-label="editLabel ?? ''"
    :covered-label="coveredLabel" :unavailable-label="unavailableLabel"
    @update:selected-only="selectOnly" @toggle="toggle" @edit="manageable && emit('edit', $event)">
    <template #edit-icon><Pencil :size="16" /></template>
    <template #pager><CollectionPager :page="page" :total="total" :has-more="hasMore" :loading="loading" :failed="failed" @page="go" @retry="load" /></template>
  </BindingList>
</template>
