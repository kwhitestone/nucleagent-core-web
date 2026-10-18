<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ImagePlus, X } from "@lucide/vue";
import { USER_AVATAR_CONTRACT, checkAvatarFile } from "../addons/conversation/api/userAvatar";

const props = withDefaults(defineProps<{
  modelValue?: File;
  current?: string;
  name?: string;
  disabled?: boolean;
  error?: string;
  id?: string;
}>(), { id: "agent-avatar" });
const emit = defineEmits<{ "update:modelValue": [file: File | undefined] }>();
const { t } = useI18n();
const preview = ref("");
const invalid = ref("");
const message = computed(() => invalid.value
  ? t(`agents.avatar_${invalid.value}`, { mb: USER_AVATAR_CONTRACT.maxBytes >> 20, side: USER_AVATAR_CONTRACT.maxSide })
  : props.error ?? "");
function release() {
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = "";
}
watch(() => props.modelValue, file => {
  release();
  if (file && typeof URL.createObjectURL === "function") preview.value = URL.createObjectURL(file);
}, { immediate: true });
onBeforeUnmount(release);
function pick(event: Event) {
  if (props.disabled) return;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  invalid.value = checkAvatarFile(file);
  if (!invalid.value) emit("update:modelValue", file);
}
function reset() {
  if (props.disabled) return;
  invalid.value = "";
  emit("update:modelValue", undefined);
}
</script>

<template>
  <div class="agent-avatar-picker" :data-testid="modelValue ? 'ua-avatar-picked' : 'ua-avatar-default'">
    <span class="avatar-image" aria-hidden="true">
      <img v-if="preview || current" :src="preview || current" alt="" referrerpolicy="no-referrer">
      <template v-else>{{ [...(name?.trim() || "?")][0] }}</template>
    </span>
    <label class="avatar-pick" :for="id" :aria-disabled="disabled">
      <ImagePlus :size="18" aria-hidden="true" />
      <span>{{ modelValue ? modelValue.name : t("agents.mine.avatarPick") }}</span>
      <input :id="id" type="file" :disabled="disabled" :accept="USER_AVATAR_CONTRACT.types.join(',')"
        data-testid="ua-avatar-input" :aria-label="t('agents.mine.avatar')" :aria-invalid="!!message"
        :aria-describedby="`${id}-error`" @change="pick">
    </label>
    <button v-if="modelValue" type="button" :disabled="disabled" :title="t('agents.mine.cancel')"
      :aria-label="t('agents.mine.cancel')" @click="reset"><X :size="16" /></button>
    <p v-if="message" :id="`${id}-error`" class="avatar-error" role="alert">{{ message }}</p>
  </div>
</template>

<style scoped>
.agent-avatar-picker { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.avatar-image { display: grid; place-items: center; width: 40px; height: 40px; flex: 0 0 40px; overflow: hidden; border-radius: 6px; background: var(--bg-subtle); color: var(--text-primary); }
.avatar-image img { width: 100%; height: 100%; object-fit: cover; }
.avatar-pick { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; min-height: 44px; position: relative; cursor: pointer; color: var(--text-secondary); font-size: 13px; }
.avatar-pick span { overflow-wrap: anywhere; }
.avatar-pick svg { flex-shrink: 0; }
.avatar-pick input { position: absolute; width: 1px; height: 1px; padding: 0; opacity: 0; }
.avatar-pick:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.avatar-pick[aria-disabled=true] { opacity: .5; cursor: not-allowed; }
button { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 36px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-secondary); cursor: pointer; }
.avatar-error { width: 100%; margin: 0; color: var(--rose-500); font-size: 12px; overflow-wrap: anywhere; }
</style>
