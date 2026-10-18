<script setup lang="ts">
import { watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSessionBindings } from "../composables/useSessionBindings";
import BindingPickers from "./BindingPickers.vue";

const props = defineProps<{ id: string; disabled?: boolean; row?: boolean; state?: ReturnType<typeof useSessionBindings> }>();
const emit = defineEmits<{ pending: [pending: boolean] }>();
const { t } = useI18n();
const { skillIds, toolIds, tools, toolsLoading, toolsFailed, loadTools, saved, loading, saving, error, dirty, pending, load, save, discard } =
  props.state ?? useSessionBindings(() => props.id, () => !!props.disabled);
watch(pending, (value) => emit("pending", value), { immediate: true });
</script>

<template>
  <section v-if="loading || error || saved?.editable" class="session-bindings" data-testid="session-bindings" :aria-busy="loading || saving">
    <span v-if="loading">{{ t('common.loading') }}</span>
    <BindingPickers v-if="saved?.editable" v-model:skill-ids="skillIds" v-model:tool-ids="toolIds" :tools="tools"
      :loading="toolsLoading" :failed="toolsFailed" :disabled="disabled || saving" :row="row" @retry="loadTools" />
    <p v-if="error" role="alert" class="session-bindings-error">{{ error }}</p>
    <div class="conversation-settings-actions">
      <button v-if="!saved && error" type="button" @click="load">{{ t('common.retry') }}</button>
      <template v-if="dirty">
        <button type="button" :disabled="disabled || saving" data-testid="bindings-save" @click="save">{{ t(saving ? 'common.applying' : 'common.applySettings') }}</button>
        <button type="button" :disabled="saving" data-testid="bindings-discard" @click="discard">{{ t('common.discardSettings') }}</button>
      </template>
    </div>
  </section>
</template>

<style>
.session-bindings { flex: none; min-width: 0; padding: 4px 12px; border-top: 1px solid var(--border); font-size: 13px; }
.session-bindings-error { color: var(--rose-500); margin: 4px 0; }
.session-bindings .conversation-settings-actions { flex-wrap: wrap; }
</style>
