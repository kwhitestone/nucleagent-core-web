import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, createWriteStream, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(process.env.CORE_WEB_ROOT ?? resolve(here, "../../.."));
const core = resolve(process.env.CORE_ROOT ?? resolve(web, "../core"));
const shell = resolve(process.env.SHELL_ROOT ?? resolve(web, "../shell"));
const red = resolve(process.env.RED_SHELL_ROOT ?? resolve(web, "../shell-red"));
const out = resolve(process.env.OUTPUT_DIR ?? resolve(web, "../../evidence", `run-${Date.now()}`));
const port = Number(process.env.PORT_BASE ?? 5531);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65530);
mkdirSync(out, { recursive: true });
const children = [], results = [];
const sha = path => execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sources = [...readdirSync(here).map(name=>resolve(here,name)),
  resolve(core,"app/src/server/addons/conversation/router/editor_integrated_test.go")];
writeFileSync(resolve(out, "inputs.json"), JSON.stringify({
  web: sha(web), core: sha(core), shell: sha(shell), red: sha(red),
  sources: sources.map(path=>({path,sha256:createHash("sha256").update(readFileSync(path)).digest("hex")})),
  localOnly: true, time: new Date().toISOString(),
}, null, 2));
function start(name, cmd, args, cwd, env={}) {
  const startTime = performance.now();
  const log = createWriteStream(resolve(out, `${name}.log`), { flags: "wx" });
  const proc = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let text = "";
  proc.stdout.on("data", bytes => { text = (text + bytes).slice(-4000); log.write(bytes); });
  proc.stderr.on("data", bytes => log.write(bytes));
  const entry = { name, proc, get text() { return text; }, exit: null };
  entry.done = new Promise((resolveDone, reject) => {
    proc.once("error", reject);
    proc.once("close", (code, signal) => {
      entry.exit = { code, signal };
      log.end();
      results.push({ name, code, signal, ms: Math.round(performance.now()-startTime) });
      resolveDone(code);
    });
  });
  children.push(entry);
  return entry;
}
async function ready(test, entry) {
  const until = Date.now()+90000;
  while(!test()) {
    if(entry.exit) throw Error(`${entry.name} exited before ready; see local log`);
    if(Date.now()>until) throw Error(`${entry.name} readiness timeout`);
    await new Promise(r=>setTimeout(r,100));
  }
}
async function run(name, cmd, args, cwd, env={}) {
  const entry = start(name, cmd, args, cwd, env);
  const timeout = setTimeout(()=>entry.proc.kill("SIGTERM"),180000);
  try { return await entry.done; } finally { clearTimeout(timeout); }
}
let backend, failure;
try {
  assert.equal(await run("backend-safety", "go", ["test","-p","2","./addons/conversation/router",
    "-run","^TestIntegratedEditorSSEAndBindings$","-count=1","-timeout=90s","-v"],
    resolve(core,"app/src/server"), { GIN_MODE: "release" }),0);
  const readyPath = resolve(out,"backend-ready.json");
  const service = start("backend-service","go",["test","-p","2","./addons/conversation/router",
    "-run","^TestIntegratedEditorService$","-count=1","-timeout=11m","-v"],
    resolve(core,"app/src/server"),{ GIN_MODE:"release", EDITOR_FIXTURE_READY:readyPath });
  await ready(()=>existsSync(readyPath),service);
  backend=JSON.parse(readFileSync(readyPath)).origin;
  assert.match(backend,/^http:\/\/127\.0\.0\.1:\d+$/);
  for(const [name,p,root] of [["old-shell",port,red],["fixed-shell",port+1,shell],["child",port+2,shell]]) {
    const server=start(name,"node",[resolve(here,"independent-server.mjs")],web,
      { PORT:String(p),SHELL_ROOT:root,CORE_WEB_ROOT:web,BACKEND_ORIGIN:backend });
    await ready(()=>server.text.includes("fixture listening"),server);
  }
  for(const [name,p,suite] of [["shell-red",port,"shell"],["shell-green",port+1,"shell"],["chat-green",port+1,"chat"]]) {
    const resultPath=resolve(out,`${name}.json`);
    const code=await run(name,"flock",["-w","30","/tmp/cdp9229.lock","flock","-w","30",
      "/tmp/cdp-9229.lock","node",resolve(here,"independent-browser.mjs")],web,{
      SUITE:suite,FIXTURE_ORIGIN:`http://127.0.0.1:${p}`,CHILD_ORIGIN:`http://127.0.0.1:${port+2}`,
      RESULT_PATH:resultPath,
    });
    const result=JSON.parse(readFileSync(resultPath));
    assert.equal(result.cleanup.ownedClosed,true);
    assert.equal(result.cleanup.existingPreserved,true);
    assert.equal(result.blockedOutbound,0,"no unapproved outbound attempt, including the RED control");
    if(name==="shell-red") {
      assert.equal(code,1,"old candidate must fail the unchanged safe assertion");
      assert.ok(result.errors.some(s=>s.includes("TOKEN_CAPTURE")),"infrastructure failure is not a RED control");
    } else {
      assert.equal(code,0,`${name} failed; see ${resultPath}`);
      assert.equal(result.errors.length,0);
      assert.equal(result.results.length,suite==="shell"?13:4,"no silently skipped scenario");
    }
  }
} catch(error) {
  failure=error;
} finally {
  if(backend) await fetch(`${backend}/__fixture/release`,{method:"POST"}).catch(()=>{});
  if(backend) await fetch(`${backend}/__fixture/stop`,{method:"POST"}).catch(()=>{});
  // Only children created by this runner. Never stop shared browser/services.
  for(const child of children.filter(c=>!c.exit && c.name!=="backend-service")) child.proc.kill("SIGTERM");
  for(const child of children.filter(c=>!c.exit)) {
    const timer=setTimeout(()=>child.proc.kill("SIGKILL"),5000);
    await child.done;
    clearTimeout(timer);
  }
  writeFileSync(resolve(out,"summary.json"),JSON.stringify({
    safety:failure?"FAIL":"PASS_WITH_EXPECTED_OLD_RED",releaseAcceptance:"NOT_RUN",
    localSyntheticOnly:true,results,error:failure?.message??null,
  },null,2));
}
console.log(`Evidence: ${out}`);
if(failure) throw failure;
