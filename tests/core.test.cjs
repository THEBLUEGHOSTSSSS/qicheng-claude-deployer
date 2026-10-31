'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const c = require('../src/core/config.cjs');
const { testConnection } = require('../src/core/connection.cjs');
const { reportFor } = require('../src/core/report.cjs');
const { windowsSupported, installComponent, downloadCcSwitch, CC_SWITCH } = require('../src/core/windows.cjs');

const provider = { name: '实验室 A & B', baseUrl: 'https://gateway.example.org', apiKey: 'sk-TEST-only-never-real', model: 'demo-sonnet', authType: 'auth_token' };
async function fixture(t, value) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'qicheng-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  if (value !== undefined) { await fs.mkdir(path.join(home, '.claude')); await fs.writeFile(path.join(home, '.claude/settings.json'), typeof value === 'string' ? value : JSON.stringify(value)); }
  return home;
}
test('new config is created only on apply, with recovery removing just the created file', async t => {
  const home = await fixture(t); const plan = await c.planConfig(home, provider);
  assert.equal(plan.current.bytes, null);
  await assert.rejects(fs.stat(path.join(home, '.claude/settings.json')), { code: 'ENOENT' });
  assert.ok(!JSON.stringify(plan.public).includes(provider.apiKey));
  const result = await c.applyPlan(home, plan);
  assert.equal((await c.readConfig(home)).data.env.ANTHROPIC_AUTH_TOKEN, provider.apiKey);
  await c.restoreBackup(home, result.backupId);
  await assert.rejects(fs.stat(path.join(home, '.claude/settings.json')), { code: 'ENOENT' });
  assert.equal((await c.listBackups(home)).length, 1);
});
test('merges only managed fields, retains hooks/permissions/unknown keys, restores exact original bytes', async t => {
  const original = '\uFEFF{\n "env": {"KEEP_ME":"yes","ANTHROPIC_API_KEY":"old-key","ANTHROPIC_MODEL":"old"}, "hooks":{"Stop":[]}, "permissions":{"deny":["Read(secret)"]}, "futureKey":true\n}\n';
  const home = await fixture(t, original);
  const result = await c.applyPlan(home, await c.planConfig(home, provider));
  const data = (await c.readConfig(home)).data;
  assert.equal(data.env.KEEP_ME, 'yes'); assert.equal(data.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(data.env.ANTHROPIC_AUTH_TOKEN, provider.apiKey); assert.deepEqual(data.hooks, { Stop: [] });
  assert.deepEqual(data.permissions, { deny: ['Read(secret)'] }); assert.equal(data.futureKey, true);
  await c.restoreBackup(home, result.backupId);
  assert.equal(await fs.readFile(path.join(home, '.claude/settings.json'), 'utf8'), original);
});
test('official API key mode clears conflicting token and empty model clears only primary override', async t => {
  const home = await fixture(t, { env: { ANTHROPIC_AUTH_TOKEN: 'old-token', ANTHROPIC_MODEL: 'old', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'keep' } });
  const plan = await c.planConfig(home, { ...provider, authType: 'api_key', model: '' });
  assert.equal(plan.next.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(plan.next.env.ANTHROPIC_API_KEY, provider.apiKey);
  assert.equal(plan.next.env.ANTHROPIC_MODEL, undefined);
  assert.equal(plan.next.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'keep');
});
test('invalid JSON is never overwritten', async t => {
  const home = await fixture(t, '{not-json');
  await assert.rejects(c.planConfig(home, provider), { code: 'INVALID_JSON' });
  assert.equal(await fs.readFile(path.join(home, '.claude/settings.json'), 'utf8'), '{not-json');
});
test('preview hides secrets embedded in an old endpoint URL', async t => {
  const home = await fixture(t, { env: { ANTHROPIC_BASE_URL: 'https://user:old-secret@example.org/path-secret?token=query-secret' } });
  const preview = (await c.planConfig(home, provider)).public;
  assert.ok(!JSON.stringify(preview).includes('old-secret'));
  assert.ok(!JSON.stringify(preview).includes('path-secret'));
  assert.ok(!JSON.stringify(preview).includes('query-secret'));
});
test('existing authentication helper or cloud routing blocks automatic changes', async t => {
  const home = await fixture(t, { apiKeyHelper: 'custom helper' });
  await assert.rejects(c.planConfig(home, provider), { code: 'AUTH_HELPER' });
  assert.throws(() => c.mergeProvider({ env: { CLAUDE_CODE_USE_BEDROCK: '1' } }, provider), { code: 'AUTH_CONFLICT' });
});
test('config changed after preview is preserved', async t => {
  const home = await fixture(t, {}); const plan = await c.planConfig(home, provider);
  await fs.writeFile(plan.current.file, '{"laterEdit":true}');
  await assert.rejects(c.applyPlan(home, plan), { code: 'CONFIG_CHANGED' });
  assert.deepEqual((await c.readConfig(home)).data, { laterEdit: true });
});
test('restore refuses to overwrite later edits', async t => {
  const home = await fixture(t, {}); const result = await c.applyPlan(home, await c.planConfig(home, provider));
  const file = path.join(home, '.claude/settings.json'); await fs.writeFile(file, '{"later":1}');
  await assert.rejects(c.restoreBackup(home, result.backupId), { code: 'RESTORE_CONFLICT' });
  assert.equal(await fs.readFile(file, 'utf8'), '{"later":1}');
});
test('tampered backup cannot be restored', async t => {
  const home = await fixture(t, { a: 1 }); const result = await c.applyPlan(home, await c.planConfig(home, provider));
  const file = path.join(home, '.claude/qicheng-backups', result.backupId + '.json');
  const backup = JSON.parse(await fs.readFile(file)); backup.original = Buffer.from('malicious').toString('base64');
  await fs.writeFile(file, JSON.stringify(backup));
  await assert.rejects(c.restoreBackup(home, result.backupId), { code: 'INVALID_BACKUP' });
  assert.equal((await c.readConfig(home)).data.env.ANTHROPIC_AUTH_TOKEN, provider.apiKey);
});
test('symlink directory and hardlinked config cannot redirect a write', async t => {
  const home = await fixture(t); const other = await fixture(t);
  await fs.symlink(other, path.join(home, '.claude'), 'dir');
  await assert.rejects(c.planConfig(home, provider), { code: 'UNSAFE_PATH' });
  const hard = await fixture(t, {}); await fs.link(path.join(hard, '.claude/settings.json'), path.join(hard, 'linked.json'));
  await assert.rejects(c.planConfig(hard, provider), { code: 'UNSAFE_PATH' });
});
test('rejects malicious/unsupported provider URLs and header injection', () => {
  for (const baseUrl of ['http://host.example', 'file:///tmp/config', 'https://u:p@host.example', 'https://host.example?key=abc', 'https://host.example#x', 'https://host.example/v1', 'https://host.example/v1/messages', 'https://docs.rayinai.com', 'https://localhost']) assert.throws(() => c.normalizeProvider({ ...provider, baseUrl }));
  assert.throws(() => c.normalizeProvider({ ...provider, apiKey: 'a\r\nx-api-key:evil' }));
  assert.throws(() => c.normalizeProvider({ ...provider, authType: '__proto__' }));
  assert.throws(() => c.normalizeProvider({ ...provider, model: 'x; rm -rf /' }));
});
test('CC Switch protocol roundtrips reserved characters without auto-enable', () => {
  const input = { ...provider, apiKey: 'fake-key+A&B=#?', name: '实验室 A&B' };
  const url = new URL(c.buildDeepLink(input));
  assert.equal(url.protocol, 'ccswitch:'); assert.equal(url.host, 'v1'); assert.equal(url.pathname, '/import');
  assert.equal(url.searchParams.get('apiKey'), input.apiKey); assert.equal(url.searchParams.get('name'), input.name);
  assert.equal(url.searchParams.get('app'), 'claude'); assert.equal(url.searchParams.get('enabled'), 'false');
  assert.equal(url.searchParams.get('apiFormat'), 'anthropic');
  const embedded = JSON.parse(Buffer.from(url.searchParams.get('config'), 'base64'));
  assert.equal(embedded.env.ANTHROPIC_AUTH_TOKEN, input.apiKey);
});
test('CC Switch rejects API-key mode rather than silently importing conflicting auth fields', () => {
  assert.throws(() => c.buildDeepLink({ ...provider, authType: 'api_key' }), { code: 'CCSWITCH_AUTH_MODE' });
});
test('connection sends only one bounded Messages request and confirms response schema', async () => {
  let calls = 0;
  const result = await testConnection(provider, async (url, options) => {
    calls++; assert.equal(url, 'https://gateway.example.org/v1/messages'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer ' + provider.apiKey);
    const body = JSON.parse(options.body); assert.equal(body.max_tokens, 16); assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply with OK.' }]); assert.equal(body.tools, undefined);
    return new Response(JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }] }), { status: 200 });
  });
  assert.equal(calls, 1); assert.equal(result.status, 'passed'); assert.ok(!JSON.stringify(result).includes(provider.apiKey));
});
test('official API key uses x-api-key and no Bearer header', async () => {
  await testConnection({ ...provider, authType: 'api_key' }, async (_url, opts) => { assert.equal(opts.headers['x-api-key'], provider.apiKey); assert.equal(opts.headers.authorization, undefined); return new Response('denied', { status: 401 }); });
});
for (const [label, body] of [['HTML', '<html>Login</html>'], ['fake success', '{"ok":true}'], ['empty text', '{"type":"message","role":"assistant","content":[]}']]) {
  test('rejects HTTP 200 with ' + label, async () => { const result = await testConnection(provider, async () => new Response(body)); assert.equal(result.status, 'failed'); });
}
test('auth errors do not disclose provider error bodies or retry', async () => {
  let count = 0; const result = await testConnection(provider, async () => { count++; return new Response('echo secret ' + provider.apiKey, { status: 401 }); });
  assert.equal(result.status, 'failed'); assert.equal(count, 1); assert.ok(!JSON.stringify(result).includes(provider.apiKey));
});
test('network exception text cannot disclose credentials and does not retry', async () => {
  let count = 0; const result = await testConnection(provider, async () => { count++; throw new Error('URL with secret: ' + provider.apiKey); });
  assert.equal(count, 1); assert.equal(result.status, 'failed'); assert.ok(!JSON.stringify(result).includes(provider.apiKey));
});
test('oversized successful response is rejected', async () => {
  const result = await testConnection(provider, async () => new Response('x'.repeat(140000)));
  assert.equal(result.status, 'failed'); assert.match(result.message, /过大/);
});
test('missing model fails before network request', async () => {
  await assert.rejects(testConnection({ ...provider, model: '' }, async () => { assert.fail('must not request'); }), { code: 'MODEL_REQUIRED' });
});
test('reports whitelist only diagnostic fields, excluding keys, paths and raw provider content', () => {
  const report = reportFor({ appVersion: '0.1.0', platform: 'win32', arch: 'x64', osVersion: '10.0.22631', supported: true, preview: false,
    components: [{ id: 'claude', status: 'installed', version: '2.0.0', detail: provider.apiKey }], config: { exists: true, valid: true, hasKey: true, endpoint: provider.apiKey, model: provider.apiKey, bytes: provider.apiKey }, extra: provider.apiKey }, { status: 'passed', model: provider.apiKey, message: provider.apiKey });
  assert.ok(!JSON.stringify(report).includes(provider.apiKey)); assert.equal(report.configuration.hasKey, true);
  assert.equal(reportFor({ components: [], config: {} }, null).connection.status, 'not_tested');
});
test('Windows support rejects other platforms, old builds and unqualified architecture', () => {
  assert.equal(windowsSupported('win32', '10.0.22631', 'x64'), true);
  assert.equal(windowsSupported('win32', '10.0.17763', 'x64'), true);
  assert.equal(windowsSupported('win32', '10.0.17134', 'x64'), false);
  assert.equal(windowsSupported('darwin', '25.0.0', 'x64'), false);
  assert.equal(windowsSupported('win32', '10.0.22631', 'arm64'), false);
});
test('unknown installer ID is rejected before any launch', async () => {
  await assert.rejects(installComponent('claude; echo bad'), { code: 'INVALID_COMPONENT' });
});
test('CC Switch installer digest mismatch never produces executable file', async t => {
  const home = await fixture(t);
  await assert.rejects(downloadCcSwitch(home, async () => new Response('untrusted bytes')), { code: 'HASH_MISMATCH' });
  assert.deepEqual(await fs.readdir(home), []); assert.match(CC_SWITCH.sha256, /^[a-f0-9]{64}$/);
});
