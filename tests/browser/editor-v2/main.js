import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { loadRuntimeConfig } from "../../../src/runtimeConfig";
import "../../../src/styles/aurora.css";
import "../../../src/styles/global.css";
import "@prism-fusion/editor-ui/style.css";

await loadRuntimeConfig("https://core.editor.test", async () => new Response(JSON.stringify({
  VITE_CORE_WEB_URL: "https://core.editor.test", VITE_SHELL_URL: "https://shell.editor.test",
  VITE_CORE_BACKEND_URL: "https://api.editor.test", VITE_STORAGE_URL: "https://storage.editor.test",
  VITE_AUTH_BACKEND_URL: "https://auth.editor.test", VITE_EMBED_HOST_ORIGINS: "",
  VITE_SHELL_ALLOWED_ORIGINS: location.origin,
})));
const { platformRuntime } = await import("../../../src/addons/platform-api/runtime");
const { registerPlatformRuntime } = await import("../../../src/contracts/platform-runtime");
const { default: i18n } = await import("../../../src/i18n");
const { default: AgentList } = await import("../../../src/addons/conversation/views/AgentList.vue");
const { default: AdminAgents } = await import("../../../src/addons/administration/views/admin/AdminAgents.vue");
registerPlatformRuntime(platformRuntime);
i18n.global.locale.value = "zh";
const admin = new URLSearchParams(location.search).has("admin");
const grants = admin ? ["core:admin:read", "core:admin:write"] : [];
platformRuntime.applyShellSession("synthetic-editor-session", 1, grants, { id: "41" });
const definition = { id: 9001, name: "Synthetic Agent", slug: "synthetic-agent", revision: "1", isActive: true,
  config: { model: "synthetic-model", description: "Synthetic fixture only", prompt: "Synthetic instructions",
    defaults: { providerId: 1, model: "synthetic-model" } } };
const capabilities = { read: true, write: true, writeIdentity: true, delete: true, restore: true,
  readSkills: true, writeSkillBindings: true, readTools: true, writeTools: true, writeToolBindings: true, create: true };
const fieldPolicy = { editablePaths: ["/name", "/config/description", "/config/prompt", "/config/memory",
  "/config/avatar", "/config/defaults/providerId", "/config/defaults/model"], readOnlyPaths: ["/slug"],
  protectedPaths: [], unknownPaths: [], reasons: {} };
const aggregate = () => ({ definition, capabilities, fieldPolicy, skillBindings: [], skills: [], tools: [], toolBindings: [],
  effective: { revision: definition.revision, definitionRevision: definition.revision }, identity: { uid: null, status: "ready" } });
const calls = [];
let hold = false, pending = [], deny = false;
platformRuntime.http.defaults.adapter = async config => {
  const method = (config.method ?? "get").toUpperCase(), path = config.url.split("?")[0];
  calls.push({ method, path, params: config.params });
  if (hold && method !== "GET") await new Promise(resolve => pending.push(resolve));
  const response = data => ({ data: structuredClone({ code: 0, data, typesAvailable: true, total: Array.isArray(data) ? data.length : undefined }),
    status: 200, statusText: "Synthetic", headers: { etag: `"agent-9001-${definition.revision}"` }, config });
  if (deny) {
    const { AxiosError } = await import("axios");
    throw new AxiosError("Synthetic denied", "ERR_BAD_REQUEST", config, null, { ...response(null), status: 403 });
  }
  if (method === "POST" && path.endsWith("/mine/definitions/9001/avatar")) {
    if (!(config.data instanceof FormData) || !config.data.get("file")) throw Error("Missing synthetic avatar");
    definition.config.avatar = "/api/v1/avatars/synthetic";
    return response({ fileId: "synthetic", path: definition.config.avatar });
  }
  if (method === "PATCH") {
    const body = JSON.parse(config.data);
    if (path.includes("/admin/")) {
      for (const [key, value] of Object.entries(body.changes ?? {})) {
        if (!fieldPolicy.editablePaths.includes(key)) throw Error("Synthetic forbidden field");
        const parts = key.slice(1).split("/"), leaf = parts.pop();
        const target = parts.reduce((node, part) => node[part] ??= {}, definition);
        target[leaf] = value;
      }
    } else {
      if (body.name !== undefined) definition.name = body.name;
      for (const key of ["description", "prompt", "model"]) if (body[key] !== undefined) definition.config[key] = body[key];
    }
    definition.revision = String(Number(definition.revision) + 1);
    return response(path.includes("/admin/") ? aggregate() : definition);
  }
  if (method !== "GET") throw Error(`Unmapped synthetic write: ${method} ${path}`);
  if (path.endsWith("/admin/agents/catalog")) return response({ capabilities, fieldPolicy, skills: [] });
  if (path.endsWith("/admin/agents/9001/impact")) return response({ instances: 0, conversations: 0, conversations_7d: 0,
    skill_bindings: 0, im_groups: 0, deliverables: 0, unavailable: [], counted_at: "2026-10-19T00:00:00Z" });
  if (path.endsWith("/admin/agents/9001")) return response(aggregate());
  if (path.endsWith("/admin/agents/events")) return response({ events: [], nextCursor: "0", hasMore: false });
  if (path.endsWith("/admin/agents") || path.endsWith("/mine/definitions")) return response([definition]);
  if (path.endsWith("/agent/mine")) return response([{ templateId: 9001, name: definition.name, slug: definition.slug,
    description: definition.config.description, config: definition.config, disabled: false, instanceId: null, sessionCount: 0, lastSessionAt: null }]);
  if (path.endsWith("/mine/models")) return response([{ model: "synthetic-model" }]);
  if (path.endsWith("/mine/gen-models")) return response({});
  if (path.endsWith("/provider/models")) return response([{ providerId: 1, model: "synthetic-model", type: "chat" }]);
  if (path.endsWith("/media/models")) return response([]);
  if (path.endsWith("/skill") || path.endsWith("/tool/catalog")) {
    const result = response([]);
    Object.assign(result.data, { page: Number(config.params?.page ?? 1), pageSize: Number(config.params?.pageSize ?? 20), total: 0, hasMore: false });
    return result;
  }
  if (["/mine/backends", "/execution-backends", "/skill", "/tool/catalog", "/conversation", "/instances", "/audits"].some(end => path.endsWith(end))) return response([]);
  throw Error(`Unmapped synthetic read: ${path}`);
};
const route = admin ? "/admin/agents" : "/agents";
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: route, component: platformRuntime.authenticatedView(admin ? AdminAgents : AgentList, [route]) },
  { path: "/agents/:id", component: { render: () => h("p", "Synthetic detail destination") } },
  { path: "/away", component: { render: () => h("p", "Synthetic alternate route") } },
] });
await router.push(`${route}?edit=9001`);
createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(i18n).mount("#app");
window.editorFixture = {
  calls, route: () => router.currentRoute.value.fullPath, away: () => router.push("/away"),
  hold: () => { hold = true; }, release: () => { hold = false; pending.splice(0).forEach(resolve => resolve()); },
  deny: () => { deny = true; },
  renew: (id = "41") => platformRuntime.applyShellSession("synthetic-renewed", platformRuntime.getSessionVersion() + 1, grants, { id }),
};
