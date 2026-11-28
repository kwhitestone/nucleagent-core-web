import type { Message } from "../api/types.ts";

export function skillProcess(message: Message) {
  if (message.msgType !== "status") return;
  const metadata = message.metadata;
  if (message.senderName === "agent.skill_progress") return {
    title: "技能准备",
    content: message.content,
    running: metadata?.phase_status === "running",
    cancelled: metadata?.phase_status === "cancelled",
    failed: metadata?.phase_status === "failed",
  };
  if (message.senderName === "agent.skill_match") return {
    title: "技能选择",
    content: message.content,
    failed: ["failed", "not_written", "timeout"].includes(String(metadata?.outcome)),
    running: false,
    cancelled: false,
  };
  if (message.senderName !== "agent.skill_intent" || metadata?.role === "probe") return;
  const need = String(metadata?.need);
  const failed = !!metadata?.error || !["tool", "none", "keep"].includes(need);
  return {
    title: "技能判断",
    content: failed ? "暂未能判断是否需要技能，已继续处理请求" : need === "none" ? "此请求无需自动选择技能" : need === "keep" ? "沿用当前技能" : metadata?.effective_turn === "next" ? "正在后台选择技能，选好后从下轮起使用" : "此请求需要技能，继续选择可用技能",
    failed,
    running: false,
    cancelled: false,
  };
}
