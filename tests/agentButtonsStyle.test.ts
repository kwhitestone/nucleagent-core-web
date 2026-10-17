import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

// UA-BTN-STYLE: "我的智能体" buttons rendered as browser defaults (.btn-primary/.btn-ghost only existed in other views'
// scoped styles). Real CSS of the three components + design tokens, real Chromium computed style; skips without playwright.
const playwrightPath = process.env.PLAYWRIGHT_PATH ?? resolve("../../node_modules/playwright");
const skip = existsSync(playwrightPath) ? false : "playwright not installed";
const sfcStyle = (file: string) => readFileSync(file, "utf8").match(/<style>([\s\S]*?)<\/style>/)![1];
const css = [
  readFileSync("src/styles/aurora.css", "utf8"), readFileSync("src/styles/global.css", "utf8"),
  ...["views/AgentList.vue", "components/AgentCard.vue", "components/UserAgentWizard.vue"].map((f) => sfcStyle(`src/addons/conversation/${f}`)),
].join("\n");

// Same class structure as the templates (AgentList.vue header, AgentCard.vue, UserAgentWizard.vue actions).
const card = (id: string, owned: boolean, desc: string) => `
  <article class="agent-card" data-id="${id}" style="animation:none">
    <a class="agent-card-hit" href="#"></a><div class="agent-card-cover"></div><span class="agent-card-av">A</span>
    <div class="agent-card-body">
      <div class="agent-card-name"><span>${id}</span></div>
      <p class="agent-card-desc">${desc}</p>
      <div class="agent-card-meta"><span>meta</span></div>
      <div class="agent-card-act">
        <a href="#" class="btn-primary" data-t="start">开始对话</a>
        ${owned ? `<label class="btn-ghost agent-card-upload" data-t="upload">上传头像<input type="file" hidden></label>` : ""}
      </div>
      ${owned ? `<div class="agent-card-act own">
        <button type="button" class="btn-ghost" data-t="edit">编辑</button>
        <button type="button" class="btn-ghost" data-t="toggle">停用</button>
        <button type="button" class="btn-ghost danger" data-t="delete">删除</button>
      </div>` : ""}
    </div>
  </article>`;
const page = (width: number, disabled = false, wizard = true) => `<style>${css}</style><div style="width:${width}px"><div class="view active">
  <div class="agent-list">
    <header class="agent-list-head"><div><h1>我的智能体</h1></div><div class="agent-list-tools">
      <span class="agent-list-quota">1/5</span>
      <button type="button" class="btn-primary" data-t="create" ${disabled ? "disabled" : ""}>+ 创建智能体</button>
    </div></header>
    <div class="agent-grid" style="grid-template-columns: repeat(2, 1fr)">${card("a", false, "short")}${card("b", true, "long long long long long long long long long long long long long long long long long long")}</div>
  </div>
  ${wizard ? "" : "<!--"}<div class="ua-scrim"><form class="ua-wizard" style="animation:none"><div class="ua-actions">
    <button type="button" class="btn-ghost" data-t="cancel">取消</button><button type="submit" class="btn-primary" data-t="submit">创建</button>
  </div></form></div>${wizard ? "" : "-->"}
</div></div>`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browser: any;
before(async () => {
  if (skip) return;
  const { chromium } = createRequire(import.meta.url)(playwrightPath);
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
});
after(async () => { await browser?.close(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withPage(html: string, fn: (tab: any) => Promise<void>): Promise<void> {
  const tab = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try { await tab.setContent(html); await fn(tab); } finally { await tab.close(); }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const style = (tab: any, t: string) => tab.$eval(`[data-t="${t}"]`, (n: Element) => {
  const s = getComputedStyle(n); const r = n.getBoundingClientRect();
  return { bg: s.backgroundImage, bgColor: s.backgroundColor, color: s.color, radius: parseFloat(s.borderTopLeftRadius),
    border: `${s.borderTopWidth} ${s.borderTopStyle}`, borderColor: s.borderTopColor, deco: s.textDecorationLine, display: s.display,
    opacity: s.opacity, cursor: s.cursor, shadow: s.boxShadow, outline: s.outlineStyle, height: r.height, left: r.left, bottom: r.bottom };
});
const BUTTONFACE = "rgb(239, 239, 239)"; // Chromium default <button> background

test("primary buttons (create, start link, wizard submit) use the brand gradient, white text, rounded, no underline", { skip }, async () => {
  await withPage(page(1440), async (tab) => {
    for (const t of ["create", "start", "submit"]) {
      const s = await style(tab, t);
      assert.match(s.bg, /linear-gradient/, `${t} bg`);
      assert.equal(s.color, "rgb(255, 255, 255)", `${t} color`);
      assert.ok(s.radius >= 6, `${t} radius ${s.radius}`);
      assert.equal(s.deco, "none", `${t} underline`);
      assert.equal(s.cursor, "pointer", `${t} cursor`);
    }
  });
});

test("ghost buttons (edit/toggle/upload/cancel) are outlined cards, not buttonface; upload label looks the same", { skip }, async () => {
  await withPage(page(1440), async (tab) => {
    const ref = await style(tab, "edit");
    assert.notEqual(ref.bgColor, BUTTONFACE);
    assert.equal(ref.bgColor, "rgb(255, 255, 255)");
    assert.equal(ref.border, "1px solid");
    assert.equal(ref.borderColor, "rgb(226, 232, 240)");
    assert.ok(ref.radius >= 6);
    for (const t of ["toggle", "upload", "cancel"]) {
      const s = await style(tab, t);
      assert.deepEqual([s.bgColor, s.border, s.borderColor, s.radius, s.cursor], [ref.bgColor, ref.border, ref.borderColor, ref.radius, "pointer"], t);
    }
    assert.equal((await style(tab, "upload")).height, (await style(tab, "start")).height, "upload same height as start");
  });
});

test("danger button is rose and turns rose-bordered on hover", { skip }, async () => {
  await withPage(page(1440, false, false), async (tab) => {
    assert.equal((await style(tab, "delete")).color, "rgb(244, 63, 94)");
    await tab.hover('[data-t="delete"]', { force: true });
    await tab.waitForTimeout(300);
    assert.equal((await style(tab, "delete")).borderColor, "rgb(251, 113, 133)");
  });
});

test("hover feedback on primary and ghost", { skip }, async () => {
  await withPage(page(1440, false, false), async (tab) => {
    const p0 = (await style(tab, "create")).shadow;
    const g0 = (await style(tab, "edit")).borderColor;
    await tab.hover('[data-t="create"]', { force: true }); await tab.waitForTimeout(300);
    assert.notEqual((await style(tab, "create")).shadow, p0, "primary hover shadow");
    await tab.hover('[data-t="edit"]', { force: true }); await tab.waitForTimeout(300);
    assert.notEqual((await style(tab, "edit")).borderColor, g0, "ghost hover border");
  });
});

test("keyboard focus shows a visible outline", { skip }, async () => {
  await withPage(page(1440), async (tab) => {
    await tab.focus('[data-t="create"]');
    await tab.keyboard.press("Tab"); await tab.keyboard.press("Shift+Tab");
    assert.equal((await style(tab, "create")).outline, "solid");
  });
});

test("disabled create button is dimmed and not-allowed", { skip }, async () => {
  await withPage(page(1440, true), async (tab) => {
    const s = await style(tab, "create");
    assert.ok(Number(s.opacity) < 0.7, `opacity ${s.opacity}`);
    assert.equal(s.cursor, "not-allowed");
  });
});

test("card actions are left-aligned and bottom-aligned across a grid row", { skip }, async () => {
  await withPage(page(1440), async (tab) => {
    const [a, b] = [await style(tab, "start"), await tab.$eval('[data-id="b"] [data-t="start"]', (n: Element) => n.getBoundingClientRect().bottom)];
    const bodyLeft = await tab.$eval('[data-id="a"] .agent-card-body', (n: Element) => n.getBoundingClientRect().left + parseFloat(getComputedStyle(n).paddingLeft));
    assert.ok(Math.abs(a.left - bodyLeft) < 1, `start left ${a.left} vs ${bodyLeft}`);
    const cardBottoms = await tab.$$eval(".agent-card", (ns: Element[]) => ns.map((n) => n.getBoundingClientRect().bottom));
    // Owned card b has the extra own-row below; card a's single row sits at its card bottom.
    const aGap = cardBottoms[0] - a.bottom;
    assert.ok(aGap < 20, `card a actions not pinned to bottom (gap ${aGap})`);
    const ownBottom = await tab.$eval('[data-id="b"] .agent-card-act.own', (n: Element) => n.getBoundingClientRect().bottom);
    assert.ok(Math.abs((cardBottoms[1] - ownBottom) - aGap) < 1, "both cards end their actions at the same inset");
    assert.ok(b <= ownBottom);
  });
});

test("phone width: owner buttons stay visible and styled", { skip }, async () => {
  const tab = await browser.newPage({ viewport: { width: 360, height: 780 } });
  try {
    await tab.setContent(page(360));
    const s = await style(tab, "edit");
    assert.ok(s.height > 0);
    assert.equal(s.border, "1px solid");
  } finally { await tab.close(); }
});
