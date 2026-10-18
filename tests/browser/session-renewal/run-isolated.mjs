import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

assert.ok(process.env.CHROME_BIN, "Set CHROME_BIN to an installed Chromium executable");
const profile = mkdtempSync(resolve(".chrome-profile-"));
const browser = spawn(process.env.CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--disable-background-networking", "--disable-component-update",
  "--no-first-run", "--no-default-browser-check",
  "--host-resolver-rules=MAP localhost 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
const browserDone = new Promise(resolve => browser.once("close", resolve));
let runner, runnerDone, code, endpoint;
try {
  let timer;
  endpoint = await Promise.race([
    new Promise((resolve, reject) => {
      browser.once("error", reject);
      browser.stderr.on("data", chunk => {
        const match = String(chunk).match(/DevTools listening on ws:\/\/127.0.0.1:(\d+)\//);
        if (match) resolve(`http://127.0.0.1:${match[1]}`);
      });
    }),
    browserDone.then(() => { throw Error("Owned browser exited before readiness"); }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Owned Chrome readiness timeout")), 15000); }),
  ]).finally(() => clearTimeout(timer));
  console.log(`Owned isolated Chrome ready at ${endpoint}`);
  const scripts = process.argv.slice(2);
  runner = spawn(process.execPath, scripts.length ? scripts : [
    fileURLToPath(new URL("cross-tab-run.mjs", import.meta.url)),
  ], { env: { ...process.env, CDP_ENDPOINT: endpoint }, stdio: "inherit" });
  runnerDone = new Promise((resolve, reject) => {
    runner.once("error", reject);
    runner.once("close", resolve);
  });
  code = await runnerDone;
} finally {
  if (runner?.exitCode === null) runner.kill("SIGTERM");
  await runnerDone?.catch(() => undefined);
  if (browser.exitCode === null) browser.kill("SIGTERM");
  await browserDone;
  rmSync(profile, { recursive: true, force: true });
  writeFileSync(process.env.ISOLATION_RECEIPT ?? "isolation.json", JSON.stringify({
    code, endpoint, browserClosed: browser.exitCode !== null || browser.signalCode !== null,
    profileRemoved: true, sharedBrowserUsed: false,
  }, null, 2));
}
assert.equal(code, 0, "Isolated browser gates failed");
