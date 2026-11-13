// MUYU-365 MVP acceptance + first-token latency, Vue vs React chat, in the real TEST shell.
//
// Acceptance level: TEST shell + TEST backend + THIS checkout's `dist` served for the TEST
// core-web origin's static files (document + /assets) by request interception inside the
// caller's own CDP browser. /api and /runtime-config.json pass through untouched; the token
// reaches core-web only through the shell's postMessage handshake. Nothing is deployed.
//
// node tests/browser/muyu365-chat-react.cjs <playwright-core path> <cdp port> [--n 1] [--cancel] [--dry] [--only vue|react] [--react-id <id>]
// Costs: each sample sends one short chat message (new conversation + follow-ups).
const assert = require("node:assert/strict");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.argv[2] || "playwright-core");

const port = process.argv[3];
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const followUps = Number(arg("--n", "1"));
const withCancel = process.argv.includes("--cancel");
const SHELL = "https://nucleagent-web.debug.ndaeweb.com";
const CORE = "https://nucleagent-core-web.debug.ndaeweb.com";
const DIST = path.resolve(__dirname, "../../dist");
const EVIDENCE = path.resolve(__dirname, "../../docs/muyu365-evidence");
const PROMPT = "只回复一个字：好";
const types = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
const results = { checks: [], latencyMs: { vue: [], react: [] }, conversations: [], screens: [] };
const dry = process.argv.includes("--dry"); // load + picker + hygiene only, sends nothing
const check = (name, ok, detail = "") => { results.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

// Selectors for "first answer character on screen" and "run finished".
const UI = {
  vue: { answer: ".msg.assistant .msg-bubble", input: "textarea", send: ".desk-send, .composer-btn.send, .atc-send-button", running: ".atc-stop-button" },
  react: { answer: ".mc-msg[data-message-role=assistant] .mc-md", input: "textarea.mc-input", send: "[data-testid=mc-send]", running: "[data-testid=mc-stop]" },
};

async function openShell(context, mode, route = "/chat") {
  const page = await context.newPage();
  let authorization = "";
  await page.addInitScript(([core, ui]) => {
    if (location.origin === core) localStorage.setItem("nucleagent_chat_ui", ui);
  }, [CORE, mode]);
  await page.route(`${CORE}/**`, async (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.startsWith("/api/") || url.pathname === "/runtime-config.json") {
      // Kept in memory only, to prove it never lands in storage or console. Never printed.
      authorization ||= r.request().headers().authorization ?? "";
      return r.continue();
    }
    if (url.pathname.startsWith("/assets/")) {
      const file = path.join(DIST, url.pathname);
      if (!file.startsWith(DIST) || !existsSync(file)) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ status: 200, contentType: types[path.extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
    }
    const real = await r.fetch(); // keep the real document headers (CSP frame-ancestors)
    return r.fulfill({ response: real, body: readFileSync(path.join(DIST, "index.html")), contentType: "text/html" });
  });
  const consoleText = [];
  page.on("console", (m) => consoleText.push(m.text()));
  await page.goto(`${SHELL}${route}`, { waitUntil: "domcontentloaded" });
  const frame = await (async () => {
    for (let i = 0; i < 60; i++) {
      const f = page.frames().find((x) => x.url().startsWith(CORE));
      if (f) return f;
      await page.waitForTimeout(250);
    }
    throw new Error("core-web frame not found");
  })();
  await frame.locator(UI[mode].input).first().waitFor({ timeout: 30_000 });
  return { page, frame, consoleText, authorization: () => authorization };
}

async function measureSend(frame, mode, text) {
  const sel = UI[mode];
  const before = await frame.locator(sel.answer).count();
  await frame.evaluate(([answer, before]) => {
    const w = window;
    w.__mc = { t0: 0, t1: 0 };
    const ready = () => [...document.querySelectorAll(answer)].slice(before).some((n) => n.textContent.trim().length > 0);
    new MutationObserver((_, obs) => { if (w.__mc.t0 && !w.__mc.t1 && ready()) { w.__mc.t1 = performance.now(); obs.disconnect(); } })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
    // t0 = the user's click on Send (capture phase, before any app handler runs).
    document.addEventListener("click", () => { if (!w.__mc.t0) w.__mc.t0 = performance.now(); }, { capture: true });
  }, [sel.answer, before]);
  const input = frame.locator(sel.input).first();
  await input.fill(text);
  await frame.locator(sel.send).first().click();
  await frame.waitForFunction(() => window.__mc.t1 > 0, null, { timeout: 120_000 });
  const ms = await frame.evaluate(() => window.__mc.t1 - window.__mc.t0);
  // Wait for the run to finish so the next sample starts idle.
  await frame.waitForFunction((s) => !document.querySelector(s), sel.running, { timeout: 180_000 }).catch(() => {});
  return Math.round(ms);
}

async function shot(target, name) {
  mkdirSync(EVIDENCE, { recursive: true });
  const file = path.join(EVIDENCE, `${name}.png`);
  await target.screenshot({ path: file });
  return path.relative(path.resolve(__dirname, "../.."), file);
}

async function credentialHygiene(session, mode) {
  const token = session.authorization();
  const stored = await session.frame.evaluate(() => Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? ""]));
  check(`${mode}: requests carried shell-issued Authorization`, token.length > 0);
  check(`${mode}: token absent from core-web localStorage`, token && !stored.some(([, v]) => v.includes(token)), `keys=${stored.map(([k]) => k).join(",")}`);
  check(`${mode}: token absent from console`, token && !session.consoleText.some((t) => t.includes(token)));
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

async function run(context, mode) {
  const s = await openShell(context, mode);
  const iframe = s.page.locator(`iframe[src^="${CORE}"]`).first();
  check(`${mode}: switch selected the ${mode} view`, (await s.frame.locator("[data-chat-ui=react]").count() > 0) === (mode === "react"));
  if (mode === "react") {
    await s.frame.locator("[data-testid=mc-executor] option").first().waitFor({ timeout: 30_000 }).catch(() => {});
    const groups = await s.frame.locator("[data-testid=mc-model] optgroup, [data-testid=mc-executor] optgroup")
      .evaluateAll((els) => els.map((e) => ({ kind: e.dataset.kind, n: e.querySelectorAll("option").length })));
    check("react: grouped picker (chat/image/video/executor from Toolgate types + Core)", groups.some((g) => g.kind === "chat") && groups.some((g) => g.kind === "executor"), JSON.stringify(groups));
    results.groups = groups;
    results.screens.push(await shot(iframe, "react-empty"));
  } else {
    results.screens.push(await shot(iframe, "vue-empty"));
  }
  if (dry) { await credentialHygiene(s, mode); await s.page.close(); return null; }
  results.latencyMs[mode].push(await measureSend(s.frame, mode, PROMPT));
  const id = (s.page.url().match(/\/chat\/(\d+)/) ?? [])[1];
  check(`${mode}: new conversation created and opened`, !!id, `shell url /chat/${id ?? "?"}`);
  results.conversations.push({ mode, id });
  for (let i = 0; i < followUps; i++) results.latencyMs[mode].push(await measureSend(s.frame, mode, `${PROMPT}（${i + 2}）`));
  const answers = await s.frame.locator(UI[mode].answer).count();
  check(`${mode}: follow-ups answered without duplicate bubbles`, answers >= 1 + followUps, `answers=${answers}`);
  if (mode === "react") {
    const users = await s.frame.locator(".mc-msg[data-message-role=user]").count();
    check("react: optimistic user bubbles replaced, not duplicated", users === 1 + followUps, `user bubbles=${users}`);
  }
  results.screens.push(await shot(iframe, `${mode}-conversation`));
  if (mode === "react" && withCancel) {
    const input = s.frame.locator(UI.react.input);
    await input.fill("请从 1 数到 200，每个数字单独一行");
    await s.frame.locator(UI.react.send).click();
    const stop = s.frame.locator(UI.react.running);
    await stop.waitFor({ timeout: 30_000 });
    await stop.click();
    await s.frame.locator("[data-testid=mc-send]").waitFor({ timeout: 30_000 });
    check("react: Stop returns the composer to Send (cancelled)", true);
    results.screens.push(await shot(iframe, "react-cancelled"));
  }
  await credentialHygiene(s, mode);
  await s.page.close();
  return id;
}

(async () => {
  assert.ok(port, "usage: <playwright-core> <cdp port>");
  assert.ok(existsSync(path.join(DIST, "index.html")), "run npm run build first");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0]; // the biz browser's signed-in profile
  try {
    const only = arg("--only", "");
    const reactId = only === "vue" ? arg("--react-id", "") : await run(context, "react");
    if (only !== "react") await run(context, "vue");
    // Same conversation through the Vue view: history written via React reads back in Vue.
    if (reactId) {
      const s = await openShell(context, "vue", `/chat/${reactId}`);
      await s.frame.locator(UI.vue.answer).first().waitFor({ timeout: 30_000 });
      const n = await s.frame.locator(UI.vue.answer).count();
      check("vue reads the React-written conversation", n >= 1 + followUps, `answers=${n}`);
      results.screens.push(await shot(s.page.locator(`iframe[src^="${CORE}"]`).first(), "vue-reads-react-conversation"));
      await s.page.close();
    }
  } finally {
    results.medianMs = { vue: median(results.latencyMs.vue), react: median(results.latencyMs.react) };
    console.log(JSON.stringify(results, null, 2));
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(path.join(EVIDENCE, "acceptance.json"), JSON.stringify({ at: new Date().toISOString(), ...results }, null, 2));
    await browser.close(); // connectOverCDP: disconnects only, the biz browser stays up
  }
  process.exitCode = results.checks.every((c) => c.ok) ? 0 : 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
