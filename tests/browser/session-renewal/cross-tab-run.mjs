import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// Run under both shared CDP locks; attach only to the existing synthetic browser.
const fixture = name => fileURLToPath(new URL(name, import.meta.url));
const children = [];
function run(name, env, log) {
  const output = createWriteStream(log, { mode: 0o600 });
  const child = spawn(process.execPath, [fixture(name)], {
    env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  const done = new Promise(resolve => {
    child.once("error", error => { output.end(String(error)); resolve(-1); });
    child.once("close", code => { output.end(); resolve(code); });
  });
  children.push({ child, done });
  return { child, done };
}
async function server(name, port) {
  const { child, done } = run(name, { PORT: String(port) }, `server-${port}.log`);
  let timer;
  try {
    await Promise.race([
      new Promise(resolve => child.stdout.on("data", chunk => {
        if (/Synthetic (fixture|store\/frame fixture)/.test(String(chunk))) resolve();
      })),
      done.then(() => { throw Error(`Fixture server ${port} exited before readiness`); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Server ${port} readiness timeout`)), 30_000); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function test(name, env, log) {
  const { child, done } = run(name, env, log);
  const timer = setTimeout(() => child.kill("SIGTERM"), 300_000);
  try { assert.equal(await done, 0, log); }
  finally { clearTimeout(timer); }
}
try {
  await server("cross-tab-server.mjs", 5301);
  await server("cross-tab-server.mjs", 5303);
  const label = process.env.EXPECT_RED === "1" ? "red" : "green";
  await test("cross-tab-browser.mjs", { CROSS_ONLY: "1", NATIVE_ONLY: "", RESULT_PATH: `cross-${label}.json` }, `cross-${label}.log`);
  if (process.env.FULL === "1") {
    await test("cross-tab-browser.mjs", { CROSS_ONLY: "", NATIVE_ONLY: "", RESULT_PATH: "frame-green.json" }, "frame-green.log");
    await test("cross-tab-browser.mjs", { CROSS_ONLY: "", NATIVE_ONLY: "1", RESULT_PATH: "native-green.json" }, "native-green.log");
    await server("server.mjs", 5304);
    await test("red.mjs", {
      FIXTURE_URL: "http://127.0.0.1:5304/tests/browser/session-renewal/", RESULT_PATH: "mounted-green.json",
    }, "mounted-green.log");
  }
} finally {
  for (const { child } of children) if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.all(children.map(({ done }) => done));
}
