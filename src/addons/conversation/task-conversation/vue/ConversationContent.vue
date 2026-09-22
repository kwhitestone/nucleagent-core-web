<script setup lang="ts">
import type { ConversationItem } from "../core";
import { useStreamSmooth } from "@/addons/conversation/composables/useStreamSmooth";
import MarkdownContent from "./MarkdownContent.vue";

const props = defineProps<{
  item: ConversationItem;
}>();

const streamText = useStreamSmooth(
  () => props.item.content,
  () => props.item.status === "complete",
);
</script>

<template>
  <MarkdownContent v-if="item.status === 'complete'" :content="item.content" />
  <pre v-else class="atc-stream-text">{{ streamText }}</pre>
</template>
