'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['status', 'install', 'previewConfig', 'applyConfig', 'restore', 'testConnection', 'importCcSwitch', 'open', 'exportReport']);
contextBridge.exposeInMainWorld('deployer', Object.freeze({
  invoke: (action, payload = {}) => {
    if (!allowed.has(action)) return Promise.resolve({ ok: false, error: { code: 'UNKNOWN_ACTION', message: '不支持此操作。' } });
    return ipcRenderer.invoke('deployer:action', action, payload);
  }
}));
