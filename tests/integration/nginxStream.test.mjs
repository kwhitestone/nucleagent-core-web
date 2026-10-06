import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";

// Run with: node --test tests/integration/nginxStream.test.mjs (requires nginx).
test("API proxy delivers SSE before EOF without upstream buffering headers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "core-web-stream-"));
  const upstream = createServer((request, response) => {
    if (request.headers.authorization !== "test-session") {
      response.writeHead(401).end();
      return;
    }
    if (!request.url.endsWith("/stream")) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ path: request.url }));
      return;
    }
    assert.equal(request.headers["last-event-id"], "41");
    response.setHeader("Content-Type", "text/event-stream");
    // An intermediate proxy may consume Core's X-Accel-Buffering header.
    response.write("id: 42\nevent: message-created\ndata: {}\n\n");
    const timer = setTimeout(() => response.write(": ping\n\n"), 100);
    response.on("close", () => clearTimeout(timer));
  });
  let nginx;
  const controller = new AbortController();
  try {
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const template = await readFile(new URL("../../nginx.conf.template", import.meta.url), "utf8");
    const server = template.replace("listen 8080;", `listen 127.0.0.1:${port};`)
      .replaceAll("${CORE_UPSTREAM}", `http://127.0.0.1:${upstream.address().port}`)
      .replaceAll("${FRAME_ANCESTORS}", "https://shell.example.test");
    const config = join(directory, "nginx.conf");
    await writeFile(config, `pid ${directory}/nginx.pid;
error_log stderr warn;
events {}
http {
  access_log off;
  client_body_temp_path ${directory}/client;
  proxy_temp_path ${directory}/proxy;
  ${server}
}`);
    nginx = spawn(process.env.NGINX_BINARY || "nginx", ["-p", directory, "-c", config, "-g", "daemon off;"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let error = "";
    nginx.stderr.on("data", chunk => { error += chunk; });
    nginx.on("error", e => { error += e.message; });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        ready = (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(200) })).ok;
      } catch {}
      if (ready) break;
      await pause(50);
    }
    assert.ok(ready, `nginx did not start: ${error}`);
    const path = "/api/v1/addons/conversation/1/messages";
    assert.equal((await fetch(`${base}${path}`)).status, 401);
    const json = await fetch(`${base}${path}`, { headers: { Authorization: "test-session" } });
    assert.equal(json.headers.get("x-accel-buffering"), null);
    assert.deepEqual(await json.json(), { path });
    assert.equal((await fetch(`${base}/api`)).status, 404);

    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`${base}${path}/stream`, {
        headers: { Authorization: "test-session", "Last-Event-ID": "41" },
        signal: controller.signal,
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /text\/event-stream/);
      assert.equal(response.headers.get("x-accel-buffering"), "no", "downstream proxies need their own buffering instruction");
      assert.equal(response.headers.get("content-security-policy"), "frame-ancestors https://shell.example.test");
      const reader = response.body.getReader();
      let text = "";
      while (!text.includes(": ping\n\n")) {
        const part = await reader.read();
        assert.equal(part.done, false, "upstream must remain open");
        text += new TextDecoder().decode(part.value);
      }
      assert.match(text, /id: 42\nevent: message-created\ndata: \{\}\n\n/);
      await reader.cancel();
    } finally {
      clearTimeout(timer);
    }
  } finally {
    controller.abort();
    if (nginx?.pid && nginx.exitCode === null) {
      const exited = once(nginx, "exit");
      nginx.kill("SIGTERM");
      await exited;
    }
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
