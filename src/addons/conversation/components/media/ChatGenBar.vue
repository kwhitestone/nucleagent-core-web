<script setup lang="ts">
/** UI-IMPL-3 §3.1①: 「＋ 生成图片」 mode chip and, when on, the parameter strip. */
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { listMediaModels } from "@/addons/conversation/api/media";
import type { MediaModel } from "@/addons/conversation/composables/generation";
import { ASPECTS, COUNTS, type Aspect } from "@/addons/conversation/composables/chatGeneration";

defineProps<{ locked?: boolean }>();
const on = defineModel<boolean>("on", { required: true });
const aspect = defineModel<Aspect>("aspect", { required: true });
const count = defineModel<number>("count", { required: true });
const model = defineModel<MediaModel | null>("model", { required: true });
const { t } = useI18n();
const models = ref<MediaModel[]>([]);

onMounted(async () => {
  models.value = await listMediaModels("image").catch(() => []);
  if (!model.value) model.value = models.value[0] ?? null;
});
</script>

<template>
  <div class="cg-bar" data-testid="chat-gen-bar">
    <button v-if="!on" type="button" class="cg-chip" data-testid="chat-gen-toggle" @click="on = true">＋ {{ t("chatGen.mode") }}</button>
    <template v-else>
      <span class="cg-chip cg-chip--on" data-testid="chat-gen-mode">
        {{ t("chatGen.mode") }}
        <button v-if="!locked" type="button" class="cg-x" :aria-label="t('chatGen.modeOff')" data-testid="chat-gen-off" @click="on = false">×</button>
      </span>
      <label class="cg-field">{{ t("chatGen.aspect") }}
        <select v-model="aspect" data-testid="chat-gen-aspect"><option v-for="a in ASPECTS" :key="a" :value="a">{{ a }}</option></select>
      </label>
      <label class="cg-field">{{ t("chatGen.count") }}
        <select v-model.number="count" data-testid="chat-gen-count"><option v-for="n in COUNTS" :key="n" :value="n">{{ n }}</option></select>
      </label>
      <label class="cg-field">{{ t("chatGen.model") }}
        <select v-model="model" data-testid="chat-gen-model">
          <option v-if="!models.length" :value="null" disabled>{{ t("chatGen.noModels") }}</option>
          <option v-for="m in models" :key="`${m.providerId}/${m.model}`" :value="m">{{ m.model }}</option>
        </select>
      </label>
      <span class="cg-cost" data-testid="chat-gen-cost">{{ t("chatGen.costByLedger") }}</span>
    </template>
  </div>
</template>

<style scoped>
.cg-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; }
.cg-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-secondary); cursor: pointer; animation: fade-in 0.2s var(--ease-out) both; }
.cg-chip--on { border-color: var(--atc-accent, #6366f1); color: var(--atc-accent, #6366f1); cursor: default; }
.cg-x { border: 0; background: none; color: inherit; cursor: pointer; font-size: 14px; line-height: 1; }
.cg-field { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); }
.cg-field select { font-size: 12px; border: 1px solid var(--border); border-radius: var(--r-sm, 6px); background: var(--bg-card); color: var(--text-primary); padding: 2px 4px; }
.cg-cost { color: var(--text-tertiary, var(--text-secondary)); }
</style>
