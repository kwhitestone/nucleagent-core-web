import { createApp, defineComponent, h } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { AxiosError } from "axios";
import { loadRuntimeConfig } from "../../../src/runtimeConfig";
import "../../../src/styles/aurora.css";
import "../../../src/styles/global.css";
const hostOrigin = new URLSearchParams(location.search).get("hostOrigin") ?? location.origin;
const params = new URLSearchParams(location.search);
const chat = params.get("consumer") === "chat";
const seed = chat ? await fetch("/__fixture/seed", { method: "POST" }).then(r => r.json()) : null;
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.renewal.test/api/v1/addons/conversation/") && url.endsWith("/messages/stream")) {
    return nativeFetch(new URL(url).pathname, init);
  }
  return nativeFetch(input, init);
};

// Valid configuration is initialized through the production parser. The
// transport below never sends these reserved .test endpoints any traffic.
await loadRuntimeConfig("https://core.renewal.test", async () => new Response(JSON.stringify({
  VITE_CORE_WEB_URL: "https://core.renewal.test",
  VITE_SHELL_URL: "https://shell.renewal.test",
  VITE_CORE_BACKEND_URL: "https://api.renewal.test",
  VITE_STORAGE_URL: "https://storage.renewal.test",
  VITE_AUTH_BACKEND_URL: "https://auth.renewal.test",
  VITE_EMBED_HOST_ORIGINS: "",
  VITE_SHELL_ALLOWED_ORIGINS: hostOrigin,
}), { status: 200 }));

const { platformRuntime } = await import("../../../src/addons/platform-api/runtime");
const { registerPlatformRuntime, SESSION_CHANGE_EVENT } = await import("../../../src/contracts/platform-runtime");
const { sessionRequestSignal } = await import("../../../src/addons/platform-api/session/embeddedSession");
const { default: i18n } = await import("../../../src/i18n");
const { default: AgentList } = await import("../../../src/addons/conversation/views/AgentList.vue");
const { default: AdminAgents } = await import("../../../src/addons/administration/views/admin/AdminAgents.vue");
const { default: Home } = await import("../../../src/addons/conversation/views/Home.vue");
const { default: Conversation } = await import("../../../src/addons/conversation/views/Conversation.vue");
const { default: modelCatalog } = await import("../../../src/addons/model-catalog");
const { installShellBridge } = await import("../../../src/addons/conversation/composables/useShellBridge");
registerPlatformRuntime(platformRuntime);
modelCatalog.setup!();
i18n.global.locale.value = "en";

const definition = { id: 9001, name: "Synthetic record", slug: "synthetic-record", revision: "1",
  isActive: true, config: { model: "synthetic-model", description: "Synthetic description",
    avatar: "https://image.renewal.test/avatar.png" } };
const capabilities = { read: true, write: true, writeIdentity: true, delete: true, restore: true,
  readSkills: true, writeSkillBindings: true, readTools: true, writeTools: true, create: true };
const fieldPolicy = { editablePaths: ["/name", "/config/description"], readOnlyPaths: [],
  protectedPaths: [], unknownPaths: [], reasons: {} };
const detail = { definition, capabilities, fieldPolicy, skillBindings: [], skills: [], tools: [],
  effective: { revision: "1", definitionRevision: "1" }, identity: { uid: null, status: "ready" } };
const calls: { method: string; path: string }[] = [];
let denied = false;
let sessionEvents = 0;
window.addEventListener(SESSION_CHANGE_EVENT, () => sessionEvents++);
const waiting: (() => void)[] = [];
let hold = new URLSearchParams(location.search).has("hold");
let syntheticWrite = false;
let realPending = 0;
platformRuntime.http.defaults.adapter = async config => {
  const method = (config.method ?? "get").toUpperCase();
  const path = (config.url ?? "").split("?")[0];
  calls.push({ method, path });
  const wasHeld = hold;
  if (hold) await new Promise<void>(resolve => waiting.push(resolve));
  const response = (data: unknown, status = 200) => ({
    data: { code: status === 200 ? 0 : "forbidden", data }, status, statusText: "Synthetic",
    headers: { etag: '"agent-9001-1"' }, config,
  });
  if (chat && /^\/api\/v1\/addons\/conversation\/\d+(?:\/bindings(?:\/sync)?|\/messages)?$/.test(path)) {
    realPending++;
    try {
    const real = await fetch(path, {
      method, headers: { "Content-Type": "application/json", Authorization: String(config.headers.Authorization ?? "") },
      body: method === "GET" ? undefined : config.data,
      // Hold the real server response through cancellation to test late settlement.
    });
    const result = { ...response(null, real.status), data: await real.json() };
    if (!real.ok) throw new AxiosError("Synthetic service rejected request", "ERR_BAD_RESPONSE", config, undefined, result);
    return result;
    } finally {
      realPending--;
    }
  }
  if (wasHeld && new URLSearchParams(location.search).has("lateFail")) {
    throw new AxiosError("Synthetic delayed old failure", "ERR_BAD_RESPONSE", config, undefined, response(null, 503));
  }
  if (method !== "GET") {
    if (!syntheticWrite) throw new Error("Synthetic fixture forbids business writes");
    return response(definition);
  }
  if (path === "/synthetic/session-check") {
    throw new AxiosError("Synthetic unauthorized", "ERR_BAD_REQUEST", config, undefined, response(null, 401));
  }
  if (denied && (path.includes("/admin/") || path.includes("/agent/"))) {
    throw new AxiosError("Synthetic forbidden", "ERR_BAD_REQUEST", config, undefined, response(null, 403));
  }
  if (path === "/api/v1/addons/admin/agents") return response([definition]);
  if (path.endsWith("/admin/agents/catalog")) return response({ capabilities, fieldPolicy, skills: [] });
  if (path.endsWith("/admin/agents/9001")) return response(detail);
  if (path.endsWith("/admin/agents/events")) return response({ events: [], nextCursor: "0" });
  if (path === "/api/v1/addons/agent/mine") return response([{ templateId: definition.id,
    name: definition.name, slug: definition.slug, config: definition.config, disabled: false,
    instanceId: null, sessionCount: 0, lastSessionAt: null }]);
  if (path.endsWith("/mine/definitions")) return response([definition]);
  if (path.endsWith("/mine/models")) return response([{ model: "synthetic-model" }]);
  if (path.endsWith("/mine/gen-models")) return response({});
  if (chat && path.endsWith("/skill")) return response([{ id: seed.skillId, name: "Synthetic skill", slug: "s-on", isActive: true }]);
  if (path.endsWith("/conversation/execution-backends")) return response([
    { id: "codex", displayName: "Synthetic Codex", default: true, available: true },
  ]);
  if (path.endsWith("/provider") || path.endsWith("/provider/visible-models") ||
      path.endsWith("/provider/models") || path.endsWith("/media/models") ||
      path.endsWith("/media/generations") || path.endsWith("/conversation/home-suggestions")) return response([]);
  if (path.endsWith("/conversation")) return response([]);
  if (path.endsWith("/mine/backends") || path.endsWith("/skill") || path.endsWith("/tool/catalog")) return response([]);
  throw new Error(`Unmapped synthetic read: ${path}`);
};
const consumer = chat ? "chat" : params.get("consumer") === "admin" ? "admin" : "owner";
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: "/", component: platformRuntime.authenticatedView(consumer === "admin" ? AdminAgents : AgentList) },
  { path: "/chat", component: platformRuntime.authenticatedView(Home) },
  { path: "/c/:id", component: platformRuntime.authenticatedView(Conversation), props: true },
] });
await router.push(chat ? "/chat" : "/?edit=9001");
const app = createApp(defineComponent({
  setup() { installShellBridge(router); return () => h(RouterView); },
}));
app.use(createPinia()).use(router).use(i18n).mount("#app");
Object.assign(window, { renewalFixture: {
  calls,
  seed,
  navigate: (path: string) => router.push(path),
  state: () => ({ consumer, version: platformRuntime.getSessionVersion(), authenticated: !!platformRuntime.getAccessToken(),
    sessionEvents, writes: calls.filter(call => call.method !== "GET").length, pending: waiting.length, realPending }),
  deny: () => { denied = true; },
  rejectCurrent: () => platformRuntime.http.get("/synthetic/session-check").catch(() => undefined),
  hold: () => { hold = true; },
  allowSyntheticWrite: () => { syntheticWrite = true; },
  release: () => { hold = false; waiting.splice(0).forEach(resolve => resolve()); },
  signal: () => sessionRequestSignal(),
} });
parent.postMessage({ fixtureReady: true }, hostOrigin);
