import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { after, before, test } from "node:test";

// UNI-MOBILE-IMPL M3 (board §11–§14): the built core-web, standalone, in a
// real mobile-emulated Chromium, against a stubbed core API on one ephemeral
// port. Skips unless `npm run build` ran and playwright is installed.
const dist = resolve("dist");
const playwrightPath = process.env.PLAYWRIGHT_PATH ?? resolve("../../node_modules/playwright");
const skip = !existsSync(join(dist, "index.html")) ? "run `npm run build` first"
  : !existsSync(playwrightPath) ? "playwright not installed" : false;

const TYPES: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".html": "text/html" };
const TOKEN = `x.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString("base64url")}.y`;
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const CONVERSATIONS = [
  { id: 11, userId: 1, title: "上周的周报", mode: "a2a_agent", status: "completed", createdAt: at(90), updatedAt: at(90) },
  { id: 12, userId: 1, title: "AI Agent 市场竞品分析", mode: "a2a_agent", status: "executing", createdAt: at(30), updatedAt: at(5) },
  { id: 13, userId: 1, title: "需要确认的数据口径", mode: "a2a_agent", status: "blocked", createdAt: at(300), updatedAt: at(3) },
];
const BACKENDS = [
  { id: "codex", type: "codex", displayName: "Codex Agent", streaming: true, default: true },
  { id: "hermes", type: "hermes", displayName: "Hermes", streaming: true, default: false },
];
const PROVIDERS = [{ id: 1, name: "OpenAI", isActive: true, config: { models: ["gpt-5", "gpt-5-mini"] } }];
const TEMPLATES = [{ id: 1, name: "竞品研究", config: { role: "市场研究员", prompt: "请调研以下市场的主要竞品：" } }];
const MESSAGES = [
  { id: 1, conversationId: 12, senderType: "user", senderName: "user", msgType: "text", content: "帮我写一份 AI Agent 市场竞品分析", createdAt: at(30) },
  { id: 2, conversationId: 12, senderType: "agent", senderName: "web_search", msgType: "tool_call", content: "搜索 AI agent market 2026", createdAt: at(29), metadata: { status: "completed" } },
  { id: 3, conversationId: 12, senderType: "agent", senderName: "agent", msgType: "text", createdAt: at(28),
    content: "## 结论\n\n| 厂商 | 定位 | 价格 | 部署 | 生态 | 备注 |\n|---|---|---|---|---|---|\n| A 公司 | 企业级 | 高 | 私有化 | 强 | 很长的一列说明文字用于撑宽表格 |\n\n```\nconst veryLongLine = 'this line is long enough to overflow a 320px screen by itself for sure';\n```" },
];

let server: Server;
let origin = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browser: any;
const created: unknown[] = [];

function json(res: ServerResponse, body: unknown, headers: Record<string, string>): void {
  res.writeHead(200, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
}

before(async () => {
  if (skip) return;
  server = createServer((req, res) => {
    const cors = { "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE" };
    if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
    const url = (req.url ?? "/").split("?")[0];
    if (url.startsWith("/api/")) {
      if (url === "/api/v1/addons/conversation" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => { created.push(JSON.parse(body)); json(res, { code: 0, data: { ...CONVERSATIONS[1], id: 99 } }, cors); });
        return;
      }
      if (url === "/api/v1/addons/conversation") return json(res, { code: 0, data: CONVERSATIONS, hasMore: false }, cors);
      if (url.endsWith("/execution-backends")) return json(res, { code: 0, data: BACKENDS }, cors);
      if (url === "/api/v1/addons/provider") return json(res, { code: 0, data: PROVIDERS }, cors);
      if (url.endsWith("/visible-models")) return json(res, { code: 0, data: [] }, cors);
      if (url.endsWith("/agent/templates")) return json(res, { code: 0, data: TEMPLATES }, cors);
      if (url === "/api/v1/addons/skill") return json(res, { code: 0, data: [] }, cors);
      if (/\/conversation\/\d+\/messages\/stream$/.test(url)) return void res.writeHead(204, cors).end();
      if (/\/conversation\/\d+\/messages$/.test(url)) return json(res, { code: 0, data: MESSAGES }, cors);
      const one = url.match(/\/conversation\/(\d+)$/);
      if (one) return json(res, { code: 0, data: CONVERSATIONS.find((c) => c.id === Number(one[1])) ?? { ...CONVERSATIONS[1], id: Number(one[1]) } }, cors);
      return json(res, { code: 0, data: [] }, cors);
    }
    const file = join(dist, url);
    if (url !== "/" && existsSync(file) && !file.endsWith("/")) {
      return void res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
    }
    res.writeHead(200, { "content-type": "text/html" }).end(readFileSync(join(dist, "index.html")));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const { chromium } = createRequire(import.meta.url)(playwrightPath);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function open(width: number, path: string, opts: { dark?: boolean; desktop?: boolean } = {}) {
  const ctx = await browser.newContext(opts.desktop
    ? { viewport: { width, height: 900 }, locale: "zh-CN" }
    : { viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: opts.dark ? "dark" : "light", locale: "zh-CN" });
  await ctx.addInitScript((t: string) => localStorage.setItem("nucleagent_access_token", t), TOKEN);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.goto(`${origin}${path}`);
  return { ctx, page, errors };
}

/** Visible buttons/inputs smaller than 44px, anything wider than the screen, inputs < 16px. */
const AUDIT = () => {
  const vis = (e: Element) => (e as HTMLElement).offsetWidth > 0 && getComputedStyle(e).visibility !== "hidden";
  const small = [...document.querySelectorAll("button, a[href], input:not([type=hidden]):not([type=checkbox]), textarea, [role=tab]")]
    .filter(vis).map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ e, r }) => `${(e.getAttribute("data-testid") || e.textContent || e.tagName).trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  const fonts = [...document.querySelectorAll("input:not([type=checkbox]), textarea")].filter(vis)
    .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.getAttribute("data-testid") || e.tagName);
  const hscroll = document.documentElement.scrollWidth > innerWidth + 1;
  return { small, fonts, hscroll };
};

for (const width of [393, 360, 320]) {
  test(`chat home @${width}: task desk — needs-you first, composer at the bottom, no poster, passes the audit`, { skip }, async () => {
    const { ctx, page, errors } = await open(width, "/chat");
    await page.getByTestId("desk-row").first().waitFor();
    const rows = await page.getByTestId("desk-row").evaluateAll((els: HTMLElement[]) => els.map((e) => e.dataset.status));
    assert.deepEqual(rows, ["blocked", "executing", "completed"]);
    assert.equal(await page.locator(".suggestion-grid, .home-title").count(), 0, "no poster or suggestion cards");
    const composer = await page.locator(".desk-composer").boundingBox();
    assert.ok(composer.y + composer.height >= 799, `composer docked at the bottom: ${JSON.stringify(composer)}`);
    assert.deepEqual(await page.evaluate(AUDIT), { small: [], fonts: [], hscroll: false });
    // The config pill opens 本次执行 with model/backend rows; 「更多设置」 carries the text to the form.
    await page.getByTestId("desk-input").fill("写一份竞品分析");
    await page.getByTestId("run-pill").tap();
    await page.getByTestId("row-model").waitFor();
    await page.getByTestId("row-backend").waitFor();
    await page.getByTestId("run-more").tap();
    await page.waitForURL(/\/tasks\?input=/);
    assert.equal(await page.getByTestId("task-desc").inputValue(), "写一份竞品分析");
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  test(`creation → task form @${width} (Q4): one-column rows, tap prefills the form, launch pinned, no 保存草稿 (Q5)`, { skip }, async () => {
    const { ctx, page, errors } = await open(width, "/creation");
    await page.getByTestId("creation-card").first().waitFor();
    const card = await page.getByTestId("creation-card").first().boundingBox();
    assert.ok(card.width >= width - 40 && card.height >= 64, `list row: ${JSON.stringify(card)}`);
    assert.deepEqual(await page.evaluate(AUDIT), { small: [], fonts: [], hscroll: false }, "creation");
    await page.getByTestId("creation-card").first().tap();
    await page.waitForURL(/\/tasks\?template=/);
    await page.getByTestId("task-mobile").waitFor();
    assert.equal(await page.getByTestId("task-name").inputValue(), "竞品研究");
    assert.equal(await page.getByTestId("task-desc").inputValue(), "请调研以下市场的主要竞品：");
    assert.equal(await page.getByTestId("task-save-draft").count(), 0, "Q5: no draft button on phones");
    const launch = await page.getByTestId("task-launch").boundingBox();
    assert.ok(launch.height >= 52 && launch.y + launch.height <= 800 && launch.y > 600, `launch pinned: ${JSON.stringify(launch)}`);
    assert.deepEqual(await page.evaluate(AUDIT), { small: [], fonts: [], hscroll: false }, "task form");
    // Options are sheets, not native selects.
    await page.getByTestId("row-exec-mode").tap();
    await page.getByTestId("option-sheet").waitFor();
    await page.getByRole("radio").nth(1).tap();
    assert.equal(await page.getByTestId("option-sheet").count(), 0, "single choice closes the sheet");
    // Empty name: not greyed; tap scrolls to the field and shows the error above it.
    await page.getByTestId("task-name").fill("");
    await page.getByTestId("task-launch").tap();
    await page.getByRole("alert").first().waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "task-name");
    await page.getByTestId("task-name").fill("竞品研究");
    await page.getByTestId("task-launch").tap();
    await page.waitForURL(/\/c\/99$/);
    const sent = created.at(-1) as { metadata: { execMode: string; taskName: string }; executionBackend: string };
    assert.equal(sent.metadata.taskName, "竞品研究");
    assert.equal(sent.metadata.execMode, "stepByStep");
    assert.equal(sent.executionBackend, "codex");
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  test(`conversation @${width}: status header + 「⋯」 settings (Q7), process is one line → sheet, wide content scrolls inside`, { skip }, async () => {
    const { ctx, page, errors } = await open(width, "/c/12");
    await page.getByTestId("conv-head").waitFor();
    await page.locator(".atc-markdown table").waitFor();
    assert.match(await page.getByTestId("conv-head").innerText(), /AI Agent 市场竞品分析[\s\S]*执行中/);
    assert.equal(await page.locator(".model-picker-select, .execution-backend-picker-select").count(), 0, "no selects in the composer");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "page never scrolls sideways");
    const table = await page.locator(".atc-markdown table").evaluate((t: HTMLElement) => ({ sw: t.scrollWidth, cw: t.clientWidth, ox: getComputedStyle(t).overflowX }));
    assert.ok(table.ox === "auto" && table.sw > table.cw, `table scrolls in its box: ${JSON.stringify(table)}`);
    assert.equal(parseFloat(await page.locator(".atc-assistant-item .atc-markdown").first().evaluate((e: HTMLElement) => getComputedStyle(e).fontSize)), 16);
    // Process: collapsed one line (not the vertical-letter bug), opens as a bottom sheet.
    const summary = page.locator(".atc-process-summary").first();
    const line = await summary.boundingBox();
    assert.ok(line.height >= 44 && line.height <= 60, `process line: ${JSON.stringify(line)}`);
    assert.equal(await page.locator(".atc-process-group[open]").count(), 0);
    await summary.tap();
    const sheet = await page.locator(".atc-process-group[open] > .atc-process-group-content").boundingBox();
    assert.ok(Math.round(sheet.y + sheet.height) === 800 && sheet.width >= width - 1, `sheet at the bottom: ${JSON.stringify(sheet)}`);
    await page.locator(".atc-process-sheet-close").tap();
    assert.equal(await page.locator(".atc-process-group[open]").count(), 0);
    // Q7: model/backend live behind 「⋯」.
    await page.getByTestId("conv-more").tap();
    await page.getByTestId("row-model").waitFor();
    await page.getByTestId("row-backend").waitFor();
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("admin @360 (R-ADMIN): chip tabs, calm desktop notice that stays dismissed, no sideways page scroll", { skip }, async () => {
  const { ctx, page, errors } = await open(360, "/admin/providers");
  await page.getByTestId("admin-desktop-notice").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  const tabs = await page.locator(".admin-tab").evaluateAll((els: HTMLElement[]) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert.ok(tabs.every((h: number) => h >= 44), `tab chips: ${tabs}`);
  await page.getByTestId("admin-desktop-notice").locator("button").tap();
  await page.reload();
  await page.locator(".admin-view").waitFor();
  assert.equal(await page.getByTestId("admin-desktop-notice").count(), 0, "remembered");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("dark @360: task desk and task form stay readable (no light-on-light)", { skip }, async () => {
  const { ctx, page, errors } = await open(360, "/tasks", { dark: true });
  await page.getByTestId("task-mobile").waitFor();
  const colours = await page.evaluate(() => {
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const pair = (sel: string) => {
      const e = document.querySelector(sel)!;
      let bg = "rgb(255,255,255)";
      for (let n: Element | null = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (!/rgba\(.*, 0\)$/.test(c) && c !== "transparent") { bg = c; break; } }
      const [a, b] = [lum(rgb(getComputedStyle(e).color)), lum(rgb(bg))];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    return { label: pair(".picker-row-k"), value: pair(".picker-row-v"), launch: pair(".task-m-launch") };
  });
  for (const [k, v] of Object.entries(colours)) assert.ok(v >= 4.5, `${k} contrast ${v.toFixed(2)}`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("desktop @1280: poster home, card creation, full form with a working 保存草稿 (Q5), composer pickers", { skip }, async () => {
  const { ctx, page, errors } = await open(1280, "/tasks", { desktop: true });
  await page.locator(".task-setup-view").waitFor();
  assert.equal(await page.getByTestId("task-mobile").count(), 0);
  await page.locator(".form-input").fill("草稿任务");
  await page.getByTestId("task-save-draft").click();
  assert.match(await page.evaluate(() => localStorage.getItem("nucleagent_task_draft") ?? ""), /草稿任务/);
  await page.reload();
  await page.locator(".task-setup-view").waitFor();
  await page.waitForFunction(() => (document.querySelector(".form-input") as HTMLInputElement)?.value === "草稿任务");
  await page.goto(`${origin}/chat`);
  await page.locator(".home-title").waitFor();
  assert.equal(await page.getByTestId("task-desk").count(), 0);
  await page.goto(`${origin}/c/12`);
  await page.locator(".model-picker-select").waitFor();
  assert.equal(await page.getByTestId("conv-head").count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// Evidence (opt-in): EVIDENCE_DIR=<dir> node --test tests/mobileCore.test.ts
const evidence = process.env.EVIDENCE_DIR;
test("evidence screenshots 393/360/320 × light/dark", { skip: skip || (!evidence && "EVIDENCE_DIR not set") }, async () => {
  for (const width of [393, 360, 320]) for (const dark of [false, true]) {
    const tag = `${width}-${dark ? "dark" : "light"}`;
    const shots: [string, string, (p: any) => Promise<void>][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      ["desk", "/chat", async (p) => { await p.getByTestId("desk-row").first().waitFor(); }],
      ["run-sheet", "/chat", async (p) => { await p.getByTestId("desk-row").first().waitFor(); await p.getByTestId("run-pill").tap(); }],
      ["creation", "/creation", async (p) => { await p.getByTestId("creation-card").first().waitFor(); }],
      ["task-form", "/tasks?template=%E7%AB%9E%E5%93%81%E7%A0%94%E7%A9%B6", async (p) => { await p.getByTestId("task-mobile").waitFor(); }],
      ["task-backend-sheet", "/tasks", async (p) => { await p.getByTestId("row-backend").tap(); await p.getByTestId("option-sheet").waitFor(); }],
      ["conversation", "/c/12", async (p) => { await p.locator(".atc-markdown table").waitFor(); }],
      ["process-sheet", "/c/12", async (p) => { await p.locator(".atc-process-summary").first().tap(); }],
      ["conv-more", "/c/12", async (p) => { await p.getByTestId("conv-more").tap(); await p.getByTestId("row-model").waitFor(); }],
    ];
    for (const [name, path, prep] of shots) {
      const { ctx, page } = await open(width, path, { dark });
      await prep(page);
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${evidence}/${name}-${tag}.png` });
      await ctx.close();
    }
  }
});
