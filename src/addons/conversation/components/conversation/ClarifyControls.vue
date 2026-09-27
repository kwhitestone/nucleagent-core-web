<script setup lang="ts">
/**
 * clarify 气泡内交互区（问题正文由气泡主体渲染，这里只有选项 + 输入）。
 * pending 与否由 item.data.interactionStatus 驱动；回答经 emit → MessageItem
 * → 组件 forwardInteraction → adapter interaction.respond。
 */
import { computed, ref } from "vue";
import type { ConversationItem } from "@/addons/conversation/task-conversation/core";

const props = defineProps<{ item: ConversationItem; interactionSubmitting?: boolean }>();
const emit = defineEmits<{ respond: [value: unknown] }>();

const pending = computed(
  () =>
    props.item.data?.interactionStatus === "pending" ||
    props.item.data?.planStatus === "pending",
);

const choices = computed(() => {
  const raw = props.item.data?.choices;
  return Array.isArray(raw) ? (raw as unknown[]).filter((c): c is string => typeof c === "string") : [];
});

const custom = ref("");

function pick(v: string): void {
  if (!pending.value || props.interactionSubmitting) return;
  emit("respond", v);
}
function submit(): void {
  const v = custom.value.trim();
  if (!v || !pending.value || props.interactionSubmitting) return;
  emit("respond", v);
}
</script>

<template>
  <div v-if="pending" class="cc">
    <div v-if="choices.length" class="cc-choices">
      <button v-for="c in choices" :key="c" type="button" class="cc-ch" :disabled="interactionSubmitting" @click="pick(c)">{{ c }}</button>
    </div>
    <div v-if="choices.length" class="cc-or">或</div>
    <div class="cc-row">
      <input v-model="custom" type="text" :placeholder="choices.length ? '输入其它回答…' : '输入你的回答…'" :disabled="interactionSubmitting" @keydown.enter.prevent="submit">
      <button type="button" class="cc-send" :disabled="!custom.trim() || interactionSubmitting" @click="submit">发送</button>
    </div>
  </div>
  <p v-else class="cc-done">✓ 已确认</p>
</template>

<style scoped>
.cc { margin-top: 10px; }
.cc-choices { display: flex; flex-wrap: wrap; gap: 7px; }
.cc-ch {
  padding: 6px 13px; border: 1px solid var(--border); border-radius: var(--r-full);
  background: var(--bg); color: var(--text-primary);
  font-size: 12.5px; cursor: pointer; transition: all 0.15s ease;
}
.cc-ch:hover:not(:disabled) { border-color: var(--indigo-500); color: var(--indigo-600); }
.cc-ch:disabled { opacity: 0.55; cursor: default; }
.cc-or { font-size: 11px; color: var(--text-tertiary); text-align: center; margin: 7px 0; }
.cc-row { display: flex; gap: 7px; }
.cc-row input {
  flex: 1; min-width: 0; padding: 7px 12px;
  border: 1px solid var(--border); border-radius: var(--r-full);
  font-size: 12.5px; color: var(--text-primary); outline: none; background: var(--bg);
}
.cc-row input:focus { border-color: var(--teal-300); }
.cc-send {
  padding: 7px 15px; border: none; border-radius: var(--r-full);
  background: var(--grad-brand); color: #fff; font-size: 12.5px; font-weight: 600; cursor: pointer;
}
.cc-send:disabled { opacity: 0.45; cursor: default; }
.cc-done { font-size: 12px; color: var(--text-tertiary); margin: 6px 0 0; }
/* Below 1024px (board §13 ④): full-width 52px choices; 「其他回答」 is the bottom composer. */
@media (max-width: 1023.98px) {
  .cc-choices { flex-direction: column; }
  .cc-ch { width: 100%; min-height: 52px; border-radius: var(--r-lg); font-size: 15px; text-align: left; padding: 0 16px; }
  .cc-or, .cc-row { display: none; }
}
</style>
