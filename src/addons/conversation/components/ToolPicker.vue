<script setup lang="ts">
/**
 * PLACEHOLDER — not mounted anywhere, not released (see api/toolCatalog.ts).
 * Data comes in via props so no request is made until L6 ships the catalog
 * endpoint; then TaskSetup loads it the way SkillPicker loads skills.
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toolOptions, type ToolCatalogItem } from "@/addons/conversation/api/toolCatalog";
import OptionSheet from "./OptionSheet.vue";

const props = withDefaults(defineProps<{ modelValue: number[]; tools: ToolCatalogItem[]; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ "update:modelValue": [value: number[]] }>();
const { t, locale } = useI18n();
const open = ref(false);
const options = computed(() => toolOptions(props.tools, locale.value, t("common.skillBadgeImported")));
</script>

<template>
  <button type="button" class="skill-toggle" :disabled="disabled" aria-haspopup="dialog" @click="open = true">Tools ({{ modelValue.length }})</button>
  <OptionSheet
    :open="open"
    title="Tools"
    :options="options"
    :model-value="modelValue.map(String)"
    multiple
    searchable
    @update:model-value="(v) => emit('update:modelValue', [v].flat().map(Number))"
    @close="open = false"
  />
</template>
