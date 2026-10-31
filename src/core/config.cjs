'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new AppError(code, message); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function normalizeProvider(input) {
  if (!object(input)) fail('INVALID_INPUT', '请填写服务商配置。');
  const string = (key, max, required = false) => {
    if (input[key] != null && typeof input[key] !== 'string') fail('INVALID_INPUT', '配置字段类型无效。');
    const value = (input[key] || '').trim();
    if (value.length > max || /[\u0000-\u001f\u007f]/u.test(value) || (required && !value)) fail('INVALID_INPUT', '请检查名称、地址、密钥和模型字段。');
    return value;
  };
  const name = string('name', 80) || '自定义服务';
  const apiKey = string('apiKey', 4096, true);
  const model = string('model', 180);
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]*$/.test(model)) fail('INVALID_MODEL', '模型 ID 只允许字母、数字及 . _ : / @ -。');
  let url;
  try { url = new URL(string('baseUrl', 1000, true)); } catch { fail('INVALID_URL', '请输入完整 HTTPS API 地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('INVALID_URL', 'API 地址必须为 HTTPS，且不能包含账号、密码、查询参数或片段。');
  if (url.hostname === 'docs.rayinai.com') fail('DOCS_NOT_API', '这是文档地址，请从服务商控制台复制 API 基址。');
  if (url.pathname !== '/' && /\/(v1|messages|chat\/completions)\/?$/i.test(url.pathname)) fail('API_BASE_ONLY', '请填写 API 基址，不要加 /v1 或 /messages。');
  if (url.hostname === 'localhost' || /^127\./.test(url.hostname) || url.hostname === '[::1]') fail('LOCAL_ENDPOINT', '首版配置面向 HTTPS 服务商。已有本地 CC Switch 路由请在 CC Switch 内管理。');
  const authType = input.authType || 'auth_token';
  if (!['auth_token', 'api_key'].includes(authType)) fail('INVALID_AUTH', '请选择有效认证类型。');
  return { name, baseUrl: url.href.replace(/\/$/, ''), apiKey, model, authType };
}

async function guardedPath(home, target) {
  const base = path.resolve(home);
  const rel = path.relative(base, path.resolve(target));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) fail('UNSAFE_PATH', '配置路径超出用户目录。');
  let cursor = base;
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) fail('UNSAFE_PATH', '配置路径使用链接，已停止写入。请人工检查。');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

async function readConfig(home) {
  const file = path.join(home, '.claude', 'settings.json');
  await guardedPath(home, file);
  let bytes;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) fail('INVALID_CONFIG', 'settings.json 不是普通文件或超过 1 MB，请人工检查。');
    bytes = await fs.readFile(file);
  } catch (e) {
    if (e.code === 'ENOENT') return { file, bytes: null, data: {}, hash: null };
    throw e;
  }
  let data;
  try { data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { fail('INVALID_JSON', '已有 settings.json 格式损坏，已停止覆盖。请先备份并修复 JSON。'); }
  if (!object(data) || (data.env != null && !object(data.env))) fail('INVALID_CONFIG', '已有配置或 env 结构无效，已停止覆盖。');
  return { file, bytes, data, hash: digest(bytes) };
}

function mergeProvider(data, p) {
  if (data.apiKeyHelper) fail('AUTH_HELPER', '已有 apiKeyHelper 认证助手。请先确认其用途，部署器不会自动替换。');
  const env = { ...(data.env || {}) };
  for (const key of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
    if (env[key] && env[key] !== '0') fail('AUTH_CONFLICT', '已有云平台认证配置，请在原客户端中确认后再配置。');
  }
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.ANTHROPIC_BASE_URL = p.baseUrl;
  env[p.authType === 'api_key' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'] = p.apiKey;
  if (p.model) env.ANTHROPIC_MODEL = p.model;
  else delete env.ANTHROPIC_MODEL;
  return { ...data, env };
}

function changesFor(oldData, newData) {
  const keys = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'];
  const display = (key, val) => val == null ? '未设置' : /KEY|TOKEN/.test(key) ? '••••••••（已隐藏）' : key === 'ANTHROPIC_BASE_URL' ? safeEndpoint(val) : String(val);
  return keys.filter(k => oldData.env?.[k] !== newData.env?.[k]).map(key => ({ key, before: display(key, oldData.env?.[key]), after: display(key, newData.env?.[key]) }));
}

async function planConfig(home, input) {
  const provider = normalizeProvider(input);
  const current = await readConfig(home);
  const next = mergeProvider(current.data, provider);
  return { current, next, provider, public: { path: current.file, changes: changesFor(current.data, next), warnings: ['密钥将按 Claude Code 的配置格式保存在本机明文文件中；备份也可能包含原密钥。', '保存后请重启 VS Code / Claude Code。工作区设置或系统环境变量仍可能覆盖此配置。'] } };
}

async function atomicWrite(file, bytes) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { await fs.rename(temporary, file); } catch (e) { await fs.rm(temporary, { force: true }); throw e; }
}

async function applyPlan(home, plan) {
  const current = await readConfig(home);
  if (current.hash !== plan.current.hash) fail('CONFIG_CHANGED', '配置在预览后发生了变化，请重新预览。');
  const nextBytes = Buffer.from(JSON.stringify(plan.next, null, 2) + '\n');
  const backupId = crypto.randomUUID();
  const directory = path.join(home, '.claude', 'qicheng-backups');
  await guardedPath(home, path.join(directory, backupId + '.json'));
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const backup = { schema: 1, id: backupId, createdAt: new Date().toISOString(), original: current.bytes?.toString('base64') ?? null, originalHash: current.hash, appliedHash: digest(nextBytes) };
  // Save a recovery record before the atomic replacement; an interrupted write cannot erase the original.
  await atomicWrite(path.join(directory, backupId + '.json'), Buffer.from(JSON.stringify(backup)));
  const fresh = await readConfig(home);
  if (fresh.hash !== current.hash) fail('CONFIG_CHANGED', '配置已被其他程序修改，已停止写入。');
  await atomicWrite(current.file, nextBytes);
  return { backupId, message: '配置已保存，原配置已备份。请重启 VS Code / Claude Code，再进行验证。' };
}

async function listBackups(home) {
  const directory = path.join(home, '.claude', 'qicheng-backups');
  await guardedPath(home, directory);
  try {
    const names = (await fs.readdir(directory)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n));
    const backups = [];
    for (const name of names) {
      await guardedPath(home, path.join(directory, name));
      const stat = await fs.stat(path.join(directory, name));
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
      try { const b = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')); if (b.schema === 1 && b.id + '.json' === name) backups.push({ id: b.id, createdAt: b.createdAt }); } catch { /* Damaged records are not restoration candidates. */ }
    }
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

async function restoreBackup(home, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) fail('INVALID_BACKUP', '备份标识无效。');
  const file = path.join(home, '.claude', 'qicheng-backups', id + '.json');
  await guardedPath(home, file);
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) fail('INVALID_BACKUP', '备份无效。');
  const b = JSON.parse(await fs.readFile(file, 'utf8'));
  const current = await readConfig(home);
  if (b.schema !== 1 || b.id !== id || current.hash !== b.appliedHash) fail('RESTORE_CONFLICT', '当前配置已被修改，自动恢复会覆盖后续改动，已停止。请人工合并备份。');
  if (b.original === null && b.originalHash === null) await fs.unlink(current.file);
  else {
    if (typeof b.original !== 'string') fail('INVALID_BACKUP', '备份内容无效。');
    const bytes = Buffer.from(b.original, 'base64');
    if (digest(bytes) !== b.originalHash) fail('INVALID_BACKUP', '备份校验失败。');
    await atomicWrite(current.file, bytes);
  }
  return { message: '已恢复修改前的配置。备份记录已保留。' };
}

function safeEndpoint(value) {
  try { const u = new URL(value); return u.protocol + '//' + u.host; } catch { return '地址格式异常'; }
}
async function configSummary(home) {
  try {
    const c = await readConfig(home); const e = c.data.env || {}; const issues = [];
    if (e.ANTHROPIC_AUTH_TOKEN && e.ANTHROPIC_API_KEY) issues.push('同时存在两种密钥字段，请确认认证优先级。');
    if (c.data.apiKeyHelper) issues.push('存在 apiKeyHelper；自动配置将停止。');
    if (e.ANTHROPIC_BASE_URL && /localhost|127\.0\.0\.1/.test(e.ANTHROPIC_BASE_URL)) issues.push('当前使用本地路由，请确认 CC Switch 的路由服务已经启动。');
    const hasKey = Boolean(e.ANTHROPIC_AUTH_TOKEN || e.ANTHROPIC_API_KEY);
    return { exists: !!c.bytes, valid: true, configured: hasKey, hasKey, endpoint: e.ANTHROPIC_BASE_URL ? safeEndpoint(e.ANTHROPIC_BASE_URL) : '默认 Anthropic', model: e.ANTHROPIC_MODEL ? String(e.ANTHROPIC_MODEL).slice(0,180) : '客户端默认', issues };
  } catch (e) { return { exists: true, valid: false, configured: false, hasKey: false, endpoint: '', model: '', issues: [e instanceof AppError ? e.message : '无法读取配置，请检查文件权限。'] }; }
}

function buildDeepLink(input) {
  const p = normalizeProvider(input);
  // Upstream v4.0.22 always writes AUTH_TOKEN from the link. Do not silently turn
  // an API_KEY configuration into two conflicting authentication fields.
  if (p.authType !== 'auth_token') fail('CCSWITCH_AUTH_MODE', 'CC Switch 深链接会使用 Bearer Token。官方 API Key 请直接保存配置，或在 CC Switch 内添加官方预设。');
  const params = new URLSearchParams({ resource: 'provider', app: 'claude', name: p.name, endpoint: p.baseUrl, apiKey: p.apiKey, apiFormat: 'anthropic', enabled: 'false' });
  const env = { ANTHROPIC_BASE_URL: p.baseUrl, [p.authType === 'api_key' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN']: p.apiKey };
  if (p.model) { params.set('model', p.model); env.ANTHROPIC_MODEL = p.model; }
  params.set('config', Buffer.from(JSON.stringify({env})).toString('base64'));
  params.set('configFormat', 'json');
  const link = 'ccswitch://v1/import?' + params.toString();
  if (link.length > 8000) fail('CCSWITCH_LINK_TOO_LONG', '配置超出系统链接长度限制，请在 CC Switch 中手动添加服务。');
  return link;
}
module.exports = { AppError, fail, digest, normalizeProvider, guardedPath, readConfig, mergeProvider, planConfig, applyPlan, listBackups, restoreBackup, configSummary, buildDeepLink, safeEndpoint };
