<script setup lang="ts">
/**
 * UI-IMPL-3 §3.1① / UI-IMPL-6 §3.3: the composer's 「＋」 entries (one per
 * enabled registry kind) and, when on, the parameter strip generated from the
 * kind's declared params. The server validates; this is UX only.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { listMediaModels } from "@/addons/conversation/api/media";
import type { MediaModel } from "@/addons/conversation/composables/generation";
import { MEDIA_KINDS, defaultParams, enabledKinds, pickModel, type GenKind, type GenParams } from "@/addons/conversation/registry";

const props = defineProps<{
  locked?: boolean;
  /** Restrict the entries (e.g. a carrier chat is image-only). */
  only?: GenKind;
  /** Agent defaults (`config.defaults.<kind>Model`); missing/unlisted → first model, as before. */
  preferred?: Partial<Record<GenKind, string>>;
}>();
const on = defineModel<boolean>("on", { required: true });
const kind = defineModel<GenKind>("kind", { default: "image" });
const params = defineModel<GenParams>("params", { required: true });
const model = defineModel<MediaModel | null>("model", { required: true });
const { t } = useI18n();

const entries = computed(() => enabledKinds().filter((k) => !props.only || k.kind === props.only));
const models = ref<Partial<Record<GenKind, MediaModel[]>>>({});
const loaded = ref(false);
const list = computed(() => models.value[kind.value] ?? []);
const decls = computed(() => MEDIA_KINDS[kind.value].params.filter((p) => p.values.length > 1));
const agentDefault = ref(false);

function choose(): void {
  const pick = pickModel(list.value, props.preferred?.[kind.value]);
  model.value = pick.model;
  agentDefault.value = pick.agentDefault;
}
const empty = (k: GenKind): boolean => loaded.value && !(models.value[k]?.length);

function enter(k: GenKind): void {
  if (empty(k)) return;
  if (kind.value !== k) {
    kind.value = k;
    params.value = defaultParams(k);
  }
  on.value = true;
}

onMounted(async () => {
  const lists = await Promise.all(entries.value.map((k) => listMediaModels(k.kind as GenKind).catch(() => [])));
  models.value = Object.fromEntries(entries.value.map((k, i) => [k.kind, lists[i]]));
  loaded.value = true;
  if (!model.value || model.value.kind !== kind.value) choose();
});
watch(kind, () => { if (loaded.value) choose(); });
watch(() => props.preferred, () => { if (loaded.value && (!model.value || !agentDefault.value)) choose(); });
watch(model, (m) => { agentDefault.value = !!m && m.model === props.preferred?.[kind.value]; });

const optionText = (key: string, v: string): string => (key === "duration" ? t("chatGen.durationN", { n: v }) : v);
</script>

<template>
  <div class="cg-bar" data-testid="chat-gen-bar">
    <template v-if="!on">
      <button
        v-for="k in entries"
        :key="k.kind"
        type="button"
        class="cg-chip"
        :disabled="empty(k.kind as GenKind)"
        :title="empty(k.kind as GenKind) ? t('chatGen.noKindModels') : undefined"
        :data-testid="k.kind === 'image' ? 'chat-gen-toggle' : `chat-gen-toggle-${k.kind}`"
        @click="enter(k.kind as GenKind)"
      >＋ {{ t(`chatGen.kinds.${k.kind}`) }}<span v-if="empty(k.kind as GenKind)" class="cg-none">· {{ t("chatGen.noKindModels") }}</span></button>
    </template>
    <template v-else>
      <span class="cg-chip cg-chip--on" data-testid="chat-gen-mode">
        {{ t(`chatGen.kinds.${kind}`) }}
        <button v-if="!locked" type="button" class="cg-x" :aria-label="t('chatGen.modeOff')" data-testid="chat-gen-off" @click="on = false">×</button>
      </span>
      <label v-for="p in decls" :key="`${kind}-${p.key}`" class="cg-field">{{ t(`chatGen.param.${p.key}`) }}
        <select v-model="params[p.key]" :data-testid="`chat-gen-${p.key}`">
          <option v-for="v in p.values" :key="v" :value="v">{{ optionText(p.key, v) }}</option>
        </select>
      </label>
      <label class="cg-field">{{ t("chatGen.model") }}
        <select v-model="model" data-testid="chat-gen-model">
          <option v-if="!list.length" :value="null" disabled>{{ t("chatGen.noModels") }}</option>
          <option v-for="m in list" :key="`${m.providerId}/${m.model}`" :value="m">{{ m.model }}</option>
        </select>
      </label>
      <span v-if="agentDefault" class="cg-tag" data-testid="chat-gen-agent-default">{{ t("chatGen.agentDefault") }}</span>
      <span class="cg-cost" data-testid="chat-gen-cost">{{ t("chatGen.costByLedger") }}</span>
    </template>
  </div>
</template>

<style scoped>
.cg-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; flex: 1 1 auto; min-width: 0; max-width: 100%; }
.cg-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-secondary); cursor: pointer; animation: fade-in 0.2s var(--ease-out) both; }
.cg-chip:disabled { cursor: not-allowed; opacity: 0.55; }
.cg-chip--on { border-color: var(--atc-accent, #6366f1); color: var(--atc-accent, #6366f1); cursor: default; }
.cg-none { color: var(--text-tertiary, var(--text-secondary)); }
.cg-x { border: 0; background: none; color: inherit; cursor: pointer; font-size: 14px; line-height: 1; }
.cg-field { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); min-width: 0; max-width: 100%; }
.cg-field select { font-size: 12px; border: 1px solid var(--border); border-radius: var(--r-sm, 6px); background: var(--bg-card); color: var(--text-primary); padding: 2px 4px; min-width: 0; max-width: 100%; text-overflow: ellipsis; }
.cg-tag { padding: 0 6px; border-radius: 999px; background: var(--bg-subtle); color: var(--text-secondary); }
.cg-cost { color: var(--text-tertiary, var(--text-secondary)); }
/* ⑧ 390-wide screens: long model ids must not push the bar past the viewport. */
@media (max-width: 600px) {
  .cg-field select[data-testid="chat-gen-model"] { max-width: 150px; }
  .cg-cost { flex-basis: 100%; }
}
</style>
