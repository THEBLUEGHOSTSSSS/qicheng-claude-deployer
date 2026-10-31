// Synthetic UI fixture. Never packaged. No file writes, downloads or model calls.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
app.whenReady().then(() => {
  const components = ['claude', 'git', 'vscode', 'extension', 'ccswitch'].map(id => ({ id, name: id, status: id === 'ccswitch' ? 'missing' : 'installed', version: 'fixture', detail: '模拟检查，仅用于 UI 测试', required: !['git', 'ccswitch'].includes(id) }));
  ipcMain.handle('deployer:action', async (_event, action, data) => {
    if (action === 'status') return { ok: true, data: { appVersion: 'fixture', platform: 'win32', arch: 'x64', osVersion: '10.0.22631', supported: true, preview: false, components, config: { exists: true, valid: true, hasKey: false, issues: [] }, environmentWarnings: [], generatedAt: new Date().toISOString() } };
    if (action === 'previewConfig') return { ok: true, data: { path: 'FIXTURE/.claude/settings.json', changes: [{ key: 'ANTHROPIC_BASE_URL', before: '未设置', after: data.baseUrl }], warnings: ['fixture only'] } };
    if (action === 'applyConfig') return { ok: true, data: { message: '模拟保存，未写文件', backupId: 'fixture-backup' } };
    if (action === 'testConnection') return { ok: true, data: { status: 'failed', message: '<img src=x onerror=alert(1)> 模拟 401', httpStatus: 401 } };
    return { ok: false, error: { code: 'FIXTURE_ERROR', message: '模拟错误：未执行操作' } };
  });
  const win = new BrowserWindow({ width: 1220, height: 850, show: true, webPreferences: { preload: path.join(__dirname, '../src/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
});
app.on('window-all-closed', () => app.quit());
