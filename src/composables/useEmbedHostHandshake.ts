/**
 * 嵌入宿主（Agentia engine-web 的 NucleAgentPane）↔ core 子应用的最小握手。
 *
 * 宿主在 iframe load 后发 {type:"agentia:embed-init", payload:{conversationId}}，
 * core 必须回 {type:"nucleagent:ready", payload:{conversationId}}（同一 conversationId），
 * 否则宿主 15s 超时移除 iframe 并降级。
 *
 * 与主壳的 Remote Application 通道（useShellBridge）不是同一协议：宿主不推送会话、
 * 鉴权或路由意图，只需要确认子应用已接管，所以单独实现，不混入 shell 通道。
 *
 * 允许的宿主 origin 必须显式配置（VITE_EMBED_HOST_ORIGINS，逗号分隔）；
 * 未配置时握手关闭，不回任何消息。
 */

const MAX_CONVERSATION_ID = 200;

/** 解析宿主的 init 消息，返回它要求确认的 conversationId。 */
export function embedInitConversationId(data: unknown): string | null {
  if (data === null || typeof data !== "object") return null;
  const message = data as { type?: unknown; payload?: { conversationId?: unknown } };
  if (message.type !== "agentia:embed-init") return null;
  const raw = message.payload?.conversationId;
  if (typeof raw !== "string") return null;
  const conversationId = raw.trim();
  if (!conversationId || conversationId.length > MAX_CONVERSATION_ID) return null;
  return conversationId;
}

/** 把配置里的宿主地址规整成精确 origin 集合；非法项丢弃，不回退到通配。 */
export function allowedHostOrigins(configured: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const entry of (configured ?? "").split(",")) {
    const value = entry.trim();
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // 配置错误的条目不放宽校验。
    }
  }
  return origins;
}

/** 在 core 启动时调用一次（必须早于 iframe load，否则 init 会丢）。 */
export function installEmbedHostHandshake(
  configured: string | undefined = import.meta.env?.VITE_EMBED_HOST_ORIGINS,
): () => void {
  if (typeof window === "undefined" || window.parent === window) return () => undefined;
  const allowed = allowedHostOrigins(configured);
  if (!allowed.size) return () => undefined;

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || !allowed.has(event.origin)) return;
    const conversationId = embedInitConversationId(event.data);
    if (!conversationId) return;
    window.parent.postMessage(
      { type: "nucleagent:ready", payload: { conversationId } },
      event.origin,
    );
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
