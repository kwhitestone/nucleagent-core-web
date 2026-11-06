<script setup lang="ts">
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { computed } from "vue";
import { openToolLink } from "@/addons/conversation/api/conversation";
import { assertSafeDownloadUrl, isSealedToolLink } from "@/addons/conversation/api/downloadUrlPolicy";
import { toast } from "@/composables/useToast";

const props = defineProps<{
  content: string;
}>();

const markdown = new MarkdownIt({
  html: false,
  breaks: false,
  linkify: true,
  typographer: false,
});
markdown.renderer.rules.image = () => "";
// GFM 任务列表（计划卡的 "- [x] 步骤"）：markdown-it 核心不识别 checkbox
// 语法，会把 "[x]" 当普通文本渲染。这里转成开/闭勾选符号，保持只读。
markdown.core.ruler.after("inline", "task-lists", (state) => {
  for (const token of state.tokens) {
    if (token.type !== "inline" || !token.children) continue;
    const first = token.children[0];
    if (!first || first.type !== "text") continue;
    const match = /^\[([ xX])\]\s*(.*)$/.exec(first.content);
    if (!match) continue;
    first.content = (match[1] === " " ? "☐ " : "☑ ") + match[2];
  }
});

const rendered = computed(() =>
  DOMPurify.sanitize(markdown.render(props.content), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      "style",
      "form",
      "input",
      "button",
      "iframe",
      "object",
      "embed",
      "img",
    ],
    FORBID_ATTR: ["style"],
  }),
);

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
