import assert from "node:assert/strict";
import test from "node:test";
import { shellLoginUrl } from "../src/addons/platform-api/shellLogin.ts";
import en from "../src/i18n/en.ts";
import zh from "../src/i18n/zh.ts";

test("standalone no-session goes to the shell's /login with the shell mount path", () => {
  assert.equal(
    shellLoginUrl("https://shell.example.test", "/chat/42"),
    "https://shell.example.test/login?redirect=%2Fchat%2F42",
  );
  assert.equal(shellLoginUrl("https://shell.example.test", "//evil.test"), "https://shell.example.test/login");
});

test("interstitial copy exists in both locales (login-ux-board §08)", () => {
  for (const catalog of [en, zh]) {
    assert.ok(catalog.login.redirectingTitle);
    assert.ok(catalog.login.redirectingBody);
  }
});

test("child routes map to the shell's mount paths", async () => {
  const { coreShellPath, deliverablesShellPath, executorShellPath } =
    await import("../src/addons/platform-api/shellLogin.ts");
  assert.equal(coreShellPath("/c/42?x=1"), "/chat/42");
  assert.equal(coreShellPath("/admin/providers"), "/admin/providers");
  assert.equal(coreShellPath("/tasks"), "/tasks");
  assert.equal(coreShellPath("/b/7"), "/chat", "unmounted child paths fall back");
  assert.equal(coreShellPath("/chatter"), "/chat");
  assert.equal(deliverablesShellPath("/deliverables?conversationId=3"), "/deliverables?conversationId=3");
  assert.equal(deliverablesShellPath("/other"), "/deliverables");
  assert.equal(executorShellPath(), "/executor");
});
