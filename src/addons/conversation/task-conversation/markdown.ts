import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

/** Shared by the Vue and React chat views: one sanitization policy for both. */
const markdown = new MarkdownIt({
  html: false,
  breaks: true, // OWUI parity: marked breaks:true (chat/Messages/Markdown.svelte:23 @c38885a)
  linkify: true,
  typographer: false,
});
markdown.renderer.rules.image = () => "";
markdown.core.ruler.after("inline", "image-protocol-trailer", (state) => {
  if (!state.env?.assistant) return;
  const paragraph = state.tokens.at(-3);
  const inline = state.tokens.at(-2);
  if (paragraph?.type !== "paragraph_open" || paragraph.level !== 0 || inline?.type !== "inline") return;
  const children = inline.children;
  const imageIndex = children?.map(token => token.type).lastIndexOf("image") ?? -1;
  if (!children || imageIndex < 0) return;
  const tail = children.slice(imageIndex + 1);
  if (tail.some(token => token.type !== "text" && token.type !== "softbreak")) return;
  const text = tail.map(token => token.type === "softbreak" ? "\n" : token.content).join("");
  if (/^\s*<\/｜｜DSML｜｜ parameter>\s*<\/｜｜DSML｜｜ invoke>\s*<\/｜｜DSML｜｜ calls>\s*$/.test(text)) {
    children.splice(imageIndex + 1);
  }
});
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

export const renderMarkdown = (content: string, assistant = false): string =>
  DOMPurify.sanitize(markdown.render(content, { assistant }), {
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
  });
