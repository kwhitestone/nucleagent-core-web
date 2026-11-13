<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../markdown";
import { openToolLink } from "@/addons/conversation/api/conversation";
import { assertSafeDownloadUrl, isSealedToolLink } from "@/addons/conversation/api/downloadUrlPolicy";
import { toast } from "@/composables/useToast";

const props = defineProps<{
  content: string;
}>();

const rendered = computed(() => renderMarkdown(props.content));

// MUYU-181: tool links carry sealed tickets, never credentials; the owner's real link
// is fetched from Core at click time and opened without ever entering the page.
async function onClick(event: MouseEvent): Promise<void> {
  const anchor = (event.target as Element | null)?.closest?.("a");
  const href = anchor?.getAttribute("href") ?? "";
  // TaskConversation marks its root with the conversation id (also on broadcast pages).
  const conversationId = anchor?.closest("[data-conversation-key]")?.getAttribute("data-conversation-key") ?? "";
  if (!isSealedToolLink(href) || !/^\d+$/.test(conversationId)) return;
  event.preventDefault();
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const link = assertSafeDownloadUrl(await openToolLink(conversationId, href));
    if (tab) tab.location.href = link;
    else window.open(link, "_blank", "noopener,noreferrer");
  } catch {
    tab?.close();
    toast.error("链接无法打开");
  }
}
</script>

<template>
  <div class="atc-markdown" v-html="rendered" @click="onClick" />
</template>
