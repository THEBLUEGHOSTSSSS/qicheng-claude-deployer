'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { AppError, digest } = require('./config.cjs');

const CC_SWITCH = Object.freeze({
  version: '4.0.22',
  url: 'https://github.com/farion1231/cc-switch/releases/download/v4.0.22/CC-Switch-v4.0.22-Windows.msi',
  sha256: '3082108e964090380001b65017e544472b8bc39f03b3ccff47f1eaf010bdaa58',
  size: 18477056
});
const COMPONENTS = Object.freeze([
  { id: 'claude', name: 'Claude Code', required: true, winget: 'Anthropic.ClaudeCode', detail: '命令行与共享配置的基础组件' },
  { id: 'git', name: 'Git for Windows', required: false, winget: 'Git.Git', detail: '推荐安装：提供 Git Bash 和版本管理' },
  { id: 'vscode', name: 'Visual Studio Code', required: true, winget: 'Microsoft.VisualStudioCode', detail: '老师日常使用的图形工作区' },
  { id: 'extension', name: 'Claude Code 官方扩展', required: true, detail: '在 VS Code 中打开 Claude 对话面板' },
  { id: 'ccswitch', name: 'CC Switch', required: false, detail: '可选：管理和切换多个模型服务商' }
]);

function run(file, args, { timeout = 15000, env = process.env, maxOutput = 65536 } = {}) {
  return new Promise(resolve => {
    let child; let output = ''; let timer; let settled = false;
    const done = result => { if (settled) return; settled = true; clearTimeout(timer); resolve({ output, ...result }); };
    try { child = spawn(file, args, { shell: false, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { done({ code: null, error: 'launch' }); return; }
    const collect = data => { if (output.length < maxOutput) output += data.toString('utf8').slice(0, maxOutput - output.length); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', () => done({ code: null, error: 'launch' }));
    child.on('close', code => done({ code }));
    if (timeout) timer = setTimeout(() => {
      child.kill();
      done({ code: null, error: 'timeout' });
    }, timeout);
  });
}
const exists = async p => { if (!p) return false; try { return (await fs.stat(p)).isFile(); } catch { return false; } };
async function firstFile(paths) { for (const p of paths) if (await exists(p)) return p; return null; }
async function where(name) {
  const r = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe'), [name]);
  if (r.code !== 0) return null;
  return firstFile(r.output.trim().split(/\r?\n/).map(p => p.trim()).filter(p => p.toLowerCase().endsWith('.exe')));
}

async function locations(home = os.homedir()) {
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const program = process.env.ProgramFiles || 'C:\\Program Files';
  const claude = await firstFile([path.join(home, '.local', 'bin', 'claude.exe'), await where('claude.exe')]);
  const git = await firstFile([path.join(program, 'Git', 'cmd', 'git.exe'), path.join(local, 'Programs', 'Git', 'cmd', 'git.exe'), await where('git.exe')]);
  const vscode = await firstFile([path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(program, 'Microsoft VS Code', 'Code.exe')]);
  let ccswitch = await firstFile([path.join(local, 'CC Switch', 'cc-switch.exe'), path.join(local, 'Programs', 'CC Switch', 'cc-switch.exe'), path.join(program, 'CC Switch', 'cc-switch.exe')]);
  if (!ccswitch) {
    const reg = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), ['query', 'HKCR\\ccswitch\\shell\\open\\command', '/ve']);
    const match = reg.output.match(/"([^"\r\n]*\\cc-switch\.exe)"/i);
    if (match && await exists(match[1])) ccswitch = match[1];
  }
  return { claude, git, vscode, ccswitch };
}

async function codeCommand(vscode, args, options = {}) {
  if (!vscode) throw new AppError('NO_VSCODE', '请先安装 VS Code。');
  const cli = path.join(path.dirname(vscode), 'resources', 'app', 'out', 'cli.js');
  if (!await exists(cli)) throw new AppError('NO_CODE_CLI', '未找到 VS Code 命令行入口，请修复 VS Code 安装。');
  return run(vscode, [cli, ...args], { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
}
function windowsSupported(platform = process.platform, release = os.release(), arch = process.arch) {
  const [major, , build] = release.split('.').map(Number);
  return platform === 'win32' && major >= 10 && build >= 17763 && arch === 'x64';
}

async function diagnose(home, preview = false) {
  if (preview) return { components: COMPONENTS.map(c => ({ ...c, status: 'unknown', version: '', detail: '预览模式，未检查目标 Windows 电脑' })), environmentWarnings: ['当前为预览模式，安装、写入和网络测试已停用。'] };
  const found = await locations(home); const components = [];
  for (const component of COMPONENTS) {
    let status = 'missing'; let version = ''; let detail = component.detail;
    if (component.id === 'extension') {
      if (found.vscode) {
        const r = await codeCommand(found.vscode, ['--list-extensions', '--show-versions']);
        if (r.code === 0) {
          const match = r.output.match(/^anthropic\.claude-code@([^\r\n]+)/mi);
          if (match) { status = 'installed'; version = match[1]; }
        } else { status = 'unknown'; detail = '无法读取 VS Code 扩展列表，请打开 VS Code 检查。'; }
      }
    } else if (found[component.id]) {
      if (component.id === 'ccswitch') { status = 'installed'; detail = '已找到程序；仍需启动确认其状态。'; }
      else {
        const r = component.id === 'vscode' ? await codeCommand(found.vscode, ['--version']) : await run(found[component.id], ['--version']);
        if (r.code === 0) { status = 'installed'; version = r.output.match(/\b\d+\.\d+\.\d+(?:[.-][a-zA-Z0-9]+)*/)?.[0] || '已检测'; }
        else { status = 'unknown'; detail = '已找到程序，但版本检查失败；请重新打开软件检查。'; }
      }
    }
    components.push({ id: component.id, name: component.name, required: component.required, status, version, detail });
  }
  const environmentWarnings = [];
  for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CONFIG_DIR']) {
    if (process.env[key]) environmentWarnings.push(`进程环境中存在 ${key}，可能影响配置。这里只报告名称，不显示值。`);
  }
  if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY) environmentWarnings.push('检测到代理环境变量；部署器不会修改系统代理。短请求测试与 Claude 客户端的代理行为可能不同。');
  return { components, environmentWarnings };
}

async function downloadCcSwitch(directory, fetcher = fetch) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetcher(CC_SWITCH.url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new AppError('DOWNLOAD_FAILED', `CC Switch 下载失败（HTTP ${response.status}）。`);
    const parts = []; let total = 0;
    for await (const chunk of response.body) { total += chunk.length; if (total > CC_SWITCH.size) { controller.abort(); throw new AppError('HASH_MISMATCH', '安装包大小不符，已停止。'); } parts.push(Buffer.from(chunk)); }
    const bytes = Buffer.concat(parts);
    if (total !== CC_SWITCH.size || digest(bytes) !== CC_SWITCH.sha256) throw new AppError('HASH_MISMATCH', 'CC Switch 安装包摘要与锁定发布不符，已停止安装。');
    const file = path.join(directory, 'cc-switch-' + CC_SWITCH.version + '.msi');
    await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
    return file;
  } finally { clearTimeout(timer); }
}

async function installComponent(id, home) {
  const component = COMPONENTS.find(c => c.id === id);
  if (!component) throw new AppError('INVALID_COMPONENT', '未知组件。');
  let result;
  if (id === 'ccswitch') {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'qicheng-install-'));
    try {
      const file = await downloadCcSwitch(temp);
      result = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'msiexec.exe'), ['/i', file, '/passive', '/norestart'], { timeout: 0 });
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  } else if (id === 'extension') {
    result = await codeCommand((await locations(home)).vscode, ['--install-extension', 'anthropic.claude-code'], { timeout: 0 });
  } else {
    // App Execution Aliases can be reparse points; probing the fixed command is
    // more reliable than requiring fs.stat(alias).isFile(). No form data is used.
    const availability = await run('winget.exe', ['--version']);
    if (availability.code !== 0) throw new AppError('NO_WINGET', '未找到可运行的 WinGet。请从 Microsoft Store 安装或更新“应用安装程序”，重新打开部署器后重试。');
    result = await run('winget.exe', ['install', '--id', component.winget, '--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], { timeout: 0 });
  }
  if (result.error) throw new AppError('INSTALL_LAUNCH', '安装进程无法启动，请检查系统权限。');
  if (![0, 3010].includes(result.code)) throw new AppError('INSTALL_FAILED', `安装未完成（退出码 ${result.code}）。可能是权限、下载、已安装版本或安装器取消。请检查安装窗口并重新检测。`);
  return { message: result.code === 3010 ? '安装器完成，要求重新启动 Windows。请保存工作后重启。' : '安装器已完成。正在重新检测；最终结果以检测和实际启动为准。', exitCode: result.code };
}
module.exports = { CC_SWITCH, COMPONENTS, run, locations, codeCommand, windowsSupported, diagnose, downloadCcSwitch, installComponent };
