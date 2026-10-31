'use strict';
// Electron requires its own launcher; the browser CLI cannot exercise desktop IPC.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'playwright');
const cleanEnv = { ...process.env }; delete cleanEnv.ELECTRON_RUN_AS_NODE;

(async () => {
  await fs.mkdir(output, { recursive: true });
  const observations = [];
  let application;
  try {
    application = await electron.launch({ args: [root, '--preview'], env: cleanEnv });
    const page = await application.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.locator('#mode-banner').waitFor({ state: 'visible' });
    await page.locator('#environment-components .component-row').first().waitFor();
    assert.equal(await page.locator('#environment-components .component-row').count(), 5);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal((await page.evaluate(() => window.deployer.invoke('install', { id: 'claude' }))).ok, false);
    assert.equal((await page.evaluate(() => window.deployer.invoke('previewConfig', {}))).error.code, 'PREVIEW_ONLY');
    assert.equal((await page.evaluate(() => window.deployer.invoke('arbitrary-shell', {}))).ok, false);
    await page.screenshot({ path: path.join(output, 'desktop-environment.png'), fullPage: true, animations: 'disabled' });
    await page.locator('[data-step="connect"]').click();
    await page.locator('[data-preset="rayin"]').click();
    assert.equal(await page.locator('#base-url').inputValue(), 'https://www.rayinai.com');
    await page.locator('#api-key').fill('sk-FAKE-UI-ONLY');
    await page.locator('#toggle-key').click(); assert.equal(await page.locator('#api-key').getAttribute('type'), 'text');
    await page.locator('#toggle-key').click();
    assert.equal(await page.locator('[data-action="applyConfig"]').isDisabled(), true);
    await page.locator('#api-key').fill('');
    await page.screenshot({ path: path.join(output, 'desktop-connection.png'), fullPage: true, animations: 'disabled' });
    await page.locator('[data-step="verify"]').click();
    assert.equal(await page.locator('[data-action="testConnection"]').isDisabled(), true);
    assert.match(await page.locator('#test-state').innerText(), /待测试|未测试/);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 900));
    await page.locator('[data-step="connect"]').click();
    assert.equal(await page.locator('[data-action="importCcSwitch"]').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(output, 'desktop-narrow.png'), fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []);
    observations.push('Real Electron preview: 5 component rows, local UI navigation, no Node exposure, unsafe IPC refused, preview writes/network disabled, no overflow at 780px.');
  } finally { if (application) await application.close(); }
  try {
    application = await electron.launch({ args: [path.join(root, 'tests/ui-host.cjs')], env: cleanEnv });
    const page = await application.firstWindow();
    await page.locator('#os-label').filter({ hasText: 'Windows' }).waitFor();
    await page.locator('[data-step="connect"]').click();
    await page.locator('#base-url').fill('https://gateway.example.org');
    await page.locator('#api-key').fill('sk-FAKE-UI-ONLY');
    await page.locator('#model').fill('demo-sonnet');
    await page.locator('[data-action="previewConfig"]').click();
    await page.locator('#config-preview').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-action="applyConfig"]').isEnabled(), true);
    await page.locator('#model').fill('changed-model');
    assert.equal(await page.locator('[data-action="applyConfig"]').isDisabled(), true);
    await page.locator('[data-action="previewConfig"]').click();
    await page.locator('[data-action="applyConfig"]').click();
    await page.locator('#notice').filter({ hasText: 'fixture-backup' }).waitFor();
    assert.equal(await page.locator('#api-key').inputValue(), '');
    await page.locator('#api-key').fill('sk-FAKE-UI-ONLY');
    await page.locator('[data-step="verify"]').click();
    await page.locator('[data-action="testConnection"]').click();
    await page.locator('#test-state').filter({ hasText: '模拟 401' }).waitFor();
    assert.equal(await page.locator('#test-state img').count(), 0);
    assert.match(await page.locator('#test-state').innerText(), /未通过/);
    assert.equal(await page.locator('[data-action="testConnection"]').isEnabled(), true);
    observations.push('Synthetic Windows UI fixture: preview prerequisite, edit invalidation, save clears key, failure recovery, untrusted response rendered as text. No Windows install or real API call.');
  } finally { if (application) await application.close(); }
  await fs.writeFile(path.join(output, 'ui-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), observations }, null, 2));
  console.log(observations.join('\n'));
})().catch(error => { console.error(error); process.exitCode = 1; });
