import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const origin = process.env.FIXTURE_ORIGIN ?? "http://127.0.0.1:5301";
const childOrigin = "http://127.0.0.1:5303";
const contexts = new Map();
const base = `${origin}/tests/browser/session-renewal/independent.html`;
const red = process.env.EXPECT_RED === "1";
const nativeOnly = process.env.NATIVE_ONLY === "1";
const crossOnly = process.env.CROSS_ONLY === "1";
const naturalOnly = process.env.NATURAL_ONLY === "1";
const forcedOnly = process.env.FORCED_ONLY === "1";
const endpoint = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9229";
const version = await (await fetch(`${endpoint}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
let disposing = false;
const pending = new Map(), errors = [], results = [], dialogs = [];
function send(method, params = {}, sessionId) {
  return new Promise((resolve,reject) => {
    const id = ++sequence;
    const timer = setTimeout(()=>{pending.delete(id);reject(Error(`Timeout ${method}`))},15000);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method,params,sessionId}));
  });
}
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=";
function intercept(method, params, sessionId) {
  void send(method, params, sessionId).catch(error => {
    if (!disposing) errors.push(`Interception failed: ${error.message}`);
  });
}
ws.onmessage = ({data}) => {
  const e = JSON.parse(data);
  if(e.id) {
    const p = pending.get(e.id); if(!p)return;
    pending.delete(e.id);clearTimeout(p.timer);
    if(e.error)p.reject(Error(e.error.message));else p.resolve(e.result);
  } else if(e.method==="Runtime.executionContextCreated") {
    const c=e.params.context;
    if(c.auxData?.isDefault)contexts.set(`${e.sessionId}:${c.auxData.frameId}`,c.id);
  } else if(e.method==="Runtime.executionContextDestroyed") {
    for(const [frame,id] of contexts)if(frame.startsWith(`${e.sessionId}:`)&&id===e.params.executionContextId)contexts.delete(frame);
  } else if(e.method==="Runtime.executionContextsCleared") {
    for(const frame of contexts.keys())if(frame.startsWith(`${e.sessionId}:`))contexts.delete(frame);
  } else if(e.method==="Page.javascriptDialogOpening") {
    dialogs.push({type:e.params.type});
    intercept("Page.handleJavaScriptDialog",{accept:true},e.sessionId);
  } else if(e.method==="Runtime.exceptionThrown") errors.push(e.params.exceptionDetails.exception?.description??e.params.exceptionDetails.text);
  else if(e.method==="Fetch.requestPaused") {
    const {requestId,request} = e.params;
    if(request.url==="https://image.renewal.test/avatar.png") {
      intercept("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"image/png"}],body:png},e.sessionId);
    } else {
      const allowed=[origin,childOrigin].some(value=>request.url.startsWith(`${value}/`));
      if (!allowed) errors.push("Unexpected non-loopback request blocked");
      intercept(allowed?"Fetch.continueRequest":"Fetch.failRequest",
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
  const contextId=contexts.get(`${sessionId}:${frame?.frame.id}`);
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
try {
  ({targetId}=await send("Target.createTarget",{url:"about:blank",background:true,browserContextId}));
  ({sessionId}=await send("Target.attachToTarget",{targetId,flatten:true}));
  for(const domain of ["Runtime","Page","Accessibility"])await page(`${domain}.enable`);
  await page("Fetch.enable",{patterns:[{urlPattern:"*"}]});
  await page("Emulation.setFocusEmulationEnabled",{enabled:true});
  await page("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  assert.equal(await evaluate("location.href"),"about:blank");
  assert.ok((await page("Accessibility.getFullAXTree")).nodes.length);
  if (crossOnly) {
    const peer = await send("Target.createTarget",{url:"about:blank",background:true,browserContextId});
    const peerSession = (await send("Target.attachToTarget",{targetId:peer.targetId,flatten:true})).sessionId;
    await send("Page.enable",{},peerSession);
    await send("Runtime.enable",{},peerSession);
    await send("Fetch.enable",{patterns:[{urlPattern:"*"}]},peerSession);
    await send("Emulation.setFocusEmulationEnabled",{enabled:true},peerSession);
    await send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]},peerSession);
    const peerEval = async expression => {
      const r = await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},peerSession);
      if(r.exceptionDetails)throw Error("Synthetic peer failed");
      return r.result.value;
    };
    const navigatePeer = async url => {
      await send("Page.navigate", { url }, peerSession);
      const until = Date.now() + 10_000;
      while (Date.now() < until) {
        try {
          if (await peerEval(`location.href===${JSON.stringify(url)}&&!!window.independent`)) return;
        } catch { /* Navigation can retire the previous execution context. */ }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw Error("Synthetic peer navigation readiness timeout");
    };
    for (const natural of naturalOnly ? [true] : red || forcedOnly ? [false] : [false,true]) for (const width of [1280,390]) for (const consumer of ["owner","admin"]) {
      await page("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});
      if (natural) {
        const started = performance.now();
        const mainSession = sessionId;
        const selector = consumer === "owner" ? "#ua-name" : "#definition-name";
        const draft = "Cross-tab synthetic unsaved draft";
        await page("Page.navigate",{url:"about:blank"});
        const peerUrl = `${base}?native=1&cross=1&natural=1&consumer=${consumer}&case=${width}-${consumer}`;
        await navigatePeer(peerUrl);
        await page("Page.navigate",{url:`${base}?native=1&cross=1&natural=1&persist=1&consumer=${consumer}`});
        const prepared = new Map();
        try {
          // Equal expiry deadlines race legitimately. Prepare both real editors;
          // identify the storage receiver from observed production refresh calls.
          for (const actor of [peerSession,mainSession]) {
            sessionId = actor;
            await page("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});
            await waitChild(`!!d.querySelector("${selector}")`);
            await child("Promise.all(d.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))");
            const point = await child(`(w.saved=d.querySelector("${selector}"),w.oldSignal=w.renewalFixture.signal(),w.saved.scrollIntoView(),({x:w.saved.getBoundingClientRect().x+15,y:w.saved.getBoundingClientRect().y+15}))`);
            await page("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});
            await page("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});
            await page("Input.dispatchKeyEvent",{type:"keyDown",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65});
            await page("Input.dispatchKeyEvent",{type:"keyUp",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65});
            await page("Input.insertText",{text:draft});
            await child("w.saved.setSelectionRange(1,4)");
            await evaluate("independent.holdInfo()");
            const state = await evaluate("independent.state()");
            assert.equal(state.rotation,0,"Both editors must be ready before the natural deadline");
            assert.equal(await child("w.saved.value"),draft);
            assert.equal(await child("d.activeElement===w.saved"),true);
            prepared.set(actor,state);
          }
          const until = Date.now()+10000;
          let main, peer;
          do {
            sessionId = mainSession;
            main = await evaluate("independent.state()");
            peer = await peerEval("independent.state()");
            if (main.pendingInfo>0 || peer.pendingInfo>0) break;
            await new Promise(resolve=>setTimeout(resolve,20));
          } while(Date.now()<until);
          assert.ok(main.pendingInfo>0 || peer.pendingInfo>0,"A natural storage receiver must enter held proof");
          const receiverIsMain = main.pendingInfo>0;
          const receiver = receiverIsMain ? main : peer;
          const initiator = receiverIsMain ? peer : main;
          assert.equal(initiator.rotation,1,"The other tab's real refresh timer initiated renewal");
          assert.ok(receiver.rotation===0 || receiver.rotation===1,"Equal deadlines may initiate both real timers");
          sessionId = receiverIsMain ? mainSession : peerSession;
          const prior = prepared.get(sessionId);
          await waitChild(`w.renewalFixture.state().version>${prior.version}`);
          const suspended = await child(`({connected:w.saved.isConnected,authenticated:w.renewalFixture.state().authenticated,
            oldSignalAborted:w.oldSignal.aborted,visible:!!d.querySelector("${selector}"),writes:w.renewalFixture.state().writes})`);
          assert.equal(suspended.authenticated,false);
          assert.equal(suspended.visible,false);
          assert.equal(suspended.connected,false);
          assert.equal(suspended.oldSignalAborted,true);
          assert.equal(await child("w.renewalFixture.pendingWrite()"),true);
          const pendingImage = await page("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});
          writeFileSync(`natural-${consumer}-${width}-pending.png`,Buffer.from(pendingImage.data,"base64"));
          await evaluate("independent.releaseInfo()");
          await waitChild("w.renewalFixture.state().authenticated");
          await child("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
          const resumed = await child(`({same:w.saved===d.querySelector("${selector}"),draft:d.querySelector("${selector}")?.value,
            focused:d.activeElement===w.saved,selection:w.saved.selectionEnd-w.saved.selectionStart,writes:w.renewalFixture.state().writes,
            modal:d.querySelector(".definition-drawer")?.matches(":modal")})`);
          if (red) {
            assert.equal(resumed.same,false,"Deployed baseline must lose the original editor");
            assert.notEqual(resumed.draft,draft,"Deployed baseline must lose the draft");
          } else {
            assert.equal(resumed.same,true);
            assert.equal(resumed.draft,draft);
            assert.equal(resumed.focused,true);
            assert.equal(resumed.selection,3);
            if(consumer==="admin")assert.equal(resumed.modal,true);
          }
          assert.equal(resumed.writes,0);
          const state = await evaluate("independent.state()");
          assert.ok(state.nativeStorageEvents>0);
          results.push({width,consumer,natural:true,pass:!red,expectedBaselineLoss:red,receiver:receiverIsMain?"main":"peer",
            scenario:"same-clock real timers/native storage/held proof/mounted editors",
            initiatorRotation:initiator.rotation,receiverRotation:receiver.rotation,
            suspended,resumed,nativeEvents:state.nativeStorageEvents,timeline:state.authTimeline,
            durationMs:Math.round(performance.now()-started)});
          const image = await page("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});
          writeFileSync(`natural-${consumer}-${width}-resumed.png`,Buffer.from(image.data,"base64"));
        } catch(error) {
          const observed = await child(`({same:w.saved===d.querySelector("${selector}"),connected:w.saved?.isConnected,
            authenticated:w.renewalFixture?.state().authenticated,draft:d.querySelector("${selector}")?.value})`).catch(()=>null);
          sessionId = mainSession;
          results.push({width,consumer,natural:true,pass:false,phase:"natural race",
            observed,receiver:await evaluate("independent.state()"),peer:await peerEval("independent.state()"),error:String(error)});
          throw error;
        } finally { sessionId=mainSession; }
        continue;
      }
      await page("Page.navigate",{url:`${base}?native=1&cross=1&consumer=${consumer}`});
      const selector = consumer === "owner" ? "#ua-name" : "#definition-name";
      await waitChild(`!!d.querySelector("${selector}")`);
      await navigatePeer(`${base}?persist=1&native=1&cross=1&case=forced-${width}-${consumer}`);
      await child("Promise.all(d.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))");
      const point = await child(`(w.saved=d.querySelector("${selector}"),w.oldSignal=w.renewalFixture.signal(),w.saved.scrollIntoView(),({x:w.saved.getBoundingClientRect().x+15,y:w.saved.getBoundingClientRect().y+15}))`);
      await page("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});
      await page("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});
      await page("Input.dispatchKeyEvent",{type:"keyDown",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65});
      await page("Input.dispatchKeyEvent",{type:"keyUp",key:"a",code:"KeyA",modifiers:2,windowsVirtualKeyCode:65});
      await page("Input.insertText",{text:"Cross-tab synthetic unsaved draft"});
      await child("w.saved.setSelectionRange(1,4)");
      await evaluate("independent.holdInfo()");
      const prior = await evaluate("independent.state()");
      await peerEval("independent.renew()");
      try { await wait("independent.state().pendingInfo>0"); }
      catch (error) {
        results.push({ width, consumer, natural, pass: false, phase: "pending readiness",
          receiver: await evaluate("independent.state()"), peer: await peerEval("independent.state()") });
        throw error;
      }
      await waitChild(`w.renewalFixture.state().version>${prior.version}`);
      const suspended = await child(`({connected:w.saved.isConnected,authenticated:w.renewalFixture.state().authenticated,
        oldSignalAborted:w.oldSignal.aborted,visible:!!d.querySelector("${selector}"),writes:w.renewalFixture.state().writes})`);
      assert.equal(suspended.authenticated,false);
      assert.equal(suspended.visible,false);
      assert.equal(suspended.oldSignalAborted,true);
      if (!red) {
        const image = await page("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});
        writeFileSync(`cross-${consumer}-${width}-pending.png`,Buffer.from(image.data,"base64"));
      }
      await evaluate("independent.releaseInfo()");
      await waitChild("w.renewalFixture.state().authenticated");
      await child("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const resumed = await child(`({same:w.saved===d.querySelector("${selector}"),draft:d.querySelector("${selector}")?.value,
        focused:d.activeElement===w.saved,selection:w.saved.selectionEnd-w.saved.selectionStart,writes:w.renewalFixture.state().writes,
        modal:d.querySelector(".definition-drawer")?.matches(":modal")})`);
      const state = await evaluate("independent.state()");
      const pass = resumed.same && resumed.draft==="Cross-tab synthetic unsaved draft" && resumed.focused && resumed.selection===3;
      results.push({width,consumer,natural,scenario:"real peer store renewal/native storage/held user-info/mounted editor",
        suspended,resumed,pass,nativeEvents:state.nativeStorageEvents,timeline:state.authTimeline});
      assert.ok(state.nativeStorageEvents>0);
      assert.equal(resumed.writes,0);
      if (!red && consumer === "admin") assert.equal(resumed.modal,true,"Native dialog must remain modal after reattachment");
      if (!red) {
        const image = await page("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});
        writeFileSync(`cross-${consumer}-${width}-resumed.png`,Buffer.from(image.data,"base64"));
      }
    }
    if (!red) assert.ok(results.every(r=>r.pass),"Cross-tab revalidation must preserve original editor/draft/focus");
    else assert.ok(results.every(r=>!r.pass),"Baseline must reproduce the real cross-tab loss");
    if (!red && !naturalOnly) for (const consumer of ["owner","admin"]) for (const scenario of [
      "account-equal-claims","claims-change","revoked","logout","401","failure","timeout","late-success","late-error","busy","route",
    ]) {
      await page("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false});
      await page("Page.navigate",{url:`${base}?native=1&cross=1&consumer=${consumer}${scenario==="late-error"?"&lateFail=1":""}`});
      const selector = consumer==="owner" ? "#ua-name" : "#definition-name";
      await waitChild(`!!d.querySelector("${selector}")`);
      await navigatePeer(`${base}?persist=1&native=1&cross=1&case=${consumer}-${scenario}`);
      await child(`(w.saved=d.querySelector("${selector}"),w.saved.focus(),w.saved.select(),w.oldSignal=w.renewalFixture.signal())`);
      await page("Input.insertText",{text:"Synthetic isolated draft"});
      const stale = scenario.startsWith("late-");
      const busy = scenario==="busy";
      if(busy) {
        await child("(w.renewalFixture.holdWrites(),w.renewalFixture.allowSyntheticWrite())");
        await child("new Promise(resolve=>requestAnimationFrame(resolve))");
        if(consumer==="owner") await child('d.querySelector(".ua-wizard").requestSubmit()');
        else {
          await child('d.querySelector(".definition-drawer footer .primary").click()');
          await waitChild('!!d.querySelector(".overlay-dialog .check input")');
          await child('d.querySelector(".overlay-dialog .check input").click()');
          await child("new Promise(resolve=>requestAnimationFrame(resolve))");
          await child('d.querySelector(".overlay-dialog .commands .primary").click()');
        }
        await waitChild("w.renewalFixture.state().pending>0&&w.renewalFixture.state().writes===1");
        assert.equal(await child('!!d.querySelector(".ua-wizard button:disabled,.definition-drawer button:disabled")'),true);
      }
      if(stale) {
        await child("(w.renewalFixture.hold(),w.oldRead=w.renewalFixture.read(),true)");
        await waitChild("w.renewalFixture.state().pending>0");
      }
      await evaluate("independent.holdInfo()");
      const prior = await evaluate("independent.state()");
      await peerEval(scenario==="account-equal-claims" ? "independent.switchAccount()" : "independent.renew()");
      await wait("independent.state().pendingInfo>0");
      await waitChild(`w.renewalFixture.state().version>${prior.version}&&!w.renewalFixture.state().authenticated&&!d.querySelector("${selector}")`);
      assert.equal(await child("w.saved.isConnected"),false);
      assert.equal(await child("w.oldSignal.aborted"),true);
      assert.equal(await child("w.renewalFixture.pendingWrite()"),true);
      const pendingWrites = await child("w.renewalFixture.state().writes");
      assert.equal(pendingWrites,busy?1:0);
      if(scenario==="claims-change") await evaluate('independent.infoResult({permissions:["core:admin:read"]})');
      if(scenario==="revoked") await evaluate("independent.infoResult({permissions:[]})");
      if(scenario==="401"||scenario==="failure") await evaluate(`independent.infoResult({status:${scenario==="401"?401:503}})`);
      if(scenario==="logout") await peerEval("independent.logout()");
      if(scenario==="route") await child("w.renewalFixture.navigateAway()");
      if(scenario==="timeout") await evaluate("new Promise(resolve=>setTimeout(resolve,10400))");
      if(stale||busy) {
        await child("w.renewalFixture.release()");
        if(stale) assert.equal(await child("w.oldRead"),"rejected");
      }
      await evaluate("independent.releaseInfo()");
      const shouldAuthenticate = stale || busy || ["account-equal-claims","claims-change","revoked","route"].includes(scenario);
      if(shouldAuthenticate) await waitChild("w.renewalFixture.state().authenticated");
      else await wait("independent.state().lastAuth?.revalidation===undefined");
      await child("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const outcome = await child(`({same:w.saved===d.querySelector("${selector}"),connected:w.saved.isConnected,
        draft:d.querySelector("${selector}")?.value,authenticated:w.renewalFixture.state().authenticated,
        writes:w.renewalFixture.state().writes,status:d.querySelector("[role=status]")?.textContent})`);
      assert.equal(outcome.same,stale||busy,scenario);
      assert.equal(outcome.connected,stale||busy,scenario);
      assert.equal(outcome.authenticated,shouldAuthenticate,scenario);
      assert.equal(outcome.writes,pendingWrites);
      if(stale||busy) assert.equal(outcome.draft,"Synthetic isolated draft");
      else if(!shouldAuthenticate) assert.ok(outcome.status);
      if(busy) {
        const error = await child('d.querySelector(".ua-form-err,.definition-drawer [role=alert]")?.textContent');
        assert.ok(error,"Aborted busy save must not report success");
        await evaluate("independent.holdInfo()");
        const prior = await evaluate("independent.state().version");
        await peerEval("independent.renew()");
        await wait("independent.state().pendingInfo>0");
        await waitChild(`w.renewalFixture.state().version>${prior}&&!w.saved.isConnected`);
        await evaluate("independent.releaseInfo()");
        await waitChild("w.saved.isConnected");
        assert.equal(await child('d.querySelector(".ua-form-err,.definition-drawer [role=alert]")?.textContent'),error);
      }
      results.push({consumer,scenario,pass:true,pendingWriteBlocked:true,oldSignalAborted:true,...outcome});
    }
  }
  for(const width of nativeOnly || crossOnly ? [] : [1280,390]) for(const consumer of ["owner","admin"]) for(const reverse of [false,true]) {
    await page("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});
    await page("Page.navigate",{url:`${base}?consumer=${consumer}${reverse?"&reverse=1":""}`});
    const selector = consumer==="owner"?"#ua-name":"#definition-name";
    await waitChild(`!!d.querySelector("${selector}")`);
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
    if(consumer==="owner" && !reverse && !red) {
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
    if(red) {
      assert.equal(mismatched.sentHeader,reverse?"synthetic-A":"synthetic-B");
      assert.deepEqual(mismatched.lastAuth.principal,{id:String(expectedId)});
      assert.notEqual(mismatched.sentHeader,mismatched.lastAuth.token);
    } else {
      assert.equal(mismatched.sentHeader,beforeMismatch.token);
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
      credentialMismatch:red,contract:red?"RED":"GREEN",expectedId,
      immutableHeader:!red,lateStorageEventReproved:!red,duplicateStorageEventNoop:!red,oldEditorRemoved:true});
  }
  if(!red && !nativeOnly && !crossOnly) {
  await page("Page.navigate",{url:base});
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
    await page("Page.navigate",{url:`${base}?consumer=${consumer}&hold=1${lateFailure?"&lateFail=1":""}`});
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
  if(nativeOnly) {
    const peer = await send("Target.createTarget",{url:"about:blank",background:true,browserContextId});
    const peerSession = (await send("Target.attachToTarget",{targetId:peer.targetId,flatten:true})).sessionId;
    await send("Page.enable",{},peerSession);
    await send("Runtime.enable",{},peerSession);
    await send("Fetch.enable",{patterns:[{urlPattern:"*"}]},peerSession);
    await send("Page.navigate",{url:`${origin}/tests/browser/session-renewal/storage-peer.html`},peerSession);
    const peerEval = async expression => {
      const r = await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},peerSession);
      if(r.exceptionDetails)throw Error("Synthetic storage peer evaluation failed");
      return r.result.value;
    };
    for(let i=0;i<100 && await peerEval("location.pathname")!=="/tests/browser/session-renewal/storage-peer.html";i++)
      await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(await peerEval("location.origin"),origin);
    for(const consumer of ["owner","admin"]) for(const reverse of [false,true]) {
      await page("Page.navigate",{url:`${base}?native=1&consumer=${consumer}${reverse?"&reverse=1":""}`});
      const selector = consumer==="owner" ? "#ua-name" : "#definition-name";
      await waitChild(`!!d.querySelector("${selector}")`);
      await child(`(w.saved=d.querySelector("${selector}"),w.saved.value="Prior principal draft")`);
      const prior = await evaluate("independent.state()");
      const token = reverse ? "synthetic-A" : "synthetic-B";
      const id = reverse ? 41 : 42;
      await peerEval(`localStorage.setItem("nucleagent_session_version","0");localStorage.setItem("nucleagent_access_token","${token}")`);
      await wait(`independent.state().principal===${id} && independent.state().token==="${token}"`);
      await waitChild("!w.saved.isConnected");
      const current = await evaluate("independent.state()");
      assert.ok(current.nativeStorageEvents>=2);
      assert.ok(current.version>prior.version);
      assert.equal(current.sentHeader,token);
      assert.deepEqual(current.lastAuth.principal,{id:String(id)});
      assert.equal(await child("w.renewalFixture.state().writes"),0);
      results.push({scenario:"native cross-tab stale-version switch",consumer,reverse,
        nativeEvents:current.nativeStorageEvents,versionAdvanced:current.version>prior.version,
        immutableHeader:true,oldEditorRemoved:true,writes:0});
    }
    for(const consumer of ["owner","admin"]) {
      await page("Page.navigate",{url:`${base}?native=1&persist=1&consumer=${consumer}`});
      await waitChild("w.renewalFixture?.state().authenticated");
      const selector = consumer==="owner" ? "#ua-name" : "#definition-name";
      await waitChild(`!!d.querySelector("${selector}")`);
      await child(`(w.saved=d.querySelector("${selector}"),w.saved.value="Prior principal draft")`);
      await evaluate("independent.loginFailure(42)");
      await waitChild("!w.renewalFixture.state().authenticated && !w.saved.isConnected");
      const failed = await evaluate("independent.state()");
      assert.equal(failed.principal,null);
      const status = await child("d.querySelector('[role=status]')?.textContent");
      assert.ok(status);
      assert.equal(await child('!!d.querySelector("#ua-name,#definition-name,[data-template-id],[data-definition-id]")'),false);
      await page("Page.reload",{ignoreCache:true});
      await wait("independent?.state().principal===42");
      await waitChild("w.renewalFixture?.state().authenticated");
      const recovered = await evaluate("independent.state()");
      assert.equal(recovered.sentHeader,"synthetic-B");
      assert.deepEqual(recovered.lastAuth.principal,{id:"42"});
      assert.equal(await child("w.renewalFixture.state().writes"),0);
      results.push({scenario:"failed initial proof then actual page reload",consumer,
        explanatoryStatus:status,oldEditorRemoved:true,oldProtectedDataAbsent:true,
        recoveredPrincipal:42,headerMatches:true,writes:0});
    }
  }
} catch(error) {
  failure = error;
  errors.push(String(error));
} finally {
  disposing = true;
  await send("Target.disposeBrowserContext",{browserContextId});
  const after=(await send("Target.getTargets")).targetInfos.filter(t=>t.type==="page").map(t=>t.targetId);
  const cleanup={ownedClosed:!after.includes(targetId),existingPreserved:before.every(id=>after.includes(id)),
    missingExistingCount:before.filter(id=>!after.includes(id)).length,
    disposalScope:"only the context ID returned by this script's createBrowserContext"};
  writeFileSync(process.env.RESULT_PATH ?? "independent-browser.json",JSON.stringify({results,errors,dialogs,cleanup},null,2));
  ws.close();assert.ok(cleanup.ownedClosed && cleanup.existingPreserved);
}
if(failure)throw failure;
assert.equal(errors.length, 0, "No runtime or interception errors");
console.log(JSON.stringify({cases:results.length,errors:errors.length}));
