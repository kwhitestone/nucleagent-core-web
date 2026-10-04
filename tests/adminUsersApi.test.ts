import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let api: any;
let unregister: () => void;
const calls: Array<[string, string, unknown]> = [];
const row = { id: 13, username: "u13", nickName: "Test", headerImg: "", accountType: "human", roleId: 888, isActive: true };

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ http: {
    get: async (url: string, options: any) => { calls.push(["GET", url, options.params]); return { data: { code: 0, data: [row], total: 41 } }; },
    patch: async (url: string, body: any) => { calls.push(["PATCH", url, body]); return { data: { code: 0, data: { ...row, isActive: body.isActive } } }; },
  } });
  api = await vite.ssrLoadModule("/src/addons/administration/api/user.ts");
});
after(async () => { unregister(); await vite.close(); });

test("list sends the search and page, and unwraps data + total", async () => {
  const page = await api.listUsers("al", 20, 20);
  assert.deepEqual(calls.at(-1), ["GET", "/api/v1/addons/admin/users", { q: "al", offset: 20, limit: 20 }]);
  assert.equal(page.total, 41);
  assert.equal(page.items[0].id, 13);
});

test("toggle PATCHes isActive both ways and returns the saved row", async () => {
  assert.equal((await api.setUserActive(13, false)).isActive, false);
  assert.deepEqual(calls.at(-1), ["PATCH", "/api/v1/addons/admin/users/13", { isActive: false }]);
  assert.equal((await api.setUserActive(13, true)).isActive, true);
  assert.deepEqual(calls.at(-1), ["PATCH", "/api/v1/addons/admin/users/13", { isActive: true }]);
});
