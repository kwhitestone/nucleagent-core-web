<script setup lang="ts">
const props = withDefaults(defineProps<{
  rows: { id: number; name: string; missing: boolean; covered: boolean }[];
  selected: number[];
  editable: boolean;
  coveredLabel: string;
  unavailableLabel: string;
  omitCovered?: boolean;
}>(), { omitCovered: false });
const emit = defineEmits<{ toggle: [id: number, checked: boolean] }>();
const checked = (id: number, covered: boolean) => props.selected.includes(id) && !(props.omitCovered && covered);
const disabled = (row: typeof props.rows[number]) => !props.editable
  || (props.omitCovered && row.covered) || ((row.covered || row.missing) && !props.selected.includes(row.id));
function toggle(row: typeof props.rows[number], event: Event) {
  if (!disabled(row)) emit("toggle", row.id, (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <ul class="tool-bindings">
    <li v-for="row in rows" :key="row.id">
      <label>
        <input type="checkbox" :checked="checked(row.id, row.covered)" :disabled="disabled(row)" @change="toggle(row, $event)">
        <span>{{ row.name }} <small v-if="row.missing">{{ unavailableLabel }}</small><small v-else-if="row.covered">{{ coveredLabel }}</small></span>
      </label>
    </li>
  </ul>
</template>

<style scoped>
.tool-bindings { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
label { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 13px; cursor: pointer; }
input { width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--accent); }
span { min-width: 0; overflow-wrap: anywhere; }
small { color: var(--text-secondary); font-size: 12px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
