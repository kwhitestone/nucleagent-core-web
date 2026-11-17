<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../markdown";
import { openSealedLinkOnClick } from "../sealedLink";

const props = defineProps<{
  content: string;
}>();

const rendered = computed(() => renderMarkdown(props.content));
</script>

<template>
  <div class="atc-markdown" v-html="rendered" @click="openSealedLinkOnClick" />
</template>
