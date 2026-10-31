'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session, protocol, net } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { AppError, normalizeProvider, planConfig, applyPlan, listBackups, restoreBackup, configSummary, buildDeepLink } = require('./core/config.cjs');
const { diagnose, windowsSupported, installComponent, COMPONENTS, locations } = require('./core/windows.cjs');
const { testConnection } = require('./core/connection.cjs');
const { reportFor } = require('./core/report.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'qicheng', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const preview = process.argv.includes('--preview') || !windowsSupported();
const home = os.homedir();
let window; let lastConnection = null; let pendingPlan = null; let busy = false;
const cancelled = { cancelled: true, message: '已取消，未执行操作。' };
const links = Object.freeze({ docs: 'https://code.claude.com/docs/en/vs-code', rayin: 'https://docs.rayinai.com/claude-code/introduction', ccswitchDocs: 'https://github.com/farion1231/cc-switch', loginSettings: 'vscode://settings/claudeCode.disableLoginPrompt' });
async function confirm(message, detail, button = '继续') {
  const { response } = await dialog.showMessageBox(window, { type: 'question', title: '启程 · 确认操作', message, detail, buttons: ['取消', button], defaultId: 0, cancelId: 0, noLink: true });
  return response === 1;
}
async function status() {
  return { appVersion: app.getVersion(), platform: process.platform, arch: process.arch, osVersion: os.release(), supported: windowsSupported(), preview,
    ...(await diagnose(home, preview)),
    config: preview ? { exists: false, valid: true, configured: false, hasKey: false, endpoint: '预览模式，未读取本机配置', model: '', issues: [] } : await configSummary(home), generatedAt: new Date().toISOString() };
}
function writable() {
  if (preview) throw new AppError('PREVIEW_ONLY', '当前为预览模式。请在 Windows 10 1809+ / Windows 11 x64 上运行交付包。');
  if (process.env.CLAUDE_CONFIG_DIR) throw new AppError('CUSTOM_CONFIG_DIR', '检测到 CLAUDE_CONFIG_DIR 自定义目录。为避免写错位置，请在原工具中管理该配置。');
}
async function handle(action, input) {
  if (action === 'status') return status();
  if (action === 'previewConfig') { pendingPlan = await planConfig(home, input); return pendingPlan.public; }
  if (action === 'exportReport') {
    const data = reportFor(await status(), lastConnection);
    const result = await dialog.showSaveDialog(window, { title: '导出脱敏诊断报告', defaultPath: 'Claude-诊断报告.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled) return cancelled;
    await fs.writeFile(result.filePath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    return { message: '诊断报告已导出，不包含密钥或原始配置。' };
  }
  if (action === 'open') {
    if (Object.hasOwn(links, input.id)) {
      if (input.id === 'loginSettings') writable();
      await shell.openExternal(links[input.id]);
      return { message: input.id === 'loginSettings' ? '已请求打开 VS Code 登录提示设置。使用第三方 API 时，可勾选 Disable Login Prompt。' : '已打开官方文档。' };
    }
    writable();
    if (!['vscode', 'ccswitch'].includes(input.id)) throw new AppError('INVALID_ACTION', '未知应用。');
    const file = (await locations(home))[input.id];
    if (!file) throw new AppError('APP_MISSING', '未找到程序，请先安装；便携版可从原目录手动启动。');
    const error = await shell.openPath(file);
    if (error) throw new AppError('OPEN_FAILED', '应用未能启动，请从开始菜单手动打开。');
    return { message: input.id === 'vscode' ? '已请求启动 VS Code。请打开一个工作文件夹，然后点击 Claude 图标。' : '已请求启动 CC Switch。首次启动可导入当前配置；请在其界面确认。' };
  }
  writable();
  if (action === 'install') {
    const component = COMPONENTS.find(c => c.id === input.id);
    if (!component) throw new AppError('INVALID_COMPONENT', '未知组件。');
    if (!await confirm(`安装 ${component.name}？`, '将联网下载并运行该组件的官方安装程序。WinGet 会接受对应安装协议，系统可能提示权限确认。请等待安装结果，不要关闭部署器。', '安装')) return cancelled;
    return installComponent(input.id, home);
  }
  if (action === 'applyConfig') {
    const plan = pendingPlan;
    if (!plan || JSON.stringify(normalizeProvider(input)) !== JSON.stringify(plan.provider)) throw new AppError('PREVIEW_REQUIRED', '请先预览当前填写的配置，再保存。');
    if (!await confirm('保存 Claude Code 配置？', `目标：${plan.public.path}\n服务地址：${plan.provider.baseUrl}\n认证方式：${plan.provider.authType}\n模型：${plan.provider.model || '客户端默认'}\n将更改：${plan.public.changes.map(c => c.key).join('、') || '无差异'}\n原文件先备份；保留其他设置。密钥和备份按客户端要求以本地明文存储。请先退出 Claude Code 和 CC Switch，避免同时修改。`, '备份并保存')) return cancelled;
    pendingPlan = null;
    lastConnection = null;
    return applyPlan(home, plan);
  }
  if (action === 'restore') {
    const backups = await listBackups(home);
    if (!backups.length) throw new AppError('NO_BACKUP', '没有可恢复的部署器备份。');
    const backup = backups[0];
    if (!await confirm('恢复最近一次修改前的配置？', `备份时间：${backup.createdAt}\n若配置已有后续修改，程序会停止恢复。备份会继续保留。`, '恢复')) return cancelled;
    lastConnection = null;
    return restoreBackup(home, backup.id);
  }
  if (action === 'testConnection') {
    const p = normalizeProvider(input);
    if (!p.model) throw new AppError('MODEL_REQUIRED', '请输入服务商实际支持的模型 ID。');
    if (!await confirm('发送一次连接测试？', `服务地址：${p.baseUrl}\n模型：${p.model}\n只发送固定短文本“Reply with OK.”，最多生成 16 token，不传任何文件。此操作可能消耗服务商额度。`, '发送一次')) return cancelled;
    const result = await testConnection(p, net.fetch);
    lastConnection = { ...result, checkedAt: new Date().toISOString() };
    return result;
  }
  if (action === 'importCcSwitch') {
    const p = normalizeProvider(input);
    const link = buildDeepLink(p);
    if (!await confirm('将服务商配置交给 CC Switch？', `服务地址：${p.baseUrl}\n系统深链接将携带你输入的密钥，可能被系统协议处理记录看到。不会写入部署器报告。\n请确保安装的是官方 CC Switch；导入与启用仍需在其窗口确认，重复导入可能产生副本。`, '打开导入窗口')) return cancelled;
    try { await shell.openExternal(link); } catch { throw new AppError('CCSWITCH_OPEN_FAILED', '无法打开 CC Switch，请先安装并启动一次，再重试。'); }
    return { message: '已向系统提交导入请求。请在 CC Switch 内确认导入并选择是否启用；此处无法确认导入结果。' };
  }
  throw new AppError('UNKNOWN_ACTION', '不支持此操作。');
}

function createWindow() {
  window = new BrowserWindow({ width: 1220, height: 850, minWidth: 760, minHeight: 620, title: '启程 · Claude 部署器', backgroundColor: '#f5f4ef', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => {
    if (busy) { event.preventDefault(); dialog.showMessageBox(window, { type: 'info', message: '操作正在进行，请等待结果后关闭。', detail: '若安装程序需要确认，请先处理系统安装窗口。' }); }
  });
  window.loadURL('qicheng://app/index.html');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(() => {
    const assets = new Set(['index.html', 'app.js', 'styles.css']);
    protocol.handle('qicheng', request => {
      const url = new URL(request.url); const name = url.pathname.slice(1);
      if (url.host !== 'app' || !assets.has(name)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(path.join(__dirname, 'renderer', name)).href);
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    ipcMain.handle('deployer:action', async (event, action, input = {}) => {
      let acquired = false;
      try {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== 'qicheng://app/index.html') throw new AppError('INVALID_SENDER', '不允许的调用来源。');
        if (typeof action !== 'string' || !input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('INVALID_INPUT', '请求格式无效。');
        if (busy) throw new AppError('BUSY', '已有操作正在进行，请稍候。');
        busy = true;
        acquired = true;
        // Preview must never read the real user configuration, even through previewConfig.
        if (preview && action === 'previewConfig') throw new AppError('PREVIEW_ONLY', '预览模式不读取或写入本机配置。');
        return { ok: true, data: await handle(action, input) };
      } catch (error) {
        return { ok: false, error: { code: error instanceof AppError ? error.code : 'OPERATION_FAILED', message: error instanceof AppError ? error.message : '操作失败。请检查文件权限、网络或安装窗口，再导出诊断报告。' } };
      } finally { if (acquired) busy = false; }
    });
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
