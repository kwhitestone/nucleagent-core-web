import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

let vite: ViteDevServer;
let unregister: () => void;
let dom: JSDOM;
let ToolIO: typeof import("../src/chat-react/ToolIO.tsx").default;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let calls: string[] = [];
let denied = false;
let inputContent = ' {"command":"echo ok"}';
let outputContent = "first";
let paged = true;
beforeEach(()=>{calls=[];denied=false;inputContent=' {"command":"echo ok"}';outputContent="first";paged=true;});

before(async () => {
 dom = new JSDOM("<div id='root'></div>");
 Object.defineProperty(globalThis,"window",{configurable:true,value:dom.window});
 Object.defineProperty(globalThis,"document",{configurable:true,value:dom.window.document});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 vite=await createServer({appType:"custom",optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null}});
 await initializeRuntimeFixture(vite);
 const {registerPlatformRuntime}=await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
 unregister=registerPlatformRuntime({getSessionVersion:()=>1,http:{get:async (_url:string,options:{params:{field:string;offset:number}})=>{
   if(denied) throw new Error("403");
   const {field,offset}=options.params;calls.push(`${field}:${offset}`);
   return {data:{data:{available:true,content:field==="input"?inputContent:offset===0?outputContent:"last",nextOffset:field==="input"||offset>0||!paged?-1:5,revision:"rev",status:"completed"}}};
 }}});
 ({default:ToolIO}=await vite.ssrLoadModule("/src/chat-react/ToolIO.tsx"));
 React=await import("react");({createRoot}=await import("react-dom/client"));
});

test("non-object input, empty output and session changes keep private data bounded to the view",async()=>{
 denied=false;inputContent='["one",2]';outputContent="";paged=false;
 const container=document.getElementById("root")!;const root=createRoot(container);
 try {
  await React.act(async()=>root.render(React.createElement(ToolIO,{messageId:13})));
  await React.act(async()=>container.querySelector<HTMLButtonElement>("button")!.click());
  assert.equal(container.querySelector("dl"),null);
  assert.match(container.querySelector("pre")!.textContent!,/one/);
  assert.match(container.textContent!,/（空）/);
  await React.act(async()=>window.dispatchEvent(new dom.window.Event("nucleagent:session-change")));
  assert.equal(container.querySelector("button")!.getAttribute("aria-expanded"),"false");
  assert.doesNotMatch(container.textContent!,/one|（空）/);
 }finally{await React.act(async()=>root.unmount());}
});
after(async()=>{unregister?.();await vite?.close();dom?.window.close();});

test("tool IO owns collapse state, lazily reads pages and clears on auth failure",async()=>{
 const container=document.getElementById("root")!;const root=createRoot(container);
 try {
  await React.act(async()=>root.render(React.createElement(ToolIO,{messageId:12})));
  assert.equal(calls.length,0);
  const toggle=()=>container.querySelector<HTMLButtonElement>("button")!.click();
  await React.act(async()=>toggle());
  assert.deepEqual(calls,["input:0","output:0"]);
  assert.match(container.textContent!,/command/);assert.match(container.textContent!,/echo ok/);
  await React.act(async()=>Array.from(container.querySelectorAll("button")).find(button=>button.textContent==="加载更多输出")!.click());
  assert.match(container.textContent!,/firstlast/);
  await React.act(async()=>toggle());assert.doesNotMatch(container.textContent!,/firstlast/);
  denied=true;await React.act(async()=>toggle());assert.doesNotMatch(container.textContent!,/echo ok|firstlast/);
 }finally{await React.act(async()=>root.unmount());}
});
