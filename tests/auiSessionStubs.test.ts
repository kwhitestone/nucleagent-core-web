import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { DictationSessionController } from "../src/vendor/assistant-ui-core/dictation-session.ts";
import { VoiceSessionController } from "../src/vendor/assistant-ui-core/voice-session.ts";

// MUYU-408 on MUYU-406: the production build swaps two unreachable @assistant-ui/core session controllers for
// inert stand-ins (vite.config.ts). This pins what makes that safe; a failure means "drop the alias", not "edit the test".
const base = "node_modules/@assistant-ui/core/dist/runtime/base";
const read = (path: string) => readFileSync(path, "utf8");

test("stand-ins are valid only for the pinned library and while the island passes no voice/dictation adapter", () => {
  assert.equal(JSON.parse(read("node_modules/@assistant-ui/core/package.json")).version, "0.3.35");
  assert.match(read("vite.config.ts"), /"\.\/voice-session\.js": [^\n]*src\/vendor\/assistant-ui-core\/voice-session\.ts/);
  assert.match(read("vite.config.ts"), /"\.\/dictation-session\.js": [^\n]*src\/vendor\/assistant-ui-core\/dictation-session\.ts/);
  assert.doesNotMatch(read("src/chat-react/externalStore.ts"), /voice|dictation/i);
});

test("tool-invocation tracker stand-in: the host builds a tracker only on opt-in, which the island never gives", async () => {
  const host = read("node_modules/@assistant-ui/core/dist/runtimes/external-store/external-store-thread-runtime-core.js");
  assert.match(read("vite.config.ts"), /"\.\.\/tool-invocations\/ToolInvocationTracker\.js": [^\n]*src\/vendor\/assistant-ui-core\/tool-invocation-tracker\.ts/);
  assert.equal(host.match(/new ToolInvocationTracker\(/g)?.length, 1, "one construction site");
  assert.match(host, /_driveToolInvocations\(\) \{\n\t\tif \(!this\._store\.unstable_enableToolInvocations\) \{/, "behind the opt-in");
  for (const file of ["src/chat-react/externalStore.ts", "src/chat-react/ChatApp.tsx", "src/chat-react/useCoreConversation.ts"]) {
    assert.doesNotMatch(read(file), /unstable_enableToolInvocations|unstable_isClientToolCall/, file);
  }
  const stub = await import("../src/vendor/assistant-ui-core/tool-invocation-tracker.ts");
  assert.equal(await stub.NO_TOOL_EXECUTIONS, undefined);
  assert.throws(() => new (stub.ToolInvocationTracker as unknown as new () => unknown)(), /not bundled/);
});

test("every member the library hosts touch exists on the stand-ins and behaves as the original without a session", async () => {
  const messages = [{ id: "a", role: "assistant", status: { type: "running" } }];
  const host = { adapter: () => undefined, isRunning: () => false, dirty: 0, notified: 0, getBaseMessages: () => messages,
    markVoiceMessagesDirty() { this.dirty += 1; }, notify() { this.notified += 1; } };
  const voice = new VoiceSessionController(host);
  for (const [, member] of read(`${base}/base-thread-runtime-core.js`).matchAll(/_voiceController\.(\w+)/g)) assert.ok(member! in voice, `voice.${member}`);
  const dictation = new DictationSessionController({ getAdapter: () => undefined });
  for (const [, member] of read(`${base}/base-composer-runtime-core.js`).matchAll(/_dictationSessionController\.(\w+)/g)) assert.ok(member! in dictation, `dictation.${member}`);

  assert.equal(voice.getMessages(), messages, "no voice transcripts: the host's own list, same reference");
  assert.equal(voice.isVoiceMessage(), false);
  assert.equal(voice.isRunActive(), true, "a running assistant tail still counts as an active run");
  assert.equal(voice.voice, undefined);
  assert.equal(voice.getVoiceVolume(), 0);
  assert.equal(voice.getVoiceCommitBarrier(), undefined);
  voice.markMessagesDirty();
  assert.equal(voice.voiceGeneration, 1);
  voice.disconnectVoice();
  assert.deepEqual([host.dirty, host.notified], [1, 1]);
  assert.throws(() => voice.connectVoice(), /Voice adapter not configured/);
  assert.throws(() => voice.muteVoice(), /No active voice session/);
  await assert.rejects(voice.appendToVoiceSession());
  assert.equal(dictation.dictation, undefined);
  dictation.rebase(); dictation.cancel(); dictation.stopDictation();
  assert.throws(() => dictation.startDictation(), /Dictation adapter not configured/);
});

// The other UI tests load the library from node_modules (real controllers). This one bundles it through Vite the way
// the production build does, so the composer and a thread actually run on the stand-ins.
let vite: ViteDevServer;
before(async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new JSDOM("").window });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    ssr: { noExternal: [/^@assistant-ui\//] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
});
after(async () => { await vite?.close(); });

test("the island runtime renders, sends and reports capabilities on the stand-ins", async () => {
  const aui = await vite.ssrLoadModule("@assistant-ui/react") as typeof import("@assistant-ui/react");
  const React = await import("react");
  const { renderToString } = await import("react-dom/server");
  const sent: unknown[] = [];
  let runtime!: ReturnType<typeof aui.useExternalStoreRuntime>;
  function App() {
    runtime = aui.useExternalStoreRuntime({
      messages: [{ id: "m1", role: "user", content: [{ type: "text", text: "hello-stub" }] }], isRunning: false,
      convertMessage: (message: import("@assistant-ui/react").ThreadMessageLike) => message,
      onNew: async (message) => { sent.push(message.content); },
    });
    return React.createElement(aui.AssistantRuntimeProvider, { runtime },
      React.createElement(aui.ThreadPrimitive.Messages, { components: { Message: () => React.createElement(aui.MessagePrimitive.Root, null, React.createElement(aui.MessagePrimitive.Parts)) } }));
  }
  assert.match(renderToString(React.createElement(App)), /hello-stub/);
  const state = runtime.thread.getState();
  assert.deepEqual([state.messages.length, state.capabilities.voice, state.capabilities.dictation, state.voice], [1, false, false, undefined]);
  runtime.thread.composer.setText("typed");
  await runtime.thread.composer.send();
  assert.equal(sent.length, 1);
  assert.throws(() => runtime.thread.connectVoice(), /Voice adapter not configured/);
  assert.throws(() => runtime.thread.composer.startDictation(), /Dictation adapter not configured/);
  // Proof the bundled library really resolved to the stand-in, not node_modules.
  const graph = [...vite.moduleGraph.idToModuleMap.keys()];
  assert.ok(graph.some((id) => id.endsWith("src/vendor/assistant-ui-core/voice-session.ts")));
  assert.ok(graph.some((id) => id.endsWith("src/vendor/assistant-ui-core/dictation-session.ts")));
  assert.ok(!graph.some((id) => /@assistant-ui\/core\/dist\/runtime\/base\/(voice|dictation)-session\.js/.test(id)));
  assert.ok(graph.some((id) => id.includes("@assistant-ui/core/dist/runtime/base/base-thread-runtime-core.js")), "library was bundled through Vite");
});

test("assistant-stream/utils stand-in: aui parses argsText only for a tool-call without args, which the island never sends", async () => {
  assert.equal(JSON.parse(read("node_modules/assistant-stream/package.json")).version, "0.3.57");
  assert.match(read("vite.config.ts"), /id === "assistant-stream\/utils" && importer\?\.endsWith\("\/@assistant-ui\/core\/dist\/runtime\/utils\/thread-message-like\.js"\)\n[^\n]*src\/vendor\/assistant-ui-core\/assistant-stream-utils\.ts/);
  const convert = read("node_modules/@assistant-ui/core/dist/runtime/utils/thread-message-like.js");
  assert.equal(convert.match(/parsePartialJsonObject\(/g)?.length, 1, "one call site");
  assert.match(convert, /if \(part\.args\) return \{[^}]*args: part\.args,[^}]*\};\n\t+return \{\n\t+\.\.\.commonProps,\n\t+args: parsePartialJsonObject\(part\.argsText \?\? ""\) \?\? \{\}/, "only without args");
  // Every runtime value import of assistant-stream/utils by a module the island can bundle is that one call site.
  const island = read("src/chat-react/threadMessages.ts");
  assert.equal(island.match(/type: "tool-call"/g)?.length, 1);
  assert.match(island, /type: "tool-call", [^\n]*args: \{\},/);
  for (const file of ["src/chat-react/externalStore.ts", "src/chat-react/ChatApp.tsx", "src/chat-react/useCoreConversation.ts"]) {
    assert.doesNotMatch(read(file), /argsText|type: "tool-call"/, file);
  }
  const { parsePartialJsonObject } = await import("../src/vendor/assistant-ui-core/assistant-stream-utils.ts");
  const original = await import("assistant-stream/utils");
  for (const text of ['{"a":1,"b":[true,null]}', "{}", '{"q":"猫"}']) {
    const [mine, theirs] = [parsePartialJsonObject(text)!, original.parsePartialJsonObject(text)!];
    assert.deepEqual(JSON.parse(JSON.stringify(mine)), JSON.parse(JSON.stringify(theirs)), text);
    assert.deepEqual(Object.getOwnPropertySymbols(mine).map((key) => mine[key]), [original.getPartialJsonObjectMeta(theirs)], text);
  }
  assert.deepEqual(Object.getOwnPropertySymbols(parsePartialJsonObject("")!).map((key) => parsePartialJsonObject("")![key]), [original.getPartialJsonObjectMeta(original.parsePartialJsonObject("")!)]);
  assert.deepEqual(JSON.stringify(parsePartialJsonObject("[1]")), JSON.stringify(original.parsePartialJsonObject("[1]")));
  for (const text of ["1", "null", '"x"']) assert.equal(parsePartialJsonObject(text), original.parsePartialJsonObject(text), text);
  assert.equal(parsePartialJsonObject('{"__proto__":{"x":1}}'), undefined);
  assert.equal(parsePartialJsonObject('{"a":'), undefined, "partial args are not repaired (the caller falls back to {})");
});
