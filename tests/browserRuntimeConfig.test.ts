import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseRuntimeConfig, fetchRuntimeConfig, configValue, loadRuntimeConfig } from "../src/runtimeConfig.ts";
import { runtimeFixture } from "./fixtures/runtimeConfig.ts";

test("optional runtime shell allowlist preserves exact local clients without weakening service endpoints", () => {
  const base = runtimeFixture();
  const allowlist = `${base.VITE_SHELL_URL},http://tauri.localhost,https://localhost`;
  const actual = parseRuntimeConfig({ ...base, VITE_SHELL_ALLOWED_ORIGINS: allowlist }, base.VITE_CORE_WEB_URL);
  assert.equal(actual.VITE_SHELL_ALLOWED_ORIGINS, allowlist);
  const { VITE_SHELL_ALLOWED_ORIGINS: _ignored, ...legacy } = actual;
  assert.equal(parseRuntimeConfig(legacy, base.VITE_CORE_WEB_URL).VITE_SHELL_ALLOWED_ORIGINS, "");
  for (const value of ["*", "null", "https://shell.example.test/", "http://user:private-fixture@localhost",
    "http://localhost:0", "http://localhost:65536", "http://localhost,", ",http://localhost", "http://localhost\n"]) {
    assert.throws(() => parseRuntimeConfig({ ...base, VITE_SHELL_ALLOWED_ORIGINS: value }, base.VITE_CORE_WEB_URL),
      (error: Error) => !error.message.includes("private-fixture"));
  }
  assert.throws(() => parseRuntimeConfig({ ...base, VITE_SHELL_ALLOWED_ORIGINS: allowlist,
    VITE_STORAGE_URL: "http://tauri.localhost" }, base.VITE_CORE_WEB_URL));
  assert.doesNotMatch(readFileSync(new URL("../src/addons/conversation/composables/useShellBridge.ts", import.meta.url), "utf8"),
    /import\.meta\.env\??\.VITE_SHELL_ALLOWED_ORIGINS/);
});

test("production consumers and Dockerfile have no active loopback endpoint defaults", () => {
  for (const path of ["Dockerfile", "src/addons/platform-api/api/http.ts",
    "src/addons/platform-api/index.ts", "src/addons/conversation/api/storage.ts",
    "src/addons/conversation/composables/useShellBridge.ts", "src/addons/conversation/views/Generate.vue"]) {
    assert.doesNotMatch(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
      /https?:\/\/(?:localhost|127\.0\.0\.1):266(?:00|10)/, path);
  }
});

test("four environments resolve their own explicit inner endpoints", () => {
  for (const zone of ["dev.ndaeweb.com", "debug.ndaeweb.com", "beta.ndaeweb.com", "sdp.ndaeweb.com"]) {
    const config = runtimeFixture(zone);
    assert.deepEqual(parseRuntimeConfig(config, config.VITE_CORE_WEB_URL), config);
    for (const other of ["dev.ndaeweb.com", "debug.ndaeweb.com", "beta.ndaeweb.com", "sdp.ndaeweb.com"]) {
      if (zone === other) continue;
      assert.throws(() => parseRuntimeConfig(config, runtimeFixture(other).VITE_CORE_WEB_URL));
      assert.throws(() => parseRuntimeConfig({ ...config, VITE_STORAGE_URL: runtimeFixture(other).VITE_STORAGE_URL }, config.VITE_CORE_WEB_URL));
    }
  }
});

test("one production config resolves only outer siblings on the registered outer twin", () => {
  const config = runtimeFixture("sdp.ndaeweb.com");
  const actual = parseRuntimeConfig(config, "https://nucleagent-core-web.new.ndhy.com");
  for (const [key, value] of Object.entries(actual)) {
    assert.equal(value, config[key as keyof typeof config].replaceAll(".sdp.ndaeweb.com", ".new.ndhy.com"));
  }
});

test("missing keys, unknown keys, unknown hosts and unsafe origins fail closed without value leakage", () => {
  const config = runtimeFixture();
  for (const body of [null, [], {}, { ...config, PASSWORD: "private-fixture" },
    { ...config, VITE_STORAGE_URL: undefined }, { ...config, VITE_EMBED_HOST_ORIGINS: undefined }]) {
    assert.throws(() => parseRuntimeConfig(body, config.VITE_CORE_WEB_URL));
  }
  for (const origin of ["", "http://localhost:26610", "https://127.0.0.1", "https://storage.evil.test",
    "https://nucleagent-storage.dev.ndaeweb.com.evil.test", "https://private-fixture@storage.dev.ndaeweb.com",
    "https://storage.dev.ndaeweb.com/?token=private-fixture", "https://storage.dev.ndaeweb.com/#private-fixture",
    "https://storage.dev.ndaeweb.com/path", "https://storage.dev.ndaeweb.com\n"]) {
    assert.throws(() => parseRuntimeConfig({ ...config, VITE_STORAGE_URL: origin }, config.VITE_CORE_WEB_URL),
      (error: Error) => !error.message.includes("private-fixture"));
  }
  for (const host of ["https://evil.dev.ndaeweb.com", "http://nucleagent-core-web.dev.ndaeweb.com",
    "https://nucleagent-core-web.dev.ndaeweb.com:444", "https://nucleagent-core-web.new.ndhy.com", "null"]) {
    assert.throws(() => parseRuntimeConfig(config, host));
  }
  assert.throws(() => parseRuntimeConfig({ ...config, VITE_EMBED_HOST_ORIGINS: "https://engine.dev.ndaeweb.com," }, config.VITE_CORE_WEB_URL));
  assert.equal(parseRuntimeConfig({ ...config, VITE_EMBED_HOST_ORIGINS: "" }, config.VITE_CORE_WEB_URL).VITE_EMBED_HOST_ORIGINS, "");
});

test("fetch is same-origin, credential-free, uncached, bounded and has no 404/baked fallback", async () => {
  const config = runtimeFixture();
  let calls = 0;
  const fake = (async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, `${config.VITE_CORE_WEB_URL}/runtime-config.json`);
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    assert.deepEqual(init.headers, { accept: "application/json" });
    return new Response(JSON.stringify(config), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  assert.throws(() => configValue("VITE_SHELL_URL"), /not initialized/);
  await Promise.all([loadRuntimeConfig(config.VITE_CORE_WEB_URL, fake), loadRuntimeConfig(config.VITE_CORE_WEB_URL, fake)]);
  assert.equal(calls, 1);
  assert.equal(configValue("VITE_SHELL_URL"), config.VITE_SHELL_URL);
  for (const status of [404, 500]) {
    await assert.rejects(fetchRuntimeConfig(config.VITE_CORE_WEB_URL, (async () => new Response("", { status })) as typeof fetch), /runtime-config/);
  }
  await assert.rejects(fetchRuntimeConfig(config.VITE_CORE_WEB_URL,
    (async () => new Response("<html>SPA fallback</html>")) as typeof fetch), /runtime-config/);
});
