<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { ProviderModelLimitsForm } from "./providerConfig";

const props = defineProps<{
  models: string[];
  modelLimits: Record<string, ProviderModelLimitsForm>;
}>();
const emit = defineEmits<{
  "update:modelLimits": [value: Record<string, ProviderModelLimitsForm>];
}>();
const { t } = useI18n();

function updateLimit(model: string, field: keyof ProviderModelLimitsForm, event: Event): void {
  const current = Object.hasOwn(props.modelLimits, model)
    ? props.modelLimits[model]!
    : { contextWindow: "", maxOutputTokens: "" };
  emit("update:modelLimits", {
    ...props.modelLimits,
    [model]: { ...current, [field]: (event.target as HTMLInputElement).value },
  });
}
</script>

<template>
  <fieldset v-if="models.length" class="model-limits">
    <legend>{{ t('provider.modelLimitsTitle') }}</legend>
    <p class="limits-help">{{ t('provider.modelLimitsHelp') }}</p>
    <div v-for="model in models" :key="model" class="model-limits-row" :data-model="model">
      <span class="limits-model">{{ model }}</span>
      <div class="limits-inputs">
        <label>
          <span>{{ t('provider.contextWindow') }}</span>
          <input
            type="number" min="1024" max="2097152" step="1" placeholder="32768"
            :value="modelLimits[model]?.contextWindow ?? ''"
            @input="updateLimit(model, 'contextWindow', $event)"
          />
        </label>
        <label>
          <span>{{ t('provider.maxOutputTokens') }}</span>
          <input
            type="number" min="1" max="262144" step="1" placeholder="4096"
            :value="modelLimits[model]?.maxOutputTokens ?? ''"
            @input="updateLimit(model, 'maxOutputTokens', $event)"
          />
        </label>
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.model-limits { min-width: 0; margin: 0; padding: 12px; border: 1px solid var(--border); border-radius: var(--r-sm); }
legend { padding: 0 4px; font-size: 12.5px; font-weight: 500; color: var(--text-secondary); }
.limits-help { margin: 0 0 12px; font-size: 12px; line-height: 1.6; color: var(--text-tertiary); }
.model-limits-row + .model-limits-row { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
.limits-model { display: block; overflow-wrap: anywhere; margin-bottom: 8px; font: 12px var(--font-mono); color: var(--text-primary); }
.limits-inputs { display: flex; flex-wrap: wrap; gap: 10px; }
label { min-width: 0; flex: 1 1 150px; display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-secondary); }
input { min-width: 0; width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg); color: var(--text-primary); font-family: var(--font-body); font-size: 13px; }
input:focus-visible { outline: 2px solid var(--teal-300); outline-offset: 1px; }
</style>
