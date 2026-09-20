/**
 * 嵌入宿主（Agentia engine-web 的 NucleAgentPane）↔ core 子应用的最小握手与凭据通道。
 *
 * 宿主在 iframe load 后发 {type:"agentia:embed-init", payload:{conversationId}}，
 * core 必须回 {type:"nucleagent:ready", payload:{conversationId}}（同一 conversationId），
 * 否则宿主 15s 超时移除 iframe 并降级。ready 之后宿主才投递凭据——ready 是对端
 * 身份的最小证明，把凭据挂在 init 上等于发给一个还没自证的 frame。
 *
 *   agentia:embed-credential {conversationId, ucToken} → /exchange → 会话放行 → credential-ack
 *   agentia:embed-revoke     {conversationId, reason}  → 清内存 token + /revoke
 *
 * 与主壳的 Remote Application 通道（useShellBridge）不是同一协议：宿主不推送会话、
 * 鉴权或路由意图，只需要确认子应用已接管，所以单独实现，不混入 shell 通道。
 *
 * 允许的宿主 origin 必须显式配置（VITE_EMBED_HOST_ORIGINS，逗号分隔）；
 * 未配置时握手关闭，不回任何消息。
 *
 * 凭据纪律：UC token 只以 postMessage payload + 函数参数形态存在，不进任何变量、
 * store、localStorage、日志或错误信息；换票响应与失败原因同样不得回传 token 片段。
 */

// Relative, extensioned imports: this module is covered by `node --test`, which
// resolves neither the `@/` alias nor extensionless specifiers.
import { clearAccessToken, getAccessToken, setAccessToken } from "../utils/token.ts";
import { emitSessionChange } from "../contracts/platform-runtime.ts";

const MAX_CONVERSATION_ID = 200;
const EXCHANGE_PATH = "/api/v1/addons/uc-federation/exchange";
const REVOKE_PATH = "/api/v1/addons/uc-federation/revoke";

type HostMessage =
  | { kind: "init"; conversationId: string }
  | { kind: "credential"; conversationId: string; ucToken: string }
  | { kind: "revoke"; conversationId: string };

function conversationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CONVERSATION_ID) return null;
  return trimmed;
}

/** 解析宿主消息。形状不合法的一律丢弃，不回任何消息。 */
export function embedHostMessage(data: unknown): HostMessage | null {
  if (data === null || typeof data !== "object") return null;
  const message = data as {
    type?: unknown;
    payload?: { conversationId?: unknown; ucToken?: unknown };
  };
  const id = conversationId(message.payload?.conversationId);
  if (!id) return null;
  switch (message.type) {
    case "agentia:embed-init":
      return { kind: "init", conversationId: id };
    case "agentia:embed-credential": {
      const ucToken = message.payload?.ucToken;
      if (typeof ucToken !== "string" || !ucToken) return null;
      return { kind: "credential", conversationId: id, ucToken };
    }
    case "agentia:embed-revoke":
      return { kind: "revoke", conversationId: id };
    default:
      return null;
  }
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

/**
 * core 后端地址。与 platform-api 的 axios 实例同源配置，但这里不能复用它：
 * 凭据消息可能早于 addon 安装到达，且那个实例会给请求加 Authorization 并在
 * 嵌入态无 token 时直接 abort——换票请求恰恰是公开的、无 token 的。
 */
function coreBackendBase(): string {
  return import.meta.env?.VITE_CORE_BACKEND_URL?.trim() || "";
}

/**
 * 用 UC 凭据换 core JWT。成功返回 JWT，失败返回 null——失败细节不出函数，
 * 避免把响应体（可能含凭据回显）带进调用方的日志或 ack。
 */
async function exchange(ucToken: string): Promise<string | null> {
  try {
    const response = await fetch(`${coreBackendBase()}${EXCHANGE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ucToken }),
    });
    if (!response.ok) return null;
    // 该端点回扁平 {accessToken, expiresAt}；core 其他 addon 用 {code,message,data}
    // 信封，所以两种都认，避免后端将来加信封时前端静默失效。
    const body = await response.json() as {
      accessToken?: unknown;
      data?: { accessToken?: unknown };
    };
    const token = body?.data?.accessToken ?? body?.accessToken;
    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

/** 通知服务端撤销本会话族。fire-and-forget：前端已清 token，服务端失败不改变本地状态。 */
function revokeServerSession(token: string): void {
  if (!token) return;
  void fetch(`${coreBackendBase()}${REVOKE_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    keepalive: true,
  }).catch(() => undefined);
}

/** 在 core 启动时调用一次（必须早于 iframe load，否则 init 会丢）。 */
export function installEmbedHostHandshake(
  configured: string | undefined = import.meta.env?.VITE_EMBED_HOST_ORIGINS,
): () => void {
  if (typeof window === "undefined" || window.parent === window) return () => undefined;
  const allowed = allowedHostOrigins(configured);
  if (!allowed.size) return () => undefined;

  // 握手确认过的会话。凭据与撤销只对它生效，防跨会话投递。
  let embedded: string | null = null;

  const reply = (origin: string, type: string, payload: Record<string, unknown>) => {
    window.parent.postMessage({ type, payload }, origin);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || !allowed.has(event.origin)) return;
    const message = embedHostMessage(event.data);
    if (!message) return;
    if (message.kind === "init") {
      embedded = message.conversationId;
      reply(event.origin, "nucleagent:ready", { conversationId: embedded });
      return;
    }
    if (message.conversationId !== embedded) return;

    if (message.kind === "credential") {
      const id = message.conversationId;
      // ucToken 只作为参数穿过：不赋给任何变量，换票返回后本闭包不再持有引用。
      void exchange(message.ucToken).then((accessToken) => {
        if (accessToken) {
          setAccessToken(accessToken);
          emitSessionChange(true);
        }
        reply(event.origin, "nucleagent:credential-ack", {
          conversationId: id,
          status: accessToken ? "ok" : "rejected",
        });
      });
      return;
    }

    // 撤销必须两侧都做：只清前端的话 JWT 在有效期内仍然可用。
    const token = getAccessToken();
    clearAccessToken();
    emitSessionChange(false);
    revokeServerSession(token);
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
