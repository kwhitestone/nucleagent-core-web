import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
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
let missing = false;
type T=(key:string)=>string;
let zh:T;let en:T;
beforeEach(()=>{missing=false;calls=[];denied=false;inputContent=' {"command":"echo ok"}';outputContent="first";paged=true;});

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
   const {field,offset}=options.params;
   // exp118: this file pins the legacy input/output reads; record answers like Core <= v0.1.82 (422) and is covered in toolRecord.test.ts.
   if(field==="record") throw Object.assign(new Error("422"),{status:422});
   calls.push(`${field}:${offset}`);
   return {data:{data:missing?{available:false,content:"",nextOffset:-1,revision:"",reason:"未采集完整输入输出"}:{available:true,content:field==="input"?inputContent:offset===0?outputContent:"last",nextOffset:field==="input"||offset>0||!paged?-1:5,revision:"rev",status:"completed"}}};
 }}});
 ({default:ToolIO}=await vite.ssrLoadModule("/src/chat-react/ToolIO.tsx"));
 React=await import("react");({createRoot}=await import("react-dom/client"));
 // The island's real lookup: chatReact.* from the lazy locale chunk, anything else from the shell dictionary.
 const dict=async(locale:"Zh"|"En"):Promise<T>=>{
  const island=(await vite.ssrLoadModule(`/src/chat-react/islandStrings${locale}.ts`))[`${locale.toUpperCase()}_STRINGS`];
  const shell=(await vite.ssrLoadModule(`/src/i18n/${locale.toLowerCase()}.ts`)).default;
  return key=>key.startsWith("chatReact.")?island[key.slice(10)]??key:key.split(".").reduce((node:any,part)=>node?.[part],shell)??key;
 };
 zh=await dict("Zh");en=await dict("En");
});

test("non-object input, empty output and session changes keep private data bounded to the view",async()=>{
 denied=false;inputContent='["one",2]';outputContent="";paged=false;
 const container=document.getElementById("root")!;const root=createRoot(container);
 try {
  await React.act(async()=>root.render(React.createElement(ToolIO,{messageId:13,t:zh})));
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
  await React.act(async()=>root.render(React.createElement(ToolIO,{messageId:12,t:zh})));
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

test("an English session reads every tool IO label from the lazy island dictionary",async()=>{
 const container=document.getElementById("root")!;const root=createRoot(container);
 const CJK=/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
 const toggle=()=>React.act(async()=>container.querySelector<HTMLButtonElement>("button")!.click());
 try {
  await React.act(async()=>root.render(React.createElement(ToolIO,{messageId:14,t:en})));
  assert.equal(container.querySelector("button")!.textContent,"Full tool input and output ⌄");
  assert.equal(calls.length,0);
  await toggle();
  assert.deepEqual([...container.querySelectorAll("h4")].map(heading=>heading.textContent),["Input","Output"]);
  assert.match(container.textContent!,/echo ok/);
  await React.act(async()=>Array.from(container.querySelectorAll("button")).find(button=>button.textContent==="Load more: Output")!.click());
  assert.match(container.textContent!,/firstlast/);assert.doesNotMatch(container.textContent!,CJK);
  await toggle();outputContent="";paged=false;await toggle();
  assert.match(container.querySelector("pre")!.textContent!,/^\(empty\)$/);assert.doesNotMatch(container.textContent!,CJK);
  await toggle();missing=true;await toggle();
  assert.deepEqual([...container.querySelectorAll("section p")].map(note=>note.textContent),["Not captured","Not captured"]);
  assert.doesNotMatch(container.textContent!,CJK);
  await toggle();denied=true;await toggle();
  assert.equal(container.querySelector("[role=alert]")!.textContent,"Could not load; expand again.");
  assert.doesNotMatch(container.textContent!,CJK);
 }finally{await React.act(async()=>root.unmount());}
});

test("a Chinese session keeps its labels and the component holds no hardcoded copy",async()=>{
 const container=document.getElementById("root")!;const root=createRoot(container);
 try {
  missing=true;
  await React.act(async()=>root.render(React.createElement(ToolIO,{messageId:15,t:zh})));
  assert.equal(container.querySelector("button")!.textContent,"完整工具输入输出 ⌄");
  await React.act(async()=>container.querySelector<HTMLButtonElement>("button")!.click());
  assert.deepEqual([...container.querySelectorAll("h4")].map(heading=>heading.textContent),["输入","输出"]);
  assert.match(container.textContent!,/未采集/);
 }finally{await React.act(async()=>root.unmount());}
 assert.doesNotMatch(readFileSync(new URL("../src/chat-react/ToolIO.tsx",import.meta.url),"utf8"),/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/);
});
