const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const [playwrightPath, cdpURL, targetId, origin, conversationId, outputDir] = process.argv.slice(2);
assert.ok(outputDir, 'usage: node tests/browser/muyu407-message-actions.cjs <playwright-module> <business-cdp-url> <owned-target-id> <core-web-origin> <conversation-id> <output-dir>');
assert.ok(!['9441', '9442'].includes(new URL(cdpURL).port), 'authentication source browsers are reserved');
const { chromium } = require(playwrightPath);

(async () => {
  const browser = await chromium.connectOverCDP(cdpURL, { timeout: 15000 });
  const evidence = { conversationId, origin, checks: [], screenshots: [], writes: 'NONE', testEnvironment: 'caller must verify deployed SHA/environment' };
  try {
    let ownedPage;
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const session = await context.newCDPSession(page);
        try {
          const info = await session.send('Target.getTargetInfo');
          if (info.targetInfo.targetId === targetId) ownedPage = page;
        } finally { await session.detach(); }
      }
    }
    assert.ok(ownedPage, 'owned target must already exist; this script never opens tabs');
    const frame = ownedPage.frames().find((candidate) => {
      try { return new URL(candidate.url()).origin === origin; } catch { return false; }
    });
    assert.ok(frame, 'expected core-web frame must already be open');
    const root = frame.locator('.mc-root');
    await root.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await root.getAttribute('data-conversation-key'), conversationId);
    const user = root.locator('[data-message-role="user"]').first();
    const assistant = root.locator('[data-message-role="assistant"]').last();
    await user.hover();
    await user.getByRole('button', { name: /^(编辑|Edit)$/ }).waitFor();
    assert.equal(await user.getByRole('button', { name: /^(分叉对话|Fork chat)$/ }).isEnabled(), true);
    await assistant.hover();
    for (const name of [/^(好评|Good response)$/, /^(差评|Bad response)$/, /^(重新生成|Regenerate)$/]) {
      assert.equal(await assistant.getByRole('button', { name }).isEnabled(), true);
    }
    mkdirSync(outputDir, { recursive: true });
    const screenshot = async (name) => {
      await root.screenshot({ path: path.join(outputDir, `${name}.png`), timeout: 15000 });
      evidence.screenshots.push(`${name}.png`);
    };
    await screenshot('01-message-actions');
    await user.getByRole('button', { name: /^(编辑|Edit)$/ }).click();
    await user.getByRole('textbox', { name: /^(编辑|Edit)$/ }).waitFor();
    await screenshot('02-edit-original');
    await user.getByRole('button', { name: /^(取消|Cancel)$/ }).click();
    evidence.checks.push('persisted user edit/fork and assistant feedback/regenerate controls enabled', 'edit/cancel opens original content without submission');
    const details = assistant.getByRole('button', { name: /^(反馈详情|Feedback details)$/ });
    if (await details.count()) {
      await details.click();
      await screenshot('03-persisted-feedback-details');
      await assistant.getByRole('button', { name: /^(取消|Cancel)$/ }).click();
    } else evidence.checks.push('feedback details screenshot NOT_RUN: fixture needs a persisted negative vote');
  } finally {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(path.join(outputDir, 'screenshots.json'), JSON.stringify(evidence, null, 2));
    await browser.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
