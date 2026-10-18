import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const origin = process.env.FIXTURE_ORIGIN ?? "http://127.0.0.1:5431";
const childOrigin = process.env.CHILD_ORIGIN ?? "http://127.0.0.1:5433";
for (const value of [origin, childOrigin]) assert.match(value, /^http:\/\/127\.0\.0\.1:\d+$/);
const contexts = new Map();
const suite = process.env.SUITE ?? "shell";
const base = `${origin}/tests/browser/integrated/independent.html`;
const version = await (await fetch(`${process.env.CDP_ORIGIN ?? "http://127.0.0.1:9229"}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map(), errors = [], results = [], diagnostics = [];
function send(method, params = {}, sessionId) {
  return new Promise((resolve,reject) => {
    const id = ++sequence;
    const timer = setTimeout(()=>{pending.delete(id);reject(Error(`Timeout ${method}`))},15000);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method,params,sessionId}));
  });
}
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=";
const streamRequests = new Map();
let blockedOutbound = 0;
ws.onmessage = ({data}) => {
  const e = JSON.parse(data);
  if(e.id) {
    const p = pending.get(e.id); if(!p)return;
    pending.delete(e.id);clearTimeout(p.timer);
    if(e.error)p.reject(Error(e.error.message));else p.resolve(e.result);
  } else if(e.method==="Runtime.executionContextCreated") {
    const c=e.params.context;
    if(c.auxData?.isDefault)contexts.set(c.auxData.frameId,c.id);
  } else if(e.method==="Runtime.executionContextDestroyed") {
    for(const [frame,id] of contexts)if(id===e.params.executionContextId)contexts.delete(frame);
  } else if(e.method==="Runtime.exceptionThrown") errors.push(e.params.exceptionDetails.exception?.description??e.params.exceptionDetails.text);
  else if(e.method==="Runtime.consoleAPICalled" && ["warning","error"].includes(e.params.type)) {
    if(diagnostics.length<64) diagnostics.push(e.params.args.map(a=>a.value ?? a.description ?? a.type).join(" ").slice(0,1500));
  }
  else if(e.method==="Network.responseReceived" && e.params.response.url.endsWith("/messages/stream")) {
    streamRequests.set(e.params.requestId, { path: new URL(e.params.response.url).pathname, status: e.params.response.status, bytes: 0 });
  }
  else if(e.method==="Network.dataReceived" && streamRequests.has(e.params.requestId)) {
    streamRequests.get(e.params.requestId).bytes += e.params.dataLength;
  }
  else if(e.method==="Fetch.requestPaused") {
    const {requestId,request} = e.params;
    if(request.url==="https://image.renewal.test/avatar.png") {
      void send("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"image/png"}],body:png},e.sessionId);
    } else {
      const allowed=[origin,childOrigin].some(value=>request.url.startsWith(`${value}/`));
      if(!allowed) blockedOutbound++;
      void send(allowed?"Fetch.continueRequest":"Fetch.failRequest",
        allowed?{requestId}:{requestId,errorReason:"BlockedByClient"},e.sessionId);
    }
  }
};
const before = (await send("Target.getTargets")).targetInfos.filter(t=>t.type==="page").map(t=>t.targetId);
const {browserContextId} = await send("Target.createBrowserContext");
let targetId, sessionId, failure;
const page = (method,params={})=>send(method,params,sessionId);
async function evaluate(expression, contextId) {
  const r = await page("Runtime.evaluate",{expression,contextId,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??"Evaluation failure");
  return r.result.value;
}
async function child(expr) {
  const tree=await page("Page.getFrameTree");
  const frame=tree.frameTree.childFrames?.find(f=>f.frame.url.startsWith(childOrigin));
  const contextId=contexts.get(frame?.frame.id);
  assert.ok(contextId,"owned child execution context exists");
  return evaluate(`(()=>{const w=window,d=document;return (${expr})})()`,contextId);
}
const wait = expr=>evaluate(`new Promise((resolve,reject)=>{const until=performance.now()+10000;function poll(){try{if(${expr})return resolve(true)}catch{}if(performance.now()>until)return reject(Error("Condition timeout"));setTimeout(poll,20)}poll()})`);
async function waitChild(expr) {
  const until=Date.now()+10000;
  while(Date.now()<until) {
    try { if(await child(expr))return; } catch {}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error(`Child condition timeout: ${expr}`);
}
async function click(selector) {
  const rect = await child(`(()=>{const e=d.querySelector(${JSON.stringify(selector)});
    if(!e||e.disabled)throw Error("Missing/enabled control");e.scrollIntoView({block:"center"});
    const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    if(!e.contains(d.elementFromPoint(x,y)))throw Error("Occluded control");
    return {x,y}})()`);
  await page("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...rect});
  await page("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...rect});
}
const control = (path, method="POST") =>
  child(`fetch(${JSON.stringify(`/__fixture/${path}`)},{method:${JSON.stringify(method)}}).then(async r=>{
    if(!r.ok)throw Error("Fixture control failed");return r.status===204?null:r.json()})`);
const resize = width=>page("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});
async function selectSkill(width) {
  if(width<1024) {
    const visible = await child("!!d.querySelector('[data-testid=row-skills]')?.getClientRects().length");
    if(!visible) {
      const toggle = await child("!!d.querySelector('[data-testid=conv-more]')");
      await click(toggle ? "[data-testid=conv-more]" : "[data-testid=run-pill]");
    }
  }
  await click(width<1024?"[data-testid=row-skills]":"[data-testid=skill-picker-open]");
  await waitChild("!!d.querySelector('.osheet-row')");
  await click(".osheet-row");
  await click("[data-testid=option-sheet] .osheet-done");
}
try {
  ({targetId}=await send("Target.createTarget",{url:"about:blank",background:true,browserContextId}));
  ({sessionId}=await send("Target.attachToTarget",{targetId,flatten:true}));
  for(const domain of ["Runtime","Page","Accessibility","Network"])await page(`${domain}.enable`);
  await page("Fetch.enable",{patterns:[{urlPattern:"*"}]});
  await page("Emulation.setFocusEmulationEnabled",{enabled:true});
  await page("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  assert.equal(await evaluate("location.href"),"about:blank");
  assert.ok((await page("Accessibility.getFullAXTree")).nodes.length);
  if(suite==="shell") {
  for(const width of [1280,390]) for(const consumer of ["owner","admin"]) for(const reverse of [false,true]) {
    await page("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});
    await page("Page.navigate",{url:`${base}?childOrigin=${childOrigin}&consumer=${consumer}${reverse?"&reverse=1":""}`});
    const selector = consumer==="owner"?"#ua-name":"#definition-name";
    await waitChild(`!!d.querySelector("${selector}")`);
    assert.equal(await child("d.querySelectorAll('[data-testid=edit-sidebar]').length"),1);
    assert.ok(await child("d.querySelectorAll('[data-testid=edit-sidebar] [role=tab]').length>=2"));
    if(consumer==="admin") {
      assert.equal(await child("!!d.querySelector('.head-avatar')"),true);
      assert.equal(await child("!!d.querySelector('input[type=file]')"),false);
    } else {
      await child(`(()=>{const input=d.querySelector('[data-testid=ua-avatar-input]');
        if(!input)throw Error("Owner avatar slot missing");
        const transfer=new DataTransfer();
        transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],
          "synthetic.png",{type:"image/png"}));
        input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()`);
      await waitChild("!!d.querySelector('[data-testid=ua-avatar-picked]')");
      assert.equal(await child("w.renewalFixture.state().writes"),0);
    }
    await child("Promise.all(d.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))");
    await child(`(w.saved=d.querySelector("${selector}"),w.saved.focus(),w.saved.select())`);
    await page("Input.insertText",{text:"Independent unsaved draft"});
    await child("w.saved.setSelectionRange(1,4)");
    await evaluate("independent.renew()");
    const renewedVersion=(await evaluate("independent.state()")).version;
    await waitChild(`w.renewalFixture.state().version===${renewedVersion}`);
    const actual = await child(`({same:w.saved===d.querySelector("${selector}"),draft:w.saved.value,
      focused:d.activeElement===w.saved,selected:w.saved.selectionEnd-w.saved.selectionStart,...w.renewalFixture.state()})`);
    assert.equal(actual.same,true);assert.equal(actual.draft,"Independent unsaved draft");
    assert.equal(actual.focused,true);assert.equal(actual.selected,3);assert.equal(actual.writes,0);
    let screenshot = "not-attempted";
    if(consumer==="owner" && !reverse && process.env.SCREENSHOTS === "1") {
      try {
        const image = await page("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});
        writeFileSync(`independent-${width}.png`,Buffer.from(image.data,"base64"));
        screenshot = `independent-${width}.png`;
      } catch { screenshot = "background surface capture unavailable"; }
    }
    const beforeMismatch = await evaluate("independent.state()");
    await evaluate(`independent.mismatch("${reverse ? "restore" : "refreshAuthorization"}")`);
    const mismatched = await evaluate("independent.state()");
    const expectedId = reverse ? 41 : 42;
    assert.equal(mismatched.token,beforeMismatch.token);
    {
      assert.equal(mismatched.sentHeader,beforeMismatch.token,"TOKEN_CAPTURE: verification must use the captured credential");
      assert.equal(mismatched.principal,null);
      await waitChild("!w.renewalFixture.state().authenticated");
      await evaluate("independent.sync()");
      await wait(`independent.state().principal===${expectedId}`);
      const synced = await evaluate("independent.state()");
      assert.equal(synced.token,reverse?"synthetic-A":"synthetic-B");
      assert.deepEqual(synced.lastAuth.principal,{id:String(expectedId)});
      const calls = synced.infoCalls;
      await evaluate("independent.sync()");
      assert.equal((await evaluate("independent.state()")).infoCalls,calls);
    }
    await waitChild("!w.saved.isConnected");
    assert.equal(await child("w.saved.isConnected"),false);
    results.push({width,consumer,reverse,renewal:actual,screenshot,
      observations:{captured:beforeMismatch,response:mismatched},
      contract:"GREEN",expectedId,
      immutableHeader:true,lateStorageEventReproved:true,duplicateStorageEventNoop:true,oldEditorRemoved:true});
  }
  {
  await page("Page.navigate",{url:`${base}?childOrigin=${childOrigin}`});
  await waitChild("!!d.querySelector('#ua-name')");
  await evaluate("independent.loginFailure()");
  await waitChild("!w.renewalFixture.state().authenticated");
  await evaluate("independent.renew()");
  await evaluate("independent.renew()");
  const unavailable = await evaluate("independent.state()");
  const visible = await child("d.querySelector('[role=status]')?.textContent");
  assert.equal(unavailable.authenticated,true);assert.equal(unavailable.principal,null);
  assert.ok(visible);
  await evaluate("independent.recover()");
  await waitChild("w.renewalFixture.state().authenticated && !!d.querySelector('[data-template-id]')");
  results.push({scenario:"failed authorization recovery",automaticRefreshRecovers:false,
    explanatoryStatus:visible,explicitRestoreRecovers:true});
  for(const consumer of ["owner","admin"]) for(const lateFailure of [false,true]) {
    await page("Page.navigate",{url:`${base}?childOrigin=${childOrigin}&consumer=${consumer}&hold=1${lateFailure?"&lateFail=1":""}`});
    await waitChild("w.renewalFixture?.state().pending>=2");
    await evaluate("independent.logout()");
    await waitChild("!w.renewalFixture.state().authenticated");
    await child("w.renewalFixture.release()");
    await waitChild("w.renewalFixture.state().pending===0");
    await child("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.equal(await child('!!d.querySelector("[data-template-id],[data-definition-id],#ua-name,#definition-name")'),false);
    assert.equal(await child("w.renewalFixture.state().writes"),0);
    assert.equal(await child("w.renewalFixture.state().pending"),0);
    results.push({consumer,scenario:lateFailure?"late old HTTP503 after logout":"late old HTTP200 after logout",
      protectedDataAbsent:true,writes:0});
  }
  }
  } else if(suite==="chat") {
    for(const width of [1280,390]) {
      const checkpoints = [];
      try {
      await resize(width);
      await page("Page.navigate",{url:`${base}?childOrigin=${childOrigin}&consumer=chat`});
      await waitChild("!!d.querySelector('textarea')");
      await child("d.querySelector('textarea').focus()");
      await page("Input.insertText",{text:"Synthetic home draft"});
      await selectSkill(width);
      await waitChild("d.querySelector('.skill-chip-name')?.textContent==='Synthetic skill'");
      await resize(width===1280?390:1280);
      await waitChild("d.querySelector('textarea')?.value==='Synthetic home draft'");
      await waitChild("d.querySelector('.skill-chip-name')?.textContent==='Synthetic skill'");
      checkpoints.push("Home draft and skill survive breakpoint");
      await resize(width);
      await waitChild("!!d.querySelector('[data-testid=skill-picker-open],[data-testid=row-skills]')");
      const seed = await child("w.renewalFixture.seed");
      await child(`w.renewalFixture.navigate('/c/${seed.id}')`);
      await waitChild("!!d.querySelector('[data-testid=session-bindings] [data-testid=skill-picker-open],[data-testid=session-bindings] [data-testid=row-skills]')");
      await waitChild("!!d.querySelector('.atc-composer textarea')");
      await child("d.querySelector('.atc-composer textarea').focus()");
      await page("Input.insertText",{text:"Synthetic conversation draft"});
      const until=Date.now()+10000;
      while(![...streamRequests.values()].some(s=>s.path===`/api/v1/addons/conversation/${seed.id}/messages/stream` && s.status===200)) {
        assert.ok(Date.now()<until,"real SSE response readiness");
        await new Promise(r=>setTimeout(r,20));
      }
      const streams = (await control(`state/${seed.id}`,"GET")).streams;
      assert.ok(streams>0,"real TaskConversation opened SSE");
      await control(`event/${seed.id}`);
      await waitChild("d.querySelector('.atc-root')?.textContent.includes('Synthetic stream probe') || d.body.textContent.includes('Synthetic stream probe')");
      checkpoints.push("real SSE message visible");
      await selectSkill(width);
      await click("[data-testid=bindings-save]");
      await waitChild("!d.querySelector('[data-testid=bindings-save]')");
      assert.ok((await control(`state/${seed.id}`,"GET")).tools.includes(seed.coverId));
      await selectSkill(width);
      await click("[data-testid=bindings-save]");
      await waitChild("!d.querySelector('[data-testid=bindings-save]')");
      assert.ok(!(await control(`state/${seed.id}`,"GET")).tools.includes(seed.coverId));
      checkpoints.push("real add/clear and next-turn RuntimeTools");
      await selectSkill(width);
      await control("hold");
      await click("[data-testid=bindings-save]");
      await child(`new Promise((resolve,reject)=>{let n=0;const poll=async()=>{
        const s=await fetch('/__fixture/state/${seed.id}').then(r=>r.json());
        if(s.pending===1)return resolve(true);if(++n>100)return reject(Error("PUT not held"));setTimeout(poll,20)};poll()})`);
      checkpoints.push("real PUT held before renewal");
      await evaluate("independent.renew()");
      await resize(width===1280?390:1280);
      await waitChild("!!d.querySelector('[data-testid=bindings-save]:disabled')");
      assert.equal(await child("d.querySelector('.atc-composer textarea').value"),"Synthetic conversation draft");
      await resize(width);
      await control("release");
      await waitChild("!d.querySelector('[data-testid=bindings-save]')");
      const state = await control(`state/${seed.id}`,"GET");
      assert.ok(state.tools.includes(seed.coverId),"real next-turn tools include selected skill");
      assert.equal(state.streams,streams,"save/renewal/breakpoints retain the real SSE connection");
      await control(`event/${seed.id}`);
      await waitChild("d.body.textContent.split('Synthetic stream probe').length>=3");
      await selectSkill(width);
      await click("[data-testid=bindings-save]");
      await waitChild("!d.querySelector('[data-testid=bindings-save]')");
      assert.ok(!(await control(`state/${seed.id}`,"GET")).tools.includes(seed.coverId));
      results.push({width,scenario:"real Home/Conversation + Gin/Huma",homeDraft:true,
        heldSaveRenewal:true,conversationDraft:true,addClear:true,nextTurnProjection:true,sseSameConnection:true,checkpoints});
      } catch(error) {
        failure ??= error;
        errors.push(String(error));
        const observed = await child(`({
          savePresent:!!d.querySelector('[data-testid=bindings-save]'),
          saveDisabled:!!d.querySelector('[data-testid=bindings-save]:disabled'),
          skillPresent:!!d.querySelector('.skill-chip-name'),
          draftRetained:d.querySelector('.atc-composer textarea')?.value==='Synthetic conversation draft',
          realPending:w.renewalFixture.state().realPending
        })`).catch(()=>null);
        results.push({width,scenario:"real Home/Conversation + Gin/Huma",status:"FAIL",checkpoints,observed});
      } finally { await control("release"); }
    }
    for(const action of ["logout","switchAccount"]) {
      try {
      await resize(1280);
      await page("Page.navigate",{url:`${base}?childOrigin=${childOrigin}&consumer=chat`});
      await waitChild("!!d.querySelector('textarea')");
      const seed=await child("w.renewalFixture.seed");
      await child(`w.renewalFixture.navigate('/c/${seed.id}')`);
      await waitChild("!!d.querySelector('[data-testid=skill-picker-open]')");
      await selectSkill(1280);
      await control("hold");
      await click("[data-testid=bindings-save]");
      await child(`new Promise((resolve,reject)=>{let n=0;const poll=async()=>{
        const s=await fetch('/__fixture/state/${seed.id}').then(r=>r.json());
        if(s.pending===1)return resolve(true);if(++n>100)return reject(Error("PUT not held"));setTimeout(poll,20)};poll()})`);
      await child("w.retired=d.querySelector('[data-testid=session-bindings]')");
      await evaluate(`independent.${action}()`);
      await waitChild("!w.retired.isConnected");
      await control("release");
      await child(`new Promise((resolve,reject)=>{let n=0;const poll=async()=>{
        const s=await fetch('/__fixture/state/${seed.id}').then(r=>r.json());
        if(s.pending===0)return resolve(true);if(++n>100)return reject(Error("PUT not settled"));setTimeout(poll,20)};poll()})`);
      await waitChild("w.renewalFixture.state().realPending===0");
      await child("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      assert.equal(await child("w.retired.isConnected"),false);
      assert.equal(await child("!!d.querySelector('[data-testid=session-bindings]')"),false);
      results.push({scenario:`held real PUT + ${action}`,oldEditorRemoved:true,
        lateResponseCannotRestore:true,serverCommitNotInferredFromAbort:true});
      } catch(error) {
        failure ??= error;
        errors.push(String(error));
        results.push({scenario:`held real PUT + ${action}`,status:"FAIL"});
      } finally { await control("release"); }
    }
  } else throw Error("Unknown SUITE");
  assert.equal(errors.length,0,"all scenario and runtime assertions must pass");
  assert.equal(blockedOutbound,0,"fixture must not attempt unapproved external traffic");
} catch(error) {
  failure = error;
  errors.push(String(error));
  diagnostics.push({ streams: [...streamRequests.values()] });
} finally {
  await send("Target.disposeBrowserContext",{browserContextId});
  const after=(await send("Target.getTargets")).targetInfos.filter(t=>t.type==="page").map(t=>t.targetId);
  const cleanup={ownedClosed:!after.includes(targetId),existingPreserved:before.every(id=>after.includes(id)),
    missingExistingCount:before.filter(id=>!after.includes(id)).length,
    disposalScope:"only the context ID returned by this script's createBrowserContext"};
  writeFileSync(process.env.RESULT_PATH ?? "independent-browser.json",JSON.stringify({results,errors,diagnostics,blockedOutbound,cleanup},null,2));
  ws.close();assert.ok(cleanup.ownedClosed);assert.ok(cleanup.existingPreserved);
}
if(failure)throw failure;
console.log(JSON.stringify({cases:results.length,errors:errors.length}));
