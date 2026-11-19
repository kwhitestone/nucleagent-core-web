import assert from 'node:assert/strict';

export async function checkProcessFoldChoice({ page, open, check }) {
  const toggle = () => page.locator('.mc-process-head').first();
  const expectOpen = async expected => {
    await page.waitForFunction(value => {
      const details = document.querySelector('.mc-process');
      return details.open === value && details.querySelector('summary').getAttribute('aria-expanded') === String(value);
    }, expected);
  };
  const update = async scenario => {
    await page.evaluate(value => window.sliceHarness.setScenario(value), scenario);
    await page.waitForFunction(value => document.querySelector('.mc-root > p').textContent.includes(`· ${value} ·`), scenario);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const assertClosed = async () => {
    assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.mc-process').evaluate(node => node.open), false);
  };

  await check('untouched running fold stays collapsed across a new mixed failure', async () => {
    await open('running');
    await expectOpen(false);
    await update('mixed');
    await expectOpen(false);
    await toggle().click();
    await expectOpen(true);
    assert.equal(await page.locator('.mc-step[data-state="failed"]:visible').count(), 1);
  });
  await check('explicit open survives mixed failure, completion, recovery and repeated updates', async () => {
    await open('running');
    await toggle().click();
    await expectOpen(true);
    for (const scenario of ['mixed', 'completed', 'running', 'mixed', 'recovery', 'failed']) {
      await update(scenario);
      await expectOpen(true);
    }
  });
  await check('explicit close survives later failures', async () => {
    await open('running');
    await update('mixed');
    await toggle().click();
    await expectOpen(true);
    await toggle().click();
    await expectOpen(false);
    for (const scenario of ['running', 'mixed', 'completed', 'mixed', 'failed', 'recovery']) {
      await update(scenario);
      await assertClosed();
    }
    await toggle().click();
    await expectOpen(true);
    assert.equal(await page.locator('.mc-step[data-state="failed"]:visible').count(), 1);
    assert.equal(await page.locator('.mc-step[data-state="done"]:visible').count(), 1);
  });
  for (const key of ['Enter', 'Space']) {
    await check(`${key} close remains closed across mixed failure updates`, async () => {
      await open('running');
      await toggle().focus();
      await page.keyboard.press(key);
      await expectOpen(true);
      await page.keyboard.press(key);
      await expectOpen(false);
      await update('mixed');
      await assertClosed();
      await page.keyboard.press(key);
      await expectOpen(true);
      assert.equal(await page.locator('.mc-step[data-state="failed"]:visible').count(), 1);
    });
  }
  await check('message identity resets to a collapsed neutral history', async () => {
    await open('mixed');
    await expectOpen(false);
    await page.evaluate(() => window.sliceHarness.switchMessage());
    await expectOpen(false);
    await update('running');
    await page.evaluate(() => window.sliceHarness.switchMessage());
    await expectOpen(false);
    await update('mixed');
    await expectOpen(false);
  });
}
