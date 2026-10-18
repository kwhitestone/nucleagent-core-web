import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

// Attach to the authorized existing browser. Never launch Chrome or read
// existing tab contents; all DOM operations target the owned isolated page.
const endpoint = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9229";
const base = process.env.FIXTURE_URL ?? "http://127.0.0.1:5198/tests/browser/session-renewal/";
const version = await (await fetch(`${endpoint}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map();
let sequence = 0;
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
const blocked = [];
const exceptions = [];
const dialogs = [];
let disposing = false;
function intercept(method, params, sessionId) {
  void send(method, params, sessionId).catch(error => {
    if (!disposing) exceptions.push(`Interception failed: ${error.message}`);
  });
}
const syntheticPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=";
ws.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  if (event.id) {
    const task = pending.get(event.id);
    if (!task) return;
    pending.delete(event.id);
    clearTimeout(task.timer);
    if (event.error) task.reject(Error(event.error.message));
    else task.resolve(event.result);
  } else if (event.method === "Page.javascriptDialogOpening") {
    dialogs.push({ type: event.params.type });
    intercept("Page.handleJavaScriptDialog", { accept: true }, event.sessionId);
  } else if (event.method === "Runtime.exceptionThrown") {
    exceptions.push(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text);
  } else if (event.method === "Fetch.requestPaused") {
    const { requestId, request } = event.params;
    if (request.url === "https://image.renewal.test/avatar.png") {
      intercept("Fetch.fulfillRequest", { requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "image/png" }], body: syntheticPng }, event.sessionId);
      return;
    }
    const allowed = request.url.startsWith(new URL(base).origin + "/") ||
      request.url.startsWith(new URL(base).origin.replace("127.0.0.1", "localhost") + "/");
    if (!allowed) blocked.push({ external: true, method: request.method });
    intercept(allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
      allowed ? { requestId } : { requestId, errorReason: "BlockedByClient" }, event.sessionId);
  }
};
const before = (await send("Target.getTargets")).targetInfos.filter(t => t.type === "page").map(t => t.targetId);
const { browserContextId } = await send("Target.createBrowserContext");
let targetId, sessionId;
const results = [];
const negatives = [];
const extended = [];
const page = (method, params) => send(method, params, sessionId);
async function evaluate(expression) {
  const response = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? "Browser evaluation failed");
  return response.result.value;
}
const child = expression => evaluate(`(()=>{const w=document.querySelector("iframe").contentWindow; const d=w.document; return (${expression});})()`);
async function prepareImage(consumer) {
  if (consumer === "owner") {
    // Synthetic in-memory file exercises the real picker without accessing user files.
    await child(`(()=>{const transfer=new w.DataTransfer();transfer.items.add(new w.File([
      Uint8Array.from(w.atob(${JSON.stringify(syntheticPng)}),c=>c.charCodeAt(0))
    ],"synthetic.png",{type:"image/png"}));const input=d.querySelector("#ua-avatar");
    input.files=transfer.files;input.dispatchEvent(new w.Event("change",{bubbles:true}));})()`);
  }
  await wait('!!document.querySelector("iframe").contentDocument.querySelector(".agent-avatar-picker img, img.head-avatar")');
  await child('(w.savedImage=d.querySelector(".agent-avatar-picker img, img.head-avatar"),w.savedImage.decode())');
  assert.equal(await child("w.savedImage.naturalWidth > 0"), true);
}
async function wait(expression) {
  await evaluate(`new Promise((resolve,reject)=>{const until=performance.now()+8000;
    function poll(){try{if(${expression})return resolve(true)}catch{} if(performance.now()>until)return reject(Error("Fixture condition timed out"));requestAnimationFrame(poll)}poll()})`);
}
async function key(key, modifiers = 0) {
  for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", {
    type, key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    windowsVirtualKeyCode: ({ a: 65, Home: 36, ArrowRight: 39 })[key], modifiers,
  });
}
try {
  ({ targetId } = await send("Target.createTarget", { url: "about:blank", background: true, browserContextId }));
  ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
  await page("Runtime.enable");
  await page("Page.enable");
  await page("Accessibility.enable");
  await page("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await page("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await evaluate("location.href"), "about:blank");
  assert.ok((await page("Accessibility.getFullAXTree")).nodes.length > 0);
  for (const width of [1280, 390]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const consumer of ["owner", "admin"]) {
      const started = performance.now();
      const selector = consumer === "owner" ? "#ua-name" : "#definition-name";
      await page("Page.navigate", { url: `${base}?consumer=${consumer}` });
      await wait('document.querySelector("iframe")?.contentWindow?.renewalFixture?.state().version === 1');
      await wait(`document.querySelector("iframe").contentDocument.querySelector(${JSON.stringify(selector)})`);
      await prepareImage(consumer);
      await child('Promise.all(d.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))');
      const { frameTree } = await page("Page.getFrameTree");
      const visible = await page("Accessibility.getFullAXTree", { frameId: frameTree.childFrames[0].frame.id });
      assert.ok(visible.nodes.some(node => node.role?.value === "textbox"));
      await child(`d.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:"center",behavior:"instant"})`);
      await child("new Promise(resolve=>w.requestAnimationFrame(resolve))");
      const point = await child(`(()=>{const e=d.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(d.elementFromPoint(x,y)!==e)throw Error("Editor field is occluded");return {x,y};})()`);
      for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
      await key("a", 2);
      await page("Input.insertText", { text: "Synthetic unsaved draft" });
      await key("Home");
      await key("ArrowRight", 8);
      await key("ArrowRight", 8);
      const initial = await child(`(()=>{const e=d.querySelector(${JSON.stringify(selector)});w.savedEditor=e;w.oldSignal=w.renewalFixture.signal();return {draft:e.value==="Synthetic unsaved draft",focused:d.activeElement===e,selected:e.selectionEnd-e.selectionStart};})()`);
      assert.deepEqual(initial, { draft: true, focused: true, selected: 2 });
      // Reject stale shell version without destroying the valid current editor.
      await evaluate('renewalHost.auth(0, "synthetic-stale-session")');
      await child("new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)))");
      assert.equal(await child("w.renewalFixture.state().version"), 1);
      assert.equal(await child("d.activeElement===w.savedEditor && w.savedEditor.isConnected"), true);
      // Same authenticated principal and grants, rotated credential/version.
      await evaluate('renewalHost.auth(2, "synthetic-session-two")');
      await wait('document.querySelector("iframe").contentWindow.renewalFixture.state().version === 2');
      const actual = await child(`(()=>{const e=d.querySelector(${JSON.stringify(selector)});return {
        sameEditor:e===w.savedEditor, draft:e?.value==="Synthetic unsaved draft",
        imagePreserved:w.savedImage.isConnected && w.savedImage.naturalWidth > 0,
        focused:d.activeElement===w.savedEditor, selected:e?.selectionEnd-e?.selectionStart || 0,
        oldSignalAborted:w.oldSignal.aborted, ...w.renewalFixture.state()};})()`);
      assert.equal(actual.writes, 0);
      assert.equal(actual.oldSignalAborted, true);
      assert.equal(actual.imagePreserved, true);
      const preserved = actual.sameEditor && actual.draft && actual.focused && actual.selected === 2;
      results.push({ consumer, width, initial, actual, renewalPreserved: preserved,
        staleVersionRejected: true, durationMs: Math.round(performance.now() - started) });
      // The credential rejection path must still clear a remounted protected tree.
      await child("w.renewalFixture.rejectCurrent()");
      await wait('!document.querySelector("iframe").contentWindow.renewalFixture.state().authenticated');
      assert.equal(await child('!!d.querySelector("#ua-name, #definition-name")'), false);
      assert.equal(await child("w.savedImage.isConnected"), false);
      await evaluate('renewalHost.auth(2, "synthetic-session-two")');
      await child("new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)))");
      assert.equal(await child("w.renewalFixture.state().authenticated"), false);
      results.at(-1).rejectedCredentialCannotResurrect = true;
    }
  }
  for (const consumer of ["owner", "admin"]) {
    const selector = consumer === "owner" ? "#ua-name" : "#definition-name";
    for (const boundary of ["logout", "account-switch", "permission-revoked", "current-401", "late-read-after-logout"]) {
      const started = performance.now();
      const late = boundary === "late-read-after-logout";
      await page("Page.navigate", { url: `${base}?consumer=${consumer}${late ? "&hold=1" : ""}` });
      await wait('document.querySelector("iframe")?.contentWindow?.renewalFixture?.state().version === 1');
      if (late) {
        await wait('document.querySelector("iframe").contentWindow.renewalFixture.state().pending >= 2');
      } else {
        await wait(`document.querySelector("iframe").contentDocument.querySelector(${JSON.stringify(selector)})`);
        await prepareImage(consumer);
        await child(`w.savedEditor=d.querySelector(${JSON.stringify(selector)})`);
      }
      if (boundary === "account-switch" || boundary === "permission-revoked") {
        // The new synthetic account/server policy cannot read the old record.
        // This is not a new ACL or a production permission change.
        await child("w.renewalFixture.deny()");
      }
      if (boundary === "current-401") await child("w.renewalFixture.rejectCurrent()");
      else if (boundary === "account-switch") await evaluate('renewalHost.auth(2, "synthetic-other-account", renewalHost.grants, 42)');
      else if (boundary === "permission-revoked") await evaluate('renewalHost.auth(2, "synthetic-revoked", [])');
      else await evaluate("renewalHost.auth(2, null, [])");
      await wait(boundary === "current-401"
        ? '!document.querySelector("iframe").contentWindow.renewalFixture.state().authenticated'
        : 'document.querySelector("iframe").contentWindow.renewalFixture.state().version === 2');
      if (late) await child("w.renewalFixture.release()");
      await child("new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)))");
      assert.equal(await child(`!!d.querySelector(${JSON.stringify(selector)})`), false);
      assert.equal(await child('!!d.querySelector("[data-template-id], [data-definition-id]")'), false);
      if (!late) assert.equal(await child("w.savedEditor.isConnected"), false);
      if (!late) assert.equal(await child("w.savedImage.isConnected"), false);
      const state = await child("w.renewalFixture.state()");
      assert.equal(state.writes, 0);
      assert.equal(state.pending, 0);
      negatives.push({ consumer, boundary, cleared: true, writes: 0, durationMs: Math.round(performance.now() - started) });
    }
  }
  for (const consumer of ["owner", "admin"]) {
    const selector = consumer === "owner" ? "#ua-name" : "#definition-name";
    const settle = () => child("new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)))");
    async function open() {
      await page("Page.navigate", { url: `${base}?consumer=${consumer}` });
      await wait(`document.querySelector("iframe")?.contentDocument?.querySelector(${JSON.stringify(selector)})`);
      await child(`w.savedEditor=d.querySelector(${JSON.stringify(selector)})`);
    }
    for (const boundary of ["unknown", "absent", "malformed", "same-token-other-principal", "grants-added", "grants-removed"]) {
      await open();
      await child("w.renewalFixture.deny()");
      if (boundary === "unknown") await evaluate('renewalHost.auth(2, "synthetic-session-one", renewalHost.grants, null)');
      if (boundary === "absent") await evaluate('renewalHost.send("auth", {source:"shell",type:"auth",token:"synthetic-session-one",sessionVersion:2,permissions:renewalHost.grants})');
      if (boundary === "malformed") await evaluate('renewalHost.send("auth", {source:"shell",type:"auth",token:"synthetic-session-one",sessionVersion:2,permissions:renewalHost.grants,principal:{id:"041"}})');
      if (boundary === "same-token-other-principal") await evaluate('renewalHost.auth(2, "synthetic-session-one", renewalHost.grants, 42)');
      if (boundary === "grants-added") await evaluate('renewalHost.auth(2, "synthetic-session-one", [...renewalHost.grants,"core:tool:read"])');
      if (boundary === "grants-removed") await evaluate('renewalHost.auth(2, "synthetic-session-one", ["core:admin:read"])');
      await wait('document.querySelector("iframe").contentWindow.renewalFixture.state().version===2');
      await settle();
      assert.equal(await child("w.savedEditor.isConnected"), false);
      assert.equal(await child('!!d.querySelector("[data-template-id], [data-definition-id], #ua-name, #definition-name")'), false);
      extended.push({ consumer, boundary, pass: true });
    }
    await open();
    for (const invalid of ["source", "protocol-version", "instance", "app", "stale"]) {
      const envelope = await evaluate(`({protocol:"prism-fusion/remote",version:1,appId:"core",
        instanceId:renewalHost.instanceId,type:"auth",payload:{source:"shell",type:"auth",
        token:null,sessionVersion:2,permissions:[],principal:null}})`);
      if (invalid === "protocol-version") envelope.version = 2;
      if (invalid === "instance") envelope.instanceId = "another-handshake";
      if (invalid === "app") envelope.appId = "other";
      if (invalid === "stale") envelope.payload.sessionVersion = 0;
      if (invalid === "source") {
        // A real message sent from the child itself, not the bound parent.
        await child(`w.eval(${JSON.stringify(`window.postMessage(${JSON.stringify(envelope)}, location.origin)`)})`);
      } else {
        await evaluate(`document.querySelector("iframe").contentWindow.postMessage(${JSON.stringify(envelope)},location.origin)`);
      }
      await settle();
      assert.equal(await child("w.renewalFixture.state().version"), 1);
      assert.equal(await child("w.savedEditor.isConnected"), true);
      extended.push({ consumer, invalid, pass: true });
    }
    // Hold a real component operation, rotate auth, then release an old result.
    await child(`(()=>{const e=w.savedEditor;e.value="Synthetic busy draft";e.dispatchEvent(new w.Event("input",{bubbles:true}));})()`);
    await child("(w.renewalFixture.hold(),w.renewalFixture.allowSyntheticWrite())");
    await settle();
    await child('w.savedForm=d.querySelector(".ua-wizard, .definition-drawer")');
    if (consumer === "owner") await child('d.querySelector(".ua-wizard").requestSubmit()');
    else await child('d.querySelector(".definition-drawer footer .primary").click()');
    await wait('document.querySelector("iframe").contentWindow.renewalFixture.state().pending>0');
    assert.equal(await child('!!w.savedForm.querySelector("button:disabled")'), true);
    await evaluate('renewalHost.auth(2, "synthetic-session-two")');
    await wait('document.querySelector("iframe").contentWindow.renewalFixture.state().version===2');
    assert.equal(await child("w.savedForm.isConnected"), true);
    await child("w.renewalFixture.release()");
    await wait(`document.querySelector("iframe").contentDocument.querySelector(${JSON.stringify(selector)})?.value === "Synthetic busy draft"`);
    assert.equal(await child(`w.savedForm.isConnected && !d.querySelector(${JSON.stringify(selector)}).matches(":disabled")`), true);
    await child(`w.savedEditor=d.querySelector(${JSON.stringify(selector)})`);
    const error = await child('d.querySelector(".ua-form-err, .definition-drawer [role=alert]")?.textContent');
    assert.ok(error, "Canceled operation must not report a successful save");
    await evaluate('renewalHost.auth(3, "synthetic-session-three")');
    await wait('document.querySelector("iframe").contentWindow.renewalFixture.state().version===3');
    assert.equal(await child('d.querySelector(".ua-form-err, .definition-drawer [role=alert]")?.textContent'), error);
    assert.equal(await child("w.savedEditor.isConnected && w.savedEditor.value==='Synthetic busy draft'"), true);
    extended.push({ consumer, scenario: "busy/error renewal, late response discarded", pass: true,
      syntheticWrites: await child("w.renewalFixture.state().writes") });
  }
  await page("Page.navigate", { url: base.replace("127.0.0.1", "localhost") });
  await wait('!!document.querySelector("iframe")?.contentWindow?.renewalFixture');
  await evaluate("renewalHost.auth()");
  await child("new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)))");
  assert.equal(await child("w.renewalFixture.state().authenticated"), false);
  assert.equal(await child("w.renewalFixture.state().version"), 0);
  extended.push({ invalid: "actual unallowlisted parent origin", pass: true });
} finally {
  disposing = true;
  await send("Target.disposeBrowserContext", { browserContextId });
  const after = (await send("Target.getTargets")).targetInfos.filter(t => t.type === "page").map(t => t.targetId);
  const cleanup = { ownedPageClosed: !after.includes(targetId), existingPagesPreserved: before.every(id => after.includes(id)) };
  writeFileSync(process.env.RESULT_PATH ?? "session-renewal-red.json", JSON.stringify({ results, negatives, extended, blocked, exceptions, dialogs, cleanup }, null, 2) + "\n");
  ws.close();
  assert.ok(cleanup.ownedPageClosed && cleanup.existingPagesPreserved);
}
console.log(JSON.stringify({ cases: results.length, red: results.filter(r => !r.renewalPreserved).length,
  negativeChecks: results.length * 2 + negatives.length, extended: extended.length,
  writes: results.reduce((n, r) => n + r.actual.writes, 0) }));
assert.ok(results.every(result => result.renewalPreserved), "Real mounted editor must survive proven same-boundary renewal");
assert.equal(exceptions.length, 0, "No runtime or interception errors");
assert.equal(blocked.length, 0, "No unexpected external requests");
