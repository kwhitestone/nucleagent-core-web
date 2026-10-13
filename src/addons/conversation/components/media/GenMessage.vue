<script setup lang="ts">
/**
 * UI-IMPL-3: a media message in an ordinary conversation (data.media).
 * user (taskIds) → pending card while any task of the batch runs;
 * result → the batch grid on its first succeeded task, nothing on the rest;
 * error → GenErrorCard.
 */
import { computed, inject } from "vue";
import type { ConversationItem } from "@/addons/conversation/task-conversation/core";
import type { GenerationTask } from "@/addons/conversation/composables/generation";
import { isPending } from "@/addons/conversation/composables/generation";
import { mediaOf, promptOf, saveImage, type Aspect } from "@/addons/conversation/composables/chatGeneration";
import GenPendingCard from "./GenPendingCard.vue";
import GenResultCard, { type GenResultItem } from "./GenResultCard.vue";
import GenErrorCard from "./GenErrorCard.vue";

export interface ChatGenHost {
  tasks: ReadonlyMap<number, GenerationTask>;
  groups: ReadonlyMap<number, number[]>;
  cancel(ids: number[]): void;
  regenerate(prompt: string, aspect: string, count: number): void;
  refine(item: GenResultItem, prompt: string): void;
}
const props = defineProps<{ item: ConversationItem }>();
// Provided by Conversation.vue (renderers only receive the item).
const host = inject<ChatGenHost>("chatGen")!;

const media = computed(() => mediaOf(props.item.data));
const ids = computed(() => media.value?.taskIds ?? host.groups.get(media.value?.taskId ?? -1) ?? []);
const batchTasks = computed(() => ids.value.map((id) => host.tasks.get(id)).filter((x): x is GenerationTask => !!x));
const pending = computed(() => batchTasks.value.filter((x) => isPending(x.status)));
const ORDER = ["queued", "submitting", "running", "ingesting"] as const;
const stage = computed(() => ORDER[Math.max(...pending.value.map((x) => ORDER.indexOf(x.status as (typeof ORDER)[number])), 0)]);
const startedAt = computed(() => Math.min(...pending.value.map((x) => Date.parse(x.createdAt)).filter(Number.isFinite), Date.now()));

const done = computed(() => batchTasks.value.filter((x) => x.status === "succeeded" && x.downloadUrl));
const lead = computed(() => props.item.role !== "user" && done.value[0]?.id === media.value?.taskId);
const results = computed<GenResultItem[]>(() => done.value.map((x) => ({ url: x.downloadUrl!, name: x.file?.name ?? `image-${x.id}.png` })));
const isError = computed(() => props.item.lane === "system" || typeof props.item.data?.errorCode === "string");
const errCode = computed(() => {
  const c = String(props.item.data?.errorCode ?? "failed");
  if (c === "upstream_timeout") return "timeout";
  return ["content_rejected", "insufficient_balance", "media_busy", "cancelled"].includes(c) ? c : "failed";
});
const prompt = computed(() => promptOf(props.item.content ?? "") || batchTasks.value[0]?.prompt || "");

function download(item: GenResultItem): void {
  void saveImage(item.url, item.name);
}
</script>

<template>
  <div v-if="item.role === 'user'" class="gen-msg">
    <slot />
    <GenPendingCard
      v-if="pending.length"
      :state="stage"
      :count="media?.count ?? pending.length"
      :aspect="(media?.aspect as Aspect) ?? '1:1'"
      :started-at="startedAt"
      @cancel="host.cancel(pending.map((x) => x.id))"
    />
  </div>
  <GenErrorCard
    v-else-if="isError"
    :code="errCode as never"
    :message="errCode === 'failed' ? item.content : undefined"
    @retry="host.regenerate(batchTasks[0]?.prompt ?? '', media?.aspect ?? '1:1', 1)"
  />
  <GenResultCard
    v-else-if="lead"
    :items="results"
    :prompt="prompt"
    :params="{ aspect: media?.aspect ?? '1:1', count: media?.count ?? 1, model: media?.model ?? '', size: media?.size ?? '' }"
    saved
    @download="download"
    @regenerate="host.regenerate(prompt, media?.aspect ?? '1:1', media?.count ?? 1)"
    @refine="(it) => host.refine(it, prompt)"
  />
</template>
