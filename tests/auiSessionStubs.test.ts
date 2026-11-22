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

test("tool-approval resolver stand-in (exp104): both library call sites sit behind a pending approval the island never makes", async () => {
  const core = "node_modules/@assistant-ui/core/dist";
  const config = read("vite.config.ts");
  assert.match(config, /"\.\.\/utils\/resolveToolApprovalResponse\.js": [^\n]*src\/vendor\/assistant-ui-core\/resolve-tool-approval\.ts/);
  assert.match(config, /"\.\.\/\.\.\/runtime\/utils\/resolveToolApprovalResponse\.js": [^\n]*src\/vendor\/assistant-ui-core\/resolve-tool-approval\.ts/);
  const part = read(`${core}/runtime/api/message-part-runtime.js`);
  assert.equal(part.match(/resolveToolApprovalResponse\(/g)?.length, 1);
  assert.match(part, /if \(!approval \|\| approval\.approved !== void 0 \|\| approval\.resolution !== void 0\) throw new Error\("Tool call has no pending approval"\);\n\t\treturn core\.respondToToolApproval\(resolveToolApprovalResponse\(/);
  const external = read(`${core}/store/clients/external-thread.js`);
  assert.equal(external.match(/resolveToolApprovalResponse\(/g)?.length, 1);
  assert.match(external, /if \(!part\.approval \|\| part\.approval\.approved !== void 0 \|\| part\.approval\.resolution !== void 0\) throw new Error\("Tool call has no pending approval"\);\n\t\t\tconst options = resolveToolApprovalResponse\(/);
  for (const file of ["src/chat-react/threadMessages.ts", "src/chat-react/externalStore.ts", "src/chat-react/ChatApp.tsx", "src/chat-react/useCoreConversation.ts"]) {
    assert.doesNotMatch(read(file), /approval|onRespondToToolApproval/i, file);
  }
  const stub = await import("../src/vendor/assistant-ui-core/resolve-tool-approval.ts");
  assert.throws(() => stub.resolveToolApprovalResponse(), /not bundled/);
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
    ssr: { noExternal: [/^@assistant-ui\//, /^radix-ui/, /^@radix-ui\//] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
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
      React.createElement(aui.ThreadPrimitive.Viewport, { autoScroll: false },
        React.createElement(aui.ThreadPrimitive.Messages, { components: { Message: () => React.createElement(aui.MessagePrimitive.Root, null, React.createElement(aui.MessagePrimitive.Parts)) } })));
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
  // exp107: the interactable gate and the history copy also resolve to their stand-ins in the running island runtime.
  assert.ok(graph.some((id) => id.endsWith("src/vendor/assistant-ui-core/interactable-composer-metadata.ts")));
  assert.ok(graph.some((id) => id.endsWith("src/vendor/assistant-ui-core/external-store-history-copy.ts")));
  // exp109: the viewport and message root resolve their top-anchor imports to the stand-in.
  assert.ok(graph.some((id) => id.endsWith("src/vendor/assistant-ui-core/top-anchor.ts")));
  assert.ok(!graph.some((id) => /@assistant-ui\/react\/dist\/primitives\/thread\/topAnchor\//.test(id)));
  assert.ok(graph.some((id) => id.endsWith("src/vendor/assistant-ui-core/default-edit-composer.ts")));
  assert.ok(graph.some((id) => id.endsWith("src/vendor/assistant-ui-core/radix-slot.ts")));
  assert.ok(graph.some((id) => id.endsWith("src/vendor/assistant-ui-core/tool-parts.ts")));
  // (The full @assistant-ui/react barrel loaded here also pulls radix menu/collection, which import react-slot themselves;
  // the island's per-file primitives never do. The production bundle check is in the exp109 build evidence.)
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

test("interactable composer-metadata stand-in (exp107): the island registers no model-context provider, so nothing is ever gated", async () => {
  const core = "node_modules/@assistant-ui/core/dist";
  assert.match(read("vite.config.ts"), /id === "\.\.\/\.\.\/model-context\/interactable-composer-metadata\.js" && importer\?\.endsWith\("\/@assistant-ui\/core\/dist\/runtime\/base\/base-thread-runtime-core\.js"\)\n[^\n]*src\/vendor\/assistant-ui-core\/interactable-composer-metadata\.ts/);
  // The one bundled importer reads only gateInteractableComposerMetadata, on the composer metadata of the model context.
  const host = read(`${core}/runtime/base/base-thread-runtime-core.js`);
  assert.match(host, /^import \{ gateInteractableComposerMetadata \} from "\.\.\/\.\.\/model-context\/interactable-composer-metadata\.js";$/m);
  assert.equal(host.match(/gateInteractableComposerMetadata\(/g)?.length, 1, "one call site");
  assert.match(host, /gateInteractableComposerMetadata\(this\.getModelContext\(\)\.unstable_composerMetadata, /);
  // Composer metadata only comes from model-context providers / interactables; the island source has none.
  for (const file of ["src/chat-react/externalStore.ts", "src/chat-react/ChatApp.tsx", "src/chat-react/useCoreConversation.ts", "src/chat-react/mount.tsx", "src/chat-react/auiPrimitives.ts"]) {
    assert.doesNotMatch(read(file), /unstable_composerMetadata|Interactable|ModelContext|makeAssistantTool|useAssistantInstructions/, file);
  }
  const stub = await import("../src/vendor/assistant-ui-core/interactable-composer-metadata.ts");
  const original = await import(`../${core}/model-context/interactable-composer-metadata.js`);
  const messages = [{ id: "u1", role: "user", content: [], metadata: {} }];
  for (const meta of [undefined, {}, { other: 1 }, { a: "x", b: [1] }]) {
    assert.deepEqual(stub.gateInteractableComposerMetadata(meta as never, messages as never), original.gateInteractableComposerMetadata(meta, messages), JSON.stringify(meta));
  }
  assert.throws(() => stub.gateInteractableComposerMetadata({ interactables: [{ id: "i", name: "n", state: {} }] } as never, messages as never), /not bundled/);
});

test("external-store history-copy stand-in (exp107): with no history adapter the runtime hook only constructs it", async () => {
  const hook = read("node_modules/@assistant-ui/core/dist/react/runtimes/useExternalStoreRuntime.js");
  assert.match(read("vite.config.ts"), /id === "\.\/external-store-history-copy\.js" && importer\?\.endsWith\("\/@assistant-ui\/core\/dist\/react\/runtimes\/useExternalStoreRuntime\.js"\)\n[^\n]*src\/vendor\/assistant-ui-core\/external-store-history-copy\.ts/);
  // The copy is used only when a runtime-adapters provider supplies `history.unstable_copy`; both uses sit behind that.
  assert.match(hook, /const \{ modelContext, feedback, history \} = useRuntimeAdapters\(\) \?\? \{\};/);
  assert.match(hook, /const copiesHistory = !!history\?\.unstable_copy && /);
  assert.match(hook, /if \(!copiesHistory \|\| store\.unstable_onRecordToolInteraction\) return withFeedback;/);
  assert.match(hook, /if \(!copiesHistory \|\| !history\) return;\n\t\treturn historyCopy\.attach\(/);
  assert.deepEqual([...hook.matchAll(/historyCopy\.(\w+)/g)].map((m) => m[1]).sort(), ["attach", "recordInteraction"]);
  for (const file of ["src/chat-react/externalStore.ts", "src/chat-react/ChatApp.tsx", "src/chat-react/useCoreConversation.ts", "src/chat-react/mount.tsx"]) {
    assert.doesNotMatch(read(file), /RuntimeAdapterProvider|useRuntimeAdapters|unstable_copy|unstable_persistsHistory/, file);
  }
  const { ExternalStoreHistoryCopy } = await import("../src/vendor/assistant-ui-core/external-store-history-copy.ts");
  const copy = new ExternalStoreHistoryCopy();
  assert.throws(() => copy.attach(), /not bundled/);
  await assert.rejects(copy.recordInteraction(), /not bundled/);
});

test("top-anchor stand-in (exp109): the island never sets turnAnchor=\"top\", so the viewport and message root never reach it", async () => {
  const dist = "node_modules/@assistant-ui/react/dist";
  const config = read("vite.config.ts");
  assert.match(config, /id === "\.\/topAnchor\/useTopAnchorReserve\.js" \|\| id === "\.\/topAnchor\/topAnchorTurn\.js"\) && importer\?\.endsWith\("\/@assistant-ui\/react\/dist\/primitives\/thread\/ThreadViewport\.js"\)/);
  assert.match(config, /id === "\.\.\/thread\/topAnchor\/topAnchorUtils\.js" && importer\?\.endsWith\("\/@assistant-ui\/react\/dist\/primitives\/message\/MessageRoot\.js"\)/);
  // The store defaults to "bottom"; the island passes no turnAnchor to the viewport or its provider.
  assert.match(read(`${dist}/context/stores/ThreadViewport.js`), /turnAnchor: options\.turnAnchor \?\? "bottom",/);
  for (const file of ["src/chat-react/ChatApp.tsx", "src/chat-react/ScrollViewport.tsx", "src/chat-react/mount.tsx", "src/chat-react/auiPrimitives.ts"]) {
    assert.doesNotMatch(read(file), /turnAnchor|topAnchor|ViewportProvider options|options=\{/, file);
  }
  // Viewport: every top-anchor call is behind `topAnchorEnabled` (turnAnchor === "top").
  const viewport = read(`${dist}/primitives/thread/ThreadViewport.js`);
  assert.match(viewport, /const topAnchorEnabled = t2\.turnAnchor === "top";\n\tuseTopAnchorTurn\(topAnchorEnabled\);\n\tuseTopAnchorReserve\(topAnchorEnabled\);/);
  assert.equal(viewport.match(/useTopAnchorReserve\(/g)?.length, 1);
  assert.match(viewport, /if \(!enabled\) return;\n\t\t\treturn getActiveTopAnchorAnchorId\(s\.thread\);/);
  assert.match(viewport, /if \(!enabled\) return;\n\t\t\treturn getActiveTopAnchorTargetId\(s_0\.thread\);/);
  assert.match(viewport, /t3 = \(s_2\) => enabled && !!topAnchorTurn && isTopAnchorTurnValid\(/);
  assert.equal(viewport.match(/(getActiveTopAnchorAnchorId|getActiveTopAnchorTargetId|isTopAnchorTurnValid)\(/g)?.length, 3);
  // Message root: parseCssLength only inside the top-anchor target ref, which is mounted only for turnAnchor === "top".
  const root = read(`${dist}/primitives/message/MessageRoot.js`);
  assert.equal(root.match(/parseCssLength\(/g)?.length, 2);
  assert.match(root, /if \(!active\) return;\n\t\t\tconst state = threadViewportStore\.getState\(\);\n\t\t\tconst clamp = state\.topAnchorMessageClamp;/);
  assert.match(root, /if \(threadViewportStore\.getState\(\)\.turnAnchor === "top"\) \{/);
  const stub = await import("../src/vendor/assistant-ui-core/top-anchor.ts");
  assert.equal(stub.useTopAnchorReserve(false), undefined, "disabled: no hook, no effect");
  assert.throws(() => stub.useTopAnchorReserve(true), /not bundled/);
  for (const fn of [stub.getActiveTopAnchorAnchorId, stub.getActiveTopAnchorTargetId, stub.isTopAnchorTurnValid, stub.parseCssLength]) {
    assert.throws(() => (fn as () => unknown)(), /not bundled/);
  }
});

test("edit-composer stand-in (exp109): the island passes no onEdit, so the external-store thread never opens an aui edit composer", async () => {
  const core = "node_modules/@assistant-ui/core/dist";
  assert.match(read("vite.config.ts"), /id === "\.\/default-edit-composer-runtime-core\.js" && importer\?\.endsWith\("\/@assistant-ui\/core\/dist\/runtime\/base\/base-thread-runtime-core\.js"\)\n[^\n]*src\/vendor\/assistant-ui-core\/default-edit-composer\.ts/);
  // The class is constructed only inside BaseThreadRuntimeCore.beginEdit, which the external-store core guards with onEdit.
  const base = read(`${core}/runtime/base/base-thread-runtime-core.js`);
  assert.equal(base.match(/new DefaultEditComposerRuntimeCore\(/g)?.length, 1, "one construction site");
  assert.equal(base.match(/DefaultEditComposerRuntimeCore/g)?.length, 2, "import + construction only");
  assert.match(base, /\tbeginEdit\(messageId\) \{\n(?:\t\t[^\n]*\n)*?\t\tconst open = \(message, runConfig\) => \{\n\t\t\tconst composer = new DefaultEditComposerRuntimeCore\(/);
  const external = read(`${core}/runtimes/external-store/external-store-thread-runtime-core.js`);
  assert.match(external, /\tbeginEdit\(messageId\) \{\n\t\tif \(!this\._store\.onEdit\) throw new Error\("Runtime does not support editing\."\);\n\t\tsuper\.beginEdit\(messageId\);/);
  // The island adapter has no onEdit (its own edit button sends a new message through Core, see MessageActions).
  for (const file of ["src/chat-react/externalStore.ts", "src/chat-react/ChatApp.tsx", "src/chat-react/useCoreConversation.ts", "src/chat-react/mount.tsx"]) {
    assert.doesNotMatch(read(file), /onEdit|beginEdit|useActionBarEdit|ActionBarPrimitive\.Edit|EditComposer/, file);
  }
  const { DefaultEditComposerRuntimeCore } = await import("../src/vendor/assistant-ui-core/default-edit-composer.ts");
  assert.throws(() => new DefaultEditComposerRuntimeCore(), /not bundled/);
});

test("radix Slot stand-in (exp109): Slot renders only for asChild/render, which the island never passes to an aui primitive", async () => {
  const dist = "node_modules/@assistant-ui/react/dist";
  assert.equal(JSON.parse(read("node_modules/@radix-ui/react-slot/package.json")).version, "1.5.0");
  assert.match(read("vite.config.ts"), /id === "@radix-ui\/react-slot" && \(importer\?\.endsWith\("\/radix-ui\/dist\/index\.mjs"\) \|\| importer\?\.endsWith\("\/@radix-ui\/react-primitive\/dist\/index\.mjs"\)\)\n[^\n]*src\/vendor\/assistant-ui-core\/radix-slot\.ts/);
  // Every bundled Slot render sits behind asChild or a `render` element.
  const primitive = read("node_modules/@radix-ui/react-primitive/dist/index.mjs");
  assert.match(primitive, /const Slot = createSlot\(`Primitive\.\$\{node\}`\);/);
  assert.match(primitive, /const Comp = asChild \? Slot : node;/);
  assert.equal(primitive.match(/\bSlot\b/g)?.length, 2);
  const wrapper = read(`${dist}/utils/Primitive.js`);
  assert.equal(wrapper.match(/Slot\.Root/g)?.length, 1);
  assert.match(wrapper, /function renderSlot\(render, children, props\) \{\n\treturn \/\* @__PURE__ \*\/ jsx\(Slot\.Root, \{/);
  assert.match(wrapper, /if \(render && isValidElement\(render\)\) \{/);
  assert.match(read(`${dist}/primitives/composer/ComposerInput.js`), /if \(render && isValidElement\(render\)\) return renderSlot\(render, rest\.children, inputProps\);\n\tconst Component = asChild \? Slot\.Root : TextareaAutosize;/);
  assert.match(read(`${dist}/primitives/composer/ComposerAttachmentDropzone.js`), /if \(render && isValidElement\(render\)\) return renderSlot\(render, children, mergedProps\);\n\tconst Comp = asChild \? Slot\.Root : "div";/);
  // The island never passes asChild or render; it renders its own elements as children.
  for (const file of ["ChatApp.tsx", "ScrollViewport.tsx", "MessageActions.tsx", "ModelControls.tsx", "ProfileControls.tsx", "ToolGrants.tsx", "WorkflowForm.tsx", "AudioFilePicker.tsx", "MediaCard.tsx", "auiPrimitives.ts"]) {
    assert.doesNotMatch(read(`src/chat-react/${file}`), /asChild|\brender=\{/, file);
  }
  const stub = await import("../src/vendor/assistant-ui-core/radix-slot.ts");
  const Slot = stub.createSlot("Primitive.div") as unknown as () => unknown;
  assert.equal(typeof Slot, "function", "module-load construction stays inert");
  assert.throws(() => Slot(), /not bundled/);
  assert.throws(() => (stub.Root as unknown as () => unknown)(), /not bundled/);
  assert.equal(stub.Root, stub.Slot);
});

test("tool-interaction / tool-response / generative-ui stand-ins (exp109): the island's parts carry none and it calls no tool-result API", async () => {
  const core = "node_modules/@assistant-ui/core/dist";
  const config = read("vite.config.ts");
  assert.match(config, /id === "\.\/tool-interactions\.js" && importer\?\.endsWith\("\/@assistant-ui\/core\/dist\/runtime\/utils\/thread-message-like\.js"\)/);
  assert.match(config, /\(id === "\.\.\/utils\/tool-interactions\.js" \|\| id === "assistant-stream"\) && importer\?\.endsWith\("\/@assistant-ui\/core\/dist\/runtime\/api\/message-part-runtime\.js"\)/);
  assert.match(config, /id === "\.\.\/generativeUI\/GenerativeUI\.js" && importer\?\.endsWith\("\/@assistant-ui\/core\/dist\/react\/primitives\/message\/MessageParts\.js"\)/);
  // Conversion reads the interaction log only from a tool-call part's unstable_interactions, which the island never sets.
  const convert = read(`${core}/runtime/utils/thread-message-like.js`);
  assert.equal(convert.match(/readToolInteractionLog\(/g)?.length, 1);
  assert.match(convert, /const \{ parentId, messages, unstable_interactions, \.\.\.basePart \} = part;\n\t+const interactions = readToolInteractionLog\(unstable_interactions\);/);
  // The part runtime uses createToolInteraction / ToolResponse only in unstable_recordInteraction / addToolResult.
  const part = read(`${core}/runtime/api/message-part-runtime.js`);
  assert.match(part, /^import \{ ToolResponse \} from "assistant-stream";$/m);
  assert.equal(part.match(/ToolResponse\./g)?.length, 1);
  assert.match(part, /\taddToolResult\(result\) \{\n(?:\t\t[^\n]*\n)*?\t\tconst response = ToolResponse\.toResponse\(result\);/);
  assert.equal(part.match(/createToolInteraction\(/g)?.length, 1);
  assert.match(part, /\tasync unstable_recordInteraction\(input\) \{\n(?:\t\t[^\n]*\n)*?\t\t\tinteraction: createToolInteraction\(input\)/);
  // MessageParts renders GenerativeUIRender only for a generative-ui part with a components.generativeUI allowlist.
  const parts = read(`${core}/react/primitives/message/MessageParts.js`);
  assert.equal(parts.match(/GenerativeUIRender\b/g)?.length, 2, "import + one render");
  assert.match(parts, /case "generative-ui": \{\n\t\t\tif \(!generativeUI\?\.components\) \{/);
  const island = read("src/chat-react/threadMessages.ts");
  assert.doesNotMatch(island, /unstable_interactions|generative-ui/);
  for (const file of ["ChatApp.tsx", "ToolIO.tsx", "MessageActions.tsx", "threadMessages.ts", "externalStore.ts", "useCoreConversation.ts"]) {
    assert.doesNotMatch(read(`src/chat-react/${file}`), /addResult|addToolResult|resumeToolCall|recordInteraction|generativeUI|GenerativeUI|ToolResponse/, file);
  }
  const stub = await import("../src/vendor/assistant-ui-core/tool-parts.ts");
  const original = await import(`../${core}/runtime/utils/tool-interactions.js`);
  assert.equal(stub.readToolInteractionLog(undefined), original.readToolInteractionLog(undefined));
  assert.throws(() => stub.readToolInteractionLog({ entries: [] }), /not bundled/);
  assert.throws(() => stub.createToolInteraction(), /not bundled/);
  assert.throws(() => stub.ToolResponse.toResponse(), /not bundled/);
  assert.throws(() => (stub.GenerativeUIRender as unknown as () => unknown)(), /not bundled/);
});
