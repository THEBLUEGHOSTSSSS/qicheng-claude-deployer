'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const names = { environment: '环境检查', install: '安装组件', connect: '连接模型', verify: '验证与交付' };
  const icons = { claude: '>_', git: 'git', vscode: '</>', extension: '✳', ccswitch: '⇄' };
  const initial = [
    { id: 'claude', name: 'Claude Code', required: true },
    { id: 'git', name: 'Git for Windows', required: false },
    { id: 'vscode', name: 'Visual Studio Code', required: true },
    { id: 'extension', name: 'Claude Code 官方扩展', required: true },
    { id: 'ccswitch', name: 'CC Switch', required: false }
  ].map(c => ({ ...c, status: 'unknown', detail: '等待检查', version: '' }));
  let currentStatus = null; let busy = false; let previewValid = false;
  const native = Boolean(window.deployer);
  const interactive = () => native && currentStatus && !currentStatus.preview && currentStatus.supported;
  const nativeActions = ['install', 'previewConfig', 'applyConfig', 'restore', 'testConnection', 'importCcSwitch'];

  function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el; }
  function navigate(step) {
    if (!Object.hasOwn(names, step)) return;
    $$('.page').forEach(page => { page.hidden = page.id !== 'page-' + step; });
    $$('.nav-step').forEach(button => { const selected = button.dataset.step === step; button.classList.toggle('active', selected); if (selected) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current'); });
    $('#section-label').textContent = names[step];
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function notice(message, type = 'success') { const el = $('#notice'); el.textContent = message; el.className = 'notice ' + type; el.hidden = false; }
  function updateButtons() {
    $$('#provider-form input, #provider-form select, [data-preset], #toggle-key').forEach(control => { control.disabled = busy; });
    $$('[data-action]').forEach(button => {
      const action = button.dataset.action;
      button.disabled = busy || (!native && action !== 'status') || (nativeActions.includes(action) && !interactive()) || (action === 'applyConfig' && !previewValid) || (action === 'open' && ['vscode', 'ccswitch', 'loginSettings'].includes(button.dataset.id) && !interactive());
      if (action === 'install') {
        const component = currentStatus?.components.find(c => c.id === button.dataset.id);
        if (component?.status === 'installed') button.disabled = true;
        if (button.dataset.id === 'extension' && currentStatus?.components.find(c => c.id === 'vscode')?.status !== 'installed') button.disabled = true;
      }
    });
    $('#operation-label').textContent = busy ? '操作进行中，请稍候…' : '仅在你选择后执行操作';
    $('#operation-label').classList.toggle('busy-indicator', busy);
  }
  function badge(status) {
    return element('span', 'status-badge ' + status, ({ installed: '已检测', missing: '待安装', unknown: '待确认', passed: '请求通过', failed: '未通过' })[status] || '待确认');
  }
  function renderComponents(components) {
    for (const [selector, installing] of [['#environment-components', false], ['#install-components', true]]) {
      const container = $(selector); container.replaceChildren();
      for (const c of components) {
        const row = element('div', 'component-row');
        row.append(element('span', 'component-icon', icons[c.id] || '◇'));
        const content = element('div', 'component-content'); const title = element('div', 'component-name', c.name);
        if (!c.required) title.append(element('span', 'optional-tag', '可选'));
        content.append(title, element('p', 'component-description', [c.version, c.detail].filter(Boolean).join(' · '))); row.append(content);
        if (installing) {
          const actions = element('div', 'component-actions'); actions.append(badge(c.status));
          const button = element('button', 'button secondary small', c.status === 'installed' ? '已安装' : '安装'); button.dataset.action = 'install'; button.dataset.id = c.id;
          actions.append(button); row.append(actions);
        } else row.append(badge(c.status));
        container.append(row);
      }
    }
  }
  function renderStatus(data) {
    currentStatus = data;
    $('#app-version').textContent = 'v' + data.appVersion;
    const platformName = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[data.platform] || data.platform;
    $('#os-label').textContent = `${platformName} · ${data.arch}${data.osVersion ? ' / ' + data.osVersion : ''}`;
    $('#scan-time').textContent = data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '未检查';
    const mode = $('#mode-banner'); mode.hidden = !(data.preview || !data.supported);
    if (!mode.hidden) mode.textContent = native ? '当前是界面预览：未检测或修改本机 Claude 配置。请在 Windows x64 电脑运行交付包完成安装与验证。' : '浏览器预览 · 以下为示例界面，未连接本机部署服务；没有执行环境检测或安装。';
    renderComponents(data.components);
    $('#config-state').textContent = data.preview ? '配置文件 · 未检查' : !data.config.valid ? '配置文件 · 需要修复' : data.config.hasKey ? '配置文件 · 已发现密钥字段' : '配置文件 · 尚未发现 API 密钥';
    $('#config-detail').textContent = data.preview ? '预览模式不读取你的本机配置。' : data.config.issues.length ? data.config.issues.join(' ') : '配置状态不代表登录或模型可用；也可能使用已有的官方账户登录。';
    const warnings = $('#environment-warnings'); warnings.replaceChildren();
    const messages = [...(data.environmentWarnings || []), ...(data.config.issues || [])];
    warnings.hidden = !messages.length; messages.forEach(text => warnings.append(element('p', '', text)));
    updateButtons();
  }
  function values() { return { name: $('#provider-name').value, baseUrl: $('#base-url').value, apiKey: $('#api-key').value, model: $('#model').value, authType: $('#auth-type').value }; }
  function invalidatePreview() {
    previewValid = false; $('#config-preview').hidden = true;
    $('#test-state').replaceChildren(element('span', 'status-badge unknown', '待测试'), element('span', '', '配置已变更，需使用当前填写内容重新测试。'));
    updateButtons();
  }
  function renderPreview(data) {
    $('#preview-path').textContent = data.path; const changes = $('#preview-changes'); changes.replaceChildren();
    if (!data.changes.length) changes.append(element('p', 'quiet', '此配置与当前管理字段一致。'));
    for (const change of data.changes) { const row = element('div', 'preview-change'); row.append(element('code', '', change.key), element('span', '', `${change.before} → ${change.after}`)); changes.append(row); }
    $('#preview-warnings').textContent = data.warnings.join(' ');
    $('#config-preview').hidden = false; previewValid = true;
  }
  function renderTest(data) {
    const container = $('#test-state'); container.replaceChildren(badge(data.status), element('span', '', data.message));
  }
  async function invoke(action, payload = {}) {
    const result = await window.deployer.invoke(action, payload);
    if (!result?.ok) throw new Error(result?.error?.message || '操作未完成，请重新检查。');
    return result.data;
  }
  async function perform(action, id) {
    if (busy) return;
    if (!native) { notice('当前是浏览器示例。请用桌面部署器运行真实检查。', 'info'); return; }
    if (nativeActions.includes(action) && !interactive()) { notice('当前环境只支持预览。', 'info'); return; }
    const providerActions = ['previewConfig', 'applyConfig', 'testConnection', 'importCcSwitch'];
    if (providerActions.includes(action) && !$('#provider-form').reportValidity()) { navigate('connect'); return; }
    if (action === 'testConnection' && !$('#model').value.trim()) { notice('请先填写服务商实际支持的模型 ID。', 'error'); navigate('connect'); $('#model').focus(); return; }
    if (action === 'applyConfig' && !previewValid) return;
    busy = true; updateButtons();
    try {
      const data = await invoke(action, providerActions.includes(action) ? values() : id ? { id } : {});
      if (data.cancelled) { notice(data.message || '已取消。', 'info'); return; }
      if (action === 'status') { renderStatus(data); notice('检查已更新。' + (data.preview ? '当前为预览模式。' : ''), 'info'); }
      else if (action === 'previewConfig') { renderPreview(data); notice('预览已生成，检查下方修改内容后再保存。'); }
      else if (action === 'testConnection') { renderTest(data); notice(data.message, data.status === 'passed' ? 'success' : 'error'); }
      else {
        notice(data.message || '操作已返回。');
        if (action === 'applyConfig') { $('#api-key').value = ''; $('#api-key').type = 'password'; $('#toggle-key').textContent = '显示'; invalidatePreview(); notice(`${data.message} 备份：${data.backupId}。如需测试或导入 CC Switch，请重新输入密钥。`); }
        if (['install', 'applyConfig', 'restore'].includes(action)) { try { renderStatus(await invoke('status')); } catch { notice('操作已返回，但重新检测失败。请点击“重新检查”。', 'error'); } }
      }
    } catch (error) {
      if (action === 'status') { $('#scan-time').textContent = '检查失败'; }
      if (action === 'applyConfig') invalidatePreview();
      if (action === 'testConnection') renderTest({ status: 'failed', message: '测试未完成，不能据此判断模型可用。' });
      notice(error.message || '操作未完成，请重新检查。', 'error');
    } finally { busy = false; updateButtons(); }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.step || button.dataset.goto) navigate(button.dataset.step || button.dataset.goto);
    if (button.dataset.action) perform(button.dataset.action, button.dataset.id);
    if (button.dataset.preset) {
      const presets = { custom: ['自定义服务', '', 'auth_token'], anthropic: ['Anthropic', 'https://api.anthropic.com', 'api_key'], rayin: ['RayinAPI', 'https://www.rayinai.com', 'auth_token'] };
      const [name, url, auth] = presets[button.dataset.preset]; $('#provider-name').value = name; $('#base-url').value = url; $('#auth-type').value = auth;
      $('#api-key').value = ''; $('#model').value = ''; invalidatePreview();
    }
  });
  $('#provider-form').addEventListener('submit', event => event.preventDefault());
  $('#provider-form').addEventListener('input', invalidatePreview);
  $('#provider-form').addEventListener('change', invalidatePreview);
  $('#toggle-key').addEventListener('click', () => { const input = $('#api-key'); const show = input.type === 'password'; input.type = show ? 'text' : 'password'; $('#toggle-key').textContent = show ? '隐藏' : '显示'; $('#toggle-key').setAttribute('aria-label', show ? '隐藏密钥' : '显示密钥'); });
  renderComponents(initial); updateButtons();
  if (native) perform('status');
  else renderStatus({ appVersion: '0.1.0', platform: '示例', arch: '未检查', osVersion: '', supported: false, preview: true, components: initial.map(c => ({ ...c, detail: '示例 · 待目标电脑检测' })), config: { valid: true, issues: [] }, environmentWarnings: [], generatedAt: null });
})();
