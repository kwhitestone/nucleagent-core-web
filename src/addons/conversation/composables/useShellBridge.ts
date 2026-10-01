/**
 * core 子应用 ↔ 主壳 的 postMessage 通道桥接（iframe 方案）。
 *
 * 两个方向：
 *   壳 → core：壳切换视图时 postMessage({source:'shell', type:'view', view, conversationId})。
 *             core 监听它，驱动内部路由跳转。
 *   core → 壳：core 对话列表变化时 postMessage({source:'sub', type:'conversations', ...})，
 *             壳侧栏渲染历史。
 *
 * 仅在被 iframe 嵌入时（window.parent !== window）生效；独立 dev 运行时是 no-op。
 * 消息由框架 Remote Application 通道校验后交给本 addon 处理。
 */
import { watch } from "vue";
import type { Router } from "vue-router";
import { createRemoteChildChannel } from "@prism-fusion/plugin-runtime/remote";
import { useConversationStore } from "@/addons/conversation/store/conversation";
import i18n, { setLocale } from "@/i18n";
import { toast } from "@/composables/useToast";
import { resolveShellViewPath, shellViewLocation } from "./shellMessagePolicy";
import { activeSidebarConversation, broadcastGroupId } from "./broadcastViewPolicy";
import {
  applyShellSession,
  setAuthRequiredNotifier,
  SESSION_CHANGE_EVENT,
  getPlatformRuntime,
} from "@/contracts/platform-runtime";
import { outerAware } from "@/outerHost";

const SHELL_ORIGIN = new URL(
  outerAware(import.meta.env.VITE_SHELL_URL ?? "http://localhost:26600"),
).origin;

/** core 是否被主壳以 iframe 嵌入。 */
export function isInShell(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

/**
 * 在 core 根组件 setup 时调用一次。
 * - 注册壳→core 的视图意图监听
 * - 把对话 store 变化推回壳
 */
export function installShellBridge(router: Router): () => void {
  if (!isInShell()) return () => undefined;

  const store = useConversationStore();
  // Reset is synchronous: late requests from the previous identity must not
  // repopulate the shared history after logout or account/credential changes.
  const onSessionChange = () => store.reset();
  window.addEventListener(SESSION_CHANGE_EVENT, onSessionChange);

  async function loadHistory(more = false): Promise<void> {
    const runtime = getPlatformRuntime();
    const version = runtime.getSessionVersion();
    const token = runtime.getAccessToken();
    try {
      if (more) await store.loadMore();
      else await store.load(true);
    } catch {
      // Retired sessions are silent; current failures remain visible without
      // escaping the message listener as an unhandled promise rejection.
      if (token && runtime.getAccessToken() === token && runtime.getSessionVersion() === version) {
        toast.error(i18n.global.t("workbench.loadHistoryFailed"));
      }
    }
  }

  const channel = createRemoteChildChannel({
    appId: "core",
    hostOrigin: SHELL_ORIGIN,
    allowedHostOrigins: import.meta.env?.VITE_SHELL_ALLOWED_ORIGINS,
    parent: window.parent,
    messages: {
      toChild: ["auth", "view", "locale", "load-more"],
      fromChild: ["auth-required", "conversations"],
    },
    onMessage(type, payload) {
      handleVerifiedMessage(type, payload);
    },
  });

  // 壳 → core：按 view 切换 core 路由 + 同步登录态。
  function handleVerifiedMessage(type: string, payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const d = payload as {
      source?: string;
      type?: string;
      view?: "home" | "chat" | "creation" | "tasks" | "admin";
      conversationId?: string | null;
      token?: string | null;
      sessionVersion?: number;
      permissions?: unknown[];
      locale?: unknown;
    };
    if (d?.source !== "shell") return;

    // 仅接受已验证通道中的会话；访问凭据保留在内存，不持久化到子应用域。
    if (type === "auth" && d.type === "auth") {
      if (!Number.isSafeInteger(d.sessionVersion) || (d.sessionVersion as number) < 0) return;
      if (d.token !== null && d.token !== undefined &&
          (typeof d.token !== "string" || d.token.length === 0 || d.token.length > 8192)) return;
      if (d.permissions !== undefined && (!Array.isArray(d.permissions) || d.permissions.length > 512)) return;
      const result = applyShellSession(d.token ?? null, d.sessionVersion as number, d.permissions ?? []);
      if (result.accepted && result.changed && d.token) {
        void loadHistory();
      }
      return;
    }

    // 壳侧栏滚动到底时请求加载下一页。loadMore 内部有 hasMore/loadingMore 守卫，
    // 拉到新数据后 store.sorted 变化会自动触发下方 pushConversations 推回壳。
    if (type === "load-more" && d.type === "loadMore") {
      void loadHistory(true);
      return;
    }

    // 壳切语言：iframe 跨域 localStorage 不共享，壳把 locale 推过来同步
    //（写入子应用域的 nucleagent_locale，下次独立打开也保持一致）。
    if (type === "locale" && d.type === "locale") {
      const raw = d.locale;
      if (raw === "zh" || raw === "en") setLocale(raw);
      return;
    }

    if (type !== "view" || d.type !== "view") return;
    const directPath = resolveShellViewPath(d);
    const target = directPath ?? (
      !d.view ? null :
      d.view === "chat" && d.conversationId
        ? `/c/${d.conversationId}`
        : d.view === "chat" ? "/chat"
        : d.view === "creation" ? "/creation"
        : d.view === "tasks" ? "/tasks"
        : d.view === "admin" ? "/admin"
        : "/"
    );
    if (!target) return;
    const current = router.currentRoute.value;
    const location = shellViewLocation(target);
    // A shell selection echoes the active group member (as /c/:id or
    // /b/:groupId/:memberId). Preserve the group view and its live controller
    // when that member is already open.
    if (current.path.startsWith("/b/")) {
      const active = activeSidebarConversation(current.path, current.query.conversationId, store.sorted);
      if (target === `/c/${active}` ||
          (location.path === current.path && location.query?.conversationId === String(active))) return;
    }
    if (current.path !== location.path || (location.query && current.query.conversationId !== location.query.conversationId)) {
      void router.push(location);
    }
  }

  const onMessage = (event: MessageEvent) => channel.receive(event);
  window.addEventListener("message", onMessage);
  setAuthRequiredNotifier((payload) => channel.send("auth-required", payload));
  channel.ready();

  /** 把当前对话列表 + 选中态 + 是否还有更多推给壳。列表不变但选中项变时也要重推。 */
  function pushConversations(navigate = false): void {
    if (!getPlatformRuntime().getAccessToken()) return;
    const list = store.sorted;
    const activeId = activeSidebarConversation(router.currentRoute.value.path,
      router.currentRoute.value.query.conversationId, list);
    channel.send("conversations", {
        source: "sub",
        type: "conversations",
        sessionVersion: getPlatformRuntime().getSessionVersion(),
        navigate,
        conversations: list.map((c) => ({
          id: c.id, title: c.title, status: c.status,
          broadcastGroupId: broadcastGroupId(c), executionBackend: c.executionBackend,
        })),
        activeId,
        hasMore: store.hasMore,
    });
  }

  // core → 壳：对话列表变化时推。
  const stopConversations = watch(
    () => store.sorted,
    () => pushConversations(),
    { deep: true },
  );
  // 路由变化时也推（选中项变了，但列表数据没变，上面的 watch 不触发）。
  const stopRoute = watch(() => router.currentRoute.value.fullPath, () => pushConversations(true));
  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener(SESSION_CHANGE_EVENT, onSessionChange);
    setAuthRequiredNotifier(undefined);
    channel.dispose();
    stopConversations();
    stopRoute();
  };
}
