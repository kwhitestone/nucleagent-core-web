<script setup lang="ts">
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { computed } from "vue";

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
</script>

<template>
  <div class="atc-markdown" v-html="rendered" />
</template>
