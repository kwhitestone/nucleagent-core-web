// Catalog authors can supply service identifiers as titles. Format only the
// chat-facing text; selection, saves and server searches use catalog data.
const wording: Record<string, string> = {
  "语音合成": "生成语音", "合成": "生成", "协议": "约定", "冻结": "暂停",
  "后端": "服务", "读回": "读取", "置顶": "优先显示", "权重": "优先级",
  "执行器": "运行方式", held: "unavailable", manual_disabled: "disabled",
  sortversion: "list version", responses: "replies", executor: "runner",
  tool_covered_by_skill: "included with the skill",
  codex: "coding assistant", "claude-code": "coding assistant",
};
const terms = new RegExp(Object.keys(wording).join("|"), "gi");
export function catalogText(value: string): string {
  return value.replace(terms, term => wording[term.toLowerCase()]!)
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}
