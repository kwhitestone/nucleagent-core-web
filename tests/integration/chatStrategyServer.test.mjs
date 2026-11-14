import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runtimeFixture } from "../fixtures/runtimeConfig.ts";
import { loadChatStrategy } from "../../src/chat-react/chatStrategy.ts";

test("built app serves optional strategy through the production startup hook and nginx", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-strategy-server-"));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const candidate = { providerId: 1, model: "fixture" };
  const strategy = { scope: "test-react-ordinary", origin, backend: "codex", candidate,
    measurements: [{ ...candidate, n: 5, medianMs: 1900, maxMs: 3100, date: "2026-11-15",
      versions: "local fixture", quality: "fixture only", thinking: null, vision: null }] };
  let nginx;
  try {
    const template = (await readFile("nginx.conf.template", "utf8"))
      .replace("listen 8080;", `listen 127.0.0.1:${port};`)
      .replace("/usr/share/nginx/html", resolve("dist"))
      .replaceAll("/etc/nucleagent", directory);
    await writeFile(join(directory, "template"), template);
    const hook = (await readFile("docker-entrypoint.d/40-runtime-config.sh", "utf8"))
      .replace("/etc/nginx/runtime.conf.template", join(directory, "template"))
      .replace("/etc/nginx/conf.d/default.conf", join(directory, "server.conf"))
      .replaceAll("/etc/nucleagent", directory);
    const render = (value) => {
      const result = spawnSync("sh", ["-c", hook], { encoding: "utf8", env: {
        PATH: process.env.PATH, CORE_UPSTREAM: "http://127.0.0.1:1", SHELL_ORIGIN: "https://shell.example.test",
        ...runtimeFixture(), ...(value === undefined ? {} : { CHAT_STRATEGY_JSON: value }),
      } });
      assert.equal(result.status, 0, result.stderr);
    };
    render(JSON.stringify(strategy));
    const config = join(directory, "nginx.conf");
    await writeFile(config, `pid ${directory}/nginx.pid; error_log stderr notice; events {} http { access_log off; client_body_temp_path ${directory}/body; proxy_temp_path ${directory}/proxy; fastcgi_temp_path ${directory}/fastcgi; uwsgi_temp_path ${directory}/uwsgi; scgi_temp_path ${directory}/scgi; include ${directory}/server.conf; }`);
    nginx = spawn(process.env.NGINX_BINARY || "nginx", ["-e", "stderr", "-p", `${directory}/`, "-c", config, "-g", "daemon off;"], { stdio: ["ignore", "ignore", "pipe"] });
    await new Promise((done, reject) => {
      let diagnostics = "";
      const timer = setTimeout(() => reject(new Error("nginx startup timed out")), 2000);
      nginx.once("error", (error) => { clearTimeout(timer); reject(error); });
      nginx.once("exit", (code) => { clearTimeout(timer); reject(new Error(`nginx exited ${code}: ${diagnostics}`)); });
      nginx.stderr.on("data", (data) => {
        diagnostics += String(data);
        if (String(data).includes("start worker process")) { clearTimeout(timer); done(); }
      });
    });
    const response = await fetch(`${origin}/chat-strategy.json`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.deepEqual(await response.json(), strategy);
    assert.deepEqual(await loadChatStrategy(origin), strategy);
    const html = await (await fetch(origin)).text();
    const entry = html.match(/src="([^"]+\.js)"/)[1];
    assert.equal(await (await fetch(`${origin}${entry}`)).text(), await readFile(join("dist", entry), "utf8"));
    render(JSON.stringify({ ...strategy, origin: "https://other.example.test" }));
    assert.equal(await loadChatStrategy(origin), null);
    render("invalid JSON");
    assert.equal(await loadChatStrategy(origin), null);
    render(undefined);
    assert.equal((await fetch(`${origin}/chat-strategy.json`)).status, 404);
    assert.equal(await loadChatStrategy(origin), null);
  } finally {
    if (nginx && nginx.exitCode === null) { nginx.kill("SIGQUIT"); await once(nginx, "exit"); }
    await rm(directory, { recursive: true, force: true });
  }
});
