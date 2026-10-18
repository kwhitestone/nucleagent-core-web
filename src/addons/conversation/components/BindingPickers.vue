<script setup lang="ts">
import SkillPicker from "./SkillPicker.vue";
import ToolPicker from "./ToolPicker.vue";
import type { ToolCatalogItem } from "../api/toolCatalog";

defineProps<{
  skillIds: number[];
  toolIds: number[];
  tools: ToolCatalogItem[];
  loading?: boolean;
  failed?: boolean;
  disabled?: boolean;
  row?: boolean;
}>();
const emit = defineEmits<{
  "update:skillIds": [ids: number[]];
  "update:toolIds": [ids: number[]];
  retry: [];
}>();
</script>

<template>
  <div class="binding-pickers" :class="{ 'binding-pickers--row': row }" data-testid="binding-pickers">
    <div class="binding-picker">
      <SkillPicker :model-value="skillIds" :disabled="disabled" :row="row" @update:model-value="emit('update:skillIds', $event)" />
    </div>
    <div class="binding-picker">
      <ToolPicker :model-value="toolIds" :tools="tools" :skill-ids="skillIds" :loading="loading" :failed="failed"
        :disabled="disabled" :row="row" @update:model-value="emit('update:toolIds', $event)" @retry="emit('retry')" />
    </div>
  </div>
</template>

<style>
.binding-pickers { display: flex; flex-wrap: wrap; gap: 8px 16px; min-width: 0; text-align: left; padding: 4px 8px; }
.binding-picker { min-width: 0; max-width: 100%; }
.binding-pickers .skill-chip, .binding-pickers .tool-chip { max-width: min(260px, 100%); }
.binding-pickers--row { display: block; padding: 0; }
.binding-limit { margin: 4px 8px; font-size: 12px; color: var(--text-secondary); }
</style>
